import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { modelTextOutputReceipts } from "./db-schema";
import type { CanonicalTextOutputIngestionPort } from "./replicate-contract";

type Db = ReturnType<typeof getDb>;
const MAX_TEXT_BYTES = 100_000;

function outputText(output: unknown): string {
  const text = typeof output === "string" ? output : Array.isArray(output) && output.every((item) => typeof item === "string") ? output.join("") : "";
  const normalized = text.normalize("NFC").trim();
  const bytes = Buffer.byteLength(normalized, "utf8");
  if (!normalized || bytes > MAX_TEXT_BYTES) throw new Error("TEXT_OUTPUT_INVALID");
  return normalized;
}

const digest = (content: string) => `sha256:${createHash("sha256").update(content).digest("hex")}` as const;
const receiptId = (workspaceId: string, predictionId: string) => `text_${createHash("sha256").update(`${workspaceId}:${predictionId}:0`).digest("hex").slice(0, 32)}`;

export class PostgresCanonicalTextOutputIngestion implements CanonicalTextOutputIngestionPort {
  constructor(private readonly database: () => Db) {}
  async ingest(input: Parameters<CanonicalTextOutputIngestionPort["ingest"]>[0]) {
    if (input.intent.outputContract.mediaType !== "text") throw new Error("TEXT_OUTPUT_CONTRACT_MISMATCH");
    const content = outputText(input.output); const contentDigest = digest(content); const id = receiptId(input.workspaceId, input.providerPredictionId); const byteLength = Buffer.byteLength(content, "utf8");
    return this.database().transaction(async (tx) => {
      await tx.insert(modelTextOutputReceipts).values({ workspaceId: input.workspaceId, id, predictionId: input.providerPredictionId, outputIndex: 0, intentId: input.intent.id, content, contentDigest, byteLength, createdAt: new Date() }).onConflictDoNothing();
      const [stored] = await tx.select().from(modelTextOutputReceipts).where(and(eq(modelTextOutputReceipts.workspaceId, input.workspaceId), eq(modelTextOutputReceipts.id, id))).limit(1);
      if (!stored || stored.intentId !== input.intent.id || stored.predictionId !== input.providerPredictionId || stored.contentDigest !== contentDigest || stored.byteLength !== byteLength) throw new Error("TEXT_OUTPUT_RECEIPT_CONFLICT");
      return { textOutputIds: [stored.id] };
    });
  }
}
