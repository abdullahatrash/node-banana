import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { resolveDurableProviderKey } from "@/lib/byok/repository";
import { getDb } from "@/lib/db";
import { assets, brandProfiles } from "@/lib/db/schema";
import { configuredCatalog, findCuratedModel } from "@/lib/model-routing/catalog";
import { inspirationRightsSnapshots } from "@/lib/model-routing/db-schema";
import { productionGenerationExecution } from "@/lib/model-routing/execution-production";
import { PRODUCTION_MODEL_ROUTING } from "@/lib/model-routing/production";
import type { InspirationRightsSnapshot } from "@/lib/model-routing/types";
import { validateGenerationSources } from "@/lib/model-routing/source-validation";
import { canUseS3Storage, createPresignedDownload } from "@/lib/storage";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const modelRef = z.object({ provider: z.literal("replicate"), model: z.string().min(1).max(200), version: z.string().min(8).max(200), inputSchemaDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict();
const briefList = z.array(z.string().trim().min(1).max(200)).max(50);
const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(50_000), model: modelRef,
  capability: z.enum(["text_to_image","image_to_image","text_to_video","image_to_video","video_to_video"]),
  contentLanguage: z.enum(["ar","en","mixed"]), arabicVariety: z.enum(["msa","gulf","egyptian","levantine","maghrebi","other"]).nullable(),
  quantity: z.number().positive().max(600), sourceAssetIds: z.array(z.string().min(1).max(200)).max(8).default([]),
  rightsBasis: z.enum(["owned","licensed","public_domain","consented"]), permittedRemix: z.enum(["reference_only","transform","derivative"]),
  remixBrief: z.object({ preserve: briefList, transform: briefList, avoid: briefList }).strict(),
}).strict();

const stableRightsId = (workspaceId: string, key: string) => `rights_${createHash("sha256").update(`studio:${workspaceId}:${key}`).digest("hex").slice(0, 32)}`;
const action = (code: string, href: string, label: string) => ({ code, href, label });

/** One admitted Simple Studio path: rights snapshot -> intent/reservation -> durable operation -> provider. */
export const POST = withStudioAuth<undefined>({ route: "/api/studio/generations", action: "write" }, async (request: NextRequest, authz) => {
  const key = request.headers.get("idempotency-key")?.trim(); let raw: unknown = null; try { raw = await request.json(); } catch { /* schema handles it */ }
  const parsed = bodySchema.safeParse(raw);
  if (request.headers.get("x-workspace-id") !== authz.workspaceId || !key || key.length < 8 || !parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT", error: "Generation settings are incomplete or invalid." }, { status: 400 });
  const input = parsed.data; const model = findCuratedModel(input.model, configuredCatalog());
  if (!model || model.qualification.status !== "qualified") return noStoreJson({ success: false, code: "MODEL_NOT_EXECUTABLE", error: "This model has not been qualified with an immutable version, schema, safety parameters, and exact price.", nextActions: [action("configure_model", "/studio/model-routing", "Configure an executable model")] }, { status: 422 });
  if (!canUseS3Storage()) return noStoreJson({ success: false, code: "CANONICAL_ARTIFACT_STORAGE_UNAVAILABLE", error: "Canonical Workspace media storage must be configured before generation.", nextActions: [action("configure_storage", "/studio/settings/storage", "Configure media storage")] }, { status: 503 });
  const credential = await resolveDurableProviderKey(authz.workspaceId, "replicate");
  if (!credential) return noStoreJson({ success: false, code: "DURABLE_REPLICATE_CREDENTIAL_REQUIRED", error: "Store a Replicate key in the Workspace vault before starting asynchronous generation.", nextActions: [action("configure_provider_key", "/studio/settings/provider-keys", "Add Replicate key")] }, { status: 422 });
  const [brand] = await getDb().select().from(brandProfiles).where(and(eq(brandProfiles.workspaceId, authz.workspaceId), eq(brandProfiles.status, "active"))).orderBy(desc(brandProfiles.revision)).limit(1);
  if (!brand?.acceptedAt) return noStoreJson({ success: false, code: "ACCEPTED_BRAND_REVISION_REQUIRED", error: "Accept a Brand Profile revision before generating brand-aware media.", nextActions: [action("accept_brand", "/onboarding/brand-review", "Review and accept Brand Profile")] }, { status: 422 });
  const sourceIds = [...new Set(input.sourceAssetIds)];
  const sourceRows = sourceIds.length ? await getDb().select({ id: assets.id, type: assets.type, storageKey: assets.storageKey, checksum: assets.checksum, width: assets.width, height: assets.height, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, authz.workspaceId), inArray(assets.id, sourceIds), isNull(assets.deletedAt))) : [];
  const sourceValidation = validateGenerationSources(input.capability, sourceIds, sourceRows.map((row) => ({ ...row, metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : null })));
  if (!sourceValidation.ok) return noStoreJson({ success: false, code: sourceValidation.code, error: sourceValidation.code === "SOURCE_9_16_REQUIRED" ? "Image-to-video requires an exact 9:16 source." : "The source must be canonical Workspace media with server-verified dimensions.", nextActions: [action("prepare_source", "/simple-studio/library", "Choose a server-verified 9:16 source")] }, { status: 422 });
  if (input.rightsBasis !== "owned" && sourceIds.length === 0) return noStoreJson({ success: false, code: "RIGHTS_EVIDENCE_REQUIRED", error: "Non-owned rights require immutable evidence associated with every source.", nextActions: [action("review_rights", "/simple-studio/library", "Review inspiration rights")] }, { status: 422 });
  if (input.permittedRemix === "reference_only" && input.remixBrief.transform.length) return noStoreJson({ success: false, code: "REMIX_SCOPE_CONFLICT", error: "Reference-only rights cannot authorize requested transformations." }, { status: 422 });
  const at = new Date(); const rightsId = stableRightsId(authz.workspaceId, key); const evidenceRefs = sourceIds.map((id) => `asset:${id}`);
  const rightsInput = { basis: input.rightsBasis, permittedRemix: input.permittedRemix, evidenceRefs, sourceUrls: [] as string[] };
  const snapshot: InspirationRightsSnapshot = { schema: "inspiration-rights-snapshot/v1", id: rightsId, workspaceId: authz.workspaceId, revision: 1, ...rightsInput, digest: canonicalDigest(rightsInput) as `sha256:${string}`, createdByUserId: authz.userId, createdAt: at };
  const [inserted] = await getDb().insert(inspirationRightsSnapshots).values({ workspaceId: authz.workspaceId, id: snapshot.id, revision: 1, snapshot, digest: snapshot.digest, basis: snapshot.basis, permittedRemix: snapshot.permittedRemix, createdByUserId: authz.userId, createdAt: at }).onConflictDoNothing().returning({ snapshot: inspirationRightsSnapshots.snapshot });
  const rights = inserted?.snapshot ?? (await getDb().select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, authz.workspaceId), eq(inspirationRightsSnapshots.id, rightsId), eq(inspirationRightsSnapshots.revision, 1))).limit(1))[0]?.snapshot;
  if (!rights || rights.digest !== snapshot.digest) return noStoreJson({ success: false, code: "IDEMPOTENCY_CONFLICT", error: "This generation key was already used with different rights evidence." }, { status: 409 });
  const created = await PRODUCTION_MODEL_ROUTING.createIntent({ workspaceId: authz.workspaceId, brand: { profileId: brand.id, revision: brand.revision, digest: canonicalDigest(brand.profile) as `sha256:${string}`, acceptedAt: brand.acceptedAt }, rawPrompt: input.prompt, capability: input.capability, contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety, rights: { snapshotId: rights.id, revision: rights.revision, digest: rights.digest, basis: rights.basis, permittedRemix: rights.permittedRemix, evidenceRefs: rights.evidenceRefs, sourceUrls: rights.sourceUrls }, remixBrief: input.remixBrief, requestedModel: input.model, selectedModel: input.model, fallbackAuthorizationId: null, quantity: input.quantity, userId: authz.userId, idempotencyKey: `${key}:intent` });
  if (created.kind !== "created" && created.kind !== "replayed") { const unavailable = created.kind === "unavailable" || created.kind === "budget_unavailable"; const code = "code" in created ? created.code : created.kind.toUpperCase(); return noStoreJson({ success: false, code, error: unavailable ? "Generation admission is temporarily unavailable." : "Generation was not admitted by Workspace policy.", nextActions: [action("inspect_operations", "/studio/operations", "Inspect generation admission")] }, { status: unavailable ? 503 : created.kind === "budget_denied" ? 402 : 422 }); }
  if (!created.intent) return noStoreJson({ success: false, code: "GENERATION_INTENT_UNAVAILABLE", error: "The admitted Generation Intent could not be loaded." }, { status: 503 });
  const sourceUrls = await Promise.all(sourceRows.map(async (source) => (await createPresignedDownload({ key: source.storageKey! })).downloadUrl));
  const executed = await productionGenerationExecution(credential).execute({ workspaceId: authz.workspaceId, userId: authz.userId, intentId: created.intent.id, rawPrompt: input.prompt, sourceUrls, idempotencyKey: `${key}:execute` });
  if (executed.kind !== "accepted") return noStoreJson({ success: false, code: executed.code, error: "The admitted generation could not be started safely.", intentId: created.intent.id, nextActions: [action("inspect_intent", "/studio/model-routing", "Inspect Generation Intent")] }, { status: executed.kind === "unavailable" ? 503 : 422 });
  return noStoreJson({ success: true, intentId: created.intent.id, operation: executed.operation, provider: executed.provider, operationHref: `/studio/operations?selected=${encodeURIComponent(executed.operation.id)}` }, { status: executed.operation.state === "succeeded" ? 200 : 202 });
});
