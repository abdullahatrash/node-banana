import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import { encryptToken } from "@/lib/social/crypto";
import { getSocialPlanLimits, quotaExceededPayload } from "@/lib/social/limits";
import {
  countActiveSocialWebhooks,
  createSocialWebhook,
  createSocialWebhookSubscription,
  listSocialWebhooks,
} from "@/lib/social/repository";
import { validateMediaUrl } from "@/utils/urlValidation";

interface WebhookPostRequest {
  targetUrl: string;
  name?: string;
  enabled?: boolean;
  filters?: Record<string, unknown>;
}

interface WebhooksGetResponse {
  success: boolean;
  webhooks?: Array<{
    id: string;
    workspaceId: string;
    targetUrl: string;
    enabled: boolean;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  error?: string;
}

interface WebhooksPostResponse {
  success: boolean;
  webhook?: {
    id: string;
    workspaceId: string;
    targetUrl: string;
    enabled: boolean;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  };
  signingSecret?: string;
  error?: string;
  code?: string;
  billingUrl?: string;
}

function isValidWebhookTargetUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (parsed.username || parsed.password) {
      return false;
    }

    return validateMediaUrl(input).valid;
  } catch {
    return false;
  }
}

function parseBooleanFilter(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<WebhooksGetResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/webhooks",
      permission: "social:manage",
    });

    if (!result.authorized) {
      return result.response;
    }

    const url = new URL(request.url);
    const enabledFilter = parseBooleanFilter(url.searchParams.get("enabled"));
    const targetUrlIncludes = url.searchParams.get("targetUrlContains")?.trim();
    const createdByUserId = url.searchParams.get("createdByUserId")?.trim();

    const webhooks = await listSocialWebhooks(result.session.workspace.id);
    const safeWebhooks = webhooks
      .filter((webhook) => {
        if (enabledFilter !== undefined && webhook.enabled !== enabledFilter) {
          return false;
        }
        if (createdByUserId && webhook.createdByUserId !== createdByUserId) {
          return false;
        }
        if (targetUrlIncludes && !webhook.targetUrl.includes(targetUrlIncludes)) {
          return false;
        }
        return true;
      })
      .map(
      ({ signingSecretEncrypted, ...rest }) => rest,
      );

    return NextResponse.json({
      success: true,
      webhooks: safeWebhooks,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list social webhooks",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<WebhooksPostResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/webhooks",
      permission: "social:manage",
    });

    if (!result.authorized) {
      return result.response;
    }

    const body = (await request.json()) as WebhookPostRequest;
    const targetUrl = body.targetUrl?.trim() ?? "";

    if (!targetUrl) {
      return NextResponse.json(
        { success: false, error: "targetUrl is required." },
        { status: 400 },
      );
    }

    if (!isValidWebhookTargetUrl(targetUrl)) {
      return NextResponse.json(
        { success: false, error: "targetUrl must be a valid https URL." },
        { status: 400 },
      );
    }

    const limits = getSocialPlanLimits(result.session.planTier);
    const currentWebhooks = await countActiveSocialWebhooks(
      result.session.workspace.id,
    );
    if (currentWebhooks >= limits.webhooks) {
      return NextResponse.json(
        quotaExceededPayload({
          section: "webhooks",
          current: currentWebhooks,
          limit: limits.webhooks,
        }),
        { status: 402 },
      );
    }

    const signingSecret = randomBytes(32).toString("hex");
    const webhook = await createSocialWebhook({
      workspaceId: result.session.workspace.id,
      targetUrl,
      signingSecretEncrypted: encryptToken(signingSecret),
      createdByUserId: result.session.user.id,
    });

    await createSocialWebhookSubscription({
      workspaceId: result.session.workspace.id,
      webhookId: webhook.id,
      name: body.name?.trim() || undefined,
      enabled: body.enabled ?? true,
      filters:
        body.filters && typeof body.filters === "object" && !Array.isArray(body.filters)
          ? body.filters
          : undefined,
      createdByUserId: result.session.user.id,
    });

    const { signingSecretEncrypted, ...safeWebhook } = webhook;
    return NextResponse.json({
      success: true,
      webhook: safeWebhook,
      signingSecret,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create social webhook",
      },
      { status: 500 },
    );
  }
}
