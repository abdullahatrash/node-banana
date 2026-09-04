import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, workspaceProductRecords } from "@/lib/db/schema";
import { createProductRecord, createProductRecordInTransaction, updateProductRecord, type ProductRecord } from "./repository";
import { parseProductPayload } from "./definitions";

type Actor = { workspaceId: string; userId: string; idempotencyKey: string };

export async function saveContentCommand(input: Actor & { id?: string; expectedRevision?: number; title: string; payload: Record<string, unknown> }) {
  const requested = parseProductPayload("content_piece", { ...input.payload, candidateArtifactIds: [], renderProofStatus: "not_requested" });
  if (!input.id) return createProductRecord({ ...input, kind: "content_piece", state: "active", payload: requested });
  if (!input.expectedRevision) throw new Error("CONTENT_EXPECTED_REVISION_REQUIRED");
  const id = input.id;
  const [current] = await getDb().select({ payload: workspaceProductRecords.payload }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, id), eq(workspaceProductRecords.kind, "content_piece"))).limit(1);
  if (!current) return null;
  const authoritative = parseProductPayload("content_piece", current.payload);
  return updateProductRecord({ ...input, id, expectedKind: "content_piece", expectedRevision: input.expectedRevision, payload: { ...requested, candidateArtifactIds: authoritative.candidateArtifactIds, renderProofStatus: authoritative.renderProofStatus } });
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
