import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  deleteAutomationTask,
  getAutomationTask,
  updateAutomationTask,
  AutomationTaskNotFoundError,
  socialEventBelongsToWorkspace,
  socialPostBelongsToWorkspace,
} from "@/lib/social/repository";
import type { AutomationTaskState } from "@/lib/db/schema";
import { validateAutomationTaskPayload } from "@/lib/social/automation-guards";

interface TaskResponse {
  success: boolean;
  task?: Awaited<ReturnType<typeof getAutomationTask>>;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readOptionalDate(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
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

function readTaskState(value: unknown): AutomationTaskState | undefined {
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
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse<TaskResponse>> {
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

    const { taskId } = await params;
    const task = await getAutomationTask(auth.session.workspace.id, taskId);
    return NextResponse.json({ success: true, task });
  } catch (error) {
    if (error instanceof AutomationTaskNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load automation task",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse<TaskResponse>> {
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

    const { taskId } = await params;
    const existing = await getAutomationTask(auth.session.workspace.id, taskId);

    if (body.state !== undefined && !readTaskState(body.state)) {
      return NextResponse.json(
        { success: false, error: "state is invalid." },
        { status: 400 },
      );
    }
    if (
      body.input !== undefined &&
      body.input !== null &&
      !isRecord(body.input)
    ) {
      return NextResponse.json(
        { success: false, error: "input must be an object." },
        { status: 400 },
      );
    }
    if (
      body.result !== undefined &&
      body.result !== null &&
      !isRecord(body.result)
    ) {
      return NextResponse.json(
        { success: false, error: "result must be an object." },
        { status: 400 },
      );
    }
    if (
      body.attemptCount !== undefined &&
      readOptionalInt(body.attemptCount) === undefined
    ) {
      return NextResponse.json(
        { success: false, error: "attemptCount must be an integer." },
        { status: 400 },
      );
    }

    const nextRunIndex = readOptionalInt(body.runIndex) ?? existing.runIndex;
    const guardError = validateAutomationTaskPayload({
      runIndex: nextRunIndex,
      payload:
        body.input === undefined
          ? (existing.input as Record<string, unknown> | null | undefined)
          : body.input === null
            ? null
            : (body.input as Record<string, unknown>),
    });
    if (guardError) {
      return NextResponse.json(
        { success: false, error: guardError },
        { status: 400 },
      );
    }

    if (body.sourcePostId !== undefined && body.sourcePostId !== null) {
      if (typeof body.sourcePostId !== "string" || !body.sourcePostId.trim()) {
        return NextResponse.json(
          { success: false, error: "sourcePostId must be a non-empty string." },
          { status: 400 },
        );
      }
      const owned = await socialPostBelongsToWorkspace(
        auth.session.workspace.id,
        body.sourcePostId.trim(),
      );
      if (!owned) {
        return NextResponse.json(
          {
            success: false,
            error: "sourcePostId does not belong to this workspace.",
          },
          { status: 404 },
        );
      }
    }

    if (body.sourceEventId !== undefined && body.sourceEventId !== null) {
      if (typeof body.sourceEventId !== "string" || !body.sourceEventId.trim()) {
        return NextResponse.json(
          { success: false, error: "sourceEventId must be a non-empty string." },
          { status: 400 },
        );
      }
      const owned = await socialEventBelongsToWorkspace(
        auth.session.workspace.id,
        body.sourceEventId.trim(),
      );
      if (!owned) {
        return NextResponse.json(
          {
            success: false,
            error: "sourceEventId does not belong to this workspace.",
          },
          { status: 404 },
        );
      }
    }

    const task = await updateAutomationTask(auth.session.workspace.id, taskId, {
      ...(body.state !== undefined ? { state: readTaskState(body.state) } : {}),
      ...(body.dueAt !== undefined ? { dueAt: readOptionalDate(body.dueAt) } : {}),
      ...(body.claimToken !== undefined
        ? { claimToken: typeof body.claimToken === "string" ? body.claimToken : null }
        : {}),
      ...(body.claimedAt !== undefined
        ? { claimedAt: readOptionalDate(body.claimedAt) }
        : {}),
      ...(body.claimedBy !== undefined
        ? { claimedBy: typeof body.claimedBy === "string" ? body.claimedBy : null }
        : {}),
      ...(body.attemptCount !== undefined
        ? { attemptCount: readOptionalInt(body.attemptCount) }
        : {}),
      ...(body.input !== undefined
        ? { input: body.input === null ? null : (body.input as Record<string, unknown>) }
        : {}),
      ...(body.result !== undefined
        ? { result: body.result === null ? null : (body.result as Record<string, unknown>) }
        : {}),
      ...(body.errorMessage !== undefined
        ? {
            errorMessage:
              typeof body.errorMessage === "string" ? body.errorMessage : null,
          }
        : {}),
      ...(body.sourcePostId !== undefined
        ? {
            sourcePostId:
              typeof body.sourcePostId === "string"
                ? body.sourcePostId.trim()
                : null,
          }
        : {}),
      ...(body.sourceEventId !== undefined
        ? {
            sourceEventId:
              typeof body.sourceEventId === "string"
                ? body.sourceEventId.trim()
                : null,
          }
        : {}),
      ...(body.completedAt !== undefined
        ? { completedAt: readOptionalDate(body.completedAt) }
        : {}),
    });

    return NextResponse.json({ success: true, task });
  } catch (error) {
    if (error instanceof AutomationTaskNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update automation task",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse<{ success: boolean; error?: string }>> {
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

    const { taskId } = await params;
    await deleteAutomationTask(auth.session.workspace.id, taskId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AutomationTaskNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete automation task",
      },
      { status: 500 },
    );
  }
}
