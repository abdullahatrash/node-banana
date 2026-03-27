import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  buildAutomationTaskKey,
  createAutomationRule,
  createAutomationTask,
  listAutomationRules,
} from "@/lib/social/repository";

interface RulesGetResponse {
  success: boolean;
  rules?: Awaited<ReturnType<typeof listAutomationRules>>;
  error?: string;
}

interface RulesPostResponse {
  success: boolean;
  rule?: Awaited<ReturnType<typeof createAutomationRule>>;
  initialTask?: Awaited<ReturnType<typeof createAutomationTask>>;
  error?: string;
}

const MIN_REPEAT_INTERVAL_SECONDS = 60;
const MAX_REPEAT_INTERVAL_SECONDS = 60 * 60 * 24 * 30;
const MAX_ALLOWED_RUNS = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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

export async function GET(
  request: NextRequest,
): Promise<NextResponse<RulesGetResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const auth = await withApiPermission(request, {
      route: "/api/social/automation/rules",
      permission: "social:view",
    });
    if (!auth.authorized) {
      return auth.response;
    }

    const url = new URL(request.url);
    const enabledParam = url.searchParams.get("enabled");
    const enabled =
      enabledParam === "true" ? true : enabledParam === "false" ? false : undefined;
    const triggerSource = url.searchParams.get("triggerSource") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : undefined;

    const rules = await listAutomationRules(auth.session.workspace.id, {
      enabled,
      triggerSource,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });

    return NextResponse.json({ success: true, rules });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to list automation rules",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<RulesPostResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const auth = await withApiPermission(request, {
      route: "/api/social/automation/rules",
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

    const name = readString(body.name);
    if (!name) {
      return NextResponse.json(
        { success: false, error: "name is required." },
        { status: 400 },
      );
    }

    const triggerSource = readString(body.triggerSource) ?? "schedule";
    const repeatIntervalSeconds = readOptionalInt(body.repeatIntervalSeconds);
    const maxRuns = readOptionalInt(body.maxRuns);

    if (
      repeatIntervalSeconds !== undefined &&
      (repeatIntervalSeconds < MIN_REPEAT_INTERVAL_SECONDS ||
        repeatIntervalSeconds > MAX_REPEAT_INTERVAL_SECONDS)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `repeatIntervalSeconds must be between ${MIN_REPEAT_INTERVAL_SECONDS} and ${MAX_REPEAT_INTERVAL_SECONDS}.`,
        },
        { status: 400 },
      );
    }

    if (
      maxRuns !== undefined &&
      (maxRuns < 1 || maxRuns > MAX_ALLOWED_RUNS)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `maxRuns must be between 1 and ${MAX_ALLOWED_RUNS}.`,
        },
        { status: 400 },
      );
    }

    const enabled = readBoolean(body.enabled);
    const actionType = readString(body.actionType);
    const actionConfig = isRecord(body.actionConfig)
      ? body.actionConfig
      : undefined;
    const triggerFilters = isRecord(body.triggerFilters)
      ? body.triggerFilters
      : undefined;
    const startAt = readOptionalDate(body.startAt) ?? new Date();

    const rule = await createAutomationRule({
      workspaceId: auth.session.workspace.id,
      name,
      triggerSource,
      triggerFilters,
      repeatIntervalSeconds: repeatIntervalSeconds ?? null,
      maxRuns: maxRuns ?? null,
      actionType,
      actionConfig,
      enabled,
      createdByUserId: auth.session.user.id,
    });

    let initialTask: Awaited<ReturnType<typeof createAutomationTask>> | undefined;
    if (rule.enabled) {
      initialTask = await createAutomationTask({
        workspaceId: rule.workspaceId,
        ruleId: rule.id,
        taskKey: buildAutomationTaskKey({
          workspaceId: rule.workspaceId,
          ruleId: rule.id,
          runIndex: 1,
        }),
        runIndex: 1,
        dueAt: startAt,
        input: {
          source: "rule-seed",
        },
      });
    }

    return NextResponse.json({
      success: true,
      rule,
      initialTask,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create automation rule",
      },
      { status: 500 },
    );
  }
}
