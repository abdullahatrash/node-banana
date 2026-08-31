import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  agentAuthorizationDecisions,
  agentKeys,
  agentPrincipals,
} from "@/lib/db/schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  ArtifactService,
  ArtifactServiceError,
} from "@/lib/agent-runtime/artifacts/service";
import type { BudgetService } from "@/lib/agent-runtime/budgets/service";
import { readLinkedInAuthorKind } from "@/lib/social/linkedin-author-kind";
import { getProvider } from "@/lib/social/provider-registry";
import {
  getSocialAccount,
  SocialAccountNotFoundError,
} from "@/lib/social/repository";
import "@/lib/social/runtime-bootstrap";
import type {
  PublishingPlanArtifactSnapshotPort,
  PublishingPlanChannelSnapshotPort,
  PublishingPlanClock,
  PublishingPlanRuntimePolicyDecision,
  PublishingPlanRuntimePolicyPort,
  PublishingPlanValidationContextPort,
  PublishingPlanValidationContextSnapshot,
} from "./types";
import {
  publishingPlanArtifactVersionDigest,
  publishingPlanChannelVersionDigest,
  publishingPlanLinkedInCapabilityVersion,
  publishingPlanPolicyStateDigest,
  publishingPlanRuntimePolicyContractDigest,
  PUBLISHING_PLAN_LINKEDIN_CAPABILITIES,
  PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
  PUBLISHING_PLAN_VALIDATION_CONTEXT_TTL_MS,
} from "./production-digests";
import {
  publishingPlanAuthorizationContractDigest,
} from "./authorization-contract";

export {
  publishingPlanArtifactVersionDigest,
  publishingPlanChannelVersionDigest,
  publishingPlanLinkedInCapabilityVersion,
  publishingPlanPolicyStateDigest,
  publishingPlanRuntimePolicyContractDigest,
  PUBLISHING_PLAN_LINKEDIN_CAPABILITIES,
  PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
  PUBLISHING_PLAN_VALIDATION_CONTEXT_TTL_MS,
} from "./production-digests";

type Database = ReturnType<typeof getDb>;

const systemClock: PublishingPlanClock = { now: () => new Date() };

export class ArtifactServicePublishingPlanSnapshots
  implements PublishingPlanArtifactSnapshotPort
{
  constructor(private readonly artifacts: ArtifactService) {}

  async getCurrent(
    input: Parameters<PublishingPlanArtifactSnapshotPort["getCurrent"]>[0],
  ) {
    try {
      const found = await this.artifacts.getArtifact(input);
      const createdAt = new Date(found.artifact.createdAt);
      return {
        id: found.artifact.id,
        workspaceId: found.artifact.workspaceId,
        digest: found.artifact.digest,
        versionDigest: publishingPlanArtifactVersionDigest({
          id: found.artifact.id,
          workspaceId: found.artifact.workspaceId,
          digest: found.artifact.digest,
          kind: found.artifact.kind,
          mediaType: found.artifact.mediaType,
          sizeBytes: found.artifact.sizeBytes,
          width: found.artifact.width,
          height: found.artifact.height,
          createdAt,
          deletedAt: null,
        }),
        kind: found.artifact.kind,
        mediaType: found.artifact.mediaType,
        sizeBytes: found.artifact.sizeBytes,
        width: found.artifact.width,
        height: found.artifact.height,
        inlineText: found.textContent,
        deletedAt: null,
        // Artifacts are immutable; their creation instant is the stable
        // resource-version timestamp. Using query time here would make a
        // commit-time re-read differ even when the Artifact did not change.
        observedAt: createdAt,
      };
    } catch (error) {
      if (
        error instanceof ArtifactServiceError &&
        error.code === "ARTIFACT_UNAVAILABLE"
      ) {
        return null;
      }
      // Storage, integrity, and persistence failures are deliberately not
      // collapsed to a missing Artifact. The validator converts them into a
      // fail-closed current-state blocker.
      throw error;
    }
  }
}

export class SocialAccountPublishingPlanSnapshots
  implements PublishingPlanChannelSnapshotPort
{
  constructor(private readonly clock: PublishingPlanClock = systemClock) {}

  async getCurrent(
    input: Parameters<PublishingPlanChannelSnapshotPort["getCurrent"]>[0],
  ) {
    try {
      const account = await getSocialAccount(
        input.workspaceId,
        input.channelId,
      );
      if (account.platform !== "linkedin") return null;
      const authorKind = readLinkedInAuthorKind(account.additionalSettings);
      if (!authorKind) return null;
      const provider = getProvider("linkedin");
      const capabilities = provider.getCapabilities();
      if (
        capabilities.identifier !== "linkedin" ||
        capabilities.maxContentLength !==
          PUBLISHING_PLAN_LINKEDIN_CAPABILITIES.maxContentLength ||
        capabilities.supportsImages !==
          PUBLISHING_PLAN_LINKEDIN_CAPABILITIES.supportsImages ||
        capabilities.supportsVideo !==
          PUBLISHING_PLAN_LINKEDIN_CAPABILITIES.supportsVideo ||
        capabilities.supportsCarousel !==
          PUBLISHING_PLAN_LINKEDIN_CAPABILITIES.supportsCarousel ||
        provider.maxImages !== PUBLISHING_PLAN_LINKEDIN_CAPABILITIES.maxImages
      ) {
        return null;
      }
      const now = this.clock.now();
      const tokenUnavailable =
        account.tokenExpiresAt !== null &&
        account.tokenExpiresAt <= now &&
        !account.refreshTokenEncrypted;
      const disconnected =
        account.disabled || account.requiresReauth || tokenUnavailable;
      const capabilityVersion = publishingPlanLinkedInCapabilityVersion();
      const versionDigest = publishingPlanChannelVersionDigest({
        id: account.id,
        workspaceId: account.workspaceId,
        platform: "linkedin",
        authorKind,
        disabled: account.disabled,
        requiresReauth: account.requiresReauth,
        tokenExpiresAt: account.tokenExpiresAt,
        hasRefreshToken: Boolean(account.refreshTokenEncrypted),
        updatedAt: account.updatedAt,
        capabilityVersion,
      });
      return {
        id: account.id,
        workspaceId: account.workspaceId,
        platform: "linkedin" as const,
        authorKind,
        versionDigest,
        state: disconnected ? ("disconnected" as const) : ("active" as const),
        capabilityVersion,
        maxContentLength: capabilities.maxContentLength,
        supportsImages: capabilities.supportsImages,
        maxImages: provider.maxImages,
        observedAt: account.updatedAt,
      };
    } catch (error) {
      if (error instanceof SocialAccountNotFoundError) return null;
      throw error;
    }
  }
}

export class DrizzlePublishingPlanValidationContexts
  implements PublishingPlanValidationContextPort
{
  constructor(
    private readonly database: () => Database,
    private readonly clock: PublishingPlanClock = systemClock,
    private readonly ttlMs = PUBLISHING_PLAN_VALIDATION_CONTEXT_TTL_MS,
  ) {}

  async resolveCurrent(
    input: Parameters<PublishingPlanValidationContextPort["resolveCurrent"]>[0],
  ): Promise<PublishingPlanValidationContextSnapshot | null> {
    const separator = input.capability.lastIndexOf("@");
    const capabilityName = input.capability.slice(0, separator);
    const capabilityVersion = Number(input.capability.slice(separator + 1));
    const expectedAuthorizationContractDigest =
      publishingPlanAuthorizationContractDigest(input.capability);
    const [row] = await this.database()
      .select({
        decision: agentAuthorizationDecisions,
        keyExpiresAt: agentKeys.expiresAt,
        keyRevokedAt: agentKeys.revokedAt,
        principalStatus: agentPrincipals.status,
        principalRevokedAt: agentPrincipals.revokedAt,
      })
      .from(agentAuthorizationDecisions)
      .innerJoin(
        agentKeys,
        and(
          eq(agentKeys.id, agentAuthorizationDecisions.keyId),
          eq(agentKeys.principalId, agentAuthorizationDecisions.principalId),
        ),
      )
      .innerJoin(
        agentPrincipals,
        and(
          eq(agentPrincipals.id, agentAuthorizationDecisions.principalId),
          eq(agentPrincipals.workspaceId, agentAuthorizationDecisions.workspaceId),
        ),
      )
      .where(
        and(
          eq(agentAuthorizationDecisions.workspaceId, input.workspaceId),
          eq(agentAuthorizationDecisions.principalId, input.principalId),
          eq(agentAuthorizationDecisions.keyId, input.keyId),
          eq(
            agentAuthorizationDecisions.operatorTraceRef,
            input.authorizationEvidenceRef,
          ),
          eq(agentAuthorizationDecisions.capabilityName, capabilityName),
          eq(agentAuthorizationDecisions.capabilityVersion, capabilityVersion),
          eq(
            agentAuthorizationDecisions.authorizationContractDigest,
            expectedAuthorizationContractDigest,
          ),
          eq(agentAuthorizationDecisions.outcome, "allowed"),
        ),
      )
      .limit(1);
    if (
      !row ||
      row.keyRevokedAt ||
      row.principalStatus !== "active" ||
      row.principalRevokedAt ||
      row.decision.authorizationContractDigest !==
        expectedAuthorizationContractDigest
    ) {
      return null;
    }
    const decisionChannels: string[] = [];
    const decisionArtifacts: string[] = [];
    for (const resource of row.decision.resources) {
      if (resource.kind === "channel") decisionChannels.push(resource.id);
      else if (resource.kind === "artifact") decisionArtifacts.push(resource.id);
      else return null;
    }
    if (
      new Set(decisionChannels).size !== decisionChannels.length ||
      new Set(decisionArtifacts).size !== decisionArtifacts.length
    ) {
      return null;
    }
    const ttlExpiresAt = new Date(row.decision.createdAt.getTime() + this.ttlMs);
    const expiresAt =
      row.keyExpiresAt && row.keyExpiresAt < ttlExpiresAt
        ? row.keyExpiresAt
        : ttlExpiresAt;
    if (expiresAt <= this.clock.now()) return null;
    const contextDigest = canonicalDigest({
      schema: "publishing-plan-validation-context/v1",
      decisionId: row.decision.id,
      workspaceId: row.decision.workspaceId,
      principalId: row.decision.principalId,
      keyId: row.decision.keyId,
      capability: input.capability,
      authorizationContractDigest:
        row.decision.authorizationContractDigest,
      grantRevisionId: row.decision.grantRevisionId,
      policyRevisionId: row.decision.policyRevisionId,
      resources: [...row.decision.resources].sort((left, right) =>
        `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
      ),
      issuedAt: row.decision.createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    return {
      contextId: `ppvc_${row.decision.id.replaceAll("-", "")}`,
      contextDigest,
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      keyId: input.keyId,
      authorizationEvidenceRef: input.authorizationEvidenceRef,
      capability: input.capability,
      authorizationContractDigest: row.decision.authorizationContractDigest,
      resources: {
        channelIds: [...decisionChannels].sort(),
        artifactIds: [...decisionArtifacts].sort(),
      },
      issuedAt: row.decision.createdAt,
      expiresAt,
    };
  }
}

export class ProductionPublishingPlanRuntimePolicy
  implements PublishingPlanRuntimePolicyPort
{
  readonly identity = PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY;
  readonly contractDigest = publishingPlanRuntimePolicyContractDigest();

  constructor(private readonly budgets: Pick<BudgetService, "getSpendControl">) {}

  async evaluate(
    input: Parameters<PublishingPlanRuntimePolicyPort["evaluate"]>[0],
  ): Promise<PublishingPlanRuntimePolicyDecision> {
    const control = await this.budgets.getSpendControl(input.workspaceId);
    const reasonCodes = control.suspended
      ? ["EMERGENCY_SPEND_SUSPENDED"]
      : [];
    const stateDigest = publishingPlanPolicyStateDigest({
      identity: this.identity,
      contractDigest: this.contractDigest,
      workspaceId: input.workspaceId,
      suspended: control.suspended,
    });
    return {
      allowed: reasonCodes.length === 0,
      reasonCodes,
      stateDigest,
      evidenceDigest: canonicalDigest({
        identity: this.identity,
        contractDigest: this.contractDigest,
        workspaceId: input.workspaceId,
        targetId: input.target.targetId,
        channelId: input.channel.id,
        allowed: reasonCodes.length === 0,
        reasonCodes,
        evaluatedAt: input.evaluatedAt.toISOString(),
      }),
    };
  }
}
