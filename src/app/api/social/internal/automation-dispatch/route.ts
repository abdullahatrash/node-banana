import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import {
  buildAutomationTaskKey,
  claimDueAutomationTasks,
  createAutomationTask,
  createSocialPost,
  getAutomationRule,
  incrementAutomationRuleRunCount,
  updateAutomationTask,
  updatePostStatus,
} from "@/lib/social/repository";
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
const MIN_REPEAT_INTERVAL_SECONDS = 60;
const MAX_REPEAT_INTERVAL_SECONDS = 60 * 60 * 24 * 30;
const MAX_ALLOWED_RUNS = 1000;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readMediaUrls(
  value: unknown,
): Array<{ type: string; url: string; alt?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const media = value
    .map((item) => {
      if (!isRecord(item)) return null;
      const type = readString(item.type);
      const url = readString(item.url);
      if (!type || !url) return null;
      const alt = readString(item.alt);
      return alt ? { type, url, alt } : { type, url };
    })
    .filter(
      (item): item is { type: string; url: string; alt?: string } => item !== null,
    );
  return media.length > 0 ? media : undefined;
}

function validateRuleBounds(rule: {
  repeatIntervalSeconds: number | null;
  maxRuns: number | null;
}) {
  if (
    rule.repeatIntervalSeconds !== null &&
    (rule.repeatIntervalSeconds < MIN_REPEAT_INTERVAL_SECONDS ||
      rule.repeatIntervalSeconds > MAX_REPEAT_INTERVAL_SECONDS)
  ) {
    return `repeatIntervalSeconds must be between ${MIN_REPEAT_INTERVAL_SECONDS} and ${MAX_REPEAT_INTERVAL_SECONDS}.`;
  }

  if (
    rule.maxRuns !== null &&
    (rule.maxRuns < 1 || rule.maxRuns > MAX_ALLOWED_RUNS)
  ) {
    return `maxRuns must be between 1 and ${MAX_ALLOWED_RUNS}.`;
  }

  return null;
}

export async function POST(
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
        const boundsError = validateRuleBounds(rule);
        if (boundsError) {
          await updateAutomationTask(task.workspaceId, task.id, {
            state: "cancelled",
            errorMessage: boundsError,
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

        const content =
          readString(taskInput.content) ??
          readString(actionConfig.content) ??
          `Automated post run #${task.runIndex}`;
        const mediaUrls =
          readMediaUrls(taskInput.mediaUrls) ??
          readMediaUrls(actionConfig.mediaUrls);
        const platformSettings = isRecord(actionConfig.platformSettings)
          ? actionConfig.platformSettings
          : undefined;

        const post = await createSocialPost({
          workspaceId: task.workspaceId,
          socialAccountId,
          content,
          mediaUrls,
          platformSettings: {
            ...(platformSettings ?? {}),
            automation: {
              ruleId: rule.id,
              taskId: task.id,
              runIndex: task.runIndex,
              taskKey: task.taskKey,
            },
          },
          scheduledAt: task.dueAt ?? now,
          triggerSource: "automation",
          kind: "post",
          createdByUserId: rule.createdByUserId,
        });

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
