import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { publishingPlanDraft, setupPublishingPlans } from "../../publishing-plans/__tests__/fixtures";
import { publishingPlanLinkedInCapabilityVersion } from "../../publishing-plans/production-digests";
import { publishingApprovalRequestAuthorizationContractDigest } from "../authorization-contract";
import { InMemoryPublishingApprovalRepository } from "../memory";
import { PublishingApprovalService } from "../service";
import type { PublishingApprovalAuthoritySession, PublishingApprovalValidationSession } from "../types";
import { publishingApprovalValidationBinding } from "../validation";

export async function setupPublishingApprovals() {
  const plans = setupPublishingPlans();
  const channel = plans.channels.snapshots.values().next().value!;
  plans.channels.put({
    ...channel,
    capabilityVersion: publishingPlanLinkedInCapabilityVersion(),
  });
  const created = await plans.service.create({
    candidate: publishingPlanDraft(),
    workspaceId: "workspace_1",
    principalId: "principal_1",
    keyId: "key_1",
    creationAuthorizationEvidenceRef: "otr_creation_evidence",
    effectiveResources: plans.effectiveResources,
    idempotencyKey: "approval-fixture-plan",
  });
  const revision = plans.repository.revisions.get(`workspace_1\u0000${created.id}`)!;
  let now = new Date("2026-08-08T12:00:00.000Z");
  let validationCurrent = true;
  let authorityCurrent = true;
  const validationModes: Array<"release" | "retry_due"> = [];
  const repository = new InMemoryPublishingApprovalRepository();
  const revisionPort = {
    getRevision: async ({ workspaceId, revisionId }: { workspaceId: string; revisionId: string }) => {
      const value = plans.repository.revisions.get(`${workspaceId}\u0000${revisionId}`);
      return value ? structuredClone(value) : null;
    },
    getCurrentRevision: async ({ workspaceId, revisionId }: { workspaceId: string; revisionId: string }) => {
      const value = plans.repository.revisions.get(`${workspaceId}\u0000${revisionId}`);
      const head = value && plans.repository.plans.get(`${workspaceId}\u0000${value.planId}`);
      return value && head?.currentRevision === value.revision ? structuredClone(value) : null;
    },
  };
  const validationPort = {
    verifyCurrent: async ({ workspaceId, revision: value, targetIds, mode = "release" }: { workspaceId: string; revision: typeof revision; targetIds: string[]; mode?: "release" | "retry_due" }): Promise<PublishingApprovalValidationSession | null> => {
      validationModes.push(mode);
      return validationCurrent
        ? {
            schema: "publishing-approval-validation-session/v1",
            id: "approval_validation_1",
            workspaceId,
            planRevisionId: value.id,
            planRevisionDigest: value.definitionDigest,
            targetIds: [...targetIds],
            binding: publishingApprovalValidationBinding({ revision: value, targetIds }),
            issuedAt: new Date(now),
            expiresAt: new Date("2026-08-08T13:00:00.000Z"),
          }
        : null;
    },
  };
  const authorityPort = {
    checkCurrent: async ({ workspaceId, userId, action, channelIds }: { workspaceId: string; userId: string; action: "publish"; channelIds: string[] }): Promise<PublishingApprovalAuthoritySession | null> =>
      authorityCurrent
        ? {
            schema: "publishing-approval-authority-session/v1",
            id: "authority_session_1",
            workspaceId,
            userId,
            subjectRole: "owner",
            action,
            channelIds: [...channelIds],
            grants: channelIds.map((channelId) => ({ channelId, grantId: `grant_${channelId}` })),
            evidenceRef: "approval_authority_evidence_1",
            evidenceDigest: canonicalDigest({ workspaceId, userId, action, channelIds }),
            issuedAt: new Date(now.getTime() - 1_000),
            expiresAt: new Date("2026-08-08T13:00:00.000Z"),
          }
        : null,
  };
  repository.setValidationSessionVerifier(async () => validationCurrent);
  repository.setAuthoritySessionVerifier(async () => authorityCurrent);
  const service = new PublishingApprovalService(
    repository,
    revisionPort,
    validationPort,
    authorityPort,
    {
      present: async ({ approval, revision: value }) =>
        approval.targetIds.map((targetId) => {
          const target = value.definition.targets.find((item) => item.targetId === targetId)!;
          return {
            targetId,
            channel: { id: target.channelId, platform: "linkedin" as const, authorKind: "person" as const, displayName: "LinkedIn", historical: false },
            content: { artifactId: target.contentArtifactId, digest: value.validationEvidence.targets[0]!.artifacts[0]!.digest, mediaType: "text/plain; charset=utf-8" as const, text: "Launch copy" },
            media: target.mediaArtifactIds.map((artifactId) => ({ artifactId, digest: value.validationEvidence.targets[0]!.artifacts[1]!.digest, mediaType: "image/png" as const, previewUrl: `/api/studio/publishing-approvals/${approval.id}/media/${artifactId}` })),
            settings: { type: "person" as const },
            timing: target.timing,
            targetEvidenceDigest: canonicalDigest(
              value.validationEvidence.targets[0]!,
            ),
            validation: {
              evaluatedAt: value.validationEvidence.evaluatedAt,
              expiresAt: value.validationEvidence.context.expiresAt,
              channelSnapshot: {
                id: value.validationEvidence.targets[0]!.channel.id,
                platform: "linkedin" as const,
                authorKind:
                  value.validationEvidence.targets[0]!.channel.authorKind,
                snapshotDigest:
                  value.validationEvidence.targets[0]!.channel.snapshotDigest,
                capabilityVersion:
                  value.validationEvidence.targets[0]!.channel.capabilityVersion,
              },
              artifacts: {
                content: {
                  ...value.validationEvidence.targets[0]!.artifacts[0]!,
                  kind: "text" as const,
                  mediaType: "text/plain; charset=utf-8" as const,
                },
                media: value.validationEvidence.targets[0]!.artifacts
                  .slice(1)
                  .map((artifact) => ({
                    ...artifact,
                    kind: "image" as const,
                    mediaType: "image/png" as const,
                  })),
              },
              settingsDigest:
                value.validationEvidence.targets[0]!.settingsDigest,
              publishAt: value.validationEvidence.targets[0]!.publishAt!,
              policy: {
                identity: "publishing-runtime-policy/default@1" as const,
                contractDigest:
                  value.validationEvidence.runtimePolicy.contractDigest,
                evidenceDigest:
                  value.validationEvidence.targets[0]!.policyEvidenceDigest,
                stateDigest:
                  value.validationEvidence.targets[0]!.policyStateDigest,
                outcome: "allowed" as const,
                blockerCodes: [] as [],
              },
            },
            costContext: { authoritative: false as const, currency: "USD" as const, estimatedAmount: "0.010000", pricingSnapshotIds: ["pricing_1"], computedAt: now.toISOString() },
          };
        }),
    },
    { now: () => new Date(now) },
  );
  const requestInput = () => ({
    workspaceId: "workspace_1",
    principalId: "principal_1",
    keyId: "key_1",
    requestAuthorizationEvidenceRef: "approval_request_auth_1",
    requestAuthorizationContractDigest: publishingApprovalRequestAuthorizationContractDigest(),
    idempotencyKey: "approval-request-1",
    revisionId: revision.id,
    action: "publish" as const,
    targetIds: ["target_1"],
    channelIds: ["channel_linkedin"],
    artifactIds: ["artifact_text", "artifact_image"],
    expiresAt: "2026-08-08T12:30:00.000Z",
  });
  return {
    plans, revision, repository, revisionPort, validationPort, authorityPort, service,
    requestInput, validationModes,
    setNow(value: string) { now = new Date(value); },
    setValidationCurrent(value: boolean) { validationCurrent = value; },
    setAuthorityCurrent(value: boolean) { authorityCurrent = value; },
  };
}
