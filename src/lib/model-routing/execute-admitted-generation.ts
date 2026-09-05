import { and, eq, inArray, isNull } from "drizzle-orm";

import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { resolveDurableProviderKey, resolveManagedProviderKey } from "@/lib/byok/repository";
import { getDb } from "@/lib/db";
import { assets, brandProfiles, workflowRuns, workspaceProductRecordRevisions } from "@/lib/db/schema";
import { getReleaseControlService } from "@/lib/release-control/production";
import { canUseS3Storage, createPresignedDownload } from "@/lib/storage";
import { loadImmutableBrandContext } from "./brand-context";
import { findCuratedModel } from "./catalog";
import { quoteTotalUsd } from "./pricing";
import { contentModelPolicyRevisions, inspirationRightsSnapshots, modelGenerationBudgetReservations } from "./db-schema";
import type { GenerationExecutionResult } from "./execution";
import { PostgresModelRoutingRepository } from "./postgres-repository";
import { validateRightsEvidence } from "./rights-evidence";
import { validateGenerationSources } from "./source-validation";
import { CREATOR_PERSONAS } from "@/lib/creator-personas/production";
import { CreatorPersonaError } from "@/lib/creator-personas/repository";
import { resolveContentFormatDefinitionReference } from "@/lib/product-surfaces/content-format-registry";
import { validateContentGenerationRecipe } from "@/lib/product-surfaces/content-generation-recipe";
import { contentPieceSchema } from "@/lib/product-surfaces/definitions";
import { loadContentExecutionResources } from "@/lib/product-surfaces/content-execution-resources-repository";
import { assertContentModelPolicy } from "@/lib/product-surfaces/content-workflow-runtime";

export type ExecuteAdmittedGenerationResult =
  | { ok: true; status: 202; result: Extract<GenerationExecutionResult, { kind: "accepted" }> }
  | { ok: false; status: 404 | 409 | 503; code: string; error?: string };

const rejected = (status: 404 | 409 | 503, code: string, error?: string): ExecuteAdmittedGenerationResult => ({ ok: false, status, code, ...(error ? { error } : {}) });

type ContentWorkflowRunEvidence = Pick<typeof workflowRuns.$inferSelect, "workflowId" | "workflowRevisionId" | "startSnapshot">;

/**
 * Opens only the current typed Content Workflow contract. Historical v2 Runs
 * stored their envelope under `request`; accepting that name here would let a
 * stale, differently-shaped snapshot authorize a v3 provider effect.
 */
export function contentWorkflowRequestFromRun(input: {
  run: ContentWorkflowRunEvidence | null | undefined;
  intent: import("./types").GenerationIntent;
  workspaceId: string;
  userId: string;
  prompt: string;
  sourceAssetIds: readonly string[];
  studioAssets?: import("@/lib/agent-runtime/runs/types").WorkflowRunStudioAssetReference[];
}): Record<string, unknown> | null {
  const binding = input.intent.contentExecution;
  const run = input.run;
  const expectedSnapshotSchema = binding?.formatDefinition.revision && binding.formatDefinition.revision >= 5
    ? "workflow-run-start-snapshot/v3"
    : "workflow-run-start-snapshot/v2";
  if (!binding || !run || run.workflowId !== binding.workflow.id || run.workflowRevisionId !== binding.workflow.revisionId || run.startSnapshot.schema !== expectedSnapshotSchema || run.startSnapshot.workflowRevision !== binding.formatDefinition.revision) return null;
  const expectedInputs = [...binding.workflow.inputs].sort();
  const actualInputs = run.startSnapshot.inputs.map((candidate) => candidate.name).sort();
  const declaredInputs = Object.keys(run.startSnapshot.definition.inputs).sort();
  const dispatchStep = run.startSnapshot.definition.steps.find((step) => step.id.startsWith("dispatch_"));
  const dispatchContract = run.startSnapshot.operationContracts.find((contract) => contract.stepId === dispatchStep?.id);
  if (canonicalDigest(actualInputs) !== canonicalDigest(expectedInputs) || canonicalDigest(declaredInputs) !== canonicalDigest(expectedInputs) || run.startSnapshot.inputs.some((candidate) => candidate.kind !== "text") || run.startSnapshot.artifactReferences.length !== 0 || dispatchStep?.operation.identity !== binding.workflow.operation || dispatchContract?.identity !== binding.workflow.operation || dispatchContract.contractDigest !== dispatchStep.operation.contractDigest) return null;
  const recipeInputs = run.startSnapshot.inputs.filter((candidate) => candidate.name === "recipe" && candidate.kind === "text");
  if (recipeInputs.length !== 1 || typeof recipeInputs[0]?.value !== "string") return null;
  let request: Record<string, unknown>;
  try {
    const parsed = JSON.parse(recipeInputs[0].value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    request = parsed as Record<string, unknown>;
  } catch { return null; }
  if (request.schema !== "content-workflow-generation-request/v1" || request.workspaceId !== input.workspaceId || request.userId !== input.userId || request.intentId !== input.intent.id || request.contentExecutionDigest !== binding.digest || request.prompt !== input.prompt) return null;
  const evidenceByAssetId = new Map(input.intent.rights.evidence.map((evidence) => [evidence.sourceAssetId, evidence.sourceDigest]));
  const expectedArtifactReferences = binding.inputArtifactIds.map((artifactId) => ({ artifactId, digest: evidenceByAssetId.get(artifactId) ?? null }));
  const artifactReferencesMatch = binding.formatDefinition.revision < 5 || (!expectedArtifactReferences.some((reference) => !reference.digest) && canonicalDigest(request.orderedInputArtifacts) === canonicalDigest(expectedArtifactReferences));
  const studioAssetReferencesMatch = binding.formatDefinition.revision < 5 || (
    run.startSnapshot.schema === "workflow-run-start-snapshot/v3" &&
    Boolean(input.studioAssets) &&
    canonicalDigest(run.startSnapshot.studioAssetReferences) === canonicalDigest(input.studioAssets)
  );
  if (!artifactReferencesMatch || !studioAssetReferencesMatch || canonicalDigest(request.sourceAssetIds) !== canonicalDigest(input.sourceAssetIds) || canonicalDigest(request.workflow) !== canonicalDigest(binding.workflow) || canonicalDigest(request.modelPolicy) !== canonicalDigest(binding.modelPolicy) || canonicalDigest(request.workflowInputs) !== canonicalDigest(binding.workflowInputs) || canonicalDigest(request.orderedInputArtifactIds) !== canonicalDigest(binding.inputArtifactIds) || canonicalDigest(request.providerInputArtifactIds) !== canonicalDigest(binding.providerInputArtifactIds) || canonicalDigest(request.selectedModel) !== canonicalDigest(input.intent.selectedModel)) return null;
  return request;
}

/** Shared execute boundary for HTTP, onboarding, automations, and other admitted generation callers. */
export async function executeAdmittedGeneration(input: {
  workspaceId: string;
  userId: string;
  role: string;
  planTier: string;
  intentId: string;
  prompt: string;
  sourceAssetIds: string[];
  idempotencyKey: string;
  contentWorkflowRunId?: string;
}): Promise<ExecuteAdmittedGenerationResult> {
  const routing = new PostgresModelRoutingRepository(getDb);
  const intent = await routing.getIntent(input.workspaceId, input.intentId);
  if (!intent) return rejected(404, "GENERATION_INTENT_NOT_FOUND");
  if (intent.persona) {
    try {
      const current = await CREATOR_PERSONAS.resolveUsage({ workspaceId: input.workspaceId, personaId: intent.persona.personaId, purpose: "generation", resourceId: intent.id });
      if (current.personaRevision < intent.persona.personaRevision || current.model.model !== intent.persona.model.model || current.model.version !== intent.persona.model.version || current.model.inputSchemaDigest !== intent.persona.model.inputSchemaDigest) return rejected(409, "PERSONA_BINDING_CHANGED");
    } catch (error) { return rejected(409, error instanceof CreatorPersonaError ? error.code : "PERSONA_USAGE_DENIED"); }
  }
  if (intent.outputContract.mediaType !== "text" && !canUseS3Storage()) return rejected(503, "CANONICAL_ARTIFACT_STORAGE_UNAVAILABLE");
  const releaseFlagId = process.env.ADMITTED_GENERATION_RELEASE_FLAG_ID?.trim();
  if (!releaseFlagId && process.env.NODE_ENV === "production") return rejected(503, "GENERATION_RELEASE_FLAG_UNCONFIGURED");
  if (releaseFlagId) {
    try {
      const flag = await getReleaseControlService().evaluateReleaseFlag(input.workspaceId, input.userId, releaseFlagId, { role: input.role, entitlement: input.planTier, locale: intent.contentLanguage === "en" ? "en" : "ar", entryPoint: "admitted_generation_execute" }, `${input.idempotencyKey}:flag`);
      if (!flag.enabled) return rejected(409, "GENERATION_RELEASE_FLAG_DISABLED");
    } catch {
      return rejected(503, "GENERATION_RELEASE_FLAG_UNAVAILABLE");
    }
  }
  const [brand] = await getDb().select({ acceptedAt: brandProfiles.acceptedAt, profile: brandProfiles.profile }).from(brandProfiles).where(and(eq(brandProfiles.workspaceId, input.workspaceId), eq(brandProfiles.id, intent.brand.profileId), eq(brandProfiles.revision, intent.brand.revision), eq(brandProfiles.status, "active"))).limit(1);
  if (!brand?.acceptedAt || canonicalDigest(brand.profile) !== intent.brand.digest) return rejected(409, "BRAND_REVISION_NOT_ACCEPTED");
  const [budget] = await getDb().select({ status: modelGenerationBudgetReservations.status, amount: modelGenerationBudgetReservations.quotedAmountUsd }).from(modelGenerationBudgetReservations).where(and(eq(modelGenerationBudgetReservations.workspaceId, input.workspaceId), eq(modelGenerationBudgetReservations.intentId, intent.id))).limit(1);
  if (!budget || budget.status !== "held" || Number(budget.amount) !== quoteTotalUsd(intent.quote)) return rejected(409, "AUTHORITATIVE_BUDGET_RESERVATION_UNAVAILABLE");
  const [rights] = await getDb().select({ digest: inspirationRightsSnapshots.digest, permittedRemix: inspirationRightsSnapshots.permittedRemix }).from(inspirationRightsSnapshots).where(and(eq(inspirationRightsSnapshots.workspaceId, input.workspaceId), eq(inspirationRightsSnapshots.id, intent.rights.snapshotId), eq(inspirationRightsSnapshots.revision, intent.rights.revision))).limit(1);
  if (!rights || rights.digest !== intent.rights.digest || rights.permittedRemix !== intent.rights.permittedRemix) return rejected(409, "RIGHTS_SNAPSHOT_MISMATCH");
  const sourceIds = [...input.sourceAssetIds];
  if (sourceIds.length !== intent.rights.sourceAssetIds.length || sourceIds.some((id, index) => id !== intent.rights.sourceAssetIds[index])) return rejected(409, "RIGHTS_EVIDENCE_MISMATCH");
  const rightsValidation = validateRightsEvidence({ workspaceId: input.workspaceId, basis: intent.rights.basis, permittedRemix: intent.rights.permittedRemix, sourceAssetIds: intent.rights.sourceAssetIds, evidence: intent.rights.evidence, at: new Date() });
  if (!rightsValidation.ok) return rejected(409, rightsValidation.code);
  const fetchedRows = sourceIds.length ? await getDb().select({ id: assets.id, type: assets.type, storageKey: assets.storageKey, checksum: assets.checksum, mimeType: assets.mimeType, sizeBytes: assets.sizeBytes, width: assets.width, height: assets.height, durationSeconds: assets.durationSeconds, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), inArray(assets.id, sourceIds), isNull(assets.deletedAt))) : [];
  const sourceById = new Map(fetchedRows.map((row) => [row.id, row]));
  const sourceRows = sourceIds.map((id) => sourceById.get(id)).filter((row): row is (typeof fetchedRows)[number] => Boolean(row));
  if (sourceRows.length !== sourceIds.length || sourceRows.some((asset) => !asset.storageKey)) return rejected(409, "SOURCE_ASSET_UNAVAILABLE");
  if (sourceRows.some((asset) => intent.rights.evidence.find((item) => item.sourceAssetId === asset.id)?.sourceDigest !== asset.checksum)) return rejected(409, "RIGHTS_SOURCE_DIGEST_MISMATCH");
  const descriptor = findCuratedModel(intent.selectedModel);
  if (!descriptor || descriptor.qualification.status !== "qualified") return rejected(409, "MODEL_NOT_EXECUTABLE");
  const providerIds = intent.contentExecution?.providerInputArtifactIds ?? sourceIds;
  if (intent.contentExecution) {
    try {
      const [contentSnapshot] = await getDb().select({ payload: workspaceProductRecordRevisions.payload }).from(workspaceProductRecordRevisions).where(and(eq(workspaceProductRecordRevisions.workspaceId, input.workspaceId), eq(workspaceProductRecordRevisions.recordId, intent.contentExecution.contentPiece.id), eq(workspaceProductRecordRevisions.revision, intent.contentExecution.contentPiece.revision))).limit(1);
      const payload = contentPieceSchema.parse(contentSnapshot?.payload);
      if (canonicalDigest(payload) !== intent.contentExecution.contentPiece.digest) return rejected(409, "CONTENT_EXECUTION_RECIPE_MISMATCH");
      const resources = await loadContentExecutionResources(input.workspaceId, payload);
      const workflowInputs = intent.contentExecution.workflowInputs as unknown as Record<string, unknown>;
      const resourceBindingMatches = intent.contentExecution.formatDefinition.revision < 4
        ? canonicalDigest(payload.mediaSetIds) === canonicalDigest(workflowInputs.mediaSetIds ?? []) && canonicalDigest(payload.themeRevisionRefs) === canonicalDigest(workflowInputs.themeRevisionRefs ?? [])
        : canonicalDigest(resources.mediaSets) === canonicalDigest(workflowInputs.mediaSetRevisions) && canonicalDigest(resources.themes.map((theme) => ({ themeId: theme.themeId, revision: theme.revision, digest: theme.digest, visual: theme.document.visual, captions: theme.document.captions, licenseEvidenceIds: theme.licenseEvidenceIds }))) === canonicalDigest(workflowInputs.themeInstructions);
      if (canonicalDigest(resources.orderedAssetIds) !== canonicalDigest(intent.contentExecution.inputArtifactIds) || !resourceBindingMatches) return rejected(409, "CONTENT_RESOURCE_BINDING_STALE");
      const resolved = await resolveContentFormatDefinitionReference(intent.contentExecution.formatDefinition.id.slice("content-format:".length) as import("@/lib/product-surfaces/definitions").ContentFormat, intent.contentExecution.formatDefinition);
      if (!validateContentGenerationRecipe({ recipe: intent.contentExecution, definition: resolved.definition, capability: intent.capability, rightsSourceAssetIds: sourceIds, providerSourceAssetIds: intent.providerComposition.sourceAssetIds })) return rejected(409, "CONTENT_EXECUTION_RECIPE_MISMATCH");
      assertContentModelPolicy({ definition: resolved.definition, intent, descriptor });
      const [storedPolicy] = await getDb().select({ digest: contentModelPolicyRevisions.policyDigest }).from(contentModelPolicyRevisions).where(and(eq(contentModelPolicyRevisions.workspaceId, input.workspaceId), eq(contentModelPolicyRevisions.id, intent.contentExecution.modelPolicy.id), eq(contentModelPolicyRevisions.revision, intent.contentExecution.modelPolicy.revision), eq(contentModelPolicyRevisions.status, "active"))).limit(1);
      if (storedPolicy?.digest !== intent.contentExecution.modelPolicy.digest) return rejected(409, "CONTENT_MODEL_POLICY_UNAVAILABLE");
      if (!input.contentWorkflowRunId) return rejected(409, "CONTENT_WORKFLOW_RUN_REQUIRED");
      const [run] = await getDb().select({ workflowId: workflowRuns.workflowId, workflowRevisionId: workflowRuns.workflowRevisionId, startSnapshot: workflowRuns.startSnapshot }).from(workflowRuns).where(and(eq(workflowRuns.workspaceId, input.workspaceId), eq(workflowRuns.id, input.contentWorkflowRunId))).limit(1);
      const studioAssetReferences = sourceRows.map((asset) => ({ assetId: asset.id, digest: asset.checksum ?? "", type: asset.type, mediaType: asset.mimeType ?? "", sizeBytes: asset.sizeBytes ?? -1, width: asset.width, height: asset.height, durationSeconds: asset.durationSeconds }));
      if (!contentWorkflowRequestFromRun({ run, intent, workspaceId: input.workspaceId, userId: input.userId, prompt: input.prompt, sourceAssetIds: sourceIds, studioAssets: studioAssetReferences })) return rejected(409, "CONTENT_WORKFLOW_RUN_MISMATCH");
    } catch {
      return rejected(409, "CONTENT_EXECUTION_RECIPE_UNAVAILABLE");
    }
  }
  const providerRows = providerIds.map((id) => sourceById.get(id)).filter((row): row is (typeof fetchedRows)[number] => Boolean(row));
  if (providerRows.length !== providerIds.length) return rejected(409, "SOURCE_ASSET_UNAVAILABLE");
  const sourceValidation = validateGenerationSources(intent.capability, providerIds, providerRows.map((row) => ({ ...row, metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : null })), descriptor.qualification.inputContract.imageMode);
  if (!sourceValidation.ok) return rejected(409, sourceValidation.code);
  const sourceUrls = await Promise.all(providerRows.map(async (asset) => (await createPresignedDownload({ key: asset.storageKey! })).downloadUrl));
  const brandContext = await loadImmutableBrandContext({ workspaceId: input.workspaceId, profileId: intent.brand.profileId, revision: intent.brand.revision, acceptedAt: brand.acceptedAt, profile: brand.profile });
  if (!brandContext || brandContext.context.digest !== intent.brand.context.digest) return rejected(409, "BRAND_CONTEXT_MISMATCH");
  const credential = intent.fundingMode === "managed" ? resolveManagedProviderKey("replicate") : await resolveDurableProviderKey(input.workspaceId, "replicate");
  if (!credential) return intent.fundingMode === "managed"
    ? rejected(503, "MANAGED_REPLICATE_CREDENTIAL_UNAVAILABLE")
    : rejected(409, "DURABLE_REPLICATE_CREDENTIAL_REQUIRED", "Async generation requires a Workspace-stored Replicate key; transient request headers are not accepted.");
  const { productionGenerationExecution } = await import("./execution-production");
  const result = await productionGenerationExecution(credential).execute({ workspaceId: input.workspaceId, userId: input.userId, intentId: input.intentId, rawPrompt: input.prompt, sourceUrls, brandReferenceUrls: brandContext.referenceUrls, idempotencyKey: input.idempotencyKey });
  if (result.kind === "accepted") return { ok: true, status: 202, result };
  return rejected(result.kind === "not_found" ? 404 : result.kind === "invalid" || result.kind === "expired" ? 409 : 503, result.code);
}
