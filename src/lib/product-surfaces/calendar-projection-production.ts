import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  artifactContents,
  artifacts,
  runtimePublishingApprovalConsumptions,
  runtimePublishingApprovalDecisions,
  runtimePublishingApprovalRequests,
  runtimePublishingDeliveries,
  runtimePublishingPlanRevisions,
  runtimePublishingPlans,
} from "@/lib/db/schema";
import { parseGovernedPublishingMarker } from "@/lib/agent-tools/social-publishing-approval";
import { rehydratePublishingPlanRevision } from "@/lib/agent-runtime/publishing-plans/postgres-repository";
import { listSocialPosts } from "@/lib/social/repository";
import {
  projectCalendar,
  type CalendarItem,
  type CalendarProjectionApproval,
  type CalendarProjectionDelivery,
  type LegacyCalendarItem,
} from "./calendar-projection";

function approvalStatus(input: {
  currentRevisionId: string | undefined;
  planRevisionId: string;
  decision: string | null;
  consumedAt: Date | null;
  expiresAt: Date;
  now: Date;
}): CalendarProjectionApproval["status"] {
  if (input.currentRevisionId !== input.planRevisionId) return "superseded";
  if (input.consumedAt) return "consumed";
  if (input.decision === "approved" || input.decision === "denied") return input.decision;
  return input.expiresAt <= input.now ? "expired" : "pending";
}

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

export async function listCanonicalCalendar(input: {
  workspaceId: string;
  start: Date;
  end: Date;
  socialAccountId?: string;
  now?: Date;
}): Promise<CalendarItem[]> {
  const database = getDb();
  const now = input.now ?? new Date();
  const currentRows = await database
    .select({ planId: runtimePublishingPlans.id, revision: runtimePublishingPlanRevisions })
    .from(runtimePublishingPlans)
    .leftJoin(
      runtimePublishingPlanRevisions,
      and(
        eq(runtimePublishingPlanRevisions.workspaceId, runtimePublishingPlans.workspaceId),
        eq(runtimePublishingPlanRevisions.planId, runtimePublishingPlans.id),
        eq(runtimePublishingPlanRevisions.revision, runtimePublishingPlans.currentRevision),
      ),
    )
    .where(eq(runtimePublishingPlans.workspaceId, input.workspaceId));
  const currentRevisions = currentRows.flatMap(({ revision }) => {
    if (!revision) return [];
    const value = rehydratePublishingPlanRevision(revision);
    return value ? [value] : [];
  });
  const currentRevisionByPlan = new Map(currentRevisions.map((revision) => [revision.planId, revision.id]));
  const planIds = currentRows.map(({ planId }) => planId);

  const approvalRows = planIds.length === 0
    ? []
    : await database
        .select({
          request: runtimePublishingApprovalRequests,
          decision: runtimePublishingApprovalDecisions.outcome,
          consumedAt: runtimePublishingApprovalConsumptions.consumedAt,
        })
        .from(runtimePublishingApprovalRequests)
        .leftJoin(
          runtimePublishingApprovalDecisions,
          and(
            eq(runtimePublishingApprovalDecisions.workspaceId, runtimePublishingApprovalRequests.workspaceId),
            eq(runtimePublishingApprovalDecisions.requestId, runtimePublishingApprovalRequests.id),
          ),
        )
        .leftJoin(
          runtimePublishingApprovalConsumptions,
          and(
            eq(runtimePublishingApprovalConsumptions.workspaceId, runtimePublishingApprovalRequests.workspaceId),
            eq(runtimePublishingApprovalConsumptions.approvalRequestId, runtimePublishingApprovalRequests.id),
          ),
        )
        .where(and(
          eq(runtimePublishingApprovalRequests.workspaceId, input.workspaceId),
          inArray(runtimePublishingApprovalRequests.planId, planIds),
        ));
  const approvals: CalendarProjectionApproval[] = approvalRows.map((row) => ({
    id: row.request.id,
    planId: row.request.planId,
    planRevisionId: row.request.planRevisionId,
    targetIds: [...row.request.targetIds],
    status: approvalStatus({
      currentRevisionId: currentRevisionByPlan.get(row.request.planId),
      planRevisionId: row.request.planRevisionId,
      decision: row.decision,
      consumedAt: row.consumedAt,
      expiresAt: row.request.decisionPolicyExpiresAt,
      now,
    }),
    createdAt: row.request.createdAt.toISOString(),
  }));
  const approvalById = new Map(approvals.map((approval) => [approval.id, approval]));

  const deliveryRows = planIds.length === 0
    ? []
    : await database
        .select()
        .from(runtimePublishingDeliveries)
        .where(and(
          eq(runtimePublishingDeliveries.workspaceId, input.workspaceId),
          inArray(runtimePublishingDeliveries.planId, planIds),
        ));
  const deliveries: CalendarProjectionDelivery[] = deliveryRows.map((delivery) => ({
    id: delivery.id,
    planId: delivery.planId,
    planRevisionId: delivery.planRevisionId,
    targetId: delivery.targetId,
    state: delivery.state as CalendarProjectionDelivery["state"],
    publishAt: delivery.publishAt.toISOString(),
    completedAt: iso(delivery.completedAt),
    updatedAt: delivery.updatedAt.toISOString(),
  }));

  const contentArtifactIds = [...new Set(currentRevisions.flatMap((revision) =>
    revision.definition.targets.map((target) => target.contentArtifactId)))];
  const contentRows = contentArtifactIds.length === 0
    ? []
    : await database
        .select({ id: artifacts.id, text: artifactContents.inlineText })
        .from(artifacts)
        .innerJoin(
          artifactContents,
          and(
            eq(artifactContents.workspaceId, artifacts.workspaceId),
            eq(artifactContents.digest, artifacts.contentDigest),
          ),
        )
        .where(and(
          eq(artifacts.workspaceId, input.workspaceId),
          inArray(artifacts.id, contentArtifactIds),
        ));
  const textByArtifactId = new Map(contentRows.flatMap((row) => row.text === null ? [] : [[row.id, row.text] as const]));

  const legacyRows = await listSocialPosts(input.workspaceId, {
    startDate: input.start,
    endDate: input.end,
    socialAccountId: input.socialAccountId,
  });
  const legacyItems: LegacyCalendarItem[] = legacyRows.map((post) => {
    const marker = parseGovernedPublishingMarker(post.triggerSource);
    const approval = marker ? approvalById.get(marker.approvalRequestId) : undefined;
    return {
      id: post.id,
      workspaceId: post.workspaceId,
      socialAccountId: post.socialAccountId,
      status: post.status,
      content: post.content,
      mediaUrls: post.mediaUrls,
      stableMediaRefs: post.stableMediaRefs,
      platformSettings: post.platformSettings,
      scheduledAt: iso(post.scheduledAt),
      publishedAt: iso(post.publishedAt),
      platformPostId: post.platformPostId,
      platformPostUrl: post.platformPostUrl,
      errorMessage: post.errorMessage,
      retryCount: post.retryCount,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      governedPlanId: approval?.planId ?? null,
      governedTargetId: marker?.targetId ?? null,
    };
  });

  return projectCalendar({
    workspaceId: input.workspaceId,
    range: { start: input.start.toISOString(), end: input.end.toISOString() },
    socialAccountId: input.socialAccountId,
    currentRevisions,
    canonicalPlanIds: currentRows.map(({ planId }) => planId),
    approvals,
    deliveries,
    textByArtifactId,
    legacyItems,
  });
}
