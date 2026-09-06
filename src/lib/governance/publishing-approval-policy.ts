import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  PublishingApprovalGovernanceBinding,
  PublishingApprovalGovernancePolicyPort,
} from "@/lib/agent-runtime/publishing-approvals/types";
import {
  advanceApprovalDeadline,
  ApprovalPolicyError,
  createContentAcceptanceProgress,
  decideContentAcceptance,
} from "./approval-policy";
import { legacyRoleBinding } from "./roles";
import type {
  ApprovalPolicyRevision,
  ContentAcceptanceProgress,
  GovernanceRepository,
  GovernanceResource,
  WorkspaceRoleBinding,
} from "./types";

interface PublishingApprovalRequestBody {
  [key: string]: unknown;
  purpose: "publishing_approval";
  runtimeApprovalRequestId: string;
  planId: string;
  planRevisionId: string;
  planRevision: number;
  planRevisionDigest: string;
  policyId: string;
  policyRevision: number;
  policyDigest: string;
  policySnapshot: ApprovalPolicyRevision;
  progress: ContentAcceptanceProgress;
}

function bindingFor(input: {
  runtimeApprovalRequestId: string;
  policyId: string;
  policyRevision: number;
  policyDigest: string;
}): PublishingApprovalGovernanceBinding {
  return {
    schema: "publishing-approval-governance-binding/v1",
    governanceRequestId: `gpar_${input.runtimeApprovalRequestId}`,
    policyId: input.policyId,
    policyRevision: input.policyRevision,
    policyDigest: input.policyDigest,
  };
}

function exactRequest(
  resource: GovernanceResource<PublishingApprovalRequestBody> | null,
  input: {
    workspaceId: string;
    runtimeApprovalRequestId: string;
    binding: PublishingApprovalGovernanceBinding;
  },
): resource is GovernanceResource<PublishingApprovalRequestBody> {
  if (!resource || resource.workspaceId !== input.workspaceId) return false;
  const body = resource.body;
  return body.purpose === "publishing_approval" &&
    body.runtimeApprovalRequestId === input.runtimeApprovalRequestId &&
    body.policyId === input.binding.policyId &&
    body.policyRevision === input.binding.policyRevision &&
    body.policyDigest === input.binding.policyDigest &&
    canonicalDigest(body.policySnapshot) === input.binding.policyDigest;
}

/**
 * Joins the runtime's exact Plan Revision and explicit Channel grants to the
 * Workspace's versioned multi-party Approval Policy. Neither side is sufficient
 * by itself; the runtime consumes only an accepted exact governance request.
 */
export class RepositoryPublishingApprovalGovernancePolicy
  implements PublishingApprovalGovernancePolicyPort {
  constructor(private readonly repository: GovernanceRepository) {}

  async bind(input: Parameters<PublishingApprovalGovernancePolicyPort["bind"]>[0]) {
    const policyResource = await this.repository.getResource<{
      revisions: ApprovalPolicyRevision[];
      activeRevision: number;
    }>({ workspaceId: input.workspaceId, kind: "approval_policy", id: input.policyId });
    const policy = policyResource?.body.revisions.find(
      (revision) => revision.revision === input.policyRevision,
    );
    if (
      !policyResource || policyResource.status !== "active" ||
      policyResource.body.activeRevision !== input.policyRevision ||
      !policy || policy.purpose !== "publishing_approval"
    ) return null;

    const policyDigest = canonicalDigest(policy);
    const binding = bindingFor({ ...input, policyDigest });
    const existing = await this.repository.getResource<PublishingApprovalRequestBody>({
      workspaceId: input.workspaceId,
      kind: "approval_request",
      id: binding.governanceRequestId,
    });
    if (existing) {
      return exactRequest(existing, { ...input, binding }) ? binding : null;
    }

    const baseProgress = createContentAcceptanceProgress({
      policy,
      requesterUserId: input.requestingPrincipalId,
      now: input.requestedAt,
    });
    const expiresAt = new Date(Math.min(
      new Date(baseProgress.expiresAt).getTime(),
      input.expiresAt.getTime(),
    ));
    const deadlineAt = new Date(Math.min(
      new Date(baseProgress.deadlineAt).getTime(),
      expiresAt.getTime(),
    ));
    const progress = {
      ...baseProgress,
      deadlineAt: deadlineAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const body: PublishingApprovalRequestBody = {
      purpose: "publishing_approval",
      runtimeApprovalRequestId: input.runtimeApprovalRequestId,
      planId: input.planId,
      planRevisionId: input.planRevisionId,
      planRevision: input.planRevision,
      planRevisionDigest: input.planRevisionDigest,
      policyId: input.policyId,
      policyRevision: input.policyRevision,
      policyDigest,
      policySnapshot: policy,
      progress,
    };
    const resource: GovernanceResource<PublishingApprovalRequestBody> = {
      id: binding.governanceRequestId,
      workspaceId: input.workspaceId,
      kind: "approval_request",
      version: 1,
      status: progress.status,
      body,
      createdByUserId: null,
      createdAt: input.requestedAt,
      updatedAt: input.requestedAt,
    };
    const requestDigest = canonicalDigest({ binding, body });
    const result = await this.repository.commit({
      receipt: {
        workspaceId: input.workspaceId,
        capability: "publishing_policy.bind@1",
        idempotencyKey: input.runtimeApprovalRequestId,
        requestDigest,
        result: binding,
        createdAt: input.requestedAt,
      },
      mutations: [{ type: "create", expectedVersion: null, resource }],
      audit: {
        schema: "workspace-audit-event/v1",
        id: `audit_${canonicalDigest({ requestDigest, event: "bind" }).slice("sha256:".length)}`,
        workspaceId: input.workspaceId,
        actor: { kind: "system", id: input.requestingPrincipalId },
        capability: "publishing_approvals.request@1",
        action: "request_publishing_approval",
        resource: { kind: "plan_revision", id: input.planRevisionId },
        outcome: "completed",
        redactedDetails: {
          runtimeApprovalRequestId: input.runtimeApprovalRequestId,
          policyId: input.policyId,
          policyRevision: input.policyRevision,
          planRevisionDigest: input.planRevisionDigest,
          authorizesExecution: false,
        },
        occurredAt: input.requestedAt,
      },
    });
    if (result.type === "conflict") return null;
    return binding;
  }

  async decide(input: Parameters<PublishingApprovalGovernancePolicyPort["decide"]>[0]) {
    const request = await this.repository.getResource<PublishingApprovalRequestBody>({
      workspaceId: input.workspaceId,
      kind: "approval_request",
      id: input.binding.governanceRequestId,
    });
    if (!exactRequest(request, input)) return "unavailable" as const;
    if (request.body.progress.status === "accepted") return input.decision === "approve" ? "accepted" as const : "conflict" as const;
    if (request.body.progress.status === "rejected") return input.decision === "reject" ? "rejected" as const : "conflict" as const;
    if (request.body.progress.status === "expired") return "expired" as const;

    const receiptKey = `ppd_${canonicalDigest({
      runtimeApprovalRequestId: input.runtimeApprovalRequestId,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
    }).slice("sha256:".length)}`;
    const requestDigest = canonicalDigest({
      binding: input.binding,
      runtimeApprovalRequestId: input.runtimeApprovalRequestId,
      userId: input.userId,
      decision: input.decision,
    });
    const receipt = await this.repository.findReceipt({
      workspaceId: input.workspaceId,
      capability: "publishing_policy.decide@1",
      idempotencyKey: receiptKey,
    });
    if (receipt) {
      if (receipt.requestDigest !== requestDigest) return "conflict" as const;
      return receipt.result as "pending" | "accepted" | "rejected" | "expired";
    }

    const assignment = await this.repository.getResource<{ binding: WorkspaceRoleBinding }>({
      workspaceId: input.workspaceId,
      kind: "member_role_assignment",
      id: input.userId,
    });
    const roleBinding = assignment?.status === "active"
      ? assignment.body.binding
      : { kind: "built_in" as const, role: legacyRoleBinding(input.legacyRole) };
    let roleId: string;
    if (roleBinding.kind === "built_in") {
      roleId = roleBinding.role;
    } else {
      const role = await this.repository.getResource<{ revisions: Array<{ revision: number }> }>({
        workspaceId: input.workspaceId,
        kind: "custom_role",
        id: roleBinding.roleId,
      });
      if (
        role?.status !== "active" ||
        !role.body.revisions.some((revision) => revision.revision === roleBinding.roleRevision)
      ) return "forbidden" as const;
      roleId = roleBinding.roleId;
    }

    let progress = advanceApprovalDeadline({
      policy: request.body.policySnapshot,
      progress: request.body.progress,
      now: input.decidedAt,
    });
    if (progress.status === "expired") {
      // Persist terminal expiry through the same idempotent decision boundary.
    } else {
      try {
        progress = decideContentAcceptance({
          policy: request.body.policySnapshot,
          progress,
          userId: input.userId,
          roleId,
          decision: input.decision,
          now: input.decidedAt,
        });
      } catch (error) {
        return error instanceof ApprovalPolicyError ? "forbidden" as const : "unavailable" as const;
      }
    }
    const status = progress.status;
    const next: GovernanceResource<PublishingApprovalRequestBody> = {
      ...request,
      version: request.version + 1,
      status,
      body: { ...request.body, progress },
      updatedAt: input.decidedAt,
    };
    const result = await this.repository.commit({
      receipt: {
        workspaceId: input.workspaceId,
        capability: "publishing_policy.decide@1",
        idempotencyKey: receiptKey,
        requestDigest,
        result: status,
        createdAt: input.decidedAt,
      },
      mutations: [{ type: "update", expectedVersion: request.version, resource: next }],
      audit: {
        schema: "workspace-audit-event/v1",
        id: `audit_${canonicalDigest({ requestDigest, event: "decision" }).slice("sha256:".length)}`,
        workspaceId: input.workspaceId,
        actor: { kind: "human", id: input.userId },
        capability: "publishing_approvals.decide@1",
        action: input.decision,
        resource: { kind: "approval_request", id: request.id },
        outcome: status === "accepted" ? "accepted" : "completed",
        redactedDetails: {
          runtimeApprovalRequestId: input.runtimeApprovalRequestId,
          policyId: input.binding.policyId,
          policyRevision: input.binding.policyRevision,
          status,
          authorizesExecution: false,
        },
        occurredAt: input.decidedAt,
      },
    });
    return result.type === "conflict"
      ? "conflict" as const
      : (result.type === "replayed" ? result.result : status) as
          "pending" | "accepted" | "rejected" | "expired";
  }

  async verifyAccepted(input: Parameters<PublishingApprovalGovernancePolicyPort["verifyAccepted"]>[0]) {
    const request = await this.repository.getResource<PublishingApprovalRequestBody>({
      workspaceId: input.workspaceId,
      kind: "approval_request",
      id: input.binding.governanceRequestId,
    });
    return exactRequest(request, input) && request.status === "accepted" &&
      request.body.progress.status === "accepted";
  }
}
