import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { describe, expect, it } from "vitest";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { RepositoryPublishingApprovalGovernancePolicy } from "../publishing-approval-policy";
import type { ApprovalPolicyRevision, GovernanceResource, WorkspaceRoleBinding } from "../types";

const now = new Date("2026-09-03T12:00:00.000Z");

function resource<T extends Record<string, unknown>>(input: {
  id: string;
  kind: GovernanceResource["kind"];
  body: T;
  status?: string;
}): GovernanceResource<T> {
  return {
    id: input.id,
    workspaceId: "workspace_1",
    kind: input.kind,
    version: 1,
    status: input.status ?? "active",
    body: input.body,
    createdByUserId: "owner_1",
    createdAt: now,
    updatedAt: now,
  };
}

function policy(mode: ApprovalPolicyRevision["mode"]): ApprovalPolicyRevision {
  return {
    schema: "approval-policy-revision/v1",
    revision: 3,
    purpose: "publishing_approval",
    mode,
    separationOfDuty: true,
    deadlineSeconds: 600,
    escalationRoleIds: ["admin"],
    expiresAfterSeconds: 3_600,
    createdByUserId: "owner_1",
    createdAt: now.toISOString(),
  };
}

async function setup(mode: ApprovalPolicyRevision["mode"]) {
  const repository = new InMemoryGovernanceRepository();
  const revision = policy(mode);
  repository.resources.set("workspace_1\u0000approval_policy\u0000policy_1", resource({
    id: "policy_1",
    kind: "approval_policy",
    body: { revisions: [revision], activeRevision: 3 },
  }));
  const port = new RepositoryPublishingApprovalGovernancePolicy(repository);
  const binding = await port.bind({
    workspaceId: "workspace_1",
    runtimeApprovalRequestId: "par_runtime_1",
    requestingPrincipalId: "agent_requester",
    planId: "plan_1",
    planRevisionId: "ppr_1",
    planRevision: 4,
    planRevisionDigest: `sha256:${"1".repeat(64)}`,
    policyId: "policy_1",
    policyRevision: 3,
    expiresAt: new Date("2026-09-03T12:30:00.000Z"),
    requestedAt: now,
  });
  if (!binding) throw new Error("binding failed");
  return { repository, revision, port, binding };
}

function assign(repository: InMemoryGovernanceRepository, userId: string, binding: WorkspaceRoleBinding) {
  repository.resources.set(`workspace_1\u0000member_role_assignment\u0000${userId}`, resource({
    id: userId,
    kind: "member_role_assignment",
    body: { binding },
  }));
}

describe("RepositoryPublishingApprovalGovernancePolicy", () => {
  it("pins the exact active policy and Plan revision and enforces sequential stages", async () => {
    const setupValue = await setup({
      kind: "sequential",
      stages: [{ eligibleRoleIds: ["creator"] }, { eligibleRoleIds: ["approver"] }],
    });
    assign(setupValue.repository, "approver_1", { kind: "built_in", role: "approver" });
    expect(setupValue.binding.policyDigest).toBe(canonicalDigest(setupValue.revision));

    await expect(setupValue.port.decide({
      workspaceId: "workspace_1", binding: setupValue.binding,
      runtimeApprovalRequestId: "par_runtime_1", userId: "creator_1",
      legacyRole: "member", decision: "approve", idempotencyKey: "creator-stage-key",
      decidedAt: new Date("2026-09-03T12:01:00.000Z"),
    })).resolves.toBe("pending");
    await expect(setupValue.port.verifyAccepted({
      workspaceId: "workspace_1", runtimeApprovalRequestId: "par_runtime_1",
      binding: setupValue.binding,
    })).resolves.toBe(false);

    await expect(setupValue.port.decide({
      workspaceId: "workspace_1", binding: setupValue.binding,
      runtimeApprovalRequestId: "par_runtime_1", userId: "approver_1",
      legacyRole: "member", decision: "approve", idempotencyKey: "approver-stage-key",
      decidedAt: new Date("2026-09-03T12:02:00.000Z"),
    })).resolves.toBe("accepted");
    await expect(setupValue.port.verifyAccepted({
      workspaceId: "workspace_1", runtimeApprovalRequestId: "par_runtime_1",
      binding: setupValue.binding,
    })).resolves.toBe(true);
  });

  it("enforces quorum, separation of duty, idempotency, and exact active revision", async () => {
    const setupValue = await setup({
      kind: "quorum",
      eligibleRoleIds: ["approver"],
      required: 2,
    });
    assign(setupValue.repository, "approver_a", { kind: "built_in", role: "approver" });
    assign(setupValue.repository, "approver_b", { kind: "built_in", role: "approver" });
    const first = {
      workspaceId: "workspace_1", binding: setupValue.binding,
      runtimeApprovalRequestId: "par_runtime_1", userId: "approver_a",
      legacyRole: "member" as const, decision: "approve" as const,
      idempotencyKey: "quorum-decision-a", decidedAt: new Date("2026-09-03T12:01:00.000Z"),
    };
    await expect(setupValue.port.decide(first)).resolves.toBe("pending");
    await expect(setupValue.port.decide(first)).resolves.toBe("pending");
    await expect(setupValue.port.decide({ ...first, idempotencyKey: "quorum-a-again" }))
      .resolves.toBe("forbidden");
    await expect(setupValue.port.decide({
      ...first,
      userId: "approver_b",
      idempotencyKey: "quorum-decision-b",
      decidedAt: new Date("2026-09-03T12:02:00.000Z"),
    })).resolves.toBe("accepted");

    await expect(setupValue.port.bind({
      workspaceId: "workspace_1", runtimeApprovalRequestId: "par_stale",
      requestingPrincipalId: "agent_requester", planId: "plan_1",
      planRevisionId: "ppr_1", planRevision: 4,
      planRevisionDigest: `sha256:${"1".repeat(64)}`,
      policyId: "policy_1", policyRevision: 2,
      expiresAt: new Date("2026-09-03T12:30:00.000Z"), requestedAt: now,
    })).resolves.toBeNull();
  });
});
