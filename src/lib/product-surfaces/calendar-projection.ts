import type { PublishingApprovalStatus } from "@/lib/agent-runtime/publishing-approvals/types";
import type { PublishingDeliveryState } from "@/lib/agent-runtime/publishing-deliveries/types";
import type { PublishingPlanRevisionRecord } from "@/lib/agent-runtime/publishing-plans/types";
import type { SocialPostStatus } from "@/lib/db/schema";

export interface CanonicalCalendarBinding {
  schema: "canonical-calendar-binding/v1";
  planId: string;
  revisionId: string;
  revision: number;
  revisionDigest: string;
  targetId: string;
}

export interface CalendarItem {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  status: SocialPostStatus;
  content: string | null;
  mediaUrls: Array<{ type: string; url: string; alt?: string }> | null;
  stableMediaRefs: Array<{
    resourceKind?: "studio_asset" | "artifact";
    assetId: string;
    assetDigest: string;
    order: number;
    alt?: string;
  }>;
  platformSettings: Record<string, unknown> | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  platformPostId: string | null;
  platformPostUrl: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  authority:
    | {
        kind: "canonical";
        binding: CanonicalCalendarBinding;
        approvalStatus: PublishingApprovalStatus | null;
        deliveryState: PublishingDeliveryState | null;
      }
    | { kind: "legacy_compatibility" };
}

export interface CalendarProjectionApproval {
  id: string;
  planId: string;
  planRevisionId: string;
  targetIds: string[];
  status: PublishingApprovalStatus;
  createdAt: string;
}

export interface CalendarProjectionDelivery {
  id: string;
  planId: string;
  planRevisionId: string;
  targetId: string;
  state: PublishingDeliveryState;
  publishAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface LegacyCalendarItem extends Omit<CalendarItem, "authority"> {
  governedPlanId: string | null;
  governedTargetId: string | null;
}

export interface CalendarProjectionInput {
  workspaceId: string;
  range: { start: string; end: string };
  socialAccountId?: string;
  currentRevisions: PublishingPlanRevisionRecord[];
  /** All allocated canonical Plan heads, including any that fail safe rehydration. */
  canonicalPlanIds?: string[];
  approvals: CalendarProjectionApproval[];
  deliveries: CalendarProjectionDelivery[];
  textByArtifactId: ReadonlyMap<string, string>;
  legacyItems: LegacyCalendarItem[];
}

function canonicalStatus(
  approval: CalendarProjectionApproval | null,
  delivery: CalendarProjectionDelivery | null,
): SocialPostStatus {
  if (delivery) {
    if (delivery.state === "succeeded") return "published";
    if (delivery.state === "dispatching" || delivery.state === "confirmation_pending") return "publishing";
    if (
      delivery.state === "failed_transient" ||
      delivery.state === "failed_terminal" ||
      delivery.state === "outcome_unknown"
    ) return "failed";
    if (delivery.state === "scheduled" || delivery.state === "blocked") return "queued";
    return "draft";
  }
  return approval?.status === "approved" || approval?.status === "consumed"
    ? "queued"
    : "draft";
}

function calendarInstant(item: Pick<CalendarItem, "scheduledAt" | "publishedAt" | "createdAt">): string {
  return item.scheduledAt ?? item.publishedAt ?? item.createdAt;
}

function inRange(value: string, start: number, end: number): boolean {
  const instant = new Date(value).getTime();
  return Number.isFinite(instant) && instant >= start && instant <= end;
}

function latestByTarget<T extends { id: string; planRevisionId: string; targetId?: string; targetIds?: string[]; createdAt?: string; updatedAt?: string }>(
  rows: T[],
): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const targetIds = row.targetId ? [row.targetId] : row.targetIds ?? [];
    for (const targetId of targetIds) {
      const key = `${row.planRevisionId}\u0000${targetId}`;
      const existing = result.get(key);
      const rank = `${row.updatedAt ?? row.createdAt ?? ""}\u0000${row.id}`;
      const existingRank = existing ? `${existing.updatedAt ?? existing.createdAt ?? ""}\u0000${existing.id}` : "";
      if (!existing || rank > existingRank) result.set(key, row);
    }
  }
  return result;
}

/**
 * One authoritative calendar projection. Current Plan targets win over the
 * compatibility post bridge; legacy rows remain visible only when no current
 * canonical target owns them.
 */
export function projectCalendar(input: CalendarProjectionInput): CalendarItem[] {
  const start = new Date(input.range.start).getTime();
  const end = new Date(input.range.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];

  const revisions = new Map<string, PublishingPlanRevisionRecord>();
  for (const revision of input.currentRevisions) {
    const current = revisions.get(revision.planId);
    if (!current || revision.revision > current.revision) revisions.set(revision.planId, revision);
  }
  const approvalByTarget = latestByTarget(input.approvals);
  const deliveryByTarget = latestByTarget(input.deliveries);
  const canonicalPlanIds = new Set(input.canonicalPlanIds ?? []);
  const items: CalendarItem[] = [];

  for (const revision of revisions.values()) {
    canonicalPlanIds.add(revision.planId);
    for (const target of revision.definition.targets) {
      if (input.socialAccountId && target.channelId !== input.socialAccountId) continue;
      if (!inRange(target.timing.publishAt, start, end)) continue;

      const evidence = revision.validationEvidence.targets.find((item) => item.targetId === target.targetId);
      const approval = approvalByTarget.get(`${revision.id}\u0000${target.targetId}`) as CalendarProjectionApproval | undefined;
      const delivery = deliveryByTarget.get(`${revision.id}\u0000${target.targetId}`) as CalendarProjectionDelivery | undefined;
      const createdAt = revision.createdAt.toISOString();
      items.push({
        id: `canonical:${revision.planId}:${target.targetId}`,
        workspaceId: input.workspaceId,
        socialAccountId: target.channelId,
        status: canonicalStatus(approval ?? null, delivery ?? null),
        content: input.textByArtifactId.get(target.contentArtifactId) ?? null,
        mediaUrls: null,
        stableMediaRefs: target.mediaArtifactIds.flatMap((artifactId, order) => {
          const artifact = evidence?.artifacts.find((item) => item.id === artifactId);
          return artifact
            ? [{ resourceKind: "artifact" as const, assetId: artifactId, assetDigest: artifact.digest, order }]
            : [];
        }),
        platformSettings: structuredClone(target.settings),
        scheduledAt: target.timing.publishAt,
        publishedAt: delivery?.state === "succeeded" ? delivery.completedAt ?? delivery.updatedAt : null,
        platformPostId: null,
        platformPostUrl: null,
        errorMessage: null,
        retryCount: 0,
        createdAt,
        updatedAt: delivery?.updatedAt ?? approval?.createdAt ?? createdAt,
        authority: {
          kind: "canonical",
          binding: {
            schema: "canonical-calendar-binding/v1",
            planId: revision.planId,
            revisionId: revision.id,
            revision: revision.revision,
            revisionDigest: revision.definitionDigest,
            targetId: target.targetId,
          },
          approvalStatus: approval?.status ?? null,
          deliveryState: delivery?.state ?? null,
        },
      });
    }
  }

  for (const legacy of input.legacyItems) {
    if (input.socialAccountId && legacy.socialAccountId !== input.socialAccountId) continue;
    if (
      legacy.governedPlanId && canonicalPlanIds.has(legacy.governedPlanId)
    ) continue;
    if (!inRange(calendarInstant(legacy), start, end)) continue;
    const { governedPlanId: _plan, governedTargetId: _target, ...item } = legacy;
    items.push({ ...item, authority: { kind: "legacy_compatibility" } });
  }

  return items.sort((left, right) =>
    calendarInstant(left).localeCompare(calendarInstant(right)) || left.id.localeCompare(right.id));
}
