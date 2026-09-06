import type { ApprovalPolicyRevision, ContentAcceptanceProgress } from "./types";

export class ApprovalPolicyError extends Error {}

function eligibleRoles(policy: ApprovalPolicyRevision, progress: ContentAcceptanceProgress): string[] {
  const base = policy.mode.kind === "sequential"
    ? policy.mode.stages[progress.currentStage]?.eligibleRoleIds ?? []
    : policy.mode.eligibleRoleIds;
  return progress.status === "escalated" ? [...new Set([...base, ...policy.escalationRoleIds])] : base;
}

export function createContentAcceptanceProgress(input: { policy: ApprovalPolicyRevision; requesterUserId: string; now: Date }): ContentAcceptanceProgress {
  return { schema: "content-acceptance-progress/v1", status: "pending", requesterUserId: input.requesterUserId, currentStage: 0, decisions: [], deadlineAt: new Date(input.now.getTime() + input.policy.deadlineSeconds * 1_000).toISOString(), expiresAt: new Date(input.now.getTime() + input.policy.expiresAfterSeconds * 1_000).toISOString(), escalatedAt: null, authorizesExecution: false };
}

export function decideContentAcceptance(input: { policy: ApprovalPolicyRevision; progress: ContentAcceptanceProgress; userId: string; roleId: string; decision: "approve" | "reject"; now: Date }): ContentAcceptanceProgress {
  const progress = advanceApprovalDeadline({ policy: input.policy, progress: input.progress, now: input.now });
  if (!["pending", "escalated"].includes(progress.status)) throw new ApprovalPolicyError("Content Acceptance is terminal.");
  if (!eligibleRoles(input.policy, progress).includes(input.roleId)) throw new ApprovalPolicyError("Actor is not eligible for this Approval Policy stage.");
  if (input.policy.separationOfDuty && (input.userId === progress.requesterUserId || progress.decisions.some((item) => item.userId === input.userId && item.decision === "approve"))) throw new ApprovalPolicyError("Separation of duty requires a distinct approver.");
  if (progress.decisions.some((item) => item.userId === input.userId && item.stage === progress.currentStage)) throw new ApprovalPolicyError("Actor already decided this stage.");
  const decisions = [...progress.decisions, { userId: input.userId, roleId: input.roleId, decision: input.decision, stage: progress.currentStage, decidedAt: input.now.toISOString() }];
  if (input.decision === "reject") return { ...progress, status: "rejected", decisions };
  if (input.policy.mode.kind === "sequential") {
    const nextStage = progress.currentStage + 1;
    return nextStage >= input.policy.mode.stages.length ? { ...progress, status: "accepted", decisions } : { ...progress, status: "pending", currentStage: nextStage, decisions, deadlineAt: new Date(input.now.getTime() + input.policy.deadlineSeconds * 1_000).toISOString(), escalatedAt: null };
  }
  if (input.policy.mode.kind === "quorum") {
    const approved = new Set(decisions.filter((item) => item.decision === "approve").map((item) => item.userId)).size;
    return { ...progress, status: approved >= input.policy.mode.required ? "accepted" : progress.status, decisions };
  }
  return { ...progress, status: "accepted", decisions };
}

export function advanceApprovalDeadline(input: { policy: ApprovalPolicyRevision; progress: ContentAcceptanceProgress; now: Date }): ContentAcceptanceProgress {
  if (!["pending", "escalated"].includes(input.progress.status)) return input.progress;
  if (input.now >= new Date(input.progress.expiresAt)) return { ...input.progress, status: "expired" };
  if (input.progress.status === "pending" && input.now >= new Date(input.progress.deadlineAt)) return { ...input.progress, status: "escalated", escalatedAt: input.now.toISOString() };
  return input.progress;
}
