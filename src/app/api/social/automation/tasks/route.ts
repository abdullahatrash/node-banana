import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  buildAutomationTaskKey,
  createAutomationTask,
  getAutomationRule,
  getNextAutomationRunIndex,
  listAutomationTasks,
  socialEventBelongsToWorkspace,
  socialPostBelongsToWorkspace,
} from "@/lib/social/repository";
import type { AutomationTaskState } from "@/lib/db/schema";
import { validateAutomationTaskPayload } from "@/lib/social/automation-guards";

interface TasksGetResponse {
  success: boolean;
  tasks?: Awaited<ReturnType<typeof listAutomationTasks>>;
  error?: string;
}

interface TasksPostResponse {
  success: boolean;
  task?: Awaited<ReturnType<typeof createAutomationTask>>;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readOptionalDate(value: unknown): Date | undefined {
  const str = readString(value);
  if (!str) return undefined;
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toTaskState(value: string | null): AutomationTaskState | undefined {
  if (
    value === "pending" ||
    value === "claimed" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return undefined;
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<TasksGetResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const auth = await withApiPermission(request, {
      route: "/api/social/automation/tasks",
      permission: "social:view",
    });
    if (!auth.authorized) {
      return auth.response;
    }

    const url = new URL(request.url);
    const ruleId = url.searchParams.get("ruleId") ?? undefined;
    const state = toTaskState(url.searchParams.get("state"));
    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined;

    const tasks = await listAutomationTasks(auth.session.workspace.id, {
      ruleId,
      state,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });

    return NextResponse.json({ success: true, tasks });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to list automation tasks",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<TasksPostResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const auth = await withApiPermission(request, {
      route: "/api/social/automation/tasks",
      permission: "social:publish",
    });
    if (!auth.authorized) {
      return auth.response;
    }

    const body = (await request.json()) as unknown;
    if (!isRecord(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const ruleId = readString(body.ruleId);
    if (!ruleId) {
      return NextResponse.json(
        { success: false, error: "ruleId is required." },
        { status: 400 },
      );
    }

    const rule = await getAutomationRule(auth.session.workspace.id, ruleId);
    const dueAt = readOptionalDate(body.dueAt) ?? new Date();
    const runIndexInput = readOptionalInt(body.runIndex);
    const runIndex =
      runIndexInput && runIndexInput > 0
        ? runIndexInput
        : await getNextAutomationRunIndex(rule.workspaceId, rule.id);

    const inputPayload = isRecord(body.input)
      ? body.input
      : {};
    const sourcePostId = readString(body.sourcePostId);
    const sourceEventId = readString(body.sourceEventId);
    const guardError = validateAutomationTaskPayload({
      runIndex,
      payload: inputPayload,
    });
    if (guardError) {
      return NextResponse.json(
        { success: false, error: guardError },
        { status: 400 },
      );
    }

    if (sourcePostId) {
      const sourcePostOwned = await socialPostBelongsToWorkspace(
        rule.workspaceId,
        sourcePostId,
      );
      if (!sourcePostOwned) {
        return NextResponse.json(
          {
            success: false,
            error: "sourcePostId does not belong to this workspace.",
          },
          { status: 404 },
        );
      }
    }

    if (sourceEventId) {
      const sourceEventOwned = await socialEventBelongsToWorkspace(
        rule.workspaceId,
        sourceEventId,
      );
      if (!sourceEventOwned) {
        return NextResponse.json(
          {
            success: false,
            error: "sourceEventId does not belong to this workspace.",
          },
          { status: 404 },
        );
      }
    }

    const task = await createAutomationTask({
      workspaceId: rule.workspaceId,
      ruleId: rule.id,
      taskKey: buildAutomationTaskKey({
        workspaceId: rule.workspaceId,
        ruleId: rule.id,
        runIndex,
      }),
      runIndex,
      dueAt,
      input: {
        ...inputPayload,
        source: "manual-create",
      },
      sourcePostId: sourcePostId ?? null,
      sourceEventId: sourceEventId ?? null,
    });

    return NextResponse.json({ success: true, task });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create automation task",
      },
      { status: 500 },
    );
  }
}
