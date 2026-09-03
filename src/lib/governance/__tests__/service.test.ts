import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { BUILT_IN_ROLE_APPLICATION_CAPABILITIES, BUILT_IN_ROLE_CAPABILITIES } from "../roles";
import { decodeInvitationToken, decodeReviewToken, GovernanceError, GovernanceService } from "../service";
import { RepositoryPublishingApprovalGovernancePolicy } from "../publishing-approval-policy";
import { ConfiguredGovernanceRegionVerifier, GovernanceRegionAdmissionService, type GovernanceRegionDeploymentEvidence } from "../region-policy";
import { TRUSTED_RETENTION_LEGAL_FLOORS } from "../retention-policy";
import { RETENTION_CLASSES, type GovernanceActor, type RetentionRule } from "../types";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const owner: GovernanceActor = { workspaceId: "workspace-a", userId: "owner-a", legacyRole: "owner", authContextId: "session-owner-a" };
const creator: GovernanceActor = { workspaceId: "workspace-a", userId: "creator-a", legacyRole: "member", authContextId: "session-creator-a" };
const digest = canonicalDigest({ revision: 1 });
const regionKey = Buffer.alloc(32, 7);
const bulkPreview = { inspect: async () => ({ type: "ready" as const, authorizationEvidenceRef: "test-authorization", authorizationContractDigest: canonicalDigest({ contract: 1 }), targetStateDigest: canonicalDigest({ target: 1 }), entitlement: "exact_capability_granted" as const, quote: { required: false as const, amount: "0" as const, currency: "USD" as const, source: "capability_effect_contract" as const, digest: canonicalDigest({ amount: 0 }) } }) };

function regionEvidence(validSignature = true): GovernanceRegionDeploymentEvidence {
  const payload = {
    schema: "governance-region-deployment-evidence/v1" as const,
    keyId: "deployment-key-1", deploymentId: "deployment-1", region: "me-central-1",
    issuedAt: "2026-09-03T11:00:00.000Z", expiresAt: "2026-10-03T12:00:00.000Z",
    routes: (["primary_storage", "processing", "backup", "logging", "deletion"] as const).map((kind) => ({ kind, routeId: `${kind}-me-1`, region: "me-central-1" })),
  };
  return { ...payload, signature: validSignature ? createHmac("sha256", regionKey).update(canonicalJson(payload)).digest("base64url") : Buffer.alloc(32, 1).toString("base64url") };
}

function setup() {
  const repository = new InMemoryGovernanceRepository();
  const service = new GovernanceService(
    repository,
    { now: () => new Date(NOW) },
    undefined,
    undefined,
    { verify: () => true },
    bulkPreview,
    undefined,
    { resolve: async ({ resourceKind, resourceId }) => ({ resourceKind: resourceKind as "media", resourceId, retentionClass: "security_evidence", createdAt: new Date(NOW), authoritativeSystems: ["primary", "replica"] }) },
  );
  return { repository, service };
}

async function stepUp(service: GovernanceService, purpose: string, resourceId: string | null = null) {
  const challenge = await service.execute(owner, { type: "begin_step_up", purpose, resourceId }, `begin-${purpose}-key`) as { challengeId: string; verificationCode: string };
  return service.execute(owner, { type: "verify_step_up", challengeId: challenge.challengeId, code: challenge.verificationCode }, `verify-${purpose}-key`) as Promise<{ stepUpToken: string }>;
}

describe("GovernanceService", () => {
  it("keeps every role bundle separate from credential, spend, and publishing Approval authority", () => {
    for (const capabilities of Object.values(BUILT_IN_ROLE_CAPABILITIES)) {
      expect(capabilities.some((item) => item.includes("credential"))).toBe(false);
      expect(capabilities.some((item) => item.includes("spend"))).toBe(false);
      expect(capabilities).not.toContain("publishing.approve");
      expect(capabilities).not.toContain("reviews.decide_publishing");
    }
    for (const capabilities of Object.values(BUILT_IN_ROLE_APPLICATION_CAPABILITIES)) {
      const names = capabilities.map((item) => item.name);
      expect(names.some((item) => item.startsWith("credentials.profiles."))).toBe(false);
      expect(names.some((item) => item.startsWith("credentials.spend_grants."))).toBe(false);
      expect(names).not.toContain("publishing_approvals.decide");
      expect(names).not.toContain("publishing_plan_revisions.release");
      expect(names).not.toContain("workflow_runs.start");
    }
  });

  it("versions Custom Roles, rejects reserved authority, and pins assignments to one revision", async () => {
    const { repository, service } = setup();
    await expect(service.execute(owner, { type: "create_custom_role", name: "Unsafe", description: "Unsafe role", capabilities: ["workspace.close"] }, "unsafe-role-key")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.execute(owner, { type: "create_custom_role", name: "Implicit publisher", description: "Unsafe role", capabilities: ["reviews.decide_publishing"] }, "unsafe-publishing-role-key")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.execute(owner, { type: "create_custom_role", name: "Unsafe app", description: "Unsafe role", capabilities: ["governance.view"], applicationCapabilities: [{ name: "publishing_plan_revisions.release", version: 1 }] }, "unsafe-app-role-key")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const created = await service.execute(owner, { type: "create_custom_role", name: "Reviewer", description: "Content reviewer", capabilities: ["governance.view", "reviews.decide_content"], applicationCapabilities: [{ name: "artifacts.list", version: 1 }] }, "create-role-key") as { roleId: string; revision: { applicationCapabilities: Array<{ name: string; version: number }> } };
    expect(created.revision.applicationCapabilities).toEqual([{ name: "artifacts.list", version: 1 }]);
    const revised = await service.execute(owner, { type: "revise_custom_role", roleId: created.roleId, expectedVersion: 1, name: "Senior reviewer", description: "Reviews content and audit", capabilities: ["governance.view", "reviews.decide_content", "audit.view"], applicationCapabilities: [{ name: "publishing_approvals.get", version: 2 }] }, "revise-role-key") as { revision: { revision: number; applicationCapabilities: Array<{ name: string; version: number }> } };
    expect(revised.revision.revision).toBe(2);
    expect(revised.revision.applicationCapabilities).toEqual([{ name: "publishing_approvals.get", version: 2 }]);
    await service.execute(owner, { type: "assign_role", userId: creator.userId, binding: { kind: "custom", roleId: created.roleId, roleRevision: 1 } }, "assign-role-key");
    const assigned = await repository.getResource<{ binding: { roleRevision: number } }>({ workspaceId: owner.workspaceId, kind: "member_role_assignment", id: creator.userId });
    expect(assigned?.body.binding.roleRevision).toBe(1);
    expect((await service.snapshot(creator)).actorCapabilities).not.toContain("audit.view");
  });

  it("replays the same command and rejects reuse of its key for another request", async () => {
    const { repository, service } = setup();
    const command = { type: "create_portfolio" as const, name: "Agency clients" };
    const first = await service.execute(owner, command, "portfolio-key");
    expect(await service.execute(owner, command, "portfolio-key")).toEqual(first);
    await expect(service.execute(owner, { ...command, name: "Different" }, "portfolio-key")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.listResources({ workspaceId: owner.workspaceId, kinds: ["portfolio"] }))).toHaveLength(1);
    expect(await repository.listAudit({ workspaceId: owner.workspaceId, limit: 100 })).toHaveLength(1);
  });

  it("does not leak a concurrently committed receipt or secret to another authorized actor", async () => {
    const { repository, service } = setup();
    const command = { type: "create_invitation" as const, email: "race@example.com", binding: { kind: "built_in" as const, role: "viewer" as const }, expiresAt: "2026-09-10T12:00:00.000Z" };
    const otherAdmin: GovernanceActor = { ...owner, userId: "admin-b", legacyRole: "admin", authContextId: "session-admin-b" };

    const outcomes = await Promise.allSettled([
      service.execute(owner, command, "concurrent-actor-bound-delivery"),
      service.execute(otherAdmin, command, "concurrent-actor-bound-delivery"),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: expect.stringMatching(/^(CONFLICT|FORBIDDEN)$/) });
    expect(await repository.listResources({ workspaceId: owner.workspaceId, kinds: ["invitation_binding"] })).toHaveLength(1);
    expect(repository.secretDeliveries.size).toBe(1);
  });

  it("accepts invitations only for the verified recipient and provisions canonical membership", async () => {
    const repository = new InMemoryGovernanceRepository();
    const provision = vi.fn().mockResolvedValue(undefined);
    const service = new GovernanceService(repository, { now: () => new Date(NOW) }, {
      provisionAcceptedMembership: provision,
      removeMembership: vi.fn().mockResolvedValue("removed"),
      transferOwnership: vi.fn().mockResolvedValue("transferred"),
      closeWorkspace: vi.fn().mockResolvedValue("closed"),
    });
    const invitation = await service.execute(owner, { type: "create_invitation", email: "new@example.com", binding: { kind: "built_in", role: "approver" }, expiresAt: "2026-09-10T12:00:00.000Z" }, "create-invitation-key") as { invitationId: string; invitationToken: string };
    const decoded = decodeInvitationToken(invitation.invitationToken)!;
    await expect(service.acceptInvitation({ ...decoded, token: decoded.secret, userId: "new-user", verifiedEmail: "other@example.com", authContextId: "session-new-user", idempotencyKey: "wrong-email-key" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const accepted = await service.acceptInvitation({ workspaceId: decoded.workspaceId, invitationId: decoded.invitationId, token: decoded.secret, userId: "new-user", verifiedEmail: "new@example.com", authContextId: "session-new-user", idempotencyKey: "accept-invite-key" });
    expect(accepted).toMatchObject({ accepted: true, userId: "new-user", binding: { kind: "built_in", role: "approver" } });
    expect(await service.acceptInvitation({ workspaceId: decoded.workspaceId, invitationId: decoded.invitationId, token: decoded.secret, userId: "new-user", verifiedEmail: "new@example.com", authContextId: "session-new-user", idempotencyKey: "accept-invite-key" })).toEqual(accepted);
    expect(provision).toHaveBeenCalledWith({ workspaceId: owner.workspaceId, userId: "new-user", binding: { kind: "built_in", role: "approver" } });
    expect(provision).toHaveBeenCalledTimes(1);
    expect(await repository.getResource({ workspaceId: owner.workspaceId, kind: "member_role_assignment", id: "new-user" })).toBeTruthy();
    expect(repository.canonicalEffects).toContainEqual(expect.objectContaining({ type: "membership_upsert", workspaceId: owner.workspaceId, userId: "new-user", role: "member" }));
    expect(await repository.listResources({ workspaceId: owner.workspaceId, kinds: ["membership_projection"], status: "queued" })).toHaveLength(1);
  });

  it("prohibits parallel Owner assignment and invitation paths", async () => {
    const { service } = setup();
    await expect(service.execute(owner, { type: "assign_role", userId: "member-b", binding: { kind: "built_in", role: "owner" } }, "assign-owner-directly")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.execute(owner, { type: "create_invitation", email: "owner@example.com", binding: { kind: "built_in", role: "owner" }, expiresAt: "2026-09-10T12:00:00.000Z" }, "invite-owner-directly")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("never persists plaintext bearer secrets in append-only receipts", async () => {
    const { repository, service } = setup();
    const invitation = await service.execute(owner, { type: "create_invitation", email: "secret@example.com", binding: { kind: "built_in", role: "viewer" }, expiresAt: "2026-09-10T12:00:00.000Z" }, "secret-invitation-key") as { invitationToken: string };
    expect(invitation.invitationToken).toBeTruthy();
    const receipt = await repository.findReceipt({ workspaceId: owner.workspaceId, capability: "members.invite@1", idempotencyKey: "secret-invitation-key" });
    expect(JSON.stringify(receipt?.result)).not.toContain(invitation.invitationToken);
    expect(receipt?.result).not.toHaveProperty("invitationToken");

    const challenge = await service.execute(owner, { type: "begin_step_up", purpose: "exports.manage", resourceId: null }, "secret-step-up-code") as { verificationCode: string };
    expect(challenge.verificationCode).toMatch(/^\d{6}$/);
    const challengeReceipt = await repository.findReceipt({ workspaceId: owner.workspaceId, capability: "governance.view@1", idempotencyKey: "secret-step-up-code" });
    expect(challengeReceipt?.result).not.toHaveProperty("verificationCode");
  });

  it("recovers secret-bearing responses only from bounded encrypted delivery storage", async () => {
    let current = new Date(NOW);
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => current });
    const command = { type: "create_invitation" as const, email: "delivery@example.com", binding: { kind: "built_in" as const, role: "viewer" as const }, expiresAt: "2026-09-10T12:00:00.000Z" };
    const issued = await service.execute(owner, command, "bounded-secret-delivery") as { invitationToken: string };
    const storedDelivery = await repository.findSecretDelivery({ workspaceId: owner.workspaceId, capability: "members.invite@1", idempotencyKey: "bounded-secret-delivery" });
    expect(storedDelivery?.encryptedPayload).not.toContain(issued.invitationToken);
    expect(await service.execute(owner, command, "bounded-secret-delivery")).toEqual(issued);

    current = new Date(NOW.getTime() + 10 * 60_000 + 1);
    expect(await service.execute(owner, command, "bounded-secret-delivery")).toEqual(expect.objectContaining({ invitationId: expect.any(String) }));
    expect(await service.execute(owner, command, "bounded-secret-delivery")).not.toHaveProperty("invitationToken");
  });

  it("re-authorizes before replay and binds receipts and secrets to the exact actor session", async () => {
    const { service } = setup();
    const command = { type: "create_invitation" as const, email: "bound@example.com", binding: { kind: "built_in" as const, role: "viewer" as const }, expiresAt: "2026-09-10T12:00:00.000Z" };
    const issued = await service.execute(owner, command, "actor-bound-delivery") as { invitationToken: string };
    expect(issued.invitationToken).toBeTruthy();

    await expect(service.execute(
      { ...owner, legacyRole: "member" },
      command,
      "actor-bound-delivery",
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.execute(
      { ...owner, userId: "other-admin", legacyRole: "admin", authContextId: "session-other-admin" },
      command,
      "actor-bound-delivery",
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.execute(
      { ...owner, authContextId: "replacement-session-owner-a" },
      command,
      "actor-bound-delivery",
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("purges expired bounded secret deliveries without deleting permanent redacted receipts", async () => {
    let current = new Date(NOW);
    const repository = new InMemoryGovernanceRepository();
    const service = new GovernanceService(repository, { now: () => current });
    const command = { type: "create_invitation" as const, email: "purge@example.com", binding: { kind: "built_in" as const, role: "viewer" as const }, expiresAt: "2026-09-10T12:00:00.000Z" };
    await service.execute(owner, command, "purge-secret-delivery");
    current = new Date(NOW.getTime() + 10 * 60_000 + 1);

    expect(await repository.purgeExpiredSecretDeliveries({ expiredBefore: current, limit: 100 })).toBe(1);
    expect(await repository.findSecretDelivery({ workspaceId: owner.workspaceId, capability: "members.invite@1", idempotencyKey: "purge-secret-delivery" })).toBeNull();
    expect(await repository.findReceipt({ workspaceId: owner.workspaceId, capability: "members.invite@1", idempotencyKey: "purge-secret-delivery" })).not.toBeNull();
  });

  it("returns role-filtered snapshots with deeply redacted security material", async () => {
    const { service } = setup();
    await service.execute(owner, { type: "create_invitation", email: "private@example.com", binding: { kind: "built_in", role: "viewer" }, expiresAt: "2026-09-10T12:00:00.000Z" }, "snapshot-invitation-key");
    await service.execute(owner, { type: "issue_review_guest", email: "reviewer@example.com", purpose: "inspect", resourceKind: "render_proof", resourceId: "proof-1", revisionDigest: digest, expiresAt: "2026-09-10T12:00:00.000Z" }, "snapshot-review-key");
    await service.execute(owner, { type: "begin_step_up", purpose: "exports.manage", resourceId: null }, "snapshot-step-up-key");

    const snapshot = await service.snapshot(owner);
    const serialized = JSON.stringify(snapshot);
    expect(snapshot.resources.step_up_challenge).toBeUndefined();
    expect(snapshot.resources.step_up_session).toBeUndefined();
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("reviewer@example.com");
    expect(serialized).not.toContain("tokenDigest");
    expect(serialized).not.toContain("codeDigest");
    expect(serialized).not.toContain("codeSalt");
  });

  it("merges Workspace-isolated authoritative domain audit events into the customer trail", async () => {
    const repository = new InMemoryGovernanceRepository();
    const list = vi.fn(async ({ workspaceId }: { workspaceId: string }) => [{ schema: "workspace-audit-event/v1" as const, id: "federated:generation:event-1", workspaceId, actor: { kind: "system" as const, id: "agent-1" }, capability: "workflow_runs.audit@1", action: "run.completed", resource: { kind: "workflow_run", id: "run-1" }, outcome: "completed" as const, redactedDetails: { source: "generation", tokenDigest: "must-not-render" }, occurredAt: new Date(NOW) }]);
    const service = new GovernanceService(repository, { now: () => new Date(NOW) }, undefined, undefined, { verify: () => true }, bulkPreview, { list });
    const snapshot = await service.snapshot(owner);
    expect(list).toHaveBeenCalledWith({ workspaceId: owner.workspaceId, limit: 100 });
    expect(snapshot.audit).toContainEqual(expect.objectContaining({ id: "federated:generation:event-1", workspaceId: owner.workspaceId, action: "run.completed" }));
    expect(JSON.stringify(snapshot.audit)).not.toContain("must-not-render");
  });

  it("revokes a pending invitation so it can no longer be accepted", async () => {
    const { service } = setup();
    const invitation = await service.execute(owner, { type: "create_invitation", email: "revoked@example.com", binding: { kind: "built_in", role: "viewer" }, expiresAt: "2026-09-10T12:00:00.000Z" }, "create-revoked-invite") as { invitationId: string; invitationToken: string };
    await service.execute(owner, { type: "revoke_invitation", invitationId: invitation.invitationId }, "revoke-invite-key");
    const decoded = decodeInvitationToken(invitation.invitationToken)!;
    await expect(service.acceptInvitation({ workspaceId: decoded.workspaceId, invitationId: decoded.invitationId, token: decoded.secret, userId: "revoked-user", verifiedEmail: "revoked@example.com", authContextId: "session-revoked-user", idempotencyKey: "accept-revoked-key" })).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("requires exact step-up for ownership transfer and enforces cancellable Workspace closure cooling-off", async () => {
    let current = new Date(NOW);
    const repository = new InMemoryGovernanceRepository();
    const transferOwnership = vi.fn().mockResolvedValue("transferred");
    const closeWorkspace = vi.fn().mockResolvedValue("closed");
    const service = new GovernanceService(repository, { now: () => new Date(current) }, {
      provisionAcceptedMembership: vi.fn(), removeMembership: vi.fn().mockResolvedValue("removed"), transferOwnership, closeWorkspace,
    });
    await expect(service.execute(owner, { type: "transfer_ownership", newOwnerUserId: "member-b", stepUpToken: "not-valid" }, "transfer-without-stepup")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    const transferChallenge = await service.execute(owner, { type: "begin_step_up", purpose: "workspace.transfer_ownership", resourceId: "member-b" }, "begin-owner-transfer") as { challengeId: string; verificationCode: string };
    const transferSession = await service.execute(owner, { type: "verify_step_up", challengeId: transferChallenge.challengeId, code: transferChallenge.verificationCode }, "verify-owner-transfer") as { stepUpToken: string };
    await service.execute(owner, { type: "transfer_ownership", newOwnerUserId: "member-b", stepUpToken: transferSession.stepUpToken }, "complete-owner-transfer");
    expect(transferOwnership).toHaveBeenCalledWith({ workspaceId: owner.workspaceId, currentOwnerUserId: owner.userId, newOwnerUserId: "member-b" });
    expect(repository.canonicalEffects).toContainEqual(expect.objectContaining({ type: "ownership_transfer", workspaceId: owner.workspaceId, currentOwnerUserId: owner.userId, newOwnerUserId: "member-b" }));

    const closureRepository = new InMemoryGovernanceRepository();
    const closureService = new GovernanceService(closureRepository, { now: () => new Date(current) }, {
      provisionAcceptedMembership: vi.fn(), removeMembership: vi.fn().mockResolvedValue("removed"), transferOwnership: vi.fn().mockResolvedValue("transferred"), closeWorkspace,
    });
    const closureChallenge = await closureService.execute(owner, { type: "begin_step_up", purpose: "workspace.close", resourceId: null }, "begin-close-request") as { challengeId: string; verificationCode: string };
    const closureSession = await closureService.execute(owner, { type: "verify_step_up", challengeId: closureChallenge.challengeId, code: closureChallenge.verificationCode }, "verify-close-request") as { stepUpToken: string };
    const requested = await closureService.execute(owner, { type: "request_workspace_closure", reason: "Contract ended", coolingOffDays: 7, stepUpToken: closureSession.stepUpToken }, "request-close-workspace") as { closureId: string };
    await closureService.execute(owner, { type: "cancel_workspace_closure", closureId: requested.closureId }, "cancel-close-workspace");
    expect(closeWorkspace).not.toHaveBeenCalled();

    current = new Date("2026-09-20T12:00:00.000Z");
    const challenge2 = await closureService.execute(owner, { type: "begin_step_up", purpose: "workspace.close", resourceId: null }, "begin-close-request-2") as { challengeId: string; verificationCode: string };
    const session2 = await closureService.execute(owner, { type: "verify_step_up", challengeId: challenge2.challengeId, code: challenge2.verificationCode }, "verify-close-request-2") as { stepUpToken: string };
    const requested2 = await closureService.execute(owner, { type: "request_workspace_closure", reason: "Closure confirmed", coolingOffDays: 7, stepUpToken: session2.stepUpToken }, "request-close-workspace-2") as { closureId: string };
    current = new Date("2026-09-27T12:01:00.000Z");
    await expect(closureService.execute(owner, { type: "execute_workspace_closure", closureId: requested2.closureId, stepUpToken: session2.stepUpToken }, "execute-close-with-workspace-scope"))
      .rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    const executionChallenge = await closureService.execute(owner, { type: "begin_step_up", purpose: "workspace.close", resourceId: requested2.closureId }, "begin-close-execute") as { challengeId: string; verificationCode: string };
    const executionSession = await closureService.execute(owner, { type: "verify_step_up", challengeId: executionChallenge.challengeId, code: executionChallenge.verificationCode }, "verify-close-execute") as { stepUpToken: string };
    await closureService.execute(owner, { type: "execute_workspace_closure", closureId: requested2.closureId, stepUpToken: executionSession.stepUpToken }, "execute-close-workspace");
    expect(closeWorkspace).toHaveBeenCalledWith({ workspaceId: owner.workspaceId, currentOwnerUserId: owner.userId, closedAt: current });
    expect(closureRepository.canonicalEffects).toContainEqual(expect.objectContaining({ type: "workspace_close", workspaceId: owner.workspaceId, currentOwnerUserId: owner.userId }));
  });

  it("makes Portfolio assignments explicit, revocable by resource state, and non-authoritative", async () => {
    const { repository, service } = setup();
    const { portfolioId } = await service.execute(owner, { type: "create_portfolio", name: "MENA brands" }, "portfolio-create") as { portfolioId: string };
    const { assignmentId } = await service.execute(owner, { type: "assign_portfolio", portfolioId, assigneeUserId: "operator-1", targetWorkspaceId: "workspace-client", permissions: ["navigate", "report", "bulk"], capabilityAllowlist: ["content.archive@1"], resourceAllowlist: [{ kind: "content", id: "content-1" }], expiresAt: "2026-09-10T12:00:00.000Z" }, "portfolio-assign") as { assignmentId: string };
    const assignment = await repository.getResource<{ assigneeUserId: string; sourceWorkspaceId: string; targetWorkspaceId: string; capabilityAllowlist: string[]; resourceAllowlist: Array<{ kind: string; id: string }>; grantsNoAuthority: boolean }>({ workspaceId: owner.workspaceId, kind: "portfolio_assignment", id: assignmentId });
    expect(assignment?.body).toMatchObject({ assigneeUserId: "operator-1", sourceWorkspaceId: owner.workspaceId, targetWorkspaceId: "workspace-client", capabilityAllowlist: ["content.archive@1"], resourceAllowlist: [{ kind: "content", id: "content-1" }], grantsNoAuthority: true });
    await service.execute(owner, { type: "revoke_portfolio_assignment", assignmentId }, "portfolio-revoke");
    expect((await repository.getResource({ workspaceId: owner.workspaceId, kind: "portfolio_assignment", id: assignmentId }))?.status).toBe("revoked");
  });

  it("binds a Review Guest to one expiring revision and never authorizes execution", async () => {
    const { repository, service } = setup();
    const policy = await service.execute(owner, { type: "publish_approval_policy", policy: { purpose: "publishing_approval", mode: { kind: "single", eligibleRoleIds: ["review_guest"] }, separationOfDuty: true, deadlineSeconds: 3600, escalationRoleIds: ["owner"], expiresAfterSeconds: 86400 } }, "review-publishing-policy") as { policyId: string; revision: { revision: number } };
    const binding = await new RepositoryPublishingApprovalGovernancePolicy(repository).bind({ workspaceId: owner.workspaceId, runtimeApprovalRequestId: "runtime-review-request", requestingPrincipalId: "requesting-agent", planId: "plan-1", planRevisionId: "plan-revision-1", planRevision: 1, planRevisionDigest: digest, policyId: policy.policyId, policyRevision: policy.revision.revision, expiresAt: new Date("2026-09-04T12:00:00.000Z"), requestedAt: new Date(NOW) });
    expect(binding).not.toBeNull();
    const issued = await service.execute(owner, { type: "issue_review_guest", email: "reviewer@example.com", purpose: "approve_publishing", resourceKind: "plan_revision", resourceId: "plan-revision-1", revisionDigest: digest, expiresAt: "2026-09-04T12:00:00.000Z" }, "issue-review-key") as { grantId: string; reviewToken: string; verificationCode: string };
    const decoded = decodeReviewToken(issued.reviewToken)!;
    const verified = await service.verifyReviewGuest({ workspaceId: decoded.workspaceId, grantId: decoded.grantId, token: decoded.secret, code: issued.verificationCode, idempotencyKey: "verify-review-key" }) as { sessionId: string; sessionToken: string };
    await expect(service.decideReviewGuest({ workspaceId: owner.workspaceId, grantId: issued.grantId, sessionId: verified.sessionId, sessionToken: verified.sessionToken, resourceId: "plan-revision-2", revisionDigest: digest, decision: "approve", comment: null, idempotencyKey: "wrong-review-key" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const decision = await service.decideReviewGuest({ workspaceId: owner.workspaceId, grantId: issued.grantId, sessionId: verified.sessionId, sessionToken: verified.sessionToken, resourceId: "plan-revision-1", revisionDigest: digest, decision: "approve", comment: "Looks good", idempotencyKey: "decide-review-key" }) as { approvalProgressStatus: string; authorizesExecution: boolean };
    expect(decision.authorizesExecution).toBe(false);
    expect(decision.approvalProgressStatus).toBe("accepted");
    expect((await repository.getResource({ workspaceId: owner.workspaceId, kind: "approval_request", id: binding!.governanceRequestId }))?.status).toBe("accepted");
    await expect(new RepositoryPublishingApprovalGovernancePolicy(repository).decide({ workspaceId: owner.workspaceId, binding: binding!, runtimeApprovalRequestId: "runtime-review-request", userId: "authority-user", legacyRole: "admin", decision: "approve", idempotencyKey: "formalize-review-acceptance", decidedAt: new Date("2026-09-03T12:02:00.000Z") })).resolves.toBe("accepted");
  });

  it("counts an exact-scope Review Guest decision in Content Acceptance policy progress", async () => {
    const { repository, service } = setup();
    const policy = await service.execute(owner, { type: "publish_approval_policy", policy: { purpose: "content_acceptance", mode: { kind: "single", eligibleRoleIds: ["review_guest"] }, separationOfDuty: true, deadlineSeconds: 3600, escalationRoleIds: [], expiresAfterSeconds: 86400 } }, "review-content-policy") as { policyId: string; revision: { revision: number } };
    const requested = await service.execute(owner, { type: "request_content_acceptance", policyId: policy.policyId, policyRevision: policy.revision.revision, resourceKind: "render_proof", resourceId: "guest-proof-1", revisionDigest: digest }, "review-content-request") as { requestId: string };
    const issued = await service.execute(owner, { type: "issue_review_guest", email: "content-reviewer@example.com", purpose: "accept_content", resourceKind: "render_proof", resourceId: "guest-proof-1", revisionDigest: digest, expiresAt: "2026-09-04T12:00:00.000Z" }, "issue-content-review") as { grantId: string; reviewToken: string; verificationCode: string };
    const decoded = decodeReviewToken(issued.reviewToken)!;
    const verified = await service.verifyReviewGuest({ workspaceId: decoded.workspaceId, grantId: decoded.grantId, token: decoded.secret, code: issued.verificationCode, idempotencyKey: "verify-content-review" }) as { sessionId: string; sessionToken: string };
    await expect(service.decideReviewGuest({ workspaceId: owner.workspaceId, grantId: issued.grantId, sessionId: verified.sessionId, sessionToken: verified.sessionToken, resourceId: "guest-proof-1", revisionDigest: digest, decision: "accept", comment: null, idempotencyKey: "decide-content-review" })).resolves.toMatchObject({ approvalRequestId: requested.requestId, approvalProgressStatus: "accepted", authorizesExecution: false });
    expect((await repository.getResource({ workspaceId: owner.workspaceId, kind: "approval_request", id: requested.requestId }))?.status).toBe("accepted");
  });

  it("refuses decision-capable guest links without a matching open exact approval request", async () => {
    const { service } = setup();
    await expect(service.execute(owner, { type: "issue_review_guest", email: "reviewer@example.com", purpose: "accept_content", resourceKind: "render_proof", resourceId: "unbound-proof", revisionDigest: digest, expiresAt: "2026-09-04T12:00:00.000Z" }, "unbound-content-review"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("revalidates a Review Guest grant before replaying its secret session", async () => {
    const { service } = setup();
    const issued = await service.execute(owner, { type: "issue_review_guest", email: "revoked-reviewer@example.com", purpose: "inspect", resourceKind: "render_proof", resourceId: "proof-replay", revisionDigest: digest, expiresAt: "2026-09-04T12:00:00.000Z" }, "issue-revoked-review") as { grantId: string; reviewToken: string; verificationCode: string };
    const decoded = decodeReviewToken(issued.reviewToken)!;
    await service.verifyReviewGuest({ workspaceId: decoded.workspaceId, grantId: decoded.grantId, token: decoded.secret, code: issued.verificationCode, idempotencyKey: "verify-revoked-review" });
    await service.execute(owner, { type: "revoke_review_guest", grantId: issued.grantId }, "revoke-verified-review");

    await expect(service.verifyReviewGuest({ workspaceId: decoded.workspaceId, grantId: decoded.grantId, token: decoded.secret, code: issued.verificationCode, idempotencyKey: "verify-revoked-review" }))
      .rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("validates all Approval Policy modes and keeps content acceptance distinct", async () => {
    const { service } = setup();
    const publishing = await service.execute(owner, { type: "publish_approval_policy", policy: { purpose: "publishing_approval", mode: { kind: "quorum", eligibleRoleIds: ["approver", "legal"], required: 2 }, separationOfDuty: true, deadlineSeconds: 3600, escalationRoleIds: ["owner"], expiresAfterSeconds: 7200 } }, "approval-policy-key") as { revision: { purpose: string; separationOfDuty: boolean } };
    expect(publishing.revision).toMatchObject({ purpose: "publishing_approval", separationOfDuty: true });
    const content = await service.execute(owner, { type: "publish_approval_policy", policy: { purpose: "content_acceptance", mode: { kind: "sequential", stages: [{ eligibleRoleIds: ["creator"] }, { eligibleRoleIds: ["approver"] }] }, separationOfDuty: true, deadlineSeconds: 3600, escalationRoleIds: [], expiresAfterSeconds: 7200 } }, "content-policy-key") as { policyId: string };
    expect(content.policyId).not.toEqual((publishing as unknown as { policyId: string }).policyId);
  });

  it("persists Content Acceptance against exact policy and content revisions without execution authority", async () => {
    const { service } = setup();
    const published = await service.execute(owner, { type: "publish_approval_policy", policy: { purpose: "content_acceptance", mode: { kind: "single", eligibleRoleIds: ["creator"] }, separationOfDuty: true, deadlineSeconds: 3600, escalationRoleIds: ["admin"], expiresAfterSeconds: 86400 } }, "content-policy-create") as { policyId: string; revision: { revision: number } };
    const requested = await service.execute(owner, { type: "request_content_acceptance", policyId: published.policyId, policyRevision: published.revision.revision, resourceKind: "render_proof", resourceId: "render-proof-1", revisionDigest: digest }, "content-acceptance-request") as { requestId: string };
    const accepted = await service.execute(creator, { type: "decide_content_acceptance", requestId: requested.requestId, decision: "approve" }, "content-acceptance-decision");
    expect(accepted).toMatchObject({ purpose: "content_acceptance", status: "accepted", revisionDigest: digest, authorizesExecution: false });
  });

  it("rejects non-Content-Acceptance policy revisions and poisoned approval requests", async () => {
    const { repository, service } = setup();
    const publishing = await service.execute(owner, { type: "publish_approval_policy", policy: { purpose: "publishing_approval", mode: { kind: "single", eligibleRoleIds: ["creator"] }, separationOfDuty: false, deadlineSeconds: 3600, escalationRoleIds: [], expiresAfterSeconds: 86400 } }, "publishing-policy-for-content") as { policyId: string; revision: { revision: number } };
    await expect(service.execute(owner, { type: "request_content_acceptance", policyId: publishing.policyId, policyRevision: publishing.revision.revision, resourceKind: "render_proof", resourceId: "wrong-purpose-proof", revisionDigest: digest }, "wrong-purpose-content-request"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    const content = await service.execute(owner, { type: "publish_approval_policy", policy: { purpose: "content_acceptance", mode: { kind: "single", eligibleRoleIds: ["creator"] }, separationOfDuty: false, deadlineSeconds: 60, escalationRoleIds: ["owner"], expiresAfterSeconds: 86400 } }, "content-policy-to-poison") as { policyId: string; revision: { revision: number } };
    const requested = await service.execute(owner, { type: "request_content_acceptance", policyId: content.policyId, policyRevision: content.revision.revision, resourceKind: "render_proof", resourceId: "poisoned-proof", revisionDigest: digest }, "content-request-to-poison") as { requestId: string };
    const stored = [...repository.resources.values()].find((resource) => resource.kind === "approval_request" && resource.id === requested.requestId);
    expect(stored).toBeTruthy();
    stored!.body = { ...stored!.body, purpose: "publishing_approval" };

    await expect(service.execute(creator, { type: "decide_content_acceptance", requestId: requested.requestId, decision: "approve" }, "decide-poisoned-content"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.execute(owner, { type: "advance_content_acceptance", requestId: requested.requestId }, "advance-poisoned-content"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires exact-purpose step-up for region, retention, and exports", async () => {
    const { repository, service } = setup();
    const wrong = await stepUp(service, "audit.export");
    await expect(service.execute(owner, { type: "set_region_policy", region: "me-central-1", verificationEvidence: regionEvidence(), stepUpToken: wrong.stepUpToken }, "region-wrong-stepup")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    const regionAuth = await stepUp(service, "regions.manage");
    const verifiedService = new GovernanceService(repository, { now: () => new Date(NOW) }, undefined, new ConfiguredGovernanceRegionVerifier(new Map([["deployment-key-1", regionKey]])));
    expect(await verifiedService.execute(owner, { type: "set_region_policy", region: "me-central-1", verificationEvidence: regionEvidence(), stepUpToken: regionAuth.stepUpToken }, "region-policy-key")).toMatchObject({ verified: true, status: "active" });
    const admission = new GovernanceRegionAdmissionService(repository);
    await expect(admission.admit({ workspaceId: owner.workspaceId, kind: "processing", routeId: "processing-me-1", configuredRegion: "me-central-1", evaluatedAt: NOW })).resolves.toMatchObject({ allowed: true, policyApplied: true });
    await expect(admission.admit({ workspaceId: owner.workspaceId, kind: "processing", routeId: "provider-global", configuredRegion: "global", evaluatedAt: NOW })).resolves.toEqual({ allowed: false, reason: "REGION_ROUTE_NOT_ALLOWLISTED" });
    const exportAuth = await stepUp(service, "exports.manage");
    expect(await service.execute(owner, { type: "request_workspace_export", includeKinds: ["content", "media", "plans"], stepUpToken: exportAuth.stepUpToken }, "workspace-export-key")).toMatchObject({ status: "queued", omissions: expect.arrayContaining(["secrets", "non_transferable_licensed_media"]) });
  });

  it("authorizes only current-capability holders to retrieve a ready, unexpired Workspace-bound export", async () => {
    const { repository, service } = setup();
    const exportId = "audit-export-ready";
    repository.resources.set(`${owner.workspaceId}\u0000audit_export\u0000${exportId}`, {
      id: exportId, workspaceId: owner.workspaceId, kind: "audit_export", version: 2, status: "succeeded",
      body: { artifactRef: `governance/${owner.workspaceId}/${exportId}/lease-1.encrypted.json`, expiresAt: "2026-09-04T12:00:00.000Z", manifest: { schema: "governance-export-manifest/v1" } },
      createdByUserId: owner.userId, createdAt: new Date(NOW), updatedAt: new Date(NOW),
    });
    await expect(service.authorizeExportDownload(owner, exportId)).resolves.toMatchObject({ exportId, kind: "audit_export", artifactRef: expect.stringContaining(owner.workspaceId) });
    await expect(service.authorizeExportDownload(creator, exportId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const stored = repository.resources.get(`${owner.workspaceId}\u0000audit_export\u0000${exportId}`)!;
    stored.body = { ...stored.body, artifactRef: `governance/other-workspace/${exportId}/stolen.encrypted.json` };
    await expect(service.authorizeExportDownload(owner, exportId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("never turns caller-asserted or invalid region evidence into a residency claim", async () => {
    const { repository, service } = setup();
    const auth = await stepUp(service, "regions.manage");
    await expect(service.execute(owner, { type: "set_region_policy", region: "me-central-1", verificationEvidence: regionEvidence(false), stepUpToken: auth.stepUpToken }, "region-untrusted-key")).resolves.toMatchObject({ verified: false, status: "pending_verification", reason: "UNCONFIGURED_TRUST_ROOT" });
    const policy = await repository.getResource<{ verified: boolean; verifiedEvidence: null }>({ workspaceId: owner.workspaceId, kind: "data_region_policy", id: "active" });
    expect(policy).toMatchObject({ status: "pending_verification", body: { verified: false, verifiedEvidence: null } });
    await expect(new GovernanceRegionAdmissionService(repository).admit({ workspaceId: owner.workspaceId, kind: "processing", routeId: "processing-me-1", configuredRegion: "me-central-1", evaluatedAt: NOW })).resolves.toEqual({ allowed: false, reason: "REGION_POLICY_UNVERIFIED" });
    await expect(new ConfiguredGovernanceRegionVerifier(new Map([["deployment-key-1", regionKey]])).verify({ workspaceId: owner.workspaceId, region: "me-central-1", evidence: regionEvidence(false), evaluatedAt: NOW })).resolves.toEqual({ status: "pending", reason: "INVALID_SIGNATURE" });
  });

  it("enforces Retention Class completeness, legal floors, holds, receipts, and tombstones", async () => {
    const { repository, service } = setup();
    const authorization = await stepUp(service, "retention.manage");
    const rules: RetentionRule[] = RETENTION_CLASSES.map((retentionClass) => ({ retentionClass, durationDays: 365, recoverableDays: 30, legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass] }));
    await service.execute(owner, { type: "publish_retention_policy", rules, stepUpToken: authorization.stepUpToken }, "retention-policy-key");
    expect(await repository.getResource({ workspaceId: owner.workspaceId, kind: "retention_policy", id: "active" })).toMatchObject({ body: { revisions: [{ legalFloorSource: "deployment_trusted/v1", rules }] } });
    const hold = await service.execute(owner, { type: "create_retention_hold", retentionClasses: ["security_evidence"], reason: "Active legal preservation", expiresAt: null, stepUpToken: authorization.stepUpToken }, "retention-hold-key") as { holdId: string };
    const deletionAuthorization = await stepUp(service, "retention.delete", "media-1");
    const deleted = await service.execute(owner, { type: "record_deletion", resourceKind: "media", resourceId: "media-1", stepUpToken: deletionAuthorization.stepUpToken }, "deletion-record-key") as { deletionReceiptId: string; tombstoneId: string };
    expect(await repository.getResource({ workspaceId: owner.workspaceId, kind: "deletion_receipt", id: deleted.deletionReceiptId })).toMatchObject({ body: { retentionClass: "security_evidence", resourceKind: "media", systems: ["primary", "replica"], policyRevision: 1 } });
    expect(await repository.getResource({ workspaceId: owner.workspaceId, kind: "tombstone", id: deleted.tombstoneId })).toBeTruthy();
    const releaseAuthorization = await stepUp(service, "retention.hold.release", hold.holdId);
    await service.execute(owner, { type: "release_retention_hold", holdId: hold.holdId, reason: "Legal matter closed", stepUpToken: releaseAuthorization.stepUpToken }, "release-hold-key");
    expect((await repository.getResource({ workspaceId: owner.workspaceId, kind: "retention_hold", id: hold.holdId }))?.status).toBe("released");
  });

  it("rejects Workspace-authored retention floors even when the submitted duration would satisfy them", async () => {
    const { service } = setup();
    const authorization = await stepUp(service, "retention.manage");
    const rules: RetentionRule[] = RETENTION_CLASSES.map((retentionClass) => ({ retentionClass, durationDays: 730, recoverableDays: 30, legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS[retentionClass] }));
    rules[0] = { ...rules[0], legalFloorDays: TRUSTED_RETENTION_LEGAL_FLOORS[rules[0].retentionClass] + 1 };
    await expect(service.execute(owner, { type: "publish_retention_policy", rules, stepUpToken: authorization.stepUpToken }, "caller-floor-key"))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("constrains Safety Appeals to exact-intent re-evaluation with current revalidation", async () => {
    const { service } = setup();
    const decision = await service.execute(owner, { type: "create_safety_decision", intentRef: "run-1", reasonCode: "DECEPTIVE_IDENTITY", policyVersion: "safety-2026-09", safeExplanation: "Identity evidence is missing", evidenceRef: "evidence-1", remediation: "Provide consent evidence", appealEligible: true }, "safety-decision-key") as { decisionId: string };
    const appeal = await service.execute(owner, { type: "appeal_safety_decision", decisionId: decision.decisionId, explanation: "Consent evidence is now available" }, "safety-appeal-key") as { appealId: string };
    expect(await service.execute(owner, { type: "resolve_safety_appeal", appealId: appeal.appealId, outcome: "reevaluate_exact_intent", currentRevalidationRequired: true }, "safety-resolve-key")).toMatchObject({ status: "revalidation_queued", currentRevalidationRequired: true, canResume: false });
  });

  it("keeps Bulk Operation outcomes per item and forbids blind retry of ambiguity", async () => {
    const { repository, service } = setup();
    const preview = await service.execute(owner, { type: "preview_bulk", operationCapability: "content.archive@1", concurrency: 3, quoteRef: null, items: [{ targetWorkspaceId: owner.workspaceId, targetKind: "content", targetId: "content-1" }, { targetWorkspaceId: owner.workspaceId, targetKind: "content", targetId: "content-2" }] }, "bulk-preview-key") as { operationId: string };
    await service.execute(owner, { type: "start_bulk", operationId: preview.operationId }, "bulk-start-key");
    const operation = await repository.getResource<{ items: Array<{ id: string; state: string }> }>({ workspaceId: owner.workspaceId, kind: "bulk_operation", id: preview.operationId });
    expect(operation?.body.items.map((item) => item.state)).toEqual(["queued", "queued"]);
  });

  it("refuses to create a Bulk preview until exact target authorization, state, entitlement, and quote preflight succeed", async () => {
    const repository = new InMemoryGovernanceRepository();
    const inspect = vi.fn(async () => ({ type: "blocked" as const, code: "TARGET_STATE_CONFLICT" }));
    const service = new GovernanceService(repository, { now: () => new Date(NOW) }, undefined, undefined, { verify: () => true }, { inspect });
    await expect(service.execute(owner, { type: "preview_bulk", operationCapability: "content.archive@1", concurrency: 1, quoteRef: null, items: [{ targetWorkspaceId: owner.workspaceId, targetKind: "content", targetId: "content-1" }] }, "blocked-bulk-preview"))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repository.listResources({ workspaceId: owner.workspaceId, kinds: ["bulk_operation"] })).toHaveLength(0);
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ sourceWorkspaceId: owner.workspaceId, targetWorkspaceId: owner.workspaceId, requestedByUserId: owner.userId, capability: "content.archive@1", quoteRef: null }));
  });

  it("previews provenance-preserving imports and explicitly omits non-transferable items", async () => {
    const { service } = setup();
    const payload = { schema: "portable-prompt/v1", id: "prompt-1", mode: "copy", name: "Launch", promptText: "Write a launch", formConfig: {}, isPublic: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
    const result = await service.execute(owner, { type: "preview_import", source: "platform-export", sourceManifestDigest: digest, manifestKeyId: "trusted-test-key", manifestSignature: "A".repeat(43), items: [{ kind: "prompt", sourceId: "source-1", digest: canonicalDigest(payload), transferable: true, payload }, { kind: "licensed_media", sourceId: "source-2", digest, transferable: false, omissionReason: "license" }] }, "import-preview-key") as { dryRun: boolean; items: Array<{ action: string; provenancePreserved: boolean }> };
    expect(result.dryRun).toBe(true);
    expect(result.items).toEqual([expect.objectContaining({ action: "create_or_match", provenancePreserved: true }), expect.objectContaining({ action: "omit", provenancePreserved: true })]);
  });

  it("isolates snapshots and audit by Workspace", async () => {
    const { repository, service } = setup();
    await service.execute(owner, { type: "create_portfolio", name: "A" }, "workspace-a-key");
    const ownerB = { ...owner, workspaceId: "workspace-b", userId: "owner-b" };
    await service.execute(ownerB, { type: "create_portfolio", name: "B" }, "workspace-b-key");
    expect((await service.snapshot(owner)).resources.portfolio).toHaveLength(1);
    expect((await service.snapshot(ownerB)).resources.portfolio).toHaveLength(1);
    expect((await repository.listAudit({ workspaceId: owner.workspaceId, limit: 10 }))).toHaveLength(1);
  });
});

describe("GovernanceError", () => {
  it("exposes stable safe codes", () => {
    expect(new GovernanceError("FORBIDDEN", "denied")).toMatchObject({ name: "GovernanceError", code: "FORBIDDEN" });
  });
});
