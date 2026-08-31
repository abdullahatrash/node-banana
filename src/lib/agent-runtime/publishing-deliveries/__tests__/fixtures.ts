import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  publishingDeliveryCancelAuthorizationContractDigest,
  publishingDeliveryReconcileAuthorizationContractDigest,
  publishingDeliveryReleaseAuthorizationContractDigest,
  publishingDeliveryRetryAuthorizationContractDigest,
} from "../authorization-contract";
import { InMemoryPublishingDeliveryRepository } from "../memory";
import { PublishingDeliveryService } from "../service";
import type {
  PublishingDeliveryAuthorizationSession,
  PublishingDeliveryCancellationAuthorizationSession,
  PublishingDeliveryRepository,
  PublishingDeliveryRecoveryAuthorizationSession,
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
  let cancellationAuthorizationCurrent = true;
  let recoveryAuthorizationCurrent = true;
  repository.seedApproval(rawApproval);
  repository.setAuthorizationSessionVerifier(async () => authorizationCurrent);
  repository.setValidationSessionVerifier(async () => validationCurrent);
  repository.setCancellationAuthorizationSessionVerifier(
    async () => cancellationAuthorizationCurrent,
  );
  repository.setRecoveryAuthorizationSessionVerifier(
    async () => recoveryAuthorizationCurrent,
  );
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
  const cancellationAuthorizationPort = {
    checkCurrent: async (input: {
      workspaceId: string;
      actor: { kind: "agent"; principalId: string; keyId: string } | { kind: "human"; userId: string };
      capability: "publishing_deliveries.cancel@1";
      authorizationContractDigest: string;
      authorizationEvidenceRef: string;
      channelIds: string[];
      artifactIds: string[];
    }): Promise<PublishingDeliveryCancellationAuthorizationSession | null> =>
      cancellationAuthorizationCurrent &&
      (input.actor.kind === "agent" || input.actor.userId === "owner_1")
        ? {
            schema: "publishing-delivery-cancellation-authorization-session/v1",
            id: "cancel_authorization_1",
            workspaceId: input.workspaceId,
            actor: structuredClone(input.actor),
            capability: input.capability,
            contractDigest: input.authorizationContractDigest,
            admissionEvidenceRef: input.authorizationEvidenceRef,
            evidenceRef: input.actor.kind === "agent"
              ? input.authorizationEvidenceRef
              : "explicit_human_channel_authority_1",
            evidenceDigest: canonicalDigest({
              actor: input.actor,
              channelIds: input.channelIds,
              artifactIds: input.artifactIds,
            }),
            resources: {
              channelIds: [...input.channelIds],
              artifactIds: [...input.artifactIds],
            },
            humanGrants: input.actor.kind === "human"
              ? input.channelIds.map((channelId, index) => ({
                  channelId,
                  grantId: `cancel_grant_${index + 1}`,
                }))
              : [],
            issuedAt: new Date(now.getTime() - 1_000),
            expiresAt: new Date(now.getTime() + 60_000),
          }
        : null,
  };
  const recoveryAuthorizationPort = {
    checkCurrent: async (input: {
      workspaceId: string;
      actor: { kind: "agent"; principalId: string; keyId: string } | { kind: "human"; userId: string };
      capability: "publishing_deliveries.retry@1" | "publishing_deliveries.reconcile@1";
      authorizationContractDigest: string;
      authorizationEvidenceRef: string;
      channelIds: string[];
      artifactIds: string[];
    }): Promise<PublishingDeliveryRecoveryAuthorizationSession | null> =>
      recoveryAuthorizationCurrent &&
      (input.actor.kind === "agent" || input.actor.userId === "owner_1")
        ? {
            schema: "publishing-delivery-recovery-authorization-session/v1",
            id: `recovery_authorization_${input.capability.includes("retry") ? "retry" : "reconcile"}`,
            workspaceId: input.workspaceId,
            actor: structuredClone(input.actor),
            capability: input.capability,
            contractDigest: input.authorizationContractDigest,
            admissionEvidenceRef: input.authorizationEvidenceRef,
            evidenceRef: input.actor.kind === "agent"
              ? input.authorizationEvidenceRef
              : "explicit_human_recovery_authority_1",
            evidenceDigest: canonicalDigest({
              actor: input.actor,
              capability: input.capability,
              channelIds: input.channelIds,
              artifactIds: input.artifactIds,
            }),
            resources: {
              channelIds: [...input.channelIds],
              artifactIds: [...input.artifactIds],
            },
            humanGrants: input.actor.kind === "human"
              ? input.channelIds.map((channelId, index) => ({
                  channelId,
                  grantId: `recovery_grant_${index + 1}`,
                }))
              : [],
            issuedAt: new Date(now.getTime() - 1_000),
            expiresAt: new Date(now.getTime() + 60_000),
          }
        : null,
  };
  const service = new PublishingDeliveryService(
    repository,
    approvals.revisionPort,
    validationPort,
    authorizationPort,
    { now: () => new Date(now) },
    cancellationAuthorizationPort,
    recoveryAuthorizationPort,
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
    cancellationAuthorizationPort,
    recoveryAuthorizationPort,
    validationPort,
    releaseInput,
    setNow(value: string) { now = new Date(value); },
    setAuthorizationCurrent(value: boolean) { authorizationCurrent = value; },
    setValidationCurrent(value: boolean) { validationCurrent = value; },
    setCancellationAuthorizationCurrent(value: boolean) {
      cancellationAuthorizationCurrent = value;
    },
    setRecoveryAuthorizationCurrent(value: boolean) {
      recoveryAuthorizationCurrent = value;
    },
    cancellationInput(actor: "agent" | "human", deliveryId: string) {
      return {
        workspaceId: "workspace_1",
        actor: actor === "agent"
          ? { kind: "agent" as const, principalId: "principal_2", keyId: "key_2" }
          : { kind: "human" as const, userId: "owner_1" },
        deliveryId,
        channelIds: [...rawApproval.channelIds],
        artifactIds: [...rawApproval.artifactIds],
        authorizationEvidenceRef: actor === "agent"
          ? "cancel_agent_admission_1"
          : "cancel_human_admission_1",
        authorizationContractDigest:
          publishingDeliveryCancelAuthorizationContractDigest(),
      };
    },
    recoveryInput(
      capability: "retry" | "reconcile",
      actor: "agent" | "human",
      deliveryId: string,
      evidenceDigest: string,
    ) {
      const common = {
        workspaceId: "workspace_1",
        actor: actor === "agent"
          ? { kind: "agent" as const, principalId: "principal_2", keyId: "key_2" }
          : { kind: "human" as const, userId: "owner_1" },
        deliveryId,
        channelIds: [...rawApproval.channelIds],
        artifactIds: [...rawApproval.artifactIds],
        authorizationEvidenceRef: `recovery_${capability}_${actor}_admission_1`,
      };
      return capability === "retry"
        ? {
            ...common,
            approvalRequestId: "approval_retry_1",
            expectedFailureEvidenceDigest: evidenceDigest,
            idempotencyKey: `retry-${deliveryId}`,
            authorizationContractDigest:
              publishingDeliveryRetryAuthorizationContractDigest(),
          }
        : {
            ...common,
            expectedUnknownEvidenceDigest: evidenceDigest,
            authorizationContractDigest:
              publishingDeliveryReconcileAuthorizationContractDigest(),
          };
    },
  } satisfies Record<string, unknown> & { repository: PublishingDeliveryRepository };
}
