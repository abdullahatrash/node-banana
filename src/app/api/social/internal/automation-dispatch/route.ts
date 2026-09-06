import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import {
  buildAutomationTaskKey,
  claimDueAutomationTasks,
  createAutomationTask,
  createSocialPost,
  getSocialAccount,
  getAutomationRule,
  incrementAutomationRuleRunCount,
  listSocialPosts,
  updateAutomationTask,
  updatePostStatus,
} from "@/lib/social/repository";
import {
  governedPublishingMarker,
  PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION,
  socialPublishingApprovalEvidenceSchema,
} from "@/lib/agent-tools/social-publishing-approval";
import {
  validateAutomationRulePayload,
  validateAutomationTaskPayload,
} from "@/lib/social/automation-guards";
import { isRecord } from "@/lib/social/utils";
import { logger } from "@/utils/logger";

interface AutomationDispatchResponse {
  success: boolean;
  summary?: {
    scanned: number;
    claimed: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    rescheduled: number;
    queuedPosts: number;
  };
  error?: string;
}

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;
function positiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getBatchSize(request: NextRequest): number {
  const queryBatch = positiveInt(request.nextUrl.searchParams.get("batch"));
  const envBatch = positiveInt(
    process.env.SOCIAL_AUTOMATION_DISPATCH_BATCH_SIZE ?? null,
  );
  return Math.min(MAX_BATCH_SIZE, queryBatch ?? envBatch ?? DEFAULT_BATCH_SIZE);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function handleAutomationDispatch(
  request: NextRequest,
): Promise<NextResponse<AutomationDispatchResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const authFailure = ensureInternalSocialAuth(request);
  if (authFailure) {
    return authFailure;
  }

  try {
    const batch = getBatchSize(request);
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? undefined;
    const ruleId = request.nextUrl.searchParams.get("ruleId") ?? undefined;
    const now = new Date();

    const claimedTasks = await claimDueAutomationTasks({
      workspaceId,
      ruleId,
      now,
      limit: batch,
    });

    let succeeded = 0;
    let failed = 0;
    let cancelled = 0;
    let rescheduled = 0;
    let queuedPosts = 0;

    for (const task of claimedTasks) {
      try {
        const rule = await getAutomationRule(task.workspaceId, task.ruleId);
        const ruleGuardError = validateAutomationRulePayload({
          triggerSource: rule.triggerSource,
          repeatIntervalSeconds: rule.repeatIntervalSeconds,
          maxRuns: rule.maxRuns,
          triggerFilters: rule.triggerFilters ?? null,
          actionType: rule.actionType,
          actionConfig: isRecord(rule.actionConfig) ? rule.actionConfig : null,
          enforceKnownTriggerSource: false,
        });
        if (ruleGuardError) {
          await updateAutomationTask(task.workspaceId, task.id, {
            state: "cancelled",
            errorMessage: ruleGuardError,
            completedAt: new Date(),
          });
          cancelled += 1;
          continue;
        }

        if (!rule.enabled) {
          await updateAutomationTask(task.workspaceId, task.id, {
            state: "cancelled",
            errorMessage: "Automation rule is disabled.",
            completedAt: new Date(),
          });
          cancelled += 1;
          continue;
        }

        if (rule.maxRuns !== null && rule.totalRuns >= rule.maxRuns) {
          await updateAutomationTask(task.workspaceId, task.id, {
            state: "cancelled",
            errorMessage: "Automation rule reached max runs.",
            completedAt: new Date(),
          });
          cancelled += 1;
          continue;
        }

        if (rule.actionType !== "create_social_post") {
          await updateAutomationTask(task.workspaceId, task.id, {
            state: "failed",
            errorMessage: `Unsupported action type "${rule.actionType}".`,
            completedAt: new Date(),
          });
          failed += 1;
          continue;
        }

        const actionConfig = isRecord(rule.actionConfig) ? rule.actionConfig : {};
        const taskInput = isRecord(task.input) ? task.input : {};
        const taskGuardError = validateAutomationTaskPayload({
          runIndex: task.runIndex,
          payload: taskInput,
        });
        if (taskGuardError) {
          await updateAutomationTask(task.workspaceId, task.id, {
            state: "cancelled",
            errorMessage: taskGuardError,
            completedAt: new Date(),
          });
          cancelled += 1;
          continue;
        }

        const socialAccountId =
          readString(taskInput.socialAccountId) ??
          readString(actionConfig.socialAccountId);
        if (!socialAccountId) {
          await updateAutomationTask(task.workspaceId, task.id, {
            state: "failed",
            errorMessage:
              "Automation action requires actionConfig.socialAccountId or task input socialAccountId.",
            completedAt: new Date(),
          });
          failed += 1;
          continue;
        }
        try {
          await getSocialAccount(task.workspaceId, socialAccountId);
        } catch {
          await updateAutomationTask(task.workspaceId, task.id, {
            state: "failed",
            errorMessage:
              "Automation action socialAccountId does not belong to this workspace.",
            completedAt: new Date(),
          });
          failed += 1;
          continue;
        }

        const content =
          readString(taskInput.content) ??
          readString(actionConfig.content) ??
          `Automated post run #${task.runIndex}`;
        const approvalResult = socialPublishingApprovalEvidenceSchema.safeParse(
          taskInput.publishingApproval ?? actionConfig.publishingApproval,
        );
        if (!approvalResult.success || approvalResult.data.consumingPrincipalId !== rule.createdByUserId) {
          await updateAutomationTask(task.workspaceId, task.id, {
            state: "failed",
            errorMessage: "Automation publishing requires fresh exact Plan Revision Approval evidence scoped to the rule owner.",
            completedAt: new Date(),
          });
          failed += 1;
          continue;
        }
        const approval = approvalResult.data;
        const idempotencyKey = `automation:${task.workspaceId}:${rule.createdByUserId}:${task.taskKey}`;
        const marker = governedPublishingMarker({
          schema: "governed-social-publishing/v1",
          approvalRequestId: approval.approvalRequestId,
          targetId: approval.targetId,
          targetEvidenceDigest: approval.targetEvidenceDigest,
          consumingPrincipalId: approval.consumingPrincipalId,
          idempotencyKey,
        });
        const replay = (await listSocialPosts(task.workspaceId, { triggerSource: marker, limit: 2 }))
          .find((candidate) => candidate.createdByUserId === rule.createdByUserId);
        if (replay) {
          const validReplay = await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.verifyConsumed({
            workspaceId: task.workspaceId,
            socialAccountId: replay.socialAccountId,
            actorUserId: rule.createdByUserId,
            triggerSource: replay.triggerSource,
            content: replay.content,
            mediaUrls: replay.mediaUrls,
            stableMediaRefs: replay.stableMediaRefs,
            platformSettings: replay.platformSettings,
            scheduledAt: replay.scheduledAt,
          });
          if (!validReplay) throw new Error("Automation idempotency record exists without valid governed publishing evidence.");
          await updateAutomationTask(task.workspaceId, task.id, {
            state: "succeeded",
            result: { postId: replay.id, socialAccountId, ruleId: rule.id, runIndex: task.runIndex, replayed: true },
            errorMessage: null,
            completedAt: new Date(),
          });
          succeeded += 1;
          queuedPosts += 1;
          continue;
        }
        const inspected = await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.inspect({
          workspaceId: task.workspaceId,
          socialAccountId,
          evidence: approval,
        });
        if (!inspected) throw new Error("Automation Publishing Approval is stale, consumed, or not exact for this Channel.");
        if (
          content.trim() !== inspected.target.content.text ||
          (task.dueAt ?? now).toISOString() !== inspected.target.timing.publishAt
        ) throw new Error("Automation content or due time does not match the approved Plan Revision target.");

        const post = await createSocialPost({
          workspaceId: task.workspaceId,
          socialAccountId,
          content: inspected.target.content.text,
          mediaUrls: inspected.target.media.map((item) => ({ type: "image", url: item.previewUrl })),
          mediaReferences: inspected.target.media.map((item) => ({ resourceKind: "artifact" as const, id: item.artifactId, digest: item.digest })),
          platformSettings: inspected.target.settings,
          scheduledAt: new Date(inspected.target.timing.publishAt),
          triggerSource: marker,
          kind: "post",
          createdByUserId: rule.createdByUserId,
        });

        const consumption = await PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION.consume({
          workspaceId: task.workspaceId,
          inspected,
        });
        if (consumption !== "consumed") throw new Error("Automation Publishing Approval release authorization could not be consumed.");

        await updatePostStatus(post.id, "queued", {
          errorMessage: null,
          dispatchStatus: "pending",
          workflowRunRef: null,
          nextDispatchAt: task.dueAt ?? now,
          lastDispatchError: null,
          lockedAt: null,
        });

        const updatedRule = await incrementAutomationRuleRunCount({
          workspaceId: rule.workspaceId,
          ruleId: rule.id,
        });

        await updateAutomationTask(task.workspaceId, task.id, {
          state: "succeeded",
          result: {
            postId: post.id,
            socialAccountId,
            ruleId: rule.id,
            runIndex: task.runIndex,
          },
          errorMessage: null,
          completedAt: new Date(),
        });

        succeeded += 1;
        queuedPosts += 1;

        if (
          updatedRule.repeatIntervalSeconds !== null &&
          updatedRule.repeatIntervalSeconds > 0 &&
          (updatedRule.maxRuns === null ||
            updatedRule.totalRuns < updatedRule.maxRuns)
        ) {
          const nextRunIndex = task.runIndex + 1;
          const base = task.dueAt ?? now;
          const nextDueAt = new Date(
            base.getTime() + updatedRule.repeatIntervalSeconds * 1000,
          );
          const nextTaskKey = buildAutomationTaskKey({
            workspaceId: rule.workspaceId,
            ruleId: rule.id,
            runIndex: nextRunIndex,
          });

          await createAutomationTask({
            workspaceId: rule.workspaceId,
            ruleId: rule.id,
            taskKey: nextTaskKey,
            runIndex: nextRunIndex,
            dueAt: nextDueAt,
            input: {
              source: "repeat-schedule",
            },
          });
          rescheduled += 1;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown automation error.";
        await updateAutomationTask(task.workspaceId, task.id, {
          state: "failed",
          errorMessage,
          completedAt: new Date(),
        });
        logger.error("system", "Automation task dispatch failed", {
          workspaceId: task.workspaceId,
          ruleId: task.ruleId,
          taskId: task.id,
          taskKey: task.taskKey,
          error: errorMessage,
        });
        failed += 1;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        scanned: claimedTasks.length,
        claimed: claimedTasks.length,
        succeeded,
        failed,
        cancelled,
        rescheduled,
        queuedPosts,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to dispatch automation tasks",
      },
      { status: 500 },
    );
  }
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<AutomationDispatchResponse>> {
  return handleAutomationDispatch(request);
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<AutomationDispatchResponse>> {
  return handleAutomationDispatch(request);
}
