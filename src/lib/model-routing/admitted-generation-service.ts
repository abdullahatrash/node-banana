import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { resolveDurableProviderKey } from "@/lib/byok/repository";
import { getDb } from "@/lib/db";
import { assets, brandProfiles } from "@/lib/db/schema";
import { canUseS3Storage, createPresignedDownload } from "@/lib/storage";
import { configuredCatalog, findCuratedModel } from "./catalog";
import { inspirationRightsSnapshots } from "./db-schema";
import { productionGenerationExecution } from "./execution-production";
import { PRODUCTION_MODEL_ROUTING } from "./production";
import { createImmutableRightsEvidence, loadRightsEvidence } from "./rights-evidence-repository";
import { hydrateRightsSnapshot, validateRightsEvidence } from "./rights-evidence";
import { validateGenerationSources } from "./source-validation";
import type { ArabicVariety, ContentLanguage, ExactModelRef, GenerationCapability, InspirationRightsEvidence, InspirationRightsSnapshot } from "./types";
import { getReleaseControlService } from "@/lib/release-control/production";
import type { OperationRecord } from "@/lib/agent-runtime/operation-status/types";
import { loadImmutableBrandContext } from "./brand-context";

export interface AdmittedGenerationInput {
  prompt: string; model: ExactModelRef & { provider: "replicate" }; capability: GenerationCapability; contentLanguage: ContentLanguage; arabicVariety: ArabicVariety | null;
  quantity: number; sourceAssetIds: string[]; rightsBasis: "owned" | "licensed" | "public_domain" | "consented"; permittedRemix: "reference_only" | "transform" | "derivative"; rightsEvidenceIds: string[];
  remixBrief: { preserve: string[]; transform: string[]; avoid: string[] };
}
export type AdmittedGenerationResult = { ok: true; status: 200 | 202; value: { intentId: string; operation: OperationRecord; provider: unknown; operationHref: string } } | { ok: false; status: 402 | 409 | 422 | 503; code: string; nextActions?: Array<{ code: string; href: string }> };
const fail = (status: 402 | 409 | 422 | 503, code: string, nextActions?: Array<{ code: string; href: string }>): AdmittedGenerationResult => ({ ok: false, status, code, ...(nextActions ? { nextActions } : {}) });
const rightsId = (workspaceId: string, key: string) => `rights_${createHash("sha256").update(`studio:${workspaceId}:${key}`).digest("hex").slice(0, 32)}`;

/** Owns the complete rights -> intent -> reservation -> operation -> provider admission transaction boundary. */
export async function admitAndExecuteStudioGeneration(context: { workspaceId: string; userId: string; role: string; planTier: string; idempotencyKey: string; input: AdmittedGenerationInput }): Promise<AdmittedGenerationResult> {
  const { input } = context; const model = findCuratedModel(input.model, configuredCatalog());
  if (!model || model.qualification.status !== "qualified") return fail(422, "MODEL_NOT_EXECUTABLE", [{ code: "configure_model", href: "/studio/model-routing" }]);
  if (!canUseS3Storage()) return fail(503, "CANONICAL_ARTIFACT_STORAGE_UNAVAILABLE", [{ code: "configure_storage", href: "/studio/settings/storage" }]);
  const releaseFlagId = process.env.ADMITTED_GENERATION_RELEASE_FLAG_ID?.trim();
  if (!releaseFlagId && process.env.NODE_ENV === "production") return fail(503, "GENERATION_RELEASE_FLAG_UNCONFIGURED");
  if (releaseFlagId) {
    try { const flag = await getReleaseControlService().evaluateReleaseFlag(context.workspaceId, context.userId, releaseFlagId, { role: context.role, entitlement: context.planTier, locale: input.contentLanguage === "en" ? "en" : "ar", entryPoint: "simple_studio_generation" }, `${context.idempotencyKey}:flag`); if (!flag.enabled) return fail(409, "GENERATION_RELEASE_FLAG_DISABLED"); }
    catch { return fail(503, "GENERATION_RELEASE_FLAG_UNAVAILABLE"); }
  }
  const credential = await resolveDurableProviderKey(context.workspaceId, "replicate");
  if (!credential) return fail(422, "DURABLE_REPLICATE_CREDENTIAL_REQUIRED", [{ code: "configure_provider_key", href: "/studio/settings/provider-keys" }]);
  const [brand] = await getDb().select().from(brandProfiles).where(and(eq(brandProfiles.workspaceId, context.workspaceId), eq(brandProfiles.status, "active"))).orderBy(desc(brandProfiles.revision)).limit(1);
  if (!brand?.acceptedAt) return fail(422, "ACCEPTED_BRAND_REVISION_REQUIRED", [{ code: "accept_brand", href: "/onboarding/brand-review" }]);
  const brandContext = await loadImmutableBrandContext({ workspaceId: context.workspaceId, profileId: brand.id, revision: brand.revision, acceptedAt: brand.acceptedAt, profile: brand.profile });
  if (!brandContext) return fail(422, "BRAND_REFERENCE_ASSET_NOT_READY", [{ code: "review_brand", href: "/onboarding/brand-review" }]);
  const sourceAssetIds = [...input.sourceAssetIds];
  const fetchedRows = sourceAssetIds.length ? await getDb().select({ id: assets.id, type: assets.type, storageKey: assets.storageKey, checksum: assets.checksum, mimeType: assets.mimeType, width: assets.width, height: assets.height, durationSeconds: assets.durationSeconds, metadata: assets.metadata, createdByUserId: assets.createdByUserId, createdAt: assets.createdAt }).from(assets).where(and(eq(assets.workspaceId, context.workspaceId), inArray(assets.id, sourceAssetIds), isNull(assets.deletedAt))) : [];
  const byId = new Map(fetchedRows.map((row) => [row.id, row]));
  const sourceRows = sourceAssetIds.map((id) => byId.get(id)).filter((row): row is (typeof fetchedRows)[number] => Boolean(row));
  const sourceValidation = validateGenerationSources(input.capability, sourceAssetIds, sourceRows.map((row) => ({ ...row, metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : null })), model.qualification.inputContract.imageMode);
  if (!sourceValidation.ok) return fail(422, sourceValidation.code, [{ code: "prepare_source", href: "/simple-studio/library" }]);
  if (input.permittedRemix === "reference_only" && input.remixBrief.transform.length) return fail(422, "REMIX_SCOPE_CONFLICT");
  const at = new Date(); const snapshotId = rightsId(context.workspaceId, context.idempotencyKey);
  const evidence = input.rightsBasis === "owned" ? await Promise.all(sourceRows.map(async (source) => { const result = await createImmutableRightsEvidence({ workspaceId: context.workspaceId, userId: context.userId, idempotencyKey: `${context.idempotencyKey}:owned:${source.id}`, sourceAssetId: source.id, basis: "owned", permittedRemix: input.permittedRemix, issuer: { type: "workspace_asset_owner", id: source.createdByUserId }, scope: { commercialUse: true, derivativeUse: true, modelInputUse: true, territories: ["worldwide"] }, evidenceDocumentAssetId: null, sourceUrl: null, issuedAt: source.createdAt, expiresAt: null, at }); return result.kind === "created" || result.kind === "replayed" ? result.evidence : null; })) : await loadRightsEvidence(context.workspaceId, [...new Set(input.rightsEvidenceIds)]);
  if (evidence.some((item) => !item)) return fail(422, "OWNERSHIP_EVIDENCE_UNAVAILABLE", [{ code: "review_rights", href: "/simple-studio/library" }]);
  const typedEvidence = evidence.filter((item): item is InspirationRightsEvidence => item !== null); const rightsValidation = validateRightsEvidence({ workspaceId: context.workspaceId, basis: input.rightsBasis, permittedRemix: input.permittedRemix, sourceAssetIds, evidence: typedEvidence, at });
  if (!rightsValidation.ok) return fail(422, rightsValidation.code, [{ code: "review_rights", href: "/simple-studio/library" }]);
  const rightsInput = { basis: input.rightsBasis, permittedRemix: input.permittedRemix, evidence: typedEvidence, sourceAssetIds }; const snapshot: InspirationRightsSnapshot = { schema: "inspiration-rights-snapshot/v1", id: snapshotId, workspaceId: context.workspaceId, revision: 1, ...rightsInput, digest: canonicalDigest(rightsInput) as `sha256:${string}`, createdByUserId: context.userId, createdAt: at };
  const [inserted] = await getDb().insert(inspirationRightsSnapshots).values({ workspaceId: context.workspaceId, id: snapshot.id, revision: 1, snapshot, digest: snapshot.digest, basis: snapshot.basis, permittedRemix: snapshot.permittedRemix, createdByUserId: context.userId, createdAt: at }).onConflictDoNothing().returning({ snapshot: inspirationRightsSnapshots.snapshot });
  const stored = inserted?.snapshot ?? (await getDb().select({ snapshot: inspirationRightsSnapshots.snapshot }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, context.workspaceId), eq(inspirationRightsSnapshots.id, snapshotId), eq(inspirationRightsSnapshots.revision, 1))).limit(1))[0]?.snapshot; const rights = stored ? hydrateRightsSnapshot(stored) : null;
  if (!rights || rights.digest !== snapshot.digest) return fail(409, "IDEMPOTENCY_CONFLICT");
  const created = await PRODUCTION_MODEL_ROUTING.createIntent({ workspaceId: context.workspaceId, brand: { profileId: brand.id, revision: brand.revision, digest: canonicalDigest(brand.profile) as `sha256:${string}`, acceptedAt: brand.acceptedAt, context: brandContext.context }, rawPrompt: input.prompt, capability: input.capability, contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety, rights: { snapshotId: rights.id, revision: rights.revision, digest: rights.digest, basis: rights.basis, permittedRemix: rights.permittedRemix, evidence: rights.evidence, sourceAssetIds: rights.sourceAssetIds }, remixBrief: input.remixBrief, requestedModel: input.model, selectedModel: input.model, fallbackAuthorizationId: null, quantity: input.quantity, userId: context.userId, idempotencyKey: `${context.idempotencyKey}:intent` });
  if (created.kind !== "created" && created.kind !== "replayed") return fail(created.kind === "unavailable" || created.kind === "budget_unavailable" ? 503 : created.kind === "budget_denied" ? 402 : 422, "code" in created && typeof created.code === "string" ? created.code : created.kind.toUpperCase(), [{ code: "inspect_operations", href: "/studio/operations" }]);
  if (!created.intent) return fail(503, "GENERATION_INTENT_UNAVAILABLE");
  const sourceUrls = await Promise.all(sourceRows.map(async (source) => (await createPresignedDownload({ key: source.storageKey! })).downloadUrl));
  const executed = await productionGenerationExecution(credential).execute({ workspaceId: context.workspaceId, userId: context.userId, intentId: created.intent.id, rawPrompt: input.prompt, sourceUrls, brandReferenceUrls: brandContext.referenceUrls, idempotencyKey: `${context.idempotencyKey}:execute` });
  if (executed.kind !== "accepted") return fail(executed.kind === "unavailable" ? 503 : 422, executed.code, [{ code: "inspect_intent", href: "/studio/model-routing" }]);
  return { ok: true, status: executed.operation.state === "succeeded" ? 200 : 202, value: { intentId: created.intent.id, operation: executed.operation, provider: executed.provider, operationHref: `/studio/operations?selected=${encodeURIComponent(executed.operation.id)}` } };
}
