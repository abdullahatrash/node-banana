import "server-only";

import { getDb } from "@/lib/db";
import { createProductRecordInTransaction } from "@/lib/product-surfaces/repository";
import { resolveSupportAttachmentReferencesWithExecutor } from "./attachments";

type SupportCommand = {
  workspaceId: string;
  userId: string;
  title: string;
  body: string;
  attachmentAssetIds: string[];
  idempotencyKey: string;
} & (
  | { kind: "feedback"; category: "idea" | "problem" | "praise"; route: string }
  | { kind: "support_case"; category: "account" | "billing" | "generation" | "publishing" | "safety" | "other"; severity: "normal" | "urgent" }
);

/** Resolves tenant-owned attachments and appends the support record in one transaction. */
export async function submitSupportCommand(input: SupportCommand) {
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const attachmentRefs = await resolveSupportAttachmentReferencesWithExecutor(tx, { workspaceId: input.workspaceId, assetIds: input.attachmentAssetIds, capturedAt: now });
    return createProductRecordInTransaction(tx, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      title: input.title,
      kind: input.kind,
      state: input.kind === "feedback" ? "submitted" : "open",
      payload: input.kind === "feedback"
        ? { category: input.category, body: input.body, route: input.route, attachmentRefs }
        : { category: input.category, body: input.body, severity: input.severity, resolution: "", attachmentRefs },
      idempotencyKey: input.idempotencyKey,
      now,
    });
  });
}
