import { canonicalDigest } from "@/lib/agent-tools/canonical";

export function brandCommandRequestDigest(input: {
  workspaceId: string;
  action: string;
  facts: Record<string, unknown>;
}) {
  return canonicalDigest({
    workspaceId: input.workspaceId,
    action: input.action,
    ...input.facts,
  });
}

export function brandReceiptRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("BRAND_RECEIPT_REVISION_INVALID");
  }
  return revision;
}

export function draftFollowsActiveBrandLineage(input: {
  draftSourceProfileId: string | null;
  activeProfileId: string;
}) {
  return input.draftSourceProfileId === input.activeProfileId;
}
