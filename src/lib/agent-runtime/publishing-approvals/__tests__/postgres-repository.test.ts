import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { publishingPlanRuntimePolicyContractDigest } from "../../publishing-plans/production-digests";
import { rehydratePublishingPlanRevision } from "../../publishing-plans/postgres-repository";
import {
  publishingApprovalRequestAuthorizationContractDigest,
} from "../authorization-contract";
import { DrizzlePublishingApprovalRepository } from "../postgres-repository";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/agent-runtime/publishing-approvals/postgres-repository.ts"),
  "utf8",
);

function repositoryReturning(request: Record<string, unknown>) {
  return new DrizzlePublishingApprovalRepository(() => ({
    select: () => {
      const query = {
        from: () => query,
        leftJoin: () => query,
        where: () => query,
        limit: async () => [{ request, decision: null, consumption: null }],
      };
      return query;
    },
  }) as never);
}

function validRequestRow() {
  const targetIds = ["target_1"];
  return {
    workspaceId: "workspace_1",
    id: "par_request_1",
    planId: "plan_1",
    planRevisionId: "ppr_revision_1",
    planRevision: 1,
    planRevisionDigest: `sha256:${"1".repeat(64)}`,
    action: "publish",
    targetIds,
    targetSetDigest: canonicalDigest(targetIds),
    channelIds: ["channel_1"],
    artifactIds: ["artifact:image.v1", "artifact:text.v1"],
    requestingPrincipalId: "principal_1",
    requestingKeyId: "key_1",
    requestAuthorizationCapability: "publishing_approvals.request@1",
    requestAuthorizationContractDigest: publishingApprovalRequestAuthorizationContractDigest(),
    requestAuthorizationEvidenceRef: "otr_request_1",
    validationEvidenceDigest: `sha256:${"2".repeat(64)}`,
    validationCurrentStateDigest: `sha256:${"3".repeat(64)}`,
    validationContextId: "context_1",
    validationContextDigest: `sha256:${"4".repeat(64)}`,
    validationEvaluatedAt: new Date("2026-08-08T11:59:00.000Z"),
    validationExpiresAt: new Date("2026-08-08T13:00:00.000Z"),
    validationRuntimePolicyIdentity: "publishing-runtime-policy/default@1",
    validationRuntimePolicyContractDigest: publishingPlanRuntimePolicyContractDigest(),
    decisionPolicyMode: "expires_at",
    decisionPolicyExpiresAt: new Date("2026-08-08T12:30:00.000Z"),
    authorizesExecution: false,
    createdAt: new Date("2026-08-08T12:00:00.000Z"),
  };
}

describe("Postgres Publishing Approval repository contract", () => {
  it("rehydrates punctuated canonical Artifact IDs and fails closed on malformed rows", async () => {
    const valid = validRequestRow();
    await expect(repositoryReturning(valid).getRequest({
      workspaceId: "workspace_1",
      approvalRequestId: "par_request_1",
    })).resolves.toMatchObject({ artifactIds: valid.artifactIds });

    await expect(repositoryReturning({
      ...valid,
      validationRuntimePolicyIdentity: "attacker-policy@1",
    }).getRequest({ workspaceId: "workspace_1", approvalRequestId: valid.id }))
      .resolves.toBeNull();
    await expect(repositoryReturning({
      ...valid,
      targetIds: ["target_1", "target_1"],
      targetSetDigest: canonicalDigest(["target_1", "target_1"]),
    }).getRequest({ workspaceId: "workspace_1", approvalRequestId: valid.id }))
      .resolves.toBeNull();
  });

  it("reuses the strict Publishing Plan durable revision parser", () => {
    const definition = {
      schema: "publishing-plan-revision-definition/v1",
      planId: "plan_1",
      channelIds: ["channel_1"],
      artifactIds: ["artifact:text.v1"],
      targets: [{ attackerControlled: true }],
    };
    const evidence = {
      schema: "publishing-plan-validation-evidence/v1",
      definitionDigest: canonicalDigest(definition),
      authorizesExecution: false,
    };
    expect(rehydratePublishingPlanRevision({
      workspaceId: "workspace_1",
      id: "ppr_revision_1",
      planId: "plan_1",
      revision: 1,
      definitionDigest: canonicalDigest(definition),
      definition,
      validationEvidenceDigest: canonicalDigest(evidence),
      validationEvidence: evidence,
      authorPrincipalId: "principal_1",
      authorKeyId: "key_1",
      creationAuthorizationEvidenceRef: "otr_creation_1",
      createdAt: new Date("2026-08-08T12:00:00.000Z"),
    } as never)).toBeNull();
    expect(source).toContain("rehydratePublishingPlanRevision(revisions[0])");
  });

  it("replays receipts before mutable state and creates each receipt once", () => {
    const create = source.slice(source.indexOf("async createRequest("), source.indexOf("\n  getRequest("));
    expect(create.indexOf("lockReceipt(tx, input.receipt)")).toBeLessThan(create.indexOf("lockCurrentRevision(tx, request)"));
    expect(create.match(/tx\.insert\(runtimePublishingApprovalMutationReceipts\)/g)).toHaveLength(1);
    expect(create).toContain("safeIds(request.targetIds, 50)");
    expect(create).toContain("safeArtifactIds(request.artifactIds, true)");
    expect(source).toContain("sameOrder(request.artifactIds, selectedArtifactIds)");
  });

  it("does not let verifier sessions extend validation evidence", () => {
    const session = source.slice(source.indexOf("function validationSessionMatches("), source.indexOf("\nasync function lockCurrentRevision("));
    expect(session).toContain("session.expiresAt.getTime() === new Date(request.validation.expiresAt).getTime()");
    expect(session).toContain("session.issuedAt >= new Date(request.validation.evaluatedAt)");
    expect(session).toContain("session.issuedAt <= session.expiresAt");
  });

  it("revalidates Channel, Artifact, schedule, and policy evidence after later locks", () => {
    const create = source.slice(source.indexOf("async createRequest("), source.indexOf("\n  getRequest("));
    expect(create.match(/verifyCurrentEvidence\(/g)).toHaveLength(2);
    expect(create.indexOf("verifyRequestAuthorization(tx, request, finalNow)")).toBeLessThan(
      create.lastIndexOf("verifyCurrentEvidence("),
    );
    const decide = source.slice(source.indexOf("async decide("), source.indexOf("\n  async consume("));
    expect(decide.match(/verifyCurrentEvidence\(/g)).toHaveLength(2);
    expect(decide.indexOf("lockCurrentAuthority(tx, input.authoritySession, request, evidenceNow)")).toBeLessThan(
      decide.lastIndexOf("verifyCurrentEvidence("),
    );
    expect(source).toContain("channel.tokenExpiresAt <= finalNow");
    expect(source).toContain("new Date(target.timing.publishAt) <= finalNow");
  });

  it("locks grant parents deterministically and queries revocations only after the lock", () => {
    const authority = source.slice(source.indexOf("async function lockCurrentAuthority("), source.indexOf("\nfunction receiptValues("));
    expect(authority).toContain("orderBy(asc(runtimePublishingApprovalAuthorityGrants.id)).for(\"update\")");
    expect(authority.indexOf(".for(\"update\")")).toBeLessThan(
      authority.indexOf("tx.select().from(runtimePublishingApprovalAuthorityRevocations)"),
    );
    expect(authority).not.toContain("leftJoin(runtimePublishingApprovalAuthorityRevocations");
    const revoke = source.slice(source.indexOf("async revokeGrantIdempotent("), source.indexOf("\n  async checkCurrent("));
    expect(revoke.indexOf(".for(\"update\")")).toBeLessThan(
      revoke.indexOf("tx.select().from(runtimePublishingApprovalAuthorityRevocations)"),
    );
    expect(revoke).not.toContain("leftJoin(runtimePublishingApprovalAuthorityRevocations");
  });

  it("derives grant roles, stamps times durably, and exposes no receipt-bypassing mutation", () => {
    expect(source).toContain("subjectRoleAtIssue: subjects[0].role");
    expect(source).toContain("randomUUID()");
    expect(source).toContain(".returning({ issuedAt:");
    expect(source).toContain(".returning({ revokedAt:");
    expect(source).not.toMatch(/async issueGrant\(/);
    expect(source).not.toMatch(/async revokeGrant\(/);
  });

  it("binds decision provenance and independent single-use release authorization", () => {
    expect(source).toContain("input.decision.authorityEvidenceRef !== input.authoritySession.evidenceRef");
    expect(source).toContain("input.decision.authorityEvidenceDigest !== input.authoritySession.evidenceDigest");
    expect(source).toContain('{ kind: "stale_view" as const }');
    expect(source).toContain("publishingApprovalReleaseAuthorizationContractDigest()");
    expect(source).toContain("request.decision.decision !== \"approved\"");
    expect(source).toContain("return \"already_consumed\" as const");
    expect(source).toContain("finalNow >= consumption.authorizationExpiresAt");
  });
});
