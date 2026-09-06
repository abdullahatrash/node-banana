import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { modelArtifactIngestionReceipts } from "./db-schema";

type Db = ReturnType<typeof getDb>;
export interface ArtifactReceipt {
  workspaceId: string; predictionId: string; outputIndex: number; intentId: string; status: "claimed" | "ready";
  storageKey: string; assetId: string | null; mimeType: string | null; sizeBytes: number | null; width: number | null; height: number | null; durationSeconds: number | null; fps: number | null; contentDigest: string | null;
  leaseOwner: string | null; leaseEpoch: number; leaseExpiresAt: Date | null;
}
export interface ArtifactReceiptPort {
  claim(input: { workspaceId: string; predictionId: string; outputIndex: number; intentId: string; proposedStorageKey: string; leaseOwner: string; leaseExpiresAt: Date; at: Date }): Promise<{ kind: "acquired" | "ready"; receipt: ArtifactReceipt } | { kind: "busy" }>;
  renew(input: { workspaceId: string; predictionId: string; outputIndex: number; intentId: string; leaseOwner: string; leaseEpoch: number; leaseExpiresAt: Date; at: Date }): Promise<boolean>;
  complete(input: { workspaceId: string; predictionId: string; outputIndex: number; intentId: string; leaseOwner: string; leaseEpoch: number; assetId: string; mimeType: string; sizeBytes: number; width: number; height: number; durationSeconds: number | null; fps: number | null; contentDigest: `sha256:${string}`; at: Date }): Promise<ArtifactReceipt>;
}
const receipt = (row: typeof modelArtifactIngestionReceipts.$inferSelect): ArtifactReceipt => ({ ...row, status: row.status as "claimed" | "ready", durationSeconds: row.durationSeconds === null ? null : Number(row.durationSeconds), fps: row.fps === null ? null : Number(row.fps) });

export class PostgresArtifactReceiptRepository implements ArtifactReceiptPort {
  constructor(private readonly database: () => Db) {}
  async claim(input: Parameters<ArtifactReceiptPort["claim"]>[0]) {
    return this.database().transaction(async (tx) => {
      await tx.insert(modelArtifactIngestionReceipts).values({ workspaceId: input.workspaceId, predictionId: input.predictionId, outputIndex: input.outputIndex, intentId: input.intentId, status: "claimed", storageKey: input.proposedStorageKey, leaseOwner: input.leaseOwner, leaseExpiresAt: input.leaseExpiresAt, createdAt: input.at, updatedAt: input.at }).onConflictDoNothing();
      const [row] = await tx.select().from(modelArtifactIngestionReceipts).where(and(eq(modelArtifactIngestionReceipts.workspaceId, input.workspaceId), eq(modelArtifactIngestionReceipts.predictionId, input.predictionId), eq(modelArtifactIngestionReceipts.outputIndex, input.outputIndex))).for("update");
      if (!row || row.intentId !== input.intentId) throw new Error("ARTIFACT_RECEIPT_CONFLICT");
      if (row.status === "ready") return { kind: "ready" as const, receipt: receipt(row) };
      if (row.leaseOwner !== input.leaseOwner && row.leaseExpiresAt && row.leaseExpiresAt > input.at) return { kind: "busy" as const };
      const [leased] = row.leaseOwner === input.leaseOwner ? [row] : await tx.update(modelArtifactIngestionReceipts).set({ leaseOwner: input.leaseOwner, leaseEpoch: row.leaseEpoch + 1, leaseExpiresAt: input.leaseExpiresAt, updatedAt: input.at }).where(and(eq(modelArtifactIngestionReceipts.workspaceId, input.workspaceId), eq(modelArtifactIngestionReceipts.predictionId, input.predictionId), eq(modelArtifactIngestionReceipts.outputIndex, input.outputIndex), eq(modelArtifactIngestionReceipts.status, "claimed"), eq(modelArtifactIngestionReceipts.leaseEpoch, row.leaseEpoch))).returning();
      if (!leased) return { kind: "busy" as const };
      return { kind: "acquired" as const, receipt: receipt(leased) };
    });
  }
  async renew(input: Parameters<ArtifactReceiptPort["renew"]>[0]) {
    const [updated] = await this.database().update(modelArtifactIngestionReceipts).set({ leaseExpiresAt: input.leaseExpiresAt, updatedAt: input.at }).where(and(eq(modelArtifactIngestionReceipts.workspaceId, input.workspaceId), eq(modelArtifactIngestionReceipts.predictionId, input.predictionId), eq(modelArtifactIngestionReceipts.outputIndex, input.outputIndex), eq(modelArtifactIngestionReceipts.intentId, input.intentId), eq(modelArtifactIngestionReceipts.status, "claimed"), eq(modelArtifactIngestionReceipts.leaseOwner, input.leaseOwner), eq(modelArtifactIngestionReceipts.leaseEpoch, input.leaseEpoch))).returning({ epoch: modelArtifactIngestionReceipts.leaseEpoch });
    return updated?.epoch === input.leaseEpoch;
  }
  async complete(input: Parameters<ArtifactReceiptPort["complete"]>[0]) {
    return this.database().transaction(async (tx) => {
      const [current] = await tx.select().from(modelArtifactIngestionReceipts).where(and(eq(modelArtifactIngestionReceipts.workspaceId, input.workspaceId), eq(modelArtifactIngestionReceipts.predictionId, input.predictionId), eq(modelArtifactIngestionReceipts.outputIndex, input.outputIndex))).for("update");
      if (!current || current.intentId !== input.intentId) throw new Error("ARTIFACT_RECEIPT_CONFLICT");
      if (current.status === "ready") {
        if (current.assetId !== input.assetId || current.contentDigest !== input.contentDigest) throw new Error("ARTIFACT_RECEIPT_REPLAY_MISMATCH");
        return receipt(current);
      }
      const [updated] = await tx.update(modelArtifactIngestionReceipts).set({ status: "ready", assetId: input.assetId, mimeType: input.mimeType, sizeBytes: input.sizeBytes, width: input.width, height: input.height, durationSeconds: input.durationSeconds?.toFixed(3) ?? null, fps: input.fps?.toFixed(3) ?? null, contentDigest: input.contentDigest, leaseOwner: null, leaseExpiresAt: null, updatedAt: input.at }).where(and(eq(modelArtifactIngestionReceipts.workspaceId, input.workspaceId), eq(modelArtifactIngestionReceipts.predictionId, input.predictionId), eq(modelArtifactIngestionReceipts.outputIndex, input.outputIndex), eq(modelArtifactIngestionReceipts.status, "claimed"), eq(modelArtifactIngestionReceipts.leaseOwner, input.leaseOwner), eq(modelArtifactIngestionReceipts.leaseEpoch, input.leaseEpoch))).returning();
      if (!updated) throw new Error("ARTIFACT_RECEIPT_COMPLETE_CONFLICT");
      return receipt(updated);
    });
  }
}
