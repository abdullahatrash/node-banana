import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import {
  SUPPORT_ATTACHMENT_MAX_COUNT,
  SupportAttachmentPolicyError,
  validateSupportAttachmentCandidates,
} from "@/lib/product-support/attachment-policy";
import type { ProductRecordExecutor } from "@/lib/product-surfaces/repository";

export * from "@/lib/product-support/attachment-policy";

export async function resolveSupportAttachmentReferences(input: { workspaceId: string; assetIds: string[]; capturedAt?: Date }) {
  return resolveSupportAttachmentReferencesWithExecutor(getDb(), input);
}

export async function resolveSupportAttachmentReferencesWithExecutor(executor: ProductRecordExecutor, input: { workspaceId: string; assetIds: string[]; capturedAt?: Date }) {
  const ids = input.assetIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return [];
  if (ids.length > SUPPORT_ATTACHMENT_MAX_COUNT) throw new SupportAttachmentPolicyError("SUPPORT_ATTACHMENT_COUNT_EXCEEDED");
  const rows = await executor.select({ id: assets.id, type: assets.type, mimeType: assets.mimeType, sizeBytes: assets.sizeBytes, checksum: assets.checksum, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), inArray(assets.id, ids), isNull(assets.deletedAt)));
  return validateSupportAttachmentCandidates({ requestedIds: ids, candidates: rows, capturedAt: input.capturedAt ?? new Date() });
}
