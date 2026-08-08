import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  publishingDeliveryReleaseAuthorizationContractDigest,
} from "../authorization-contract";
import { InMemoryPublishingDeliveryRepository } from "../memory";
import { PublishingDeliveryService } from "../service";
import type {
  PublishingDeliveryAuthorizationSession,
  PublishingDeliveryRepository,
} from "../types";
import { setupPublishingApprovals } from "../../publishing-approvals/__tests__/fixtures";
import { publishingApprovalValidationBinding } from "../../publishing-approvals/validation";

export async function setupPublishingDeliveries(
  repository = new InMemoryPublishingDeliveryRepository(),
  options: { punctuatedArtifacts?: boolean } = {},
) {
  const approvals = await setupPublishingApprovals();
  const requested = await approvals.service.request(approvals.requestInput());
  const decided = await approvals.service.decide({
    workspaceId: "workspace_1",
    userId: "owner_1",
    idempotencyKey: "approve-for-release",
    approvalRequestId: requested.id,
    expectedInspectionDigest: requested.inspectionDigest,
    decision: "approved",
  });
  let rawApproval = approvals.repository.requests.get(
    `workspace_1\u0000${decided.id}`,
  )!;
  if (options.punctuatedArtifacts) {
    const revision = approvals.plans.repository.revisions.get(
      `workspace_1\u0000${approvals.revision.id}`,
    )!;
    const punctuated = structuredClone(revision);
    punctuated.definition.targets[0]!.contentArtifactId = "artifact:text.v1";
    punctuated.definition.targets[0]!.mediaArtifactIds = ["artifact:image.v1"];
    punctuated.definition.artifactIds = ["artifact:text.v1", "artifact:image.v1"];
    punctuated.definitionDigest = canonicalDigest(punctuated.definition);
    punctuated.validationEvidence.definitionDigest = punctuated.definitionDigest;
    punctuated.validationEvidence.context.resources.artifactIds = ["artifact:text.v1", "artifact:image.v1"];
    punctuated.validationEvidence.targets[0]!.artifacts[0]!.id = "artifact:text.v1";
    punctuated.validationEvidence.targets[0]!.artifacts[1]!.id = "artifact:image.v1";
    approvals.plans.repository.revisions.set(
      `workspace_1\u0000${punctuated.id}`,
      punctuated,
    );
    rawApproval = {
      ...structuredClone(rawApproval),
      planRevisionDigest: punctuated.definitionDigest,
      artifactIds: ["artifact:image.v1", "artifact:text.v1"],
      requestAuthorization: {
        ...structuredClone(rawApproval.requestAuthorization),
        resources: {
          ...structuredClone(rawApproval.requestAuthorization.resources),
          artifactIds: ["artifact:image.v1", "artifact:text.v1"],
        },
      },
      validation: publishingApprovalValidationBinding({
        revision: punctuated,
        targetIds: rawApproval.targetIds,
      }),
    };
  }
  let now = new Date("2026-08-08T12:01:00.000Z");
  let authorizationCurrent = true;
  let validationCurrent = true;
  repository.seedApproval(rawApproval);
  repository.setAuthorizationSessionVerifier(async () => authorizationCurrent);
  repository.setValidationSessionVerifier(async () => validationCurrent);
  const authorizationPort = {
    checkCurrent: async (input: {
      workspaceId: string;
      principalId: string;
      keyId: string;
      capability: "publishing_plan_revisions.release@1";
      authorizationContractDigest: string;
      authorizationEvidenceRef: string;
      channelIds: string[];
      artifactIds: string[];
    }): Promise<PublishingDeliveryAuthorizationSession | null> =>
      authorizationCurrent
        ? {
            schema: "publishing-delivery-authorization-session/v1",
            id: "release_authorization_1",
            workspaceId: input.workspaceId,
            principalId: input.principalId,
            keyId: input.keyId,
            capability: input.capability,
            contractDigest: input.authorizationContractDigest,
            evidenceRef: input.authorizationEvidenceRef,
            resources: {
              channelIds: [...input.channelIds],
              artifactIds: [...input.artifactIds],
            },
            issuedAt: new Date(now.getTime() - 1_000),
            expiresAt: new Date(now.getTime() + 60_000),
          }
        : null,
  };
  const validationPort = {
    verifyCurrent: async (input: Parameters<typeof approvals.validationPort.verifyCurrent>[0]) =>
      validationCurrent ? approvals.validationPort.verifyCurrent(input) : null,
  };
  const service = new PublishingDeliveryService(
    repository,
    approvals.revisionPort,
    validationPort,
    authorizationPort,
    { now: () => new Date(now) },
  );
  const releaseInput = () => ({
    workspaceId: "workspace_1",
    principalId: "principal_1",
    keyId: "key_1",
    approvalRequestId: rawApproval.id,
    channelIds: [...rawApproval.channelIds],
    artifactIds: [...rawApproval.artifactIds],
    idempotencyKey: "release-approved-plan-1",
    authorizationEvidenceRef: "release_authorization_evidence_1",
    authorizationContractDigest:
      publishingDeliveryReleaseAuthorizationContractDigest(),
  });
  return {
    approvals,
    rawApproval,
    repository,
    service,
    authorizationPort,
    validationPort,
    releaseInput,
    setNow(value: string) { now = new Date(value); },
    setAuthorizationCurrent(value: boolean) { authorizationCurrent = value; },
    setValidationCurrent(value: boolean) { validationCurrent = value; },
  } satisfies Record<string, unknown> & { repository: PublishingDeliveryRepository };
}
