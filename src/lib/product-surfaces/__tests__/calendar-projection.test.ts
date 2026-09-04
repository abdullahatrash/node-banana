import { describe, expect, it } from "vitest";
import type { PublishingPlanRevisionRecord } from "@/lib/agent-runtime/publishing-plans/types";
import { projectCalendar, type LegacyCalendarItem } from "../calendar-projection";

const digest = `sha256:${"a".repeat(64)}`;
function revision(number: number, publishAt: string): PublishingPlanRevisionRecord {
  return {
    id: `revision_${number}`,
    workspaceId: "workspace_1",
    planId: "plan_1",
    revision: number,
    definitionDigest: digest,
    definition: {
      schema: "publishing-plan-revision-definition/v1",
      planId: "plan_1",
      channelIds: ["channel_1"],
      artifactIds: ["artifact_text"],
      targets: [{
        targetId: "target_1",
        channelId: "channel_1",
        contentArtifactId: "artifact_text",
        mediaArtifactIds: [],
        settings: { type: "person" },
        timing: { kind: "scheduled", publishAt },
      }],
    },
    validationEvidence: {
      targets: [{ targetId: "target_1", artifacts: [{ id: "artifact_text", digest }] }],
    } as PublishingPlanRevisionRecord["validationEvidence"],
    authorPrincipalId: "principal_1",
    authorKeyId: "key_1",
    creationAuthorizationEvidenceRef: "evidence_1",
    createdAt: new Date(`2026-09-0${number}T08:00:00.000Z`),
  };
}

function legacy(overrides: Partial<LegacyCalendarItem> = {}): LegacyCalendarItem {
  return {
    id: "post_1",
    workspaceId: "workspace_1",
    socialAccountId: "channel_1",
    status: "queued",
    content: "Legacy body",
    mediaUrls: null,
    stableMediaRefs: [],
    platformSettings: null,
    scheduledAt: "2026-09-05T10:00:00.000Z",
    publishedAt: null,
    platformPostId: null,
    platformPostUrl: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    governedPlanId: "plan_1",
    governedTargetId: "target_1",
    ...overrides,
  };
}

describe("canonical calendar projection", () => {
  const range = { start: "2026-09-01T00:00:00.000Z", end: "2026-09-30T23:59:59.999Z" };

  it("uses the current Plan target and joins its latest Approval and Delivery", () => {
    const items = projectCalendar({
      workspaceId: "workspace_1",
      range,
      currentRevisions: [revision(4, "2026-09-08T10:00:00.000Z")],
      approvals: [
        { id: "approval_old", planId: "plan_1", planRevisionId: "revision_4", targetIds: ["target_1"], status: "pending", createdAt: "2026-09-04T08:00:00.000Z" },
        { id: "approval_new", planId: "plan_1", planRevisionId: "revision_4", targetIds: ["target_1"], status: "consumed", createdAt: "2026-09-04T09:00:00.000Z" },
      ],
      deliveries: [{ id: "delivery_1", planId: "plan_1", planRevisionId: "revision_4", targetId: "target_1", state: "dispatching", publishAt: "2026-09-08T10:00:00.000Z", completedAt: null, updatedAt: "2026-09-04T10:00:00.000Z" }],
      textByArtifactId: new Map([["artifact_text", "Canonical body"]]),
      legacyItems: [legacy()],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "canonical:plan_1:target_1",
      scheduledAt: "2026-09-08T10:00:00.000Z",
      content: "Canonical body",
      status: "publishing",
      authority: {
        kind: "canonical",
        approvalStatus: "consumed",
        deliveryState: "dispatching",
        binding: { revisionId: "revision_4", revision: 4, revisionDigest: digest },
      },
    });
  });

  it("keeps the stable calendar identity but advances the binding after refetch, enabling another reschedule", () => {
    const base = {
      workspaceId: "workspace_1",
      range,
      approvals: [],
      deliveries: [],
      textByArtifactId: new Map([["artifact_text", "Canonical body"]]),
      legacyItems: [legacy()],
    };
    const before = projectCalendar({ ...base, currentRevisions: [revision(4, "2026-09-08T10:00:00.000Z")] });
    const after = projectCalendar({ ...base, currentRevisions: [revision(5, "2026-09-10T12:00:00.000Z")] });

    expect(before[0]?.id).toBe(after[0]?.id);
    expect(after[0]).toMatchObject({
      scheduledAt: "2026-09-10T12:00:00.000Z",
      authority: { kind: "canonical", binding: { revisionId: "revision_5", revision: 5 } },
    });
  });

  it("retains ungoverned posts as explicitly marked compatibility rows", () => {
    const items = projectCalendar({
      workspaceId: "workspace_1",
      range,
      currentRevisions: [],
      approvals: [],
      deliveries: [],
      textByArtifactId: new Map(),
      legacyItems: [legacy({ governedPlanId: null, governedTargetId: null })],
    });
    expect(items).toEqual([expect.objectContaining({ id: "post_1", authority: { kind: "legacy_compatibility" } })]);
  });

  it("fails closed instead of reviving legacy authority when a canonical Plan head cannot be projected", () => {
    const items = projectCalendar({
      workspaceId: "workspace_1",
      range,
      currentRevisions: [],
      canonicalPlanIds: ["plan_1"],
      approvals: [],
      deliveries: [],
      textByArtifactId: new Map(),
      legacyItems: [legacy()],
    });
    expect(items).toEqual([]);
  });
});
