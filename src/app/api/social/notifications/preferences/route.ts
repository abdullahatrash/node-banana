import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  getSocialNotificationPreferences,
  SocialNotificationPreferencesNotFoundError,
  upsertSocialNotificationPreferences,
} from "@/lib/social/repository";
import { isRecord } from "@/lib/social/utils";

interface NotificationPreferencesResponse {
  success: boolean;
  preferences?: {
    workspaceId: string;
    userId: string;
    inAppEnabled: boolean;
    emailEnabled: boolean;
    webhookEnabled: boolean;
    muteAll: boolean;
    preferences: Record<string, unknown> | null;
  };
  error?: string;
}

interface NotificationPreferencesBody {
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  webhookEnabled?: boolean;
  muteAll?: boolean;
  preferences?: Record<string, unknown> | null;
}

function isBooleanOrUndefined(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function normalizePreferences(
  row: {
    workspaceId?: string;
    userId?: string;
    inAppEnabled?: boolean;
    emailEnabled?: boolean;
    webhookEnabled?: boolean;
    muteAll?: boolean;
    preferences?: Record<string, unknown> | null;
  },
  workspaceId: string,
  userId: string,
): NotificationPreferencesResponse["preferences"] {
  return {
    workspaceId: row.workspaceId ?? workspaceId,
    userId: row.userId ?? userId,
    inAppEnabled: row.inAppEnabled ?? true,
    emailEnabled: row.emailEnabled ?? false,
    webhookEnabled: row.webhookEnabled ?? false,
    muteAll: row.muteAll ?? false,
    preferences: row.preferences ?? null,
  };
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<NotificationPreferencesResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/notifications/preferences",
      permission: "social:view",
    });

    if (!result.authorized) {
      return result.response;
    }

    const workspaceId = result.session.workspace.id;
    const userId = result.session.user.id;

    try {
      const row = await getSocialNotificationPreferences(workspaceId, userId);
      return NextResponse.json({
        success: true,
        preferences: normalizePreferences(row, workspaceId, userId),
      });
    } catch (error) {
      if (!(error instanceof SocialNotificationPreferencesNotFoundError)) {
        throw error;
      }
      return NextResponse.json({
        success: true,
        preferences: normalizePreferences({}, workspaceId, userId),
      });
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load social notification preferences",
      },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
): Promise<NextResponse<NotificationPreferencesResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/notifications/preferences",
      permission: "social:view",
    });

    if (!result.authorized) {
      return result.response;
    }

    const body = (await request.json()) as NotificationPreferencesBody;

    if (
      !isBooleanOrUndefined(body.inAppEnabled) ||
      !isBooleanOrUndefined(body.emailEnabled) ||
      !isBooleanOrUndefined(body.webhookEnabled) ||
      !isBooleanOrUndefined(body.muteAll)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "inAppEnabled, emailEnabled, webhookEnabled, and muteAll must be booleans when provided.",
        },
        { status: 400 },
      );
    }

    if (
      body.preferences !== undefined &&
      body.preferences !== null &&
      !isRecord(body.preferences)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "preferences must be an object when provided.",
        },
        { status: 400 },
      );
    }

    const workspaceId = result.session.workspace.id;
    const userId = result.session.user.id;

    const row = await upsertSocialNotificationPreferences({
      workspaceId,
      userId,
      inAppEnabled: body.inAppEnabled,
      emailEnabled: body.emailEnabled,
      webhookEnabled: body.webhookEnabled,
      muteAll: body.muteAll,
      preferences: body.preferences ?? undefined,
    });

    return NextResponse.json({
      success: true,
      preferences: normalizePreferences(row, workspaceId, userId),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update social notification preferences",
      },
      { status: 500 },
    );
  }
}
