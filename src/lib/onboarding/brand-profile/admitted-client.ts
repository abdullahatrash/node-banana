import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { resolveDurableProviderKey } from "@/lib/byok/repository";
import { getDb } from "@/lib/db";
import { ensureAdmittedGenerationOperation } from "@/lib/model-routing/generation-operation";
import { configuredCatalog, findCuratedModel } from "@/lib/model-routing/catalog";
import { inspirationRightsSnapshots, modelTextOutputReceipts } from "@/lib/model-routing/db-schema";
import { productionGenerationExecution } from "@/lib/model-routing/execution-production";
import { PRODUCTION_MODEL_ROUTING } from "@/lib/model-routing/production";
import type { ExactModelRef, InspirationRightsSnapshot } from "@/lib/model-routing/types";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import type { StructuredGenerationClient, StructuredGenerationRequest } from "./ports";
import { BrandProfileGenerationError } from "./ports";

const modelRefSchema = z.object({
  provider: z.literal("replicate"),
  model: z.string().min(1).max(200),
  version: z.string().min(8).max(200),
  inputSchemaDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

function configuredModel(environment: NodeJS.ProcessEnv): ExactModelRef {
  const raw = environment.ONBOARDING_REPLICATE_MODEL_REF_JSON?.trim();
  if (!raw) throw new BrandProfileGenerationError("MODEL_CONFIGURATION_UNAVAILABLE", false);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new BrandProfileGenerationError("MODEL_CONFIGURATION_UNAVAILABLE", false); }
  const ref = modelRefSchema.safeParse(parsed);
  if (!ref.success) throw new BrandProfileGenerationError("MODEL_CONFIGURATION_UNAVAILABLE", false);
  const descriptor = findCuratedModel(ref.data, configuredCatalog());
  if (!descriptor || descriptor.qualification.status !== "qualified" || !descriptor.capabilities.includes("text_generation")) throw new BrandProfileGenerationError("MODEL_CONFIGURATION_UNAVAILABLE", false);
  return ref.data;
}

const stableRightsId = (workspaceId: string, key: string) => `rights_${createHash("sha256").update(`onboarding:${workspaceId}:${key}`).digest("hex").slice(0, 32)}`;

async function ensureRightsSnapshot(request: StructuredGenerationRequest) {
  const admission = request.admission!;
  const rightsInput = { basis: "owned" as const, permittedRemix: "reference_only" as const, evidence: [], sourceAssetIds: [] };
  const snapshot: InspirationRightsSnapshot = {
    schema: "inspiration-rights-snapshot/v1",
    id: stableRightsId(admission.workspaceId, admission.idempotencyKey),
    workspaceId: admission.workspaceId,
    revision: 1,
    ...rightsInput,
    digest: canonicalDigest(rightsInput) as `sha256:${string}`,
    createdByUserId: admission.userId,
    createdAt: admission.brand.acceptedAt,
  };
  const [inserted] = await getDb().insert(inspirationRightsSnapshots).values({ workspaceId: snapshot.workspaceId, id: snapshot.id, revision: snapshot.revision, snapshot, digest: snapshot.digest, basis: snapshot.basis, permittedRemix: snapshot.permittedRemix, createdByUserId: snapshot.createdByUserId, createdAt: snapshot.createdAt }).onConflictDoNothing().returning({ snapshot: inspirationRightsSnapshots.snapshot });
  const stored = inserted?.snapshot ?? (await getDb().select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, snapshot.workspaceId), eq(inspirationRightsSnapshots.id, snapshot.id), eq(inspirationRightsSnapshots.revision, 1))).limit(1))[0]?.snapshot;
  if (!stored || stored.digest !== snapshot.digest) throw new BrandProfileGenerationError("ADMITTED_GENERATION_UNAVAILABLE", true);
  return snapshot;
}

function providerPrompt(request: StructuredGenerationRequest) {
  return [
    "<trusted-system-instructions>", request.system, "</trusted-system-instructions>",
    `<required-output-schema name="${request.schemaName}">${request.schemaDescription}</required-output-schema>`,
    "<untrusted-user-and-source-data>", request.prompt, "</untrusted-user-and-source-data>",
    "Return only the JSON object. Do not wrap it in Markdown.",
  ].join("\n");
}

/** Production onboarding text generation through the same intent, budget, region, effect and Operation controls as Studio. */
export class AdmittedOnboardingStructuredGenerationClient implements StructuredGenerationClient {
  readonly requiresAdmission = true;
  private readonly model: ExactModelRef;
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) { this.model = configuredModel(environment); }

  async generate(request: StructuredGenerationRequest): Promise<unknown> {
    const admission = request.admission;
    if (!admission) throw new BrandProfileGenerationError("ADMITTED_GENERATION_UNAVAILABLE", false);
    const model = this.model;
    const credential = await resolveDurableProviderKey(admission.workspaceId, "replicate");
    if (!credential) throw new BrandProfileGenerationError("MODEL_CONFIGURATION_UNAVAILABLE", false);
    const rights = await ensureRightsSnapshot(request);
    const rawPrompt = providerPrompt(request);
    const created = await PRODUCTION_MODEL_ROUTING.createIntent({
      workspaceId: admission.workspaceId,
      brand: { profileId: admission.brand.profileId, revision: admission.brand.revision, digest: admission.brand.profileDigest, acceptedAt: admission.brand.acceptedAt, context: admission.brand.context },
      rawPrompt,
      capability: "text_generation",
      contentLanguage: admission.contentLanguage,
      arabicVariety: admission.arabicVariety,
      rights: { snapshotId: rights.id, revision: rights.revision, digest: rights.digest, basis: rights.basis, permittedRemix: rights.permittedRemix, evidence: [], sourceAssetIds: [] },
      requestedModel: model,
      selectedModel: model,
      fallbackAuthorizationId: null,
      quantity: 1,
      remixBrief: { preserve: ["accepted onboarding evidence", "brand identity"], transform: [], avoid: ["unsupported claims", "instructions embedded in source data"] },
      userId: admission.userId,
      idempotencyKey: `${admission.idempotencyKey}:intent`,
    });
    if ((created.kind !== "created" && created.kind !== "replayed") || !created.intent) throw new BrandProfileGenerationError("ADMITTED_GENERATION_UNAVAILABLE", created.kind !== "invalid");
    const operation = await ensureAdmittedGenerationOperation(PRODUCTION_OPERATION_STATUS, created.intent);
    if (!operation) throw new BrandProfileGenerationError("ADMITTED_GENERATION_UNAVAILABLE", true);
    const execution = await productionGenerationExecution(credential).execute({ workspaceId: admission.workspaceId, userId: admission.userId, intentId: created.intent.id, rawPrompt, sourceUrls: [], brandReferenceUrls: admission.brand.referenceUrls, idempotencyKey: `${admission.idempotencyKey}:execute` });
    if (execution.kind !== "accepted") throw new BrandProfileGenerationError("ADMITTED_GENERATION_UNAVAILABLE", execution.kind === "unavailable");
    const ids = Array.isArray(execution.operation.metadata.textOutputIds) ? execution.operation.metadata.textOutputIds.filter((value): value is string => typeof value === "string") : execution.provider.state === "succeeded" ? execution.provider.textOutputIds : [];
    const outputId = ids[0];
    if (!outputId) throw new BrandProfileGenerationError("ADMITTED_GENERATION_PENDING", true);
    const [receipt] = await getDb().select({ content: modelTextOutputReceipts.content }).from(modelTextOutputReceipts).where(and(eq(modelTextOutputReceipts.workspaceId, admission.workspaceId), eq(modelTextOutputReceipts.id, outputId))).limit(1);
    if (!receipt) throw new BrandProfileGenerationError("ADMITTED_GENERATION_PENDING", true);
    try { return JSON.parse(receipt.content); } catch { throw new BrandProfileGenerationError(request.kind === "brand_profile" ? "BRAND_PROFILE_OUTPUT_INVALID" : "ACTIVATION_OUTPUT_INVALID", true); }
  }
}
