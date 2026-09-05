import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { modelTextOutputReceipts } from "./db-schema";
import type { CanonicalTextOutputIngestionPort } from "./replicate-contract";
import { structuredCopySchema } from "@/lib/creative-generation/contracts";

type Db = ReturnType<typeof getDb>;
const MAX_TEXT_BYTES = 100_000;

function outputText(output: unknown, preserveExact = false): string {
  const text = typeof output === "string" ? output : Array.isArray(output) && output.every((item) => typeof item === "string") ? output.join("") : "";
  const normalized = preserveExact ? text : text.normalize("NFC").trim();
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
    const creative = input.intent.providerComposition.promptVersion === "tasmeemai-creative-prompt/v1";
    const content = outputText(input.output, creative); const contentDigest = digest(content); const id = receiptId(input.workspaceId, input.providerPredictionId); const byteLength = Buffer.byteLength(content, "utf8");
    const receipt = await this.database().transaction(async (tx) => {
      await tx.insert(modelTextOutputReceipts).values({ workspaceId: input.workspaceId, id, predictionId: input.providerPredictionId, outputIndex: 0, intentId: input.intent.id, content, contentDigest, byteLength, createdAt: new Date() }).onConflictDoNothing();
      const [stored] = await tx.select().from(modelTextOutputReceipts).where(and(eq(modelTextOutputReceipts.workspaceId, input.workspaceId), eq(modelTextOutputReceipts.id, id))).limit(1);
      if (!stored || stored.intentId !== input.intent.id || stored.predictionId !== input.providerPredictionId || stored.contentDigest !== contentDigest || stored.byteLength !== byteLength) throw new Error("TEXT_OUTPUT_RECEIPT_CONFLICT");
      return { textOutputIds: [stored.id] };
    });
    // Preserve the raw output receipt even when validation fails, but do not
    // report unusable creative copy as success and settle customer credits.
    if (creative) validateCreativeTextOutput(content, input.intent);
    return receipt;
  }
}

export function validateCreativeTextOutput(content: string, intent: Pick<Parameters<CanonicalTextOutputIngestionPort["ingest"]>[0]["intent"], "contentLanguage" | "arabicVariety" | "creativeBinding">) {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { throw new Error("CREATIVE_TEXT_OUTPUT_INVALID"); }
  const parsed = structuredCopySchema.safeParse(raw);
  if (!parsed.success || parsed.data.language !== intent.contentLanguage || parsed.data.arabicVariety !== intent.arabicVariety) throw new Error("CREATIVE_TEXT_OUTPUT_INVALID");
  const output = intent.creativeBinding?.output;
  if (output && parsed.data.blocks.some((block) => output.format === "image" ? block.timing !== null : block.timing === null || output.durationMs === null || block.timing.endMs > output.durationMs)) throw new Error("CREATIVE_TEXT_OUTPUT_INVALID");
}
