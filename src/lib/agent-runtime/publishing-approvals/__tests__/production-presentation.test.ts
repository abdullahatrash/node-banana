import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { UsageLedgerService } from "@/lib/agent-runtime/usage/service";
import type { PublishingPlanRevisionRecord } from "../../publishing-plans/types";
import type { RetainedPublishingApprovalArtifact } from "../audit-artifacts";
import { ProductionPublishingApprovalPresentation } from "../production-presentation";
import type { PublishingApprovalRequestRecord } from "../types";

const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE_DIGEST = `sha256:${"b".repeat(64)}`;
const SETTINGS_DIGEST = canonicalDigest({ type: "organization" });
const NOW = new Date("2026-08-08T12:00:00.000Z");

function artifact(
  kind: "text" | "image",
  digest: string,
  mediaType: string,
  textContent: string | null,
): RetainedPublishingApprovalArtifact {
  return {
    kind,
    digest,
    sizeBytes: 42,
    mediaType,
    textContent,
  };
}

const revision = {
  id: "ppr_revision_1",
  workspaceId: "workspace_1",
  planId: "plan_1",
  revision: 1,
  definitionDigest: DIGEST,
  definition: {
    schema: "publishing-plan-revision-definition/v1",
    planId: "plan_1",
    channelIds: ["channel_1"],
    artifactIds: ["text_1", "image_1"],
    targets: [
      {
        targetId: "target_1",
        channelId: "channel_1",
        contentArtifactId: "text_1",
        mediaArtifactIds: ["image_1"],
        settings: { type: "organization" },
        timing: { kind: "scheduled", publishAt: "2026-08-08T12:30:00.000Z" },
      },
    ],
  },
  validationEvidence: {
    schema: "publishing-plan-validation-evidence/v1",
    submittedDraftDigest: DIGEST,
    definitionDigest: DIGEST,
    currentStateDigest: DIGEST,
    evaluatedAt: NOW.toISOString(),
    context: {
      contextId: "context_1",
      contextDigest: DIGEST,
      issuedAt: NOW.toISOString(),
      expiresAt: "2026-08-08T13:00:00.000Z",
      capability: "publishing_plan_revisions.create@1",
      keyId: "key_1",
      authorizationEvidenceRef: "otr_safe",
      authorizationContractDigest: DIGEST,
      resources: {
        channelIds: ["channel_1"],
        artifactIds: ["image_1", "text_1"],
      },
    },
    runtimePolicy: {
      identity: "publishing-runtime-policy/default@1",
      contractDigest: DIGEST,
    },
    targets: [
      {
        targetId: "target_1",
        channel: {
          id: "channel_1",
          platform: "linkedin",
          authorKind: "organization",
          snapshotDigest: DIGEST,
          capabilityVersion: "linkedin@1",
        },
        artifacts: [
          { id: "text_1", digest: DIGEST, snapshotDigest: DIGEST, kind: "text", mediaType: "text/plain; charset=utf-8", sizeBytes: 42 },
          { id: "image_1", digest: IMAGE_DIGEST, snapshotDigest: IMAGE_DIGEST, kind: "image", mediaType: "image/png", sizeBytes: 42 },
        ],
        settingsDigest: SETTINGS_DIGEST,
        publishAt: "2026-08-08T12:30:00.000Z",
        policyEvidenceDigest: DIGEST,
        policyStateDigest: DIGEST,
        blockerCodes: [],
      },
    ],
    authorizesExecution: false,
  },
  authorPrincipalId: "principal_1",
  authorKeyId: "key_1",
  creationAuthorizationEvidenceRef: "otr_safe",
  createdAt: NOW,
} satisfies PublishingPlanRevisionRecord;

const approval = {
  id: "par_request_1",
  workspaceId: "workspace_1",
  planId: "plan_1",
  planRevisionId: revision.id,
  planRevision: 1,
  planRevisionDigest: DIGEST,
  action: "publish",
  targetIds: ["target_1"],
  channelIds: ["channel_1"],
  artifactIds: ["image_1", "text_1"],
  requestingPrincipalId: "principal_1",
  requestingKeyId: "key_1",
  requestAuthorization: {
    capability: "publishing_approvals.request@1",
    contractDigest: DIGEST,
    evidenceRef: "otr_safe",
    resources: { channelIds: ["channel_1"], artifactIds: ["image_1", "text_1"] },
  },
  validation: {
    evidenceDigest: canonicalDigest(revision.validationEvidence),
    currentStateDigest: DIGEST,
    contextId: "context_1",
    contextDigest: DIGEST,
    evaluatedAt: NOW.toISOString(),
    expiresAt: "2026-08-08T13:00:00.000Z",
    runtimePolicyIdentity: "publishing-runtime-policy/default@1",
    runtimePolicyContractDigest: DIGEST,
  },
  decisionPolicy: { mode: "expires_at", expiresAt: new Date("2026-08-08T13:00:00.000Z") },
  createdAt: NOW,
  decision: null,
  consumption: null,
  authorizesExecution: false,
} satisfies PublishingApprovalRequestRecord;

function dependencies() {
  const getRetainedArtifact = vi.fn(
    async (input: { evidence: { id: string } }) =>
      input.evidence.id === "text_1"
        ? artifact("text", DIGEST, "text/plain; charset=utf-8", "Exact copy")
        : artifact("image", IMAGE_DIGEST, "image/png", null),
  );
  const getChannel = vi.fn(
    async (): Promise<{
      id: string;
      platform: string;
      displayName: string;
      authorKind: "person" | "organization" | null;
    } | null> => ({
      id: "channel_1",
      platform: "linkedin",
      displayName: "Node Banana, Inc.",
      authorKind: "organization",
    }),
  );
  return {
    artifacts: { getRetainedArtifact },
    usage: {
      listUsageRecords: vi.fn(async () => [
        { settlementId: "settlement_1" },
      ]),
      getCurrentValuation: vi.fn(async () => ({
        amount: "0.42",
        currency: "USD",
        pricingSnapshotIds: ["pricing_1"],
        recordedAt: NOW,
      })),
    } as unknown as Pick<
      UsageLedgerService,
      "listUsageRecords" | "getCurrentValuation"
    >,
    getChannel,
  };
}

describe("ProductionPublishingApprovalPresentation", () => {
  it("builds a closed exact presentation with only an internal media URL", async () => {
    const adapter = new ProductionPublishingApprovalPresentation(dependencies());
    const [target] = await adapter.present({
      approval,
      revision,
      actorUserId: "human_1",
      presentedAt: NOW,
    });

    expect(target).toMatchObject({
      targetId: "target_1",
      channel: {
        id: "channel_1",
        authorKind: "organization",
        historical: false,
      },
      content: { text: "Exact copy", digest: DIGEST },
      settings: { type: "organization" },
      costContext: {
        authoritative: false,
        estimatedAmount: "0.42",
        currency: "USD",
      },
      media: [
        {
          artifactId: "image_1",
          previewUrl:
            "/api/studio/publishing-approvals/par_request_1/media/image_1",
        },
      ],
      validation: {
        evaluatedAt: "2026-08-08T12:00:00.000Z",
        expiresAt: "2026-08-08T13:00:00.000Z",
        channelSnapshot: {
          id: "channel_1",
          platform: "linkedin",
          authorKind: "organization",
          snapshotDigest: DIGEST,
          capabilityVersion: "linkedin@1",
        },
        artifacts: {
          content: {
            id: "text_1",
            digest: DIGEST,
            kind: "text",
            sizeBytes: 42,
          },
          media: [
            {
              id: "image_1",
              digest: IMAGE_DIGEST,
              kind: "image",
              sizeBytes: 42,
            },
          ],
        },
        settingsDigest: SETTINGS_DIGEST,
        publishAt: "2026-08-08T12:30:00.000Z",
        policy: {
          identity: "publishing-runtime-policy/default@1",
          contractDigest: DIGEST,
          evidenceDigest: DIGEST,
          stateDigest: DIGEST,
          outcome: "allowed",
          blockerCodes: [],
        },
      },
    });
    expect(JSON.stringify(target)).not.toMatch(
      /accessToken|refreshToken|storageKey|downloadUrl|providerOperationRef|authorizationEvidenceRef|keyId/,
    );
  });

  it("keeps the immutable audit view when the Channel was hard-deleted", async () => {
    const values = dependencies();
    values.getChannel.mockResolvedValue(null);
    const adapter = new ProductionPublishingApprovalPresentation(values);

    const [target] = await adapter.present({
      approval,
      revision,
      actorUserId: "human_1",
      presentedAt: NOW,
    });

    expect(target?.channel).toEqual({
      id: "channel_1",
      platform: "linkedin",
      authorKind: "organization",
      displayName: null,
      historical: true,
    });
  });

  it("uses retained immutable content when the live Artifact was soft-deleted", async () => {
    const values = dependencies();
    const adapter = new ProductionPublishingApprovalPresentation(values);

    const [target] = await adapter.present({
      approval,
      revision,
      actorUserId: "human_1",
      presentedAt: NOW,
    });

    expect(target?.content.text).toBe("Exact copy");
    expect(values.artifacts.getRetainedArtifact).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      evidence: revision.validationEvidence.targets[0]!.artifacts[0],
    });
  });

  it("bounds cost evidence fan-out across the whole presentation", async () => {
    const values = dependencies();
    const adapter = new ProductionPublishingApprovalPresentation(values);
    const loadCostContexts = (
      adapter as unknown as {
        costContexts(
          workspaceId: string,
          targets: Array<{ targetId: string; artifactIds: string[] }>,
        ): Promise<Map<string, unknown>>;
      }
    ).costContexts.bind(adapter);

    const tooManyArtifacts = await loadCostContexts("workspace_1", [
      {
        targetId: "target_large",
        artifactIds: Array.from({ length: 21 }, (_, index) => `artifact_${index}`),
      },
    ]);
    expect(tooManyArtifacts.get("target_large")).toBeNull();
    expect(values.usage.listUsageRecords).not.toHaveBeenCalled();

    vi.mocked(values.usage.listUsageRecords).mockImplementation(
      async (_workspaceId, filters) =>
        Array.from({ length: 40 }, (_, index) => ({
          settlementId: `${filters?.artifactId}_settlement_${index}`,
        })) as never,
    );
    const tooManySettlements = await loadCostContexts("workspace_1", [
      {
        targetId: "target_many_settlements",
        artifactIds: ["artifact_a", "artifact_b", "artifact_c"],
      },
    ]);
    expect(tooManySettlements.get("target_many_settlements")).toBeNull();
    expect(values.usage.listUsageRecords).toHaveBeenCalledTimes(3);
    expect(values.usage.getCurrentValuation).not.toHaveBeenCalled();
  });

  it("selects only secret-safe Channel columns", () => {
    const source = readFileSync(
      `${process.cwd()}/src/lib/agent-runtime/publishing-approvals/production-presentation.ts`,
      "utf8",
    );
    expect(source).toContain("displayName: socialAccounts.displayName");
    expect(source).not.toContain("socialAccounts.accessTokenEncrypted");
    expect(source).not.toContain("socialAccounts.refreshTokenEncrypted");
    expect(source).not.toContain("socialAccounts.accessTokenSecret");
    expect(source).not.toContain("PRODUCTION_ARTIFACT_SERVICE");
  });
});
