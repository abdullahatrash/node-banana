import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  deleteAutomationRule,
  getAutomationRule,
  updateAutomationRule,
  AutomationRuleNotFoundError,
} from "@/lib/social/repository";
import { validateAutomationRulePayload } from "@/lib/social/automation-guards";

interface RuleResponse {
  success: boolean;
  rule?: Awaited<ReturnType<typeof getAutomationRule>>;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalInt(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> },
): Promise<NextResponse<RuleResponse>> {
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

    const { ruleId } = await params;
    const rule = await getAutomationRule(auth.session.workspace.id, ruleId);
    return NextResponse.json({ success: true, rule });
  } catch (error) {
    if (error instanceof AutomationRuleNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load automation rule",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> },
): Promise<NextResponse<RuleResponse>> {
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

    const { ruleId } = await params;
    const existingRule = await getAutomationRule(auth.session.workspace.id, ruleId);
    const name = body.name === null ? "" : readString(body.name);
    const triggerSource = readString(body.triggerSource);
    const repeatIntervalSeconds = readOptionalInt(body.repeatIntervalSeconds);
    const maxRuns = readOptionalInt(body.maxRuns);
    const actionType = readString(body.actionType);
    const actionConfig =
      body.actionConfig === null
        ? null
        : isRecord(body.actionConfig)
          ? body.actionConfig
          : undefined;
    const triggerFilters =
      body.triggerFilters === null
        ? null
        : isRecord(body.triggerFilters)
          ? body.triggerFilters
          : undefined;

    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { success: false, error: "enabled must be a boolean." },
        { status: 400 },
      );
    }
    if (
      body.repeatIntervalSeconds !== undefined &&
      readOptionalInt(body.repeatIntervalSeconds) === undefined
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "repeatIntervalSeconds must be an integer or null.",
        },
        { status: 400 },
      );
    }
    if (body.maxRuns !== undefined && readOptionalInt(body.maxRuns) === undefined) {
      return NextResponse.json(
        { success: false, error: "maxRuns must be an integer or null." },
        { status: 400 },
      );
    }
    if (body.totalRuns !== undefined && readOptionalInt(body.totalRuns) === undefined) {
      return NextResponse.json(
        { success: false, error: "totalRuns must be an integer when provided." },
        { status: 400 },
      );
    }
    if (body.name !== undefined && !name) {
      return NextResponse.json(
        { success: false, error: "name must be a non-empty string when provided." },
        { status: 400 },
      );
    }

    const guardError = validateAutomationRulePayload({
      triggerSource: triggerSource ?? existingRule.triggerSource,
      repeatIntervalSeconds:
        repeatIntervalSeconds === undefined
          ? existingRule.repeatIntervalSeconds
          : repeatIntervalSeconds,
      maxRuns: maxRuns === undefined ? existingRule.maxRuns : maxRuns,
      triggerFilters:
        triggerFilters === undefined
          ? (existingRule.triggerFilters as Record<string, unknown> | null)
          : triggerFilters,
      actionType: actionType ?? existingRule.actionType,
      actionConfig:
        actionConfig === undefined
          ? (existingRule.actionConfig as Record<string, unknown> | null)
          : actionConfig,
    });
    if (guardError) {
      return NextResponse.json(
        { success: false, error: guardError },
        { status: 400 },
      );
    }

    const rule = await updateAutomationRule(auth.session.workspace.id, ruleId, {
      ...(name ? { name } : {}),
      ...(triggerSource !== undefined ? { triggerSource } : {}),
      ...(triggerFilters !== undefined ? { triggerFilters } : {}),
      ...(repeatIntervalSeconds !== undefined ? { repeatIntervalSeconds } : {}),
      ...(maxRuns !== undefined ? { maxRuns } : {}),
      ...(body.totalRuns !== undefined
        ? { totalRuns: readOptionalInt(body.totalRuns) ?? undefined }
        : {}),
      ...(actionType !== undefined ? { actionType } : {}),
      ...(actionConfig !== undefined ? { actionConfig } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });

    return NextResponse.json({ success: true, rule });
  } catch (error) {
    if (error instanceof AutomationRuleNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update automation rule",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> },
): Promise<NextResponse<{ success: boolean; error?: string }>> {
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

    const { ruleId } = await params;
    await deleteAutomationRule(auth.session.workspace.id, ruleId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AutomationRuleNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete automation rule",
      },
      { status: 500 },
    );
  }
}
