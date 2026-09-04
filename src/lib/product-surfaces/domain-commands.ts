import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, workspaceProductRecords } from "@/lib/db/schema";
import { generationIntents, modelTextOutputReceipts } from "@/lib/model-routing/db-schema";
import { runtimeOperations } from "@/lib/agent-runtime/operation-status/db-schema";
import { generationOperationId } from "@/lib/model-routing/generation-operation";
import { createProductRecord, createProductRecordInTransaction, updateProductRecord, updateProductRecordInTransaction, type ProductRecord } from "./repository";
import { parseProductPayload } from "./definitions";

type Actor = { workspaceId: string; userId: string; idempotencyKey: string };

export async function saveContentCommand(input: Actor & { id?: string; expectedRevision?: number; title: string; payload: Record<string, unknown> }) {
  const requested = parseProductPayload("content_piece", { ...input.payload, candidateArtifactIds: [], renderProofStatus: "not_requested", generatedText: null });
  if (!input.id) return createProductRecord({ ...input, kind: "content_piece", state: "active", payload: requested });
  if (!input.expectedRevision) throw new Error("CONTENT_EXPECTED_REVISION_REQUIRED");
  const id = input.id;
  const [current] = await getDb().select({ payload: workspaceProductRecords.payload }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, id), eq(workspaceProductRecords.kind, "content_piece"))).limit(1);
  if (!current) return null;
  const authoritative = parseProductPayload("content_piece", current.payload);
  return updateProductRecord({ ...input, id, expectedKind: "content_piece", expectedRevision: input.expectedRevision, payload: { ...requested, candidateArtifactIds: authoritative.candidateArtifactIds, renderProofStatus: authoritative.renderProofStatus, generatedText: authoritative.generatedText } });
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
  const payload = input.kind === "website_analytics_source"
    ? { ...input.payload, publicKey: `pending:${input.idempotencyKey}`, enabled: false, lastEventAt: null }
    : { ...input.payload, enabled: false, lastObservationAt: null };
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
