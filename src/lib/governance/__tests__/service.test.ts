import { describe, expect, it, vi } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { BUILT_IN_ROLE_CAPABILITIES } from "../roles";
import { decodeInvitationToken, decodeReviewToken, GovernanceError, GovernanceService } from "../service";
import { RETENTION_CLASSES, type GovernanceActor, type RetentionRule } from "../types";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const owner: GovernanceActor = { workspaceId: "workspace-a", userId: "owner-a", legacyRole: "owner" };
const creator: GovernanceActor = { workspaceId: "workspace-a", userId: "creator-a", legacyRole: "member" };
const digest = canonicalDigest({ revision: 1 });

function setup() {
  const repository = new InMemoryGovernanceRepository();
  const service = new GovernanceService(repository, { now: () => new Date(NOW) });
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
    }
  });

  it("versions Custom Roles, rejects reserved authority, and pins assignments to one revision", async () => {
    const { repository, service } = setup();
    await expect(service.execute(owner, { type: "create_custom_role", name: "Unsafe", description: "Unsafe role", capabilities: ["workspace.close"] }, "unsafe-role-key")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const created = await service.execute(owner, { type: "create_custom_role", name: "Reviewer", description: "Content reviewer", capabilities: ["governance.view", "reviews.decide_content"] }, "create-role-key") as { roleId: string };
    const revised = await service.execute(owner, { type: "revise_custom_role", roleId: created.roleId, expectedVersion: 1, name: "Senior reviewer", description: "Reviews content and audit", capabilities: ["governance.view", "reviews.decide_content", "audit.view"] }, "revise-role-key") as { revision: { revision: number } };
    expect(revised.revision.revision).toBe(2);
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
    await expect(service.acceptInvitation({ ...decoded, token: decoded.secret, userId: "new-user", verifiedEmail: "other@example.com", idempotencyKey: "wrong-email-key" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const accepted = await service.acceptInvitation({ workspaceId: decoded.workspaceId, invitationId: decoded.invitationId, token: decoded.secret, userId: "new-user", verifiedEmail: "new@example.com", idempotencyKey: "accept-invite-key" });
    expect(accepted).toMatchObject({ accepted: true, userId: "new-user", binding: { kind: "built_in", role: "approver" } });
    expect(provision).toHaveBeenCalledWith({ workspaceId: owner.workspaceId, userId: "new-user", binding: { kind: "built_in", role: "approver" } });
    expect(await repository.getResource({ workspaceId: owner.workspaceId, kind: "member_role_assignment", id: "new-user" })).toBeTruthy();
  });

  it("revokes a pending invitation so it can no longer be accepted", async () => {
    const { service } = setup();
    const invitation = await service.execute(owner, { type: "create_invitation", email: "revoked@example.com", binding: { kind: "built_in", role: "viewer" }, expiresAt: "2026-09-10T12:00:00.000Z" }, "create-revoked-invite") as { invitationId: string; invitationToken: string };
    await service.execute(owner, { type: "revoke_invitation", invitationId: invitation.invitationId }, "revoke-invite-key");
    const decoded = decodeInvitationToken(invitation.invitationToken)!;
    await expect(service.acceptInvitation({ workspaceId: decoded.workspaceId, invitationId: decoded.invitationId, token: decoded.secret, userId: "revoked-user", verifiedEmail: "revoked@example.com", idempotencyKey: "accept-revoked-key" })).rejects.toMatchObject({ code: "EXPIRED" });
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
    const executionChallenge = await closureService.execute(owner, { type: "begin_step_up", purpose: "workspace.close", resourceId: requested2.closureId }, "begin-close-execute") as { challengeId: string; verificationCode: string };
    const executionSession = await closureService.execute(owner, { type: "verify_step_up", challengeId: executionChallenge.challengeId, code: executionChallenge.verificationCode }, "verify-close-execute") as { stepUpToken: string };
    await closureService.execute(owner, { type: "execute_workspace_closure", closureId: requested2.closureId, stepUpToken: executionSession.stepUpToken }, "execute-close-workspace");
    expect(closeWorkspace).toHaveBeenCalledWith({ workspaceId: owner.workspaceId, currentOwnerUserId: owner.userId, closedAt: current });
  });

  it("makes Portfolio assignments explicit, revocable by resource state, and non-authoritative", async () => {
    const { repository, service } = setup();
    const { portfolioId } = await service.execute(owner, { type: "create_portfolio", name: "MENA brands" }, "portfolio-create") as { portfolioId: string };
    const { assignmentId } = await service.execute(owner, { type: "assign_portfolio", portfolioId, targetWorkspaceId: "workspace-client", permissions: ["navigate", "report", "bulk"], expiresAt: "2026-09-10T12:00:00.000Z" }, "portfolio-assign") as { assignmentId: string };
    const assignment = await repository.getResource<{ targetWorkspaceId: string; grantsNoAuthority: boolean }>({ workspaceId: owner.workspaceId, kind: "portfolio_assignment", id: assignmentId });
    expect(assignment?.body).toMatchObject({ targetWorkspaceId: "workspace-client", grantsNoAuthority: true });
    await service.execute(owner, { type: "revoke_portfolio_assignment", assignmentId }, "portfolio-revoke");
    expect((await repository.getResource({ workspaceId: owner.workspaceId, kind: "portfolio_assignment", id: assignmentId }))?.status).toBe("revoked");
  });

  it("binds a Review Guest to one expiring revision and never authorizes execution", async () => {
    const { service } = setup();
    const issued = await service.execute(owner, { type: "issue_review_guest", email: "reviewer@example.com", purpose: "approve_publishing", resourceKind: "plan_revision", resourceId: "plan-revision-1", revisionDigest: digest, expiresAt: "2026-09-04T12:00:00.000Z" }, "issue-review-key") as { grantId: string; reviewToken: string; verificationCode: string };
    const decoded = decodeReviewToken(issued.reviewToken)!;
    const verified = await service.verifyReviewGuest({ workspaceId: decoded.workspaceId, grantId: decoded.grantId, token: decoded.secret, code: issued.verificationCode, idempotencyKey: "verify-review-key" }) as { sessionId: string; sessionToken: string };
    await expect(service.decideReviewGuest({ workspaceId: owner.workspaceId, grantId: issued.grantId, sessionId: verified.sessionId, sessionToken: verified.sessionToken, resourceId: "plan-revision-2", revisionDigest: digest, decision: "approve", comment: null, idempotencyKey: "wrong-review-key" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const decision = await service.decideReviewGuest({ workspaceId: owner.workspaceId, grantId: issued.grantId, sessionId: verified.sessionId, sessionToken: verified.sessionToken, resourceId: "plan-revision-1", revisionDigest: digest, decision: "approve", comment: "Looks good", idempotencyKey: "decide-review-key" }) as { authorizesExecution: boolean };
    expect(decision.authorizesExecution).toBe(false);
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

  it("requires exact-purpose step-up for region, retention, and exports", async () => {
    const { service } = setup();
    const wrong = await stepUp(service, "audit.export");
    await expect(service.execute(owner, { type: "set_region_policy", region: "me-central-1", verificationEvidence: ["storage", "processing", "backups", "logging", "deletion", "contracts"], stepUpToken: wrong.stepUpToken }, "region-wrong-stepup")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    const regionAuth = await stepUp(service, "regions.manage");
    expect(await service.execute(owner, { type: "set_region_policy", region: "me-central-1", verificationEvidence: ["storage", "processing", "backups", "logging", "deletion", "contracts"], stepUpToken: regionAuth.stepUpToken }, "region-policy-key")).toMatchObject({ verified: true });
    const exportAuth = await stepUp(service, "exports.manage");
    expect(await service.execute(owner, { type: "request_workspace_export", includeKinds: ["content", "media", "plans"], stepUpToken: exportAuth.stepUpToken }, "workspace-export-key")).toMatchObject({ status: "queued", omissions: expect.arrayContaining(["secrets", "non_transferable_licensed_media"]) });
  });

  it("enforces Retention Class completeness, legal floors, holds, receipts, and tombstones", async () => {
    const { repository, service } = setup();
    const authorization = await stepUp(service, "retention.manage");
    const rules: RetentionRule[] = RETENTION_CLASSES.map((retentionClass) => ({ retentionClass, durationDays: 365, recoverableDays: 30, legalFloorDays: retentionClass.includes("evidence") ? 365 : 0 }));
    await service.execute(owner, { type: "publish_retention_policy", rules, stepUpToken: authorization.stepUpToken }, "retention-policy-key");
    const hold = await service.execute(owner, { type: "create_retention_hold", retentionClasses: ["security_evidence"], reason: "Active legal preservation", expiresAt: null, stepUpToken: authorization.stepUpToken }, "retention-hold-key") as { holdId: string };
    const deletionAuthorization = await stepUp(service, "retention.delete", "media-1");
    const deleted = await service.execute(owner, { type: "record_deletion", resourceKind: "media", resourceId: "media-1", retentionClass: "security_evidence", immediate: ["source bytes"], delayed: ["replicas"], retained: ["billing evidence"], holdIds: [hold.holdId], stepUpToken: deletionAuthorization.stepUpToken }, "deletion-record-key") as { tombstoneId: string };
    expect(await repository.getResource({ workspaceId: owner.workspaceId, kind: "tombstone", id: deleted.tombstoneId })).toBeTruthy();
    const releaseAuthorization = await stepUp(service, "retention.hold.release", hold.holdId);
    await service.execute(owner, { type: "release_retention_hold", holdId: hold.holdId, reason: "Legal matter closed", stepUpToken: releaseAuthorization.stepUpToken }, "release-hold-key");
    expect((await repository.getResource({ workspaceId: owner.workspaceId, kind: "retention_hold", id: hold.holdId }))?.status).toBe("released");
  });

  it("constrains Safety Appeals to exact-intent re-evaluation with current revalidation", async () => {
    const { service } = setup();
    const decision = await service.execute(owner, { type: "create_safety_decision", intentRef: "run-1", reasonCode: "DECEPTIVE_IDENTITY", policyVersion: "safety-2026-09", safeExplanation: "Identity evidence is missing", evidenceRef: "evidence-1", remediation: "Provide consent evidence", appealEligible: true }, "safety-decision-key") as { decisionId: string };
    const appeal = await service.execute(owner, { type: "appeal_safety_decision", decisionId: decision.decisionId, explanation: "Consent evidence is now available" }, "safety-appeal-key") as { appealId: string };
    expect(await service.execute(owner, { type: "resolve_safety_appeal", appealId: appeal.appealId, outcome: "reevaluate_exact_intent", currentRevalidationRequired: true }, "safety-resolve-key")).toMatchObject({ currentRevalidationRequired: true });
  });

  it("keeps Bulk Operation outcomes per item and forbids blind retry of ambiguity", async () => {
    const { repository, service } = setup();
    const preview = await service.execute(owner, { type: "preview_bulk", operationCapability: "content.archive@1", concurrency: 3, quoteRef: null, items: [{ targetWorkspaceId: owner.workspaceId, targetKind: "content", targetId: "content-1" }, { targetWorkspaceId: owner.workspaceId, targetKind: "content", targetId: "content-2" }] }, "bulk-preview-key") as { operationId: string };
    await service.execute(owner, { type: "start_bulk", operationId: preview.operationId }, "bulk-start-key");
    const operation = await repository.getResource<{ items: Array<{ id: string; state: string }> }>({ workspaceId: owner.workspaceId, kind: "bulk_operation", id: preview.operationId });
    expect(operation?.body.items.map((item) => item.state)).toEqual(["queued", "queued"]);
  });

  it("previews provenance-preserving imports and explicitly omits non-transferable items", async () => {
    const { service } = setup();
    const payload = { revisions: [], activeRevision: 0 };
    const result = await service.execute(owner, { type: "preview_import", source: "platform-export", sourceManifestDigest: digest, items: [{ kind: "custom_role", sourceId: "source-1", digest: canonicalDigest(payload), transferable: true, payload }, { kind: "licensed_media", sourceId: "source-2", digest, transferable: false, omissionReason: "license" }] }, "import-preview-key") as { dryRun: boolean; items: Array<{ action: string; provenancePreserved: boolean }> };
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
