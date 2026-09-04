import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { assets, socialPosts, workspaceContentPerformanceObservations } from "@/lib/db/schema";
import { rightsEvidenceDigest } from "@/lib/model-routing/rights-evidence";
import type { InspirationRightsSnapshot } from "@/lib/model-routing/types";
import { workspaceOwnedCandidateFromRecords } from "../workspace-owned-trend-adapter";

const digest = (character: string) => `sha256:${character.repeat(64)}` as `sha256:${string}`;
const publishedAt = new Date("2026-09-04T10:00:00.000Z");
const observedAt = new Date("2026-09-04T12:00:00.000Z");
const requestedAt = new Date("2026-09-04T12:05:00.000Z");
const unsignedEvidence = {
  schema: "inspiration-rights-evidence/v1" as const, id: "evidence-1", workspaceId: "workspace-1", sourceAssetId: "asset-1", sourceDigest: digest("a"),
  basis: "owned" as const, permittedRemix: "transform" as const, issuer: { type: "workspace_asset_owner" as const, id: "user-1" }, verifier: { type: "workspace_member" as const, userId: "user-1" },
  scope: { commercialUse: true, derivativeUse: true, modelInputUse: true, territories: ["worldwide"] }, evidenceDocumentAssetId: null, sourceUrl: null,
  issuedAt: new Date("2026-09-01T00:00:00.000Z"), verifiedAt: new Date("2026-09-03T00:00:00.000Z"), expiresAt: null,
};
const evidence = { ...unsignedEvidence, digest: rightsEvidenceDigest(unsignedEvidence) };
const rights: InspirationRightsSnapshot = {
  schema: "inspiration-rights-snapshot/v1", id: "rights-1", workspaceId: "workspace-1", revision: 1, basis: "owned", permittedRemix: "transform",
  evidence: [evidence], sourceAssetIds: ["asset-1"], digest: digest("b"), createdByUserId: "user-1", createdAt: new Date("2026-09-03T01:00:00.000Z"),
};
const observation: typeof workspaceContentPerformanceObservations.$inferSelect = {
  workspaceId: "workspace-1", id: "observation-1", postId: "post-1", sourceAssetId: "asset-1", rightsSnapshotId: "rights-1", rightsSnapshotRevision: 1, rightsSnapshotDigest: digest("b"),
  sourceKind: "workspace_attested", sourceRef: "workspace-dashboard", sourceDigest: digest("c"), views: 12_000, likes: 900, comments: 40,
  region: "GCC", contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo", tags: ["launch"], observedAt, capturedAt: requestedAt,
  createdByUserId: "user-1", idempotencyKey: "observation-key", requestDigest: digest("d"),
};
const post: typeof socialPosts.$inferSelect = {
  id: "post-1", workspaceId: "workspace-1", socialAccountId: "account-1", status: "published", rootPostId: null, dispatchStatus: "dispatched", dispatchAttempts: 1, workflowRunRef: null,
  nextDispatchAt: null, lastDispatchError: null, lockedAt: null, kind: "post", delaySeconds: null, position: null, sourceTemplatePostId: null, triggerSource: null,
  content: "أفضل طريقة لإطلاق منتجك", mediaUrls: null, stableMediaRefs: [{ resourceKind: "studio_asset", assetId: "asset-1", assetDigest: digest("a"), order: 0 }],
  platformSettings: null, scheduledAt: null, publishedAt, platformPostId: "platform-1", platformPostUrl: "https://social.example/posts/1", errorMessage: null, retryCount: 0,
  parentPostId: null, studioAssetId: "asset-1", createdByUserId: "user-1", createdAt: publishedAt, updatedAt: publishedAt,
};
const asset: Pick<typeof assets.$inferSelect, "id" | "type" | "checksum" | "metadata"> = { id: "asset-1", type: "video", checksum: digest("a"), metadata: { uploadState: "ready" } };
const account = { id: "account-1", displayName: "علامتنا", platform: "instagram" as const };

describe("Workspace-owned winning-content adapter", () => {
  it("maps only a rights-cleared published video and keeps its real metrics", () => {
    const candidate = workspaceOwnedCandidateFromRecords({ workspaceId: "workspace-1", observation, post, asset, account, rights, requestedAt });
    expect(candidate).toMatchObject({
      externalItemId: "post-1", title: "أفضل طريقة لإطلاق منتجك", sourceUrl: "https://social.example/posts/1",
      metrics: { views: 12_000, likes: 900, comments: 40 }, contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo",
      observationProvenance: { kind: "workspace_attested", ref: "workspace-dashboard", digest: digest("c") },
      rights: { status: "user_submitted", sourceAssetId: "asset-1", permittedInfluence: ["topic", "hook", "pacing", "structure"] },
    });
    expect(candidate?.sourceContentDigest).toBe(canonicalDigest({ schema: "workspace-published-content/v1", postId: post.id, content: post.content, platformPostUrl: post.platformPostUrl, assetId: asset.id, assetDigest: asset.checksum }));
  });

  it("limits reference-only content to topic influence", () => {
    const referenceOnlyEvidence = { ...unsignedEvidence, permittedRemix: "reference_only" as const };
    const value = workspaceOwnedCandidateFromRecords({ workspaceId: "workspace-1", observation, post, asset, account, rights: { ...rights, permittedRemix: "reference_only", evidence: [{ ...referenceOnlyEvidence, digest: rightsEvidenceDigest(referenceOnlyEvidence) }] }, requestedAt });
    expect(value?.rights.permittedInfluence).toEqual(["topic"]);
  });

  it("rejects unowned rights, mismatched media, and observations before publication", () => {
    expect(workspaceOwnedCandidateFromRecords({ workspaceId: "workspace-1", observation, post, asset, account, rights: { ...rights, basis: "licensed" }, requestedAt })).toBeNull();
    expect(workspaceOwnedCandidateFromRecords({ workspaceId: "workspace-1", observation, post: { ...post, stableMediaRefs: [{ resourceKind: "studio_asset", assetId: "asset-1", assetDigest: digest("f"), order: 0 }] }, asset, account, rights, requestedAt })).toBeNull();
    expect(workspaceOwnedCandidateFromRecords({ workspaceId: "workspace-1", observation: { ...observation, observedAt: new Date("2026-09-04T09:00:00.000Z") }, post, asset, account, rights, requestedAt })).toBeNull();
  });
});
