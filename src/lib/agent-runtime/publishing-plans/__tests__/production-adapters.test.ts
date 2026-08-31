import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactServiceError } from "@/lib/agent-runtime/artifacts/errors";
import type { ArtifactService } from "@/lib/agent-runtime/artifacts/service";
import { withLinkedInAuthorKind } from "@/lib/social/linkedin-author-kind";
import {
  publishingPlanAuthorizationContractDigest,
} from "../authorization-contract";

const mocks = vi.hoisted(() => ({
  getSocialAccount: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock("@/lib/social/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/social/repository")>();
  return { ...original, getSocialAccount: mocks.getSocialAccount };
});
vi.mock("@/lib/social/provider-registry", () => ({
  getProvider: mocks.getProvider,
}));
vi.mock("@/lib/social/runtime-bootstrap", () => ({}));

import {
  ArtifactServicePublishingPlanSnapshots,
  DrizzlePublishingPlanValidationContexts,
  ProductionPublishingPlanRuntimePolicy,
  SocialAccountPublishingPlanSnapshots,
} from "../production-adapters";

const NOW = new Date("2026-08-08T12:00:00.000Z");
const clock = { now: () => new Date(NOW) };

function artifactService(
  getArtifact: (...args: unknown[]) => unknown,
): ArtifactService {
  return { getArtifact } as unknown as ArtifactService;
}

function channel(overrides: Record<string, unknown> = {}) {
  return {
    id: "channel_1",
    workspaceId: "workspace_1",
    platform: "linkedin",
    additionalSettings: withLinkedInAuthorKind({}, "person"),
    disabled: false,
    requiresReauth: false,
    tokenExpiresAt: null,
    refreshTokenEncrypted: null,
    updatedAt: NOW,
    accessTokenEncrypted: "must-never-leave-adapter",
    ...overrides,
  };
}

describe("Publishing Plan production adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProvider.mockReturnValue({
      maxImages: 9,
      getCapabilities: () => ({
        identifier: "linkedin",
        maxContentLength: 3_000,
        supportsImages: true,
        supportsVideo: false,
        supportsCarousel: true,
      }),
    });
  });

  it("maps immutable Artifact metadata and text without weakening failures", async () => {
    const adapter = new ArtifactServicePublishingPlanSnapshots(
      artifactService(async () => ({
        artifact: {
          id: "artifact_1",
          workspaceId: "workspace_1",
          digest: `sha256:${"a".repeat(64)}`,
          kind: "text",
          mediaType: "text/plain; charset=utf-8",
          sizeBytes: 5,
          width: null,
          height: null,
          createdAt: NOW.toISOString(),
        },
        textContent: "hello",
      })),
    );
    await expect(
      adapter.getCurrent({ workspaceId: "workspace_1", artifactId: "artifact_1" }),
    ).resolves.toMatchObject({ inlineText: "hello", observedAt: NOW });

    const unavailable = new ArtifactServicePublishingPlanSnapshots(
      artifactService(async () => {
        throw new ArtifactServiceError("ARTIFACT_UNAVAILABLE", "missing");
      }),
    );
    await expect(
      unavailable.getCurrent({ workspaceId: "workspace_1", artifactId: "missing" }),
    ).resolves.toBeNull();

    const broken = new ArtifactServicePublishingPlanSnapshots(
      artifactService(async () => {
        throw new ArtifactServiceError(
          "ARTIFACT_CONTENT_STORE_UNAVAILABLE",
          "store down",
        );
      }),
    );
    await expect(
      broken.getCurrent({ workspaceId: "workspace_1", artifactId: "artifact_1" }),
    ).rejects.toMatchObject({ code: "ARTIFACT_CONTENT_STORE_UNAVAILABLE" });
  });

  it("accepts only active marked LinkedIn Channels and returns no credentials", async () => {
    const adapter = new SocialAccountPublishingPlanSnapshots(clock);
    mocks.getSocialAccount.mockResolvedValue(channel());
    const active = await adapter.getCurrent({
      workspaceId: "workspace_1",
      channelId: "channel_1",
    });
    expect(active).toMatchObject({
      platform: "linkedin",
      authorKind: "person",
      state: "active",
      maxImages: 9,
    });
    expect(active).not.toHaveProperty("accessTokenEncrypted");
    expect(active).not.toHaveProperty("refreshTokenEncrypted");

    mocks.getSocialAccount.mockResolvedValue(
      channel({ disabled: true, requiresReauth: true }),
    );
    await expect(
      adapter.getCurrent({ workspaceId: "workspace_1", channelId: "channel_1" }),
    ).resolves.toMatchObject({ state: "disconnected" });

    mocks.getSocialAccount.mockResolvedValue(
      channel({ additionalSettings: null }),
    );
    await expect(
      adapter.getCurrent({ workspaceId: "workspace_1", channelId: "legacy" }),
    ).resolves.toBeNull();

    mocks.getSocialAccount.mockResolvedValue(channel({ platform: "facebook" }));
    await expect(
      adapter.getCurrent({ workspaceId: "workspace_1", channelId: "facebook" }),
    ).resolves.toBeNull();

    mocks.getSocialAccount.mockResolvedValue(channel());
    mocks.getProvider.mockReturnValue({
      maxImages: 99,
      getCapabilities: () => ({
        identifier: "linkedin",
        maxContentLength: 3_000,
        supportsImages: true,
        supportsVideo: false,
        supportsCarousel: true,
      }),
    });
    await expect(
      adapter.getCurrent({ workspaceId: "workspace_1", channelId: "drifted" }),
    ).resolves.toBeNull();
  });

  it("caps server admission context lifetime by key expiry", async () => {
    const decision = {
      id: "11111111-1111-1111-1111-111111111111",
      workspaceId: "workspace_1",
      principalId: "principal_1",
      keyId: "key_1",
      authorizationContractDigest: publishingPlanAuthorizationContractDigest(
        "publishing_plan_revisions.create@1",
      ),
      grantRevisionId: "grant_revision_1",
      policyRevisionId: "policy_revision_1",
      resources: [
        { kind: "artifact", id: "artifact_1" },
        { kind: "channel", id: "channel_1" },
      ],
      createdAt: NOW,
    };
    const rows: Array<{
      decision: typeof decision;
      keyExpiresAt: Date | null;
      keyRevokedAt: Date | null;
      principalStatus: string;
      principalRevokedAt: Date | null;
    }> = [
      {
        decision,
        keyExpiresAt: new Date(NOW.getTime() + 60_000),
        keyRevokedAt: null,
        principalStatus: "active",
        principalRevokedAt: null,
      },
    ];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "from", "innerJoin", "where"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.limit = vi.fn(async () => rows);
    const adapter = new DrizzlePublishingPlanValidationContexts(
      () => chain as never,
      clock,
    );
    await expect(
      adapter.resolveCurrent({
        workspaceId: "workspace_1",
        principalId: "principal_1",
        keyId: "key_1",
        authorizationEvidenceRef: "otr_11111111111111111111111111111111",
        capability: "publishing_plan_revisions.create@1",
      }),
    ).resolves.toMatchObject({
      contextId: "ppvc_11111111111111111111111111111111",
      expiresAt: new Date(NOW.getTime() + 60_000),
      capability: "publishing_plan_revisions.create@1",
    });

    rows[0]!.keyRevokedAt = NOW;
    await expect(
      adapter.resolveCurrent({
        workspaceId: "workspace_1",
        principalId: "principal_1",
        keyId: "key_1",
        authorizationEvidenceRef: "forged",
        capability: "publishing_plan_revisions.create@1",
      }),
    ).resolves.toBeNull();
  });

  it("fails publishing policy closed during emergency spend suspension", async () => {
    const policy = new ProductionPublishingPlanRuntimePolicy({
      getSpendControl: vi.fn(async () => ({
        workspaceId: "workspace_1",
        suspended: true,
      })),
    });
    await expect(
      policy.evaluate({
        workspaceId: "workspace_1",
        principalId: "principal_1",
        target: { targetId: "target_1" },
        channel: { id: "channel_1" },
        content: {},
        media: [],
        evaluatedAt: NOW,
      } as never),
    ).resolves.toMatchObject({
      allowed: false,
      reasonCodes: ["EMERGENCY_SPEND_SUSPENDED"],
    });
  });

  it("binds context lookup to the exact durable allowed authorization row", () => {
    const source = readFileSync(
      `${process.cwd()}/src/lib/agent-runtime/publishing-plans/production-adapters.ts`,
      "utf8",
    );
    for (const binding of [
      "agentAuthorizationDecisions.workspaceId",
      "agentAuthorizationDecisions.principalId",
      "agentAuthorizationDecisions.keyId",
      "agentAuthorizationDecisions.operatorTraceRef",
      "agentAuthorizationDecisions.capabilityName",
      "agentAuthorizationDecisions.capabilityVersion",
      "agentAuthorizationDecisions.authorizationContractDigest",
      'agentAuthorizationDecisions.outcome, "allowed"',
      'row.principalStatus !== "active"',
      "row.keyRevokedAt",
    ]) {
      expect(source).toContain(binding);
    }
  });
});
