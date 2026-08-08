import { and, eq } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { addDecimals } from "@/lib/agent-runtime/usage/decimal";
import { PRODUCTION_USAGE_SERVICE } from "@/lib/agent-runtime/usage/production";
import type { UsageLedgerService } from "@/lib/agent-runtime/usage/service";
import { getDb } from "@/lib/db";
import { socialAccounts } from "@/lib/db/schema";
import { readLinkedInAuthorKind } from "@/lib/social/linkedin-author-kind";
import {
  PRODUCTION_PUBLISHING_APPROVAL_AUDIT_ARTIFACTS,
  type PublishingApprovalAuditArtifactStore,
} from "./audit-artifacts";
import type {
  PublishingApprovalPresentationPort,
  PublishingApprovalPresentationTarget,
} from "./types";
import { PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY } from "../publishing-plans/production-digests";

const TEXT_MEDIA_TYPE = "text/plain; charset=utf-8" as const;
const IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);
const COST_USAGE_RECORD_LIMIT = 50;
const MAX_COST_ARTIFACTS_PER_PRESENTATION = 20;
const MAX_COST_SETTLEMENTS_PER_PRESENTATION = 100;

interface SafeChannelPresentation {
  id: string;
  platform: string;
  displayName: string;
  authorKind: "person" | "organization" | null;
}

export interface PublishingApprovalPresentationDependencies {
  artifacts: Pick<
    PublishingApprovalAuditArtifactStore,
    "getRetainedArtifact"
  >;
  usage: Pick<UsageLedgerService, "listUsageRecords" | "getCurrentValuation">;
  getChannel(input: {
    workspaceId: string;
    channelId: string;
  }): Promise<SafeChannelPresentation | null>;
}

async function getSafeChannel(input: {
  workspaceId: string;
  channelId: string;
}): Promise<SafeChannelPresentation | null> {
  const [row] = await getDb()
    .select({
      id: socialAccounts.id,
      platform: socialAccounts.platform,
      displayName: socialAccounts.displayName,
      additionalSettings: socialAccounts.additionalSettings,
    })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.workspaceId, input.workspaceId),
        eq(socialAccounts.id, input.channelId),
      ),
    )
    .limit(1);
  return row
    ? {
        id: row.id,
        platform: row.platform,
        displayName: row.displayName,
        authorKind: readLinkedInAuthorKind(row.additionalSettings),
      }
    : null;
}

function internalMediaPreviewUrl(
  approvalRequestId: string,
  artifactId: string,
): string {
  return `/api/studio/publishing-approvals/${encodeURIComponent(approvalRequestId)}/media/${encodeURIComponent(artifactId)}`;
}

function requiredTarget<T>(value: T | undefined): T {
  if (!value) throw new Error("Publishing Approval presentation is unavailable.");
  return value;
}

function latestIso(values: Date[]): string {
  return new Date(Math.max(...values.map((value) => value.getTime()))).toISOString();
}

export class ProductionPublishingApprovalPresentation
  implements PublishingApprovalPresentationPort
{
  constructor(
    private readonly dependencies: PublishingApprovalPresentationDependencies = {
      artifacts: PRODUCTION_PUBLISHING_APPROVAL_AUDIT_ARTIFACTS,
      usage: PRODUCTION_USAGE_SERVICE,
      getChannel: getSafeChannel,
    },
  ) {}

  private async costContexts(
    workspaceId: string,
    targets: Array<{ targetId: string; artifactIds: string[] }>,
  ): Promise<
    Map<string, PublishingApprovalPresentationTarget["costContext"]>
  > {
    const unknown = new Map(targets.map((target) => [target.targetId, null]));
    const artifactIds = [
      ...new Set(targets.flatMap((target) => target.artifactIds)),
    ];
    if (artifactIds.length > MAX_COST_ARTIFACTS_PER_PRESENTATION) {
      return unknown;
    }
    try {
      const recordPages = await Promise.all(
        artifactIds.map((artifactId) =>
          this.dependencies.usage.listUsageRecords(workspaceId, {
            artifactId,
            limit: COST_USAGE_RECORD_LIMIT,
          }),
        ),
      );
      // A truncated ledger query is unknown cost, never an understated total.
      if (
        recordPages.some(
          (records) => records.length >= COST_USAGE_RECORD_LIMIT,
        )
      ) {
        return unknown;
      }
      const recordsByArtifact = new Map(
        artifactIds.map((artifactId, index) => [
          artifactId,
          recordPages[index] ?? [],
        ]),
      );
      const settlementIds = [
        ...new Set(recordPages.flatMap((records) => records.map((record) => record.settlementId))),
      ];
      if (
        settlementIds.length === 0 ||
        settlementIds.length > MAX_COST_SETTLEMENTS_PER_PRESENTATION
      ) {
        return unknown;
      }
      const valuations = (
        await Promise.all(
          settlementIds.map((settlementId) =>
            this.dependencies.usage.getCurrentValuation(
              workspaceId,
              settlementId,
            ),
          ),
        )
      ).filter((value) => value !== null);
      if (
        valuations.length !== settlementIds.length ||
        valuations.some(
          (valuation) =>
            valuation.amount === null || valuation.currency !== "USD",
        )
      ) {
        return unknown;
      }
      const valuationBySettlement = new Map(
        settlementIds.map((settlementId, index) => [
          settlementId,
          valuations[index]!,
        ]),
      );
      return new Map(
        targets.map((target) => {
          const targetSettlementIds = [
            ...new Set(
              target.artifactIds.flatMap((artifactId) =>
                (recordsByArtifact.get(artifactId) ?? []).map(
                  (record) => record.settlementId,
                ),
              ),
            ),
          ];
          const targetValuations = targetSettlementIds.map((settlementId) =>
            valuationBySettlement.get(settlementId),
          );
          if (
            targetValuations.length === 0 ||
            targetValuations.some((valuation) => !valuation)
          ) {
            return [target.targetId, null];
          }
          const presentValuations = targetValuations.filter(
            (valuation) => valuation !== undefined,
          );
          const pricingSnapshotIds = [
            ...new Set(
              presentValuations.flatMap(
                (valuation) => valuation.pricingSnapshotIds,
              ),
            ),
          ].sort();
          if (
            pricingSnapshotIds.length > 200 ||
            pricingSnapshotIds.some(
              (id) =>
                id.length < 1 ||
                id.length > 200 ||
                /[\u0000-\u001f\u007f]/.test(id),
            )
          ) {
            return [target.targetId, null];
          }
          return [
            target.targetId,
            {
              authoritative: false,
              currency: "USD",
              estimatedAmount: presentValuations.reduce(
                (total, valuation) => addDecimals(total, valuation.amount!),
                "0",
              ),
              pricingSnapshotIds,
              computedAt: latestIso(
                presentValuations.map((valuation) => valuation.recordedAt),
              ),
            },
          ];
        }),
      );
    } catch {
      return unknown;
    }
  }

  async present(
    input: Parameters<PublishingApprovalPresentationPort["present"]>[0],
  ): Promise<PublishingApprovalPresentationTarget[]> {
    const selected = new Set(input.approval.targetIds);
    const validationEvidenceDigest = canonicalDigest(
      input.revision.validationEvidence,
    );
    const validation = input.revision.validationEvidence;
    const targets = input.revision.definition.targets.filter((target) =>
      selected.has(target.targetId),
    );
    if (
      targets.length !== input.approval.targetIds.length ||
      input.revision.id !== input.approval.planRevisionId ||
      input.revision.definitionDigest !== input.approval.planRevisionDigest ||
      validationEvidenceDigest !== input.approval.validation.evidenceDigest ||
      validation.currentStateDigest !==
        input.approval.validation.currentStateDigest ||
      validation.evaluatedAt !== input.approval.validation.evaluatedAt ||
      validation.context.expiresAt !== input.approval.validation.expiresAt ||
      validation.runtimePolicy.identity !==
        input.approval.validation.runtimePolicyIdentity ||
      validation.runtimePolicy.identity !==
        PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY ||
      validation.runtimePolicy.contractDigest !==
        input.approval.validation.runtimePolicyContractDigest
    ) {
      throw new Error("Publishing Approval presentation is unavailable.");
    }
    const costContexts = await this.costContexts(
      input.approval.workspaceId,
      targets.map((target) => ({
        targetId: target.targetId,
        artifactIds: [
          target.contentArtifactId,
          ...target.mediaArtifactIds,
        ],
      })),
    );

    return Promise.all(
      targets.map(async (target) => {
        const settingsType = target.settings.type;
        if (settingsType !== "person" && settingsType !== "organization") {
          throw new Error("Publishing Approval presentation is unavailable.");
        }
        const evidence = requiredTarget(
          input.revision.validationEvidence.targets.find(
            (candidate) => candidate.targetId === target.targetId,
          ),
        );
        const expectedArtifactIds = [
          target.contentArtifactId,
          ...target.mediaArtifactIds,
        ];
        if (
          evidence.targetId !== target.targetId ||
          evidence.channel.id !== target.channelId ||
          evidence.channel.platform !== "linkedin" ||
          evidence.settingsDigest !== canonicalDigest(target.settings) ||
          evidence.publishAt !== target.timing.publishAt ||
          evidence.blockerCodes.length !== 0 ||
          evidence.artifacts.length !== expectedArtifactIds.length ||
          evidence.artifacts.some(
            (artifact, index) => artifact.id !== expectedArtifactIds[index],
          )
        ) {
          throw new Error("Publishing Approval presentation is unavailable.");
        }
        const contentEvidence = evidence.artifacts[0]!;
        const mediaEvidence = evidence.artifacts.slice(1);
        const [channel, content, media] = await Promise.all([
          this.dependencies.getChannel({
            workspaceId: input.approval.workspaceId,
            channelId: target.channelId,
          }),
          this.dependencies.artifacts.getRetainedArtifact({
            workspaceId: input.approval.workspaceId,
            evidence: contentEvidence,
          }),
          Promise.all(
            mediaEvidence.map((artifact) =>
              this.dependencies.artifacts.getRetainedArtifact({
                workspaceId: input.approval.workspaceId,
                evidence: artifact,
              }),
            ),
          ),
        ]);
        const costContext = costContexts.get(target.targetId) ?? null;
        const matchingChannel =
          channel?.platform === "linkedin" &&
          channel.authorKind === evidence.channel.authorKind &&
          channel.id === evidence.channel.id &&
          channel.displayName.trim().length > 0 &&
          channel.displayName.length <= 200
            ? channel
            : null;
        if (
          evidence.channel.authorKind !== settingsType ||
          !content ||
          content.kind !== "text" ||
          content.mediaType !== TEXT_MEDIA_TYPE ||
          content.textContent === null ||
          content.digest !== contentEvidence.digest ||
          content.sizeBytes !== contentEvidence.sizeBytes ||
          content.textContent.length > 3_000 ||
          media.length > 9 ||
          media.some((artifact) => artifact === null)
        ) {
          throw new Error("Publishing Approval presentation is unavailable.");
        }
        const mediaPresentation = media.map((artifact, index) => {
          const artifactId = target.mediaArtifactIds[index]!;
          const artifactEvidence = mediaEvidence[index]!;
          if (
            !artifact ||
            artifactEvidence.id !== artifactId ||
            artifact.kind !== "image" ||
            !IMAGE_MEDIA_TYPES.has(artifact.mediaType) ||
            artifact.digest !== artifactEvidence.digest ||
            artifact.sizeBytes !== artifactEvidence.sizeBytes
          ) {
            throw new Error("Publishing Approval presentation is unavailable.");
          }
          return {
            artifactId,
            digest: artifactEvidence.digest,
            mediaType: artifactEvidence.mediaType as
              | "image/jpeg"
              | "image/png"
              | "image/gif",
            previewUrl: internalMediaPreviewUrl(input.approval.id, artifactId),
          };
        });
        return {
          targetId: target.targetId,
          channel: {
            id: evidence.channel.id,
            platform: "linkedin",
            authorKind: evidence.channel.authorKind,
            displayName: matchingChannel?.displayName ?? null,
            historical: matchingChannel === null,
          },
          content: {
            artifactId: target.contentArtifactId,
            digest: contentEvidence.digest,
            mediaType: TEXT_MEDIA_TYPE,
            text: content.textContent,
          },
          media: mediaPresentation,
          settings: { type: settingsType },
          timing: { ...target.timing },
          targetEvidenceDigest: canonicalDigest(evidence),
          validation: {
            evaluatedAt: validation.evaluatedAt,
            expiresAt: validation.context.expiresAt,
            channelSnapshot: {
              id: evidence.channel.id,
              platform: "linkedin",
              authorKind: evidence.channel.authorKind,
              snapshotDigest: evidence.channel.snapshotDigest,
              capabilityVersion: evidence.channel.capabilityVersion,
            },
            artifacts: {
              content: {
                ...contentEvidence!,
                kind: "text",
                mediaType: TEXT_MEDIA_TYPE,
              },
              media: mediaPresentation.map((presentedMedia) => {
                const artifactEvidence = requiredTarget(
                  evidence.artifacts.find(
                    (artifact) => artifact.id === presentedMedia.artifactId,
                  ),
                );
                return {
                  ...artifactEvidence,
                  kind: "image" as const,
                  mediaType: presentedMedia.mediaType,
                };
              }),
            },
            settingsDigest: evidence.settingsDigest,
            publishAt: evidence.publishAt,
            policy: {
              identity: PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
              contractDigest: validation.runtimePolicy.contractDigest,
              evidenceDigest: evidence.policyEvidenceDigest,
              stateDigest: evidence.policyStateDigest,
              outcome: "allowed",
              blockerCodes: [],
            },
          },
          costContext,
        };
      }),
    );
  }
}
