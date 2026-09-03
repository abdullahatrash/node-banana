import { randomUUID } from "node:crypto";
import { canonicalDigest } from "./canonical";
import { publishingApprovalReleaseAuthorizationContractDigest } from "@/lib/agent-runtime/publishing-approvals/authorization-contract";
import {
  PRODUCTION_PUBLISHING_APPROVAL_PRESENTATION,
  PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY,
  PRODUCTION_PUBLISHING_APPROVAL_REVISIONS,
} from "@/lib/agent-runtime/publishing-approvals/production";
import type { PublishingApprovalPresentationTarget } from "@/lib/agent-runtime/publishing-approvals/types";
import { GOVERNANCE_REGION_ROUTES, requireGovernanceRegionRoute } from "@/lib/governance/region-enforcement";

export interface SocialPublishingApprovalEvidence {
  approvalRequestId: string;
  targetId: string;
  targetEvidenceDigest: string;
  consumingPrincipalId: string;
  consumingKeyId: string;
  authorizationEvidenceRef: string;
  authorizationIssuedAt: string;
  authorizationExpiresAt: string;
}

export interface InspectedSocialPublishingApproval {
  requestId: string;
  decisionId: string;
  target: PublishingApprovalPresentationTarget;
  channelIds: string[];
  artifactIds: string[];
  evidence: SocialPublishingApprovalEvidence;
}

export interface SocialPublishingApprovalAdmissionPort {
  inspect(input: {
    workspaceId: string;
    socialAccountId: string;
    evidence: SocialPublishingApprovalEvidence;
  }): Promise<InspectedSocialPublishingApproval | null>;
  consume(input: {
    workspaceId: string;
    inspected: InspectedSocialPublishingApproval;
  }): Promise<"consumed" | "already_consumed" | "invalid" | "authorization_stale">;
}

function exactTimestamp(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? parsed : null;
}

/**
 * Bridges the legacy social-post tool into the canonical Plan Revision Approval
 * runtime. The approved presentation, not caller-authored post data, is the
 * source of publishable content and timing.
 */
export const PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION:
  SocialPublishingApprovalAdmissionPort = {
  async inspect(input) {
    await requireGovernanceRegionRoute({
      workspaceId: input.workspaceId,
      route: GOVERNANCE_REGION_ROUTES.publishing,
      configuredRegion: process.env.SOCIAL_PROCESSING_REGION ?? process.env.APP_DATA_REGION,
    });
    const request = await PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY.getRequest({
      workspaceId: input.workspaceId,
      approvalRequestId: input.evidence.approvalRequestId,
    });
    if (
      !request?.decision || request.decision.decision !== "approved" ||
      request.consumption || !request.governancePolicy ||
      !request.channelIds.includes(input.socialAccountId)
    ) return null;
    const revision = await PRODUCTION_PUBLISHING_APPROVAL_REVISIONS.getCurrentRevision({
      workspaceId: input.workspaceId,
      revisionId: request.planRevisionId,
    });
    if (!revision || revision.definitionDigest !== request.planRevisionDigest) return null;
    const targets = await PRODUCTION_PUBLISHING_APPROVAL_PRESENTATION.present({
      approval: request,
      revision,
      actorUserId: request.requestingPrincipalId,
      presentedAt: new Date(),
    });
    const target = targets.find((candidate) => candidate.targetId === input.evidence.targetId);
    if (
      !target || target.channel.id !== input.socialAccountId ||
      target.targetEvidenceDigest !== input.evidence.targetEvidenceDigest
    ) return null;
    return {
      requestId: request.id,
      decisionId: request.decision.id,
      target,
      channelIds: [...request.channelIds],
      artifactIds: [...request.artifactIds],
      evidence: input.evidence,
    };
  },
  async consume(input) {
    const issuedAt = exactTimestamp(input.inspected.evidence.authorizationIssuedAt);
    const expiresAt = exactTimestamp(input.inspected.evidence.authorizationExpiresAt);
    if (!issuedAt || !expiresAt || expiresAt <= new Date()) return "authorization_stale";
    return PRODUCTION_PUBLISHING_APPROVAL_REPOSITORY.consume({
      consumption: {
        id: `pac_${randomUUID().replaceAll("-", "")}`,
        workspaceId: input.workspaceId,
        approvalRequestId: input.inspected.requestId,
        decisionId: input.inspected.decisionId,
        consumingPrincipalId: input.inspected.evidence.consumingPrincipalId,
        consumingKeyId: input.inspected.evidence.consumingKeyId,
        capability: "publishing_plan_revisions.release@1",
        authorizationContractDigest: publishingApprovalReleaseAuthorizationContractDigest(),
        authorizationEvidenceRef: input.inspected.evidence.authorizationEvidenceRef,
        authorizedResources: {
          channelIds: input.inspected.channelIds,
          artifactIds: input.inspected.artifactIds,
        },
        authorizationIssuedAt: issuedAt,
        authorizationExpiresAt: expiresAt,
        consumedAt: new Date(),
      },
    });
  },
};

export function exactApprovedSocialPostInput(input: {
  content?: string;
  scheduledAt?: string;
  platformSettings?: Record<string, unknown>;
  mediaAssetIds?: string[];
}, target: PublishingApprovalPresentationTarget): boolean {
  if (input.content !== undefined && input.content.trim() !== target.content.text) return false;
  if ((input.mediaAssetIds?.length ?? 0) > 0) return false;
  if (input.platformSettings && canonicalDigest(input.platformSettings) !== canonicalDigest(target.settings)) return false;
  const approvedAt = target.timing.publishAt;
  return input.scheduledAt ? input.scheduledAt === approvedAt : true;
}
