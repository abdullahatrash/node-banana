import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { resolveDurableProviderKey, resolveManagedProviderKey } from "@/lib/byok/repository";
import { getDb } from "@/lib/db";
import { assets, brandProfiles, workspaceProductRecords } from "@/lib/db/schema";
import { canUseS3Storage } from "@/lib/storage";
import { configuredCatalog, findCuratedModel } from "./catalog";
import { inspirationRightsSnapshots } from "./db-schema";
import { PRODUCTION_MODEL_ROUTING } from "./production";
import { createImmutableRightsEvidence, loadRightsEvidence } from "./rights-evidence-repository";
import { hydrateRightsSnapshot, validateRightsEvidence } from "./rights-evidence";
import { validateGenerationSources } from "./source-validation";
import type { ArabicVariety, ContentLanguage, ExactModelRef, GenerationCapability, InspirationRightsEvidence, InspirationRightsSnapshot } from "./types";
import type { ManagedCreditQuote, ManagedCreditQuoteAcceptance } from "./budget-authority";
import { getReleaseControlService } from "@/lib/release-control/production";
import type { OperationRecord } from "@/lib/agent-runtime/operation-status/types";
import { loadImmutableBrandContext } from "./brand-context";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { ensureAdmittedGenerationOperation } from "./generation-operation";
import { CREATOR_PERSONAS } from "@/lib/creator-personas/production";
import { CreatorPersonaError } from "@/lib/creator-personas/repository";
import { contentPieceSchema } from "@/lib/product-surfaces/definitions";
import { validateBrandAwareBlitzGenerationContract } from "@/lib/product-surfaces/blitz-generation-contract";
import { resolveContentFormatDefinitionReference } from "@/lib/product-surfaces/content-format-registry";
import { assertContentGenerationRequest, buildContentGenerationRecipe, contentProviderPrompt, ContentGenerationRecipeError } from "@/lib/product-surfaces/content-generation-recipe";
import { assertContentModelPolicy, ContentWorkflowRuntimeError } from "@/lib/product-surfaces/content-workflow-runtime";
import { contentModelAllowed, resolveContentModelPolicy } from "@/lib/product-surfaces/content-model-policy";
import { loadContentExecutionResources } from "@/lib/product-surfaces/content-execution-resources-repository";
import { persistCurrentContentModelPolicy } from "./content-model-policy-repository";

export interface AdmittedGenerationInput {
  prompt: string; model: ExactModelRef & { provider: "replicate" }; capability: GenerationCapability; contentLanguage: ContentLanguage; arabicVariety: ArabicVariety | null;
  quantity: number; sourceAssetIds: string[]; rightsBasis: "owned" | "licensed" | "public_domain" | "consented"; permittedRemix: "reference_only" | "transform" | "derivative"; rightsEvidenceIds: string[];
  remixBrief: { preserve: string[]; transform: string[]; avoid: string[] };
  fundingMode: "byok" | "managed";
  managedQuoteAcceptance?: ManagedCreditQuoteAcceptance | null;
  personaId?: string | null;
  contentExecution?: { contentPieceId: string; contentPieceRevision: number } | null;
  blitzContext?: { itemId: string; expectedRevision: number } | null;
}
export type AdmittedGenerationResult = { ok: true; status: 200 | 202; value: { intentId: string; operation: OperationRecord; provider: unknown; operationHref: string } } | { ok: false; status: 402 | 409 | 422 | 503; code: string; nextActions?: Array<{ code: string; href: string }>; managedCreditQuote?: ManagedCreditQuote };
const fail = (status: 402 | 409 | 422 | 503, code: string, nextActions?: Array<{ code: string; href: string }>, managedCreditQuote?: ManagedCreditQuote): AdmittedGenerationResult => ({ ok: false, status, code, ...(nextActions ? { nextActions } : {}), ...(managedCreditQuote ? { managedCreditQuote } : {}) });
const rightsId = (workspaceId: string, key: string) => `rights_${createHash("sha256").update(`studio:${workspaceId}:${key}`).digest("hex").slice(0, 32)}`;

/** Owns the complete rights -> intent -> reservation -> operation -> provider admission transaction boundary. */
export async function admitStudioGeneration(context: { workspaceId: string; userId: string; role: string; planTier: string; idempotencyKey: string; input: AdmittedGenerationInput }): Promise<AdmittedGenerationResult> {
  const { input } = context; const model = findCuratedModel(input.model, configuredCatalog());
  if (!model || model.qualification.status !== "qualified") return fail(422, "MODEL_NOT_EXECUTABLE", [{ code: "configure_model", href: "/studio/model-routing" }]);
  let persona: import("./types").GenerationPersonaBinding | null = null;
  if (input.personaId) {
    try { const prepared = await CREATOR_PERSONAS.prepareUsage({ workspaceId: context.workspaceId, personaId: input.personaId, purpose: "generation" }); persona = { ...prepared, purpose: "generation" }; }
    catch (error) { return fail(422, error instanceof CreatorPersonaError ? error.code : "PERSONA_USAGE_DENIED", [{ code: "review_persona", href: "/influencers" }]); }
    if (persona.model.provider !== input.model.provider || persona.model.model !== input.model.model || persona.model.version !== input.model.version || persona.model.inputSchemaDigest !== input.model.inputSchemaDigest) return fail(422, "PERSONA_MODEL_MISMATCH", [{ code: "select_persona_model", href: "/influencers" }]);
  }
  if (input.capability !== "text_generation" && !canUseS3Storage()) return fail(503, "CANONICAL_ARTIFACT_STORAGE_UNAVAILABLE", [{ code: "configure_storage", href: "/settings?section=storage" }]);
  const releaseFlagId = process.env.ADMITTED_GENERATION_RELEASE_FLAG_ID?.trim();
  if (!releaseFlagId && process.env.NODE_ENV === "production") return fail(503, "GENERATION_RELEASE_FLAG_UNCONFIGURED");
  if (releaseFlagId) {
    try { const flag = await getReleaseControlService().evaluateReleaseFlag(context.workspaceId, context.userId, releaseFlagId, { role: context.role, entitlement: context.planTier, locale: input.contentLanguage === "en" ? "en" : "ar", entryPoint: "simple_studio_generation" }, `${context.idempotencyKey}:flag`); if (!flag.enabled) return fail(409, "GENERATION_RELEASE_FLAG_DISABLED"); }
    catch { return fail(503, "GENERATION_RELEASE_FLAG_UNAVAILABLE"); }
  }
  const credential = input.fundingMode === "managed"
    ? resolveManagedProviderKey("replicate")
    : await resolveDurableProviderKey(context.workspaceId, "replicate");
  if (!credential) return input.fundingMode === "managed"
    ? fail(503, "MANAGED_REPLICATE_CREDENTIAL_UNAVAILABLE", [{ code: "inspect_billing", href: "/billing" }])
    : fail(422, "DURABLE_REPLICATE_CREDENTIAL_REQUIRED", [{ code: "configure_provider_key", href: "/settings?section=providers" }]);
  const [brand] = await getDb().select().from(brandProfiles).where(and(eq(brandProfiles.workspaceId, context.workspaceId), eq(brandProfiles.status, "active"))).orderBy(desc(brandProfiles.revision)).limit(1);
  if (!brand?.acceptedAt) return fail(422, "ACCEPTED_BRAND_REVISION_REQUIRED", [{ code: "accept_brand", href: "/brand" }]);
  if (input.blitzContext) {
    const [row] = await getDb().select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, context.workspaceId), eq(workspaceProductRecords.id, input.blitzContext.itemId), eq(workspaceProductRecords.kind, "blitz_item"), isNull(workspaceProductRecords.archivedAt))).limit(1);
    if (!row || row.state !== "queued" || row.revision !== input.blitzContext.expectedRevision) return fail(409, "BLITZ_REVISION_STALE", [{ code: "refresh_blitz", href: "/blitz" }]);
    const contract = validateBrandAwareBlitzGenerationContract({ payloadValue: row.payload, request: input, brand: { id: brand.id, revision: brand.revision, digest: canonicalDigest(brand.profile), acceptedAt: brand.acceptedAt } });
    if (!contract.ok) return fail(422, contract.code, [{ code: contract.code === "BLITZ_BRIEF_SNAPSHOT_REQUIRED" ? "requeue_inspiration" : "refresh_blitz", href: contract.code === "BLITZ_BRIEF_SNAPSHOT_REQUIRED" ? "/inspiration" : "/blitz" }]);
  }
  const brandContext = await loadImmutableBrandContext({ workspaceId: context.workspaceId, profileId: brand.id, revision: brand.revision, acceptedAt: brand.acceptedAt, profile: brand.profile });
  if (!brandContext) return fail(422, "BRAND_REFERENCE_ASSET_NOT_READY", [{ code: "review_brand", href: "/brand" }]);
  let sourceAssetIds = [...input.sourceAssetIds];
  let preparedContent: { record: typeof workspaceProductRecords.$inferSelect; payload: ReturnType<typeof contentPieceSchema.parse>; resolved: Awaited<ReturnType<typeof resolveContentFormatDefinitionReference>>; policy: NonNullable<ReturnType<typeof resolveContentModelPolicy>>; resources: Awaited<ReturnType<typeof loadContentExecutionResources>> } | null = null;
  if (input.contentExecution) {
    try {
      const [record] = await getDb().select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, context.workspaceId), eq(workspaceProductRecords.id, input.contentExecution.contentPieceId), eq(workspaceProductRecords.kind, "content_piece"), isNull(workspaceProductRecords.archivedAt))).limit(1);
      if (!record || record.revision !== input.contentExecution.contentPieceRevision || record.state !== "active") throw new ContentGenerationRecipeError("CONTENT_EXECUTION_REVISION_STALE");
      const payload = contentPieceSchema.parse(record.payload);
      if (!payload.formatDefinition) throw new ContentGenerationRecipeError("CONTENT_FORMAT_DEFINITION_STALE");
      const resolved = await resolveContentFormatDefinitionReference(payload.format, payload.formatDefinition);
      const policy = resolveContentModelPolicy(resolved.definition, configuredCatalog());
      if (!policy) throw new ContentWorkflowRuntimeError("CONTENT_MODEL_POLICY_UNAVAILABLE");
      const resources = await loadContentExecutionResources(context.workspaceId, payload);
      if (canonicalDigest(input.sourceAssetIds) !== canonicalDigest(resources.orderedAssetIds)) throw new ContentGenerationRecipeError("CONTENT_RESOURCE_ASSET_MISMATCH");
      if (input.prompt !== contentProviderPrompt(payload, resources)) throw new ContentGenerationRecipeError("CONTENT_PROVIDER_CONTROLS_MISMATCH");
      sourceAssetIds = resources.orderedAssetIds;
      preparedContent = { record, payload, resolved, policy, resources };
    } catch (error) {
      return fail(422, error instanceof ContentGenerationRecipeError || error instanceof ContentWorkflowRuntimeError || error instanceof Error && error.message.startsWith("CONTENT_") ? (error as Error).message : "CONTENT_EXECUTION_RECIPE_INVALID");
    }
  }
  const fetchedRows = sourceAssetIds.length ? await getDb().select({ id: assets.id, type: assets.type, storageKey: assets.storageKey, checksum: assets.checksum, mimeType: assets.mimeType, width: assets.width, height: assets.height, durationSeconds: assets.durationSeconds, metadata: assets.metadata, createdByUserId: assets.createdByUserId, createdAt: assets.createdAt }).from(assets).where(and(eq(assets.workspaceId, context.workspaceId), inArray(assets.id, sourceAssetIds), isNull(assets.deletedAt))) : [];
  const byId = new Map(fetchedRows.map((row) => [row.id, row]));
  const sourceRows = sourceAssetIds.map((id) => byId.get(id)).filter((row): row is (typeof fetchedRows)[number] => Boolean(row));
  let contentExecution: import("./types").GenerationIntent["contentExecution"] = null;
  if (preparedContent) {
    try {
      const { record, payload, resolved, policy, resources } = preparedContent;
      if (!contentModelAllowed(policy, input.model)) throw new ContentWorkflowRuntimeError("CONTENT_MODEL_POLICY_MODEL_NOT_ALLOWED");
      contentExecution = buildContentGenerationRecipe({ contentPieceId: record.id, contentPieceRevision: record.revision, contentPiecePayload: payload, definition: resolved.definition, definitionDigest: resolved.reference.digest as `sha256:${string}`, sourceTypes: new Map(sourceRows.map((row) => [row.id, row.type])), modelPolicy: policy, resources });
      assertContentGenerationRequest({ recipe: contentExecution, format: payload.format, definition: resolved.definition, capability: input.capability, sourceAssetIds, personaId: input.personaId ?? null, payload });
      assertContentModelPolicy({ definition: resolved.definition, intent: { selectedModel: input.model, capability: input.capability, contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety, outputContract: { mediaType: input.capability === "text_generation" ? "text" : input.capability.includes("video") ? "video" : "image", aspectRatio: input.capability === "text_generation" ? null : "9:16" }, quote: { quantity: input.quantity }, contentExecution, regionAdmission: { region: "replicate-us" } } as import("./types").GenerationIntent, descriptor: model, policy });
    } catch (error) {
      return fail(422, error instanceof ContentGenerationRecipeError || error instanceof ContentWorkflowRuntimeError ? error.code : "CONTENT_EXECUTION_RECIPE_INVALID");
    }
  }
  const providerSourceIds = contentExecution?.providerInputArtifactIds ?? sourceAssetIds;
  if (contentExecution) {
    const policy = { schema: "content-model-policy/v1" as const, id: contentExecution.modelPolicy.id, revision: contentExecution.modelPolicy.revision, format: contentExecution.workflowInputs.format as import("@/lib/product-surfaces/definitions").ContentFormat, region: contentExecution.modelPolicy.region as "replicate-us", defaultModel: contentExecution.modelPolicy.defaultModel as import("@/lib/product-surfaces/content-model-policy").ContentModelPolicy["defaultModel"], compatibleModels: contentExecution.modelPolicy.compatibleModels as import("@/lib/product-surfaces/content-model-policy").ContentModelPolicy["compatibleModels"], overrides: { mode: contentExecution.modelPolicy.overrideMode, allowedFields: ["model"] as const, requireRequote: true as const }, digest: contentExecution.modelPolicy.digest };
    if (!await persistCurrentContentModelPolicy(getDb(), context.workspaceId, policy)) return fail(409, "CONTENT_MODEL_POLICY_CONFLICT");
  }
  const providerSourceSet = new Set(providerSourceIds);
  const providerRows = sourceRows.filter((row) => providerSourceSet.has(row.id));
  const sourceValidation = validateGenerationSources(input.capability, providerSourceIds, providerRows.map((row) => ({ ...row, metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : null })), model.qualification.inputContract.imageMode);
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
  const created = await PRODUCTION_MODEL_ROUTING.createIntent({ workspaceId: context.workspaceId, brand: { profileId: brand.id, revision: brand.revision, digest: canonicalDigest(brand.profile) as `sha256:${string}`, acceptedAt: brand.acceptedAt, context: brandContext.context }, rawPrompt: input.prompt, capability: input.capability, contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety, rights: { snapshotId: rights.id, revision: rights.revision, digest: rights.digest, basis: rights.basis, permittedRemix: rights.permittedRemix, evidence: rights.evidence, sourceAssetIds: rights.sourceAssetIds }, providerSourceAssetIds: providerSourceIds, remixBrief: input.remixBrief, requestedModel: input.model, selectedModel: input.model, fallbackAuthorizationId: null, fundingMode: input.fundingMode, managedQuoteAcceptance: input.managedQuoteAcceptance ?? null, persona, contentExecution, quantity: input.quantity, userId: context.userId, idempotencyKey: `${context.idempotencyKey}:intent` });
  if (created.kind === "managed_quote_confirmation_required") return fail(409, "MANAGED_CREDIT_CONFIRMATION_REQUIRED", undefined, created.quote);
  if (created.kind !== "created" && created.kind !== "replayed") return fail(created.kind === "unavailable" || created.kind === "budget_unavailable" ? 503 : created.kind === "budget_denied" ? 402 : 422, "code" in created && typeof created.code === "string" ? created.code : created.kind.toUpperCase(), [{ code: "inspect_operations", href: "/studio/operations" }]);
  if (!created.intent) return fail(503, "GENERATION_INTENT_UNAVAILABLE");
  if (created.intent.persona) {
    try { await CREATOR_PERSONAS.bindUsage({ workspaceId: context.workspaceId, userId: context.userId, personaId: created.intent.persona.personaId, expectedRevision: created.intent.persona.personaRevision, purpose: "generation", resourceId: created.intent.id, idempotencyKey: `generation-persona:${created.intent.id}` }); }
    catch (error) { await PRODUCTION_MODEL_ROUTING.releaseIntent({ workspaceId: context.workspaceId, intent: created.intent }); return fail(409, error instanceof CreatorPersonaError ? error.code : "PERSONA_BINDING_FAILED", [{ code: "review_persona", href: "/influencers" }]); }
  }
  void credential;
  const operation = await ensureAdmittedGenerationOperation(PRODUCTION_OPERATION_STATUS, created.intent);
  if (!operation) return fail(503, "OPERATION_UNAVAILABLE", [{ code: "inspect_operations", href: "/studio/operations" }]);
  return { ok: true, status: 202, value: { intentId: created.intent.id, operation, provider: null, operationHref: `/studio/operations?selected=${encodeURIComponent(operation.id)}` } };
}
