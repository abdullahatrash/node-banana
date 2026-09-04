import "server-only";

import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, contentThemeRevisions, contentThemes, creatorPersonaEvidence, creatorPersonas, workspaceProductRecords } from "@/lib/db/schema";
import { generationIntents, modelTextOutputReceipts } from "@/lib/model-routing/db-schema";
import { runtimeOperations } from "@/lib/agent-runtime/operation-status/db-schema";
import { generationOperationId } from "@/lib/model-routing/generation-operation";
import { modelArtifactIngestionReceipts } from "@/lib/model-routing/db-schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { createProductRecord, createProductRecordInTransaction, updateProductRecord, updateProductRecordInTransaction, type ProductRecord } from "./repository";
import { contentPieceSchema, parseProductPayload } from "./definitions";
import { buildContentRenderProof, isAdmittedContentArtifact, validateReadyPortraitAsset, type ContentAssetEvidence, type ContentGenerationReference } from "./content-lineage";
import { contentExecutionPlan, validateContentExecutionInput } from "./content-execution-plan";
import { validateContentDraft } from "./content-draft-policy";
import { resolveActiveContentFormatDefinition } from "./content-format-registry";
import { evaluatePersonaGate, type CreatorPersona, type CreatorPersonaEvidence } from "@/lib/creator-personas/types";

type Actor = { workspaceId: string; userId: string; idempotencyKey: string };
type ContentPiecePayload = ReturnType<typeof contentPieceSchema.parse>;

async function validateContentPayload(executor: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], workspaceId: string, payload: ContentPiecePayload, now = new Date()) {
  const sourceRowsUnordered = payload.sourceAssetIds.length ? await executor.select().from(assets).where(and(eq(assets.workspaceId, workspaceId), inArray(assets.id, payload.sourceAssetIds), isNull(assets.deletedAt))) : [];
  const sourceById = new Map(sourceRowsUnordered.map((row) => [row.id, row]));
  const sourceAssets = payload.sourceAssetIds.map((id) => sourceById.get(id)).filter((row): row is typeof assets.$inferSelect => Boolean(row)).map((row) => ({ id: row.id, type: row.type, ready: Boolean(row.checksum && (row.metadata as Record<string, unknown> | null)?.uploadState === "ready") }));
  let persona: { id: string; state: string; consentCurrent: boolean } | null = null;
  if (payload.personaId) {
    const [[row], evidence] = await Promise.all([
      executor.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, workspaceId), eq(creatorPersonas.id, payload.personaId), isNull(creatorPersonas.deletedAt))).limit(1),
      executor.select().from(creatorPersonaEvidence).where(and(eq(creatorPersonaEvidence.workspaceId, workspaceId), eq(creatorPersonaEvidence.personaId, payload.personaId))),
    ]);
    if (row) persona = { id: row.id, state: row.state, consentCurrent: evaluatePersonaGate({ persona: row as CreatorPersona, evidence: evidence as CreatorPersonaEvidence[], at: now }).admitted };
  }
  const mediaSets = payload.mediaSetIds.length ? await executor.select({ id: workspaceProductRecords.id, state: workspaceProductRecords.state }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.kind, "media_set"), inArray(workspaceProductRecords.id, payload.mediaSetIds), isNull(workspaceProductRecords.archivedAt))) : [];
  const themeIds = [...new Set(payload.themeRevisionRefs.map((reference) => reference.themeId))];
  const themes = themeIds.length ? await executor.select({ id: contentThemes.id, revision: contentThemeRevisions.revision, state: contentThemes.state, licenseExpiresAt: contentThemeRevisions.licenseExpiresAt }).from(contentThemes).innerJoin(contentThemeRevisions, and(eq(contentThemeRevisions.workspaceId, contentThemes.workspaceId), eq(contentThemeRevisions.themeId, contentThemes.id))).where(and(eq(contentThemes.workspaceId, workspaceId), inArray(contentThemes.id, themeIds))) : [];
  return validateContentDraft({
    draft: { format: payload.format, formatDefinition: payload.formatDefinition, contentLanguage: payload.contentLanguage, arabicVariety: payload.arabicVariety, aspectRatio: payload.aspectRatio, durationSeconds: payload.durationSeconds, script: payload.script, captionStyle: payload.captionStyle, speaker: payload.speaker, scene: payload.scene, personaId: payload.personaId, mediaSetIds: payload.mediaSetIds, themeRevisionRefs: payload.themeRevisionRefs },
    sourceAssets,
    persona,
    mediaSets,
    themes: themes.map((theme) => ({ id: theme.id, revision: theme.revision, state: theme.state, licenseCurrent: !theme.licenseExpiresAt || theme.licenseExpiresAt > now })),
  });
}

export async function saveContentCommand(input: Actor & { id?: string; expectedRevision?: number; title: string; payload: Record<string, unknown> }) {
  const draft = contentPieceSchema.parse({ ...input.payload, candidateArtifactIds: [], candidates: [], renderProofStatus: "not_requested", generatedText: null, generatedMedia: null });
  const activeDefinition = await resolveActiveContentFormatDefinition(draft.format);
  const requested = contentPieceSchema.parse({ ...draft, formatDefinition: activeDefinition.reference });
  const validationIssues = await getDb().transaction((tx) => validateContentPayload(tx, input.workspaceId, requested));
  const state = validationIssues.length ? "draft" : "active";
  const validated = { ...requested, validationIssues };
  if (!input.id) return createProductRecord({ ...input, kind: "content_piece", state, payload: validated });
  if (!input.expectedRevision) throw new Error("CONTENT_EXPECTED_REVISION_REQUIRED");
  const id = input.id;
  const [current] = await getDb().select({ payload: workspaceProductRecords.payload }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, id), eq(workspaceProductRecords.kind, "content_piece"))).limit(1);
  if (!current) return null;
  const authoritative = contentPieceSchema.parse(current.payload);
  return updateProductRecord({ ...input, id, expectedKind: "content_piece", expectedRevision: input.expectedRevision, state, payload: { ...validated, candidateArtifactIds: authoritative.candidateArtifactIds, candidates: authoritative.candidates, renderProofStatus: authoritative.renderProofStatus, generatedText: authoritative.generatedText, generatedMedia: authoritative.generatedMedia } });
}

function assetEvidence(row: typeof assets.$inferSelect): ContentAssetEvidence {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
  return { id: row.id, type: row.type, checksum: row.checksum, width: row.width, height: row.height, durationSeconds: row.durationSeconds, uploadState: metadata.uploadState };
}

export async function bindContentMediaOutputCommand(input: Actor & { id: string; expectedRevision: number; generation: ContentGenerationReference | null }) {
  const now = new Date();
  return getDb().transaction(async (tx) => {
    const [record] = await tx.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.id), eq(workspaceProductRecords.kind, "content_piece"))).limit(1);
    if (!record) return null;
    const payload = contentPieceSchema.parse(record.payload);
    const validationIssues = await validateContentPayload(tx, input.workspaceId, payload, now);
    if (validationIssues.length) throw new Error(validationIssues[0]);
    const sourceRowsUnordered = payload.sourceAssetIds.length ? await tx.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), inArray(assets.id, payload.sourceAssetIds), isNull(assets.deletedAt))) : [];
    const sourceById = new Map(sourceRowsUnordered.map((row) => [row.id, row]));
    const sourceRows = payload.sourceAssetIds.map((id) => sourceById.get(id)).filter((row): row is typeof assets.$inferSelect => Boolean(row));
    const sourceAssets = sourceRows.map(assetEvidence);
    let personaState: string | null = null;
    if (payload.personaId) {
      const [persona] = await tx.select({ state: workspaceProductRecords.state }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, payload.personaId), eq(workspaceProductRecords.kind, "creator_persona"), isNull(workspaceProductRecords.archivedAt))).limit(1);
      personaState = persona?.state ?? null;
    }
    const inputValidation = validateContentExecutionInput({ format: payload.format, sources: sourceAssets, personaState });
    if (!inputValidation.ok) throw new Error(inputValidation.code);
    const plan = contentExecutionPlan(payload.format);
    let artifact: ContentAssetEvidence;
    let contentDigest: string;
    let intentId: string | null = null;
    let operationId: string | null = null;
    if (plan.strategy === "canonical_upload") {
      if (input.generation || sourceAssets.length !== 1 || validateReadyPortraitAsset(sourceAssets[0]!, "video")) throw new Error("CONTENT_UPLOAD_RENDER_PROOF_INVALID");
      artifact = sourceAssets[0]!;
      contentDigest = artifact.checksum!;
    } else {
      if (!input.generation) throw new Error("CONTENT_GENERATION_REQUIRED");
      const [[receipt], [intentRow], [operation], [artifactRow]] = await Promise.all([
        tx.select().from(modelArtifactIngestionReceipts).where(and(eq(modelArtifactIngestionReceipts.workspaceId, input.workspaceId), eq(modelArtifactIngestionReceipts.assetId, input.generation.assetId), eq(modelArtifactIngestionReceipts.intentId, input.generation.intentId), eq(modelArtifactIngestionReceipts.status, "ready"))).limit(1),
        tx.select({ intent: generationIntents.intent }).from(generationIntents).where(and(eq(generationIntents.workspaceId, input.workspaceId), eq(generationIntents.id, input.generation.intentId))).limit(1),
        tx.select({ state: runtimeOperations.state, metadata: runtimeOperations.metadata }).from(runtimeOperations).where(and(eq(runtimeOperations.workspaceId, input.workspaceId), eq(runtimeOperations.id, input.generation.operationId), eq(runtimeOperations.resourceId, input.generation.intentId))).limit(1),
        tx.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, input.generation.assetId), isNull(assets.deletedAt))).limit(1),
      ]);
      const operationMetadata = operation?.metadata && typeof operation.metadata === "object" && !Array.isArray(operation.metadata) ? operation.metadata : {};
      if (!artifactRow) throw new Error("CONTENT_GENERATION_LINEAGE_INVALID");
      artifact = assetEvidence(artifactRow);
      if (!isAdmittedContentArtifact({ format: payload.format, sourceAssets, personaState, generation: input.generation, receipt: receipt ? { assetId: receipt.assetId, intentId: receipt.intentId, status: receipt.status, contentDigest: receipt.contentDigest, width: receipt.width, height: receipt.height, durationSeconds: receipt.durationSeconds } : null, intent: intentRow?.intent ?? null, operation: operation ? { state: operation.state, artifactIds: operationMetadata.artifactIds } : null, artifact })) throw new Error("CONTENT_GENERATION_LINEAGE_INVALID");
      contentDigest = receipt!.contentDigest!;
      intentId = input.generation.intentId;
      operationId = input.generation.operationId;
    }
    const proofFacts = buildContentRenderProof({ sourceAssets, artifact, intentId, operationId, verifiedAt: now });
    const renderProof = { ...proofFacts, digest: canonicalDigest(proofFacts) };
    const existing = payload.candidates.find((candidate) => candidate.assetId === artifact.id && candidate.contentDigest === contentDigest);
    if (existing) return record;
    const candidate = { assetId: artifact.id, intentId, operationId, contentDigest, createdAt: now.toISOString(), renderProof };
    return updateProductRecordInTransaction(tx, {
      workspaceId: input.workspaceId, userId: input.userId, id: record.id, expectedKind: "content_piece", expectedRevision: input.expectedRevision,
      payload: { ...payload, candidateArtifactIds: [...payload.candidateArtifactIds, artifact.id], candidates: [...payload.candidates, candidate], renderProofStatus: "passed", generatedMedia: intentId && operationId ? { assetId: artifact.id, intentId, operationId, contentDigest } : payload.generatedMedia },
      idempotencyKey: input.idempotencyKey,
    });
  });
}

export async function bindContentTextOutputCommand(input: Actor & { id: string; expectedRevision: number; textOutputId: string }) {
  return getDb().transaction(async (tx) => {
    const [[record], [output]] = await Promise.all([
      tx.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.id), eq(workspaceProductRecords.kind, "content_piece"))).limit(1),
      tx.select().from(modelTextOutputReceipts).where(and(eq(modelTextOutputReceipts.workspaceId, input.workspaceId), eq(modelTextOutputReceipts.id, input.textOutputId))).limit(1),
    ]);
    if (!record || !output) return null;
    const operationId = generationOperationId(output.intentId);
    const [[intentRow], [operation]] = await Promise.all([
      tx.select({ intent: generationIntents.intent }).from(generationIntents).where(and(eq(generationIntents.workspaceId, input.workspaceId), eq(generationIntents.id, output.intentId))).limit(1),
      tx.select({ state: runtimeOperations.state, metadata: runtimeOperations.metadata }).from(runtimeOperations).where(and(eq(runtimeOperations.workspaceId, input.workspaceId), eq(runtimeOperations.id, operationId), eq(runtimeOperations.resourceId, output.intentId))).limit(1),
    ]);
    const operationOutputIds = Array.isArray(operation?.metadata.textOutputIds) ? operation.metadata.textOutputIds : [];
    if (!intentRow || intentRow.intent.outputContract.mediaType !== "text" || operation?.state !== "succeeded" || !operationOutputIds.includes(output.id)) throw new Error("CONTENT_TEXT_OUTPUT_NOT_ADMITTED");
    const payload = parseProductPayload("content_piece", record.payload);
    return updateProductRecordInTransaction(tx, {
      workspaceId: input.workspaceId, userId: input.userId, id: record.id, expectedKind: "content_piece", expectedRevision: input.expectedRevision,
      payload: { ...payload, script: output.content, generatedText: { textOutputId: output.id, intentId: output.intentId, operationId, contentDigest: output.contentDigest } },
      idempotencyKey: input.idempotencyKey,
    });
  });
}

export async function createMediaSetCommand(input: Actor & { title: string; assetIds: string[]; category: string; description: string }) {
  return getDb().transaction(async (tx) => {
    const ids = [...new Set(input.assetIds)];
    const found = ids.length ? await tx.select({ id: assets.id }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), inArray(assets.id, ids), isNull(assets.deletedAt))) : [];
    if (!ids.length || found.length !== ids.length) throw new Error("MEDIA_SET_ASSET_NOT_AVAILABLE");
    return createProductRecordInTransaction(tx, { ...input, kind: "media_set", state: "active", payload: { assetIds: ids, category: input.category, description: input.description } });
  });
}

export async function createAnalyticsSourceCommand(input: Actor & { kind: "website_analytics_source" | "geo_analytics_source"; title: string; payload: Record<string, unknown> }) {
  const verificationChallenge = `tasmeemai-verification=${randomBytes(24).toString("base64url")}`;
  const common = { enabled: false, verificationStatus: "pending" as const, verificationChallenge, verifiedAt: null, refreshStatus: "idle" as const, refreshRequestedAt: null, lastRefreshAt: null, lastRefreshError: null };
  const payload = input.kind === "website_analytics_source"
    ? { ...input.payload, ...common, publicKey: randomBytes(32).toString("base64url"), lastEventAt: null }
    : { ...input.payload, ...common, lastObservationAt: null };
  return createProductRecord({ ...input, state: "disabled", payload });
}

export async function saveGuidanceProgressCommand(input: Actor & { id?: string; expectedRevision?: number; payload: Record<string, unknown> }) {
  const payload = parseProductPayload("guidance_progress", input.payload);
  if (!input.id) return createProductRecord({ ...input, kind: "guidance_progress", title: "release-notifications", state: "active", payload });
  if (!input.expectedRevision) throw new Error("GUIDANCE_EXPECTED_REVISION_REQUIRED");
  return updateProductRecord({ ...input, id: input.id, expectedKind: "guidance_progress", expectedRevision: input.expectedRevision, payload });
}

export async function saveCampaignDraftCommand(input: Actor & { id?: string; expectedRevision?: number; title: string; payload: Record<string, unknown> }): Promise<ProductRecord | null> {
  const requested = parseProductPayload("campaign_automation", { ...input.payload, runtime: null });
  if (!input.id) return createProductRecord({ ...input, kind: "campaign_automation", state: "draft", payload: requested });
  if (!input.expectedRevision) throw new Error("CAMPAIGN_EXPECTED_REVISION_REQUIRED");
  const [current] = await getDb().select({ payload: workspaceProductRecords.payload }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.id), eq(workspaceProductRecords.kind, "campaign_automation"))).limit(1);
  if (!current) return null;
  const authoritative = parseProductPayload("campaign_automation", current.payload);
  return updateProductRecord({ ...input, id: input.id, expectedKind: "campaign_automation", expectedRevision: input.expectedRevision, title: input.title, payload: { ...requested, runtime: authoritative.runtime } });
}
