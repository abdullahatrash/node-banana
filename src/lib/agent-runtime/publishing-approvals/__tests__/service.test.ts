import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { describe, expect, it } from "vitest";
import { publishingApprovalAgentDtoFromDto } from "../service";
import { exactPublishingApprovalSelection, publishingApprovalValidationBinding } from "../validation";
import { setupPublishingApprovals } from "./fixtures";
import type { PublishingApprovalGovernancePolicyPort } from "../types";

describe("PublishingApprovalService", () => {
  it("binds one exact current revision, action, target/resource manifests, requester, validation, and bounded expiry", async () => {
    const setup = await setupPublishingApprovals();
    const approval = await setup.service.request(setup.requestInput());

    expect(approval).toMatchObject({
      planRevisionId: setup.revision.id,
      planRevisionDigest: setup.revision.definitionDigest,
      action: "publish",
      targetIds: ["target_1"],
      channelIds: ["channel_linkedin"],
      artifactIds: ["artifact_image", "artifact_text"],
      requestingPrincipalId: "principal_1",
      status: "pending",
      decision: null,
      authorizesExecution: false,
    });
    expect(approval.validation.evidenceDigest).toBe(
      canonicalDigest(setup.revision.validationEvidence),
    );
    expect(approval.requestAuthorization.resources).toEqual({
      channelIds: ["channel_linkedin"],
      artifactIds: ["artifact_image", "artifact_text"],
    });
  });

  it("treats transport acceptance as pending, redacts human/key/auth provenance from Agent output, and never authorizes execution", async () => {
    const setup = await setupPublishingApprovals();
    const internal = await setup.service.request(setup.requestInput());
    const agent = publishingApprovalAgentDtoFromDto(internal);
    const serialized = JSON.stringify(agent);

    expect(agent).toMatchObject({ status: "pending", decision: null, authorizesExecution: false });
    expect(serialized).not.toContain("requestingKeyId");
    expect(serialized).not.toContain("authorityEvidence");
    expect(serialized).not.toContain("decidedByUserId");
    expect(serialized).not.toContain("authorizationEvidenceRef");
  });

  it("rejects stale evidence at request and again at decision", async () => {
    const staleRequest = await setupPublishingApprovals();
    staleRequest.setValidationCurrent(false);
    await expect(staleRequest.service.request(staleRequest.requestInput())).rejects.toMatchObject({
      code: "PUBLISHING_APPROVAL_STALE_VALIDATION",
    });

    const staleDecision = await setupPublishingApprovals();
    const approval = await staleDecision.service.request(staleDecision.requestInput());
    staleDecision.setValidationCurrent(false);
    await expect(staleDecision.service.decide({
      workspaceId: "workspace_1", userId: "owner_1", idempotencyKey: "approval-decision-1",
      approvalRequestId: approval.id, expectedInspectionDigest: approval.inspectionDigest, decision: "approved",
    })).rejects.toMatchObject({ code: "PUBLISHING_APPROVAL_STALE_VALIDATION" });
  });

  it("rejects a verifier session that tries to extend the bound validation expiry", async () => {
    const setup = await setupPublishingApprovals();
    const original = setup.validationPort.verifyCurrent;
    setup.validationPort.verifyCurrent = async (input) => {
      const session = await original(input);
      return session
        ? { ...session, expiresAt: new Date("2026-08-09T13:00:00.000Z") }
        : null;
    };
    await expect(setup.service.request(setup.requestInput())).rejects.toMatchObject({
      code: "PUBLISHING_APPROVAL_STALE_VALIDATION",
    });
  });

  it("requires explicit current authority for denial too, makes denial final, and replays the same decision", async () => {
    const setup = await setupPublishingApprovals();
    const approval = await setup.service.request(setup.requestInput());
    setup.setAuthorityCurrent(false);
    await expect(setup.service.decide({
      workspaceId: "workspace_1", userId: "owner_1", idempotencyKey: "approval-deny-missing",
      approvalRequestId: approval.id, expectedInspectionDigest: approval.inspectionDigest, decision: "denied",
    })).rejects.toMatchObject({ code: "PUBLISHING_APPROVAL_AUTHORITY_REQUIRED" });
    setup.setAuthorityCurrent(true);
    const input = {
      workspaceId: "workspace_1", userId: "owner_1", idempotencyKey: "approval-deny-final",
      approvalRequestId: approval.id, expectedInspectionDigest: approval.inspectionDigest, decision: "denied" as const,
    };
    const denied = await setup.service.decide(input);
    expect(await setup.service.decide(input)).toEqual(denied);
    await expect(setup.service.decide({ ...input, idempotencyKey: "approval-deny-again", expectedInspectionDigest: denied.inspectionDigest, decision: "approved" })).rejects.toMatchObject({ code: "PUBLISHING_APPROVAL_FINAL" });
    expect(denied).toMatchObject({ status: "denied", authorizesExecution: false, decision: { authorizesExecution: false } });
  });

  it("fails closed on a mismatched authority session even for an owner transport role", async () => {
    const setup = await setupPublishingApprovals();
    const approval = await setup.service.request(setup.requestInput());
    const original = setup.authorityPort.checkCurrent;
    setup.authorityPort.checkCurrent = async (input) => {
      const session = await original(input);
      return session ? { ...session, userId: "another_owner" } : null;
    };
    await expect(setup.service.decide({
      workspaceId: "workspace_1", userId: "owner_1", idempotencyKey: "approval-bad-session",
      approvalRequestId: approval.id, expectedInspectionDigest: approval.inspectionDigest, decision: "approved",
    })).rejects.toMatchObject({ code: "PUBLISHING_APPROVAL_AUTHORITY_REQUIRED" });
  });

  it("allows a current member only when an exact per-channel publishing grant is verified", async () => {
    const setup = await setupPublishingApprovals();
    const approval = await setup.service.request(setup.requestInput());
    const original = setup.authorityPort.checkCurrent;
    setup.authorityPort.checkCurrent = async (input) => {
      const session = await original(input);
      return session ? { ...session, subjectRole: "member" as const } : null;
    };

    await expect(setup.service.decide({
      workspaceId: "workspace_1",
      userId: "member_1",
      idempotencyKey: "approval-member-grant",
      approvalRequestId: approval.id,
      expectedInspectionDigest: approval.inspectionDigest,
      decision: "approved",
    })).resolves.toMatchObject({ status: "approved" });

    setup.setAuthorityCurrent(false);
    const second = await setup.service.request({
      ...setup.requestInput(),
      idempotencyKey: "approval-member-second-request",
    });
    await expect(setup.service.decide({
      workspaceId: "workspace_1",
      userId: "member_1",
      idempotencyKey: "approval-member-without-grant",
      approvalRequestId: second.id,
      expectedInspectionDigest: second.inspectionDigest,
      decision: "approved",
    })).rejects.toMatchObject({ code: "PUBLISHING_APPROVAL_AUTHORITY_REQUIRED" });
  });

  it("replays the original request after expiry and supersession without re-running mutable admission", async () => {
    const setup = await setupPublishingApprovals();
    const first = await setup.service.request(setup.requestInput());
    const head = setup.plans.repository.plans.get("workspace_1\u0000plan_1")!;
    setup.plans.repository.plans.set("workspace_1\u0000plan_1", { ...structuredClone(head), currentRevision: 2 });
    setup.setValidationCurrent(false);
    setup.setNow("2026-08-08T14:00:00.000Z");
    const replay = await setup.service.request(setup.requestInput());
    expect(replay.id).toBe(first.id);
    expect(replay.status).toBe("superseded");
  });

  it("requester-scopes Agent observation and resource manifests", async () => {
    const setup = await setupPublishingApprovals();
    const approval = await setup.service.request(setup.requestInput());
    await expect(setup.service.getAgent({ workspaceId: "workspace_1", approvalRequestId: approval.id, viewer: { principalId: "principal_2", authorizedChannelIds: ["channel_linkedin"], authorizedArtifactIds: ["artifact_text", "artifact_image"] } })).rejects.toMatchObject({ code: "PUBLISHING_APPROVAL_NOT_FOUND" });
    await expect(setup.service.getAgent({ workspaceId: "workspace_1", approvalRequestId: approval.id, viewer: { principalId: "principal_1", authorizedChannelIds: [], authorizedArtifactIds: [] } })).rejects.toMatchObject({ code: "PUBLISHING_APPROVAL_NOT_FOUND" });
  });

  it("keeps a superseded immutable request inspectable while disabling decision", async () => {
    const setup = await setupPublishingApprovals();
    const approval = await setup.service.request(setup.requestInput());
    const head = setup.plans.repository.plans.get("workspace_1\u0000plan_1")!;
    setup.plans.repository.plans.set("workspace_1\u0000plan_1", { ...structuredClone(head), currentRevision: 2 });
    const presentation = await setup.service.inspectForHuman({ workspaceId: "workspace_1", userId: "owner_1", approvalRequestId: approval.id });
    expect(presentation.approval.status).toBe("superseded");
    expect(presentation.targets[0]).toMatchObject({ targetId: "target_1", content: { text: "Launch copy" } });
    expect(presentation.decisionEligibility).toEqual({ eligible: false, blockerCodes: expect.arrayContaining(["REVISION_SUPERSEDED", "VALIDATION_STALE"]) });
  });

  it("projects superseded status in direct and filtered list reads", async () => {
    const setup = await setupPublishingApprovals();
    const approval = await setup.service.request(setup.requestInput());
    const head = setup.plans.repository.plans.get("workspace_1\u0000plan_1")!;
    setup.plans.repository.plans.set("workspace_1\u0000plan_1", { ...structuredClone(head), currentRevision: 2 });

    await expect(setup.service.get({ workspaceId: "workspace_1", approvalRequestId: approval.id, viewer: { kind: "human", userId: "owner_1" } })).resolves.toMatchObject({ status: "superseded" });
    await expect(setup.service.list({ workspaceId: "workspace_1", filters: { status: "superseded" }, limit: 10, viewer: { kind: "human", userId: "owner_1" } })).resolves.toEqual([expect.objectContaining({ id: approval.id, status: "superseded" })]);
    await expect(setup.service.list({ workspaceId: "workspace_1", filters: { status: "pending" }, limit: 10, viewer: { kind: "human", userId: "owner_1" } })).resolves.toEqual([]);
  });

  it("accepts canonical punctuated Artifact IDs and binds the full evidence document", () => {
    const setupPromise = setupPublishingApprovals();
    return setupPromise.then((setup) => {
      const revision = structuredClone(setup.revision);
      revision.definition.targets[0]!.contentArtifactId = "artifact:text.v1";
      revision.definition.targets[0]!.mediaArtifactIds = ["artifact:image.v1"];
      revision.validationEvidence.targets[0]!.artifacts[0]!.id = "artifact:text.v1";
      revision.validationEvidence.targets[0]!.artifacts[1]!.id = "artifact:image.v1";
      expect(exactPublishingApprovalSelection({ revision, targetIds: ["target_1"], channelIds: ["channel_linkedin"], artifactIds: ["artifact:text.v1", "artifact:image.v1"] }).artifactIds).toEqual(["artifact:image.v1", "artifact:text.v1"]);
      expect(() => publishingApprovalValidationBinding({ revision, targetIds: ["target_1"] })).not.toThrow();
      expect(publishingApprovalValidationBinding({ revision, targetIds: ["target_1"] }).evidenceDigest).toBe(canonicalDigest(revision.validationEvidence));
    });
  });

  it("rejects validation evidence from a different runtime-policy or LinkedIn capability contract", async () => {
    const setup = await setupPublishingApprovals();
    const revision = structuredClone(setup.revision);
    revision.validationEvidence.runtimePolicy.identity = "publishing-runtime-policy/other@1";
    expect(() => publishingApprovalValidationBinding({ revision, targetIds: ["target_1"] })).toThrow(expect.objectContaining({ code: "PUBLISHING_APPROVAL_STALE_VALIDATION" }));
  });

  it("keeps runtime approval pending until the pinned Workspace policy reaches acceptance", async () => {
    let decisionCount = 0;
    const binding = {
      schema: "publishing-approval-governance-binding/v1" as const,
      governanceRequestId: "gpar_request_1",
      policyId: "policy_publishing",
      policyRevision: 1,
      policyDigest: `sha256:${"9".repeat(64)}`,
    };
    const policyPort: PublishingApprovalGovernancePolicyPort = {
      bind: async () => binding,
      decide: async () => ++decisionCount === 1 ? "pending" : "accepted",
      verifyAccepted: async () => decisionCount > 1,
    };
    const setup = await setupPublishingApprovals(policyPort);
    const requested = await setup.service.request(setup.requestInput());
    expect(requested.governancePolicy).toEqual(binding);

    const first = await setup.service.decide({
      workspaceId: "workspace_1", userId: "member_a", idempotencyKey: "policy-stage-one",
      approvalRequestId: requested.id, expectedInspectionDigest: requested.inspectionDigest,
      decision: "approved",
    });
    expect(first).toMatchObject({ status: "pending", decision: null });

    const second = await setup.service.decide({
      workspaceId: "workspace_1", userId: "member_b", idempotencyKey: "policy-stage-two",
      approvalRequestId: requested.id, expectedInspectionDigest: requested.inspectionDigest,
      decision: "approved",
    });
    expect(second).toMatchObject({ status: "approved", decision: { decidedByUserId: "member_b" } });
  });
});
