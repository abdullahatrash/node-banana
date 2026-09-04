import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { workspaceProductCommandReceipts, workspaceProductRecords } from "@/lib/db/schema";
import { parseProductPayload } from "./definitions";
import { ProductRecordConflictError, ProductRecordIdempotencyError } from "./repository";

export async function decideBlitzItem(input: { workspaceId: string; userId: string; itemId: string; expectedRevision: number; decision: "accepted" | "rejected"; reasons: string[]; idempotencyKey: string; now?: Date }) {
  const now = input.now ?? new Date();
  const digest = canonicalDigest({ itemId: input.itemId, expectedRevision: input.expectedRevision, decision: input.decision, reasons: input.reasons });
  return getDb().transaction(async (tx) => {
    const [receipt] = await tx.select().from(workspaceProductCommandReceipts).where(and(eq(workspaceProductCommandReceipts.workspaceId, input.workspaceId), eq(workspaceProductCommandReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
    if (receipt) {
      if (receipt.requestDigest !== digest) throw new ProductRecordIdempotencyError("Idempotency key was already used.");
      return { itemId: receipt.recordId, revision: receipt.resultRevision };
    }
    const [item] = await tx.select().from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.itemId), eq(workspaceProductRecords.kind, "blitz_item"))).limit(1);
    if (!item || item.revision !== input.expectedRevision || item.state !== "queued") throw new ProductRecordConflictError("Blitz item is no longer queued. Refresh and try again.");
    const payload = parseProductPayload("blitz_item", item.payload);
    let contentPieceId: string | null = null;
    if (input.decision === "accepted") {
      contentPieceId = randomUUID();
      const contentPayload = parseProductPayload("content_piece", { format: "video_hook_demo", contentLanguage: "ar", arabicVariety: "msa", prompt: payload.rationale, script: "", aspectRatio: "9:16", durationSeconds: 15, captionStyle: "brand", sourceAssetIds: [], candidateArtifactIds: [], renderProofStatus: "not_requested" });
      await tx.insert(workspaceProductRecords).values({ workspaceId: input.workspaceId, id: contentPieceId, kind: "content_piece", title: item.title, state: "active", revision: 1, payload: contentPayload, createdByUserId: input.userId, updatedByUserId: input.userId, createdAt: now, updatedAt: now });
    }
    const nextPayload = parseProductPayload("blitz_item", { ...payload, contentPieceId, rejectionReasons: input.decision === "rejected" ? input.reasons : [] });
    const [updated] = await tx.update(workspaceProductRecords).set({ state: input.decision, payload: nextPayload, revision: sql`${workspaceProductRecords.revision} + 1`, updatedByUserId: input.userId, updatedAt: now }).where(and(eq(workspaceProductRecords.workspaceId, input.workspaceId), eq(workspaceProductRecords.id, input.itemId), eq(workspaceProductRecords.revision, input.expectedRevision))).returning();
    if (!updated) throw new ProductRecordConflictError("Blitz item changed on another device.");
    await tx.insert(workspaceProductCommandReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: digest, recordId: input.itemId, resultRevision: updated.revision, createdAt: now });
    return { itemId: updated.id, revision: updated.revision, contentPieceId };
  });
}

