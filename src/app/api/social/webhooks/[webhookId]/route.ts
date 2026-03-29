import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  deleteSocialWebhook,
  getSocialWebhook,
  listSocialWebhookSubscriptions,
  listWebhookDeliveriesForWorkspace,
  SocialWebhookNotFoundError,
  updateSocialWebhook,
  updateSocialWebhookSubscription,
  SocialWebhookSubscriptionNotFoundError,
} from "@/lib/social/repository";
import { validateMediaUrl } from "@/utils/urlValidation";

interface WebhookGetResponse {
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
  deliveries?: Awaited<ReturnType<typeof listWebhookDeliveriesForWorkspace>>;
  error?: string;
}

interface WebhookDeleteResponse {
  success: boolean;
  error?: string;
}

interface WebhookPatchRequest {
  targetUrl?: string;
  enabled?: boolean;
  subscription?: {
    name?: string | null;
    enabled?: boolean;
    filters?: Record<string, unknown> | null;
  };
}

interface WebhookPatchResponse {
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
  subscription?: Record<string, unknown> | null;
  error?: string;
}

function parseBooleanFilter(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ webhookId: string }> },
): Promise<NextResponse<WebhookGetResponse>> {
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

    const { webhookId } = await params;
    const webhook = await getSocialWebhook(result.session.workspace.id, webhookId);
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status")?.trim();
    const eventTypeFilter = url.searchParams.get("eventType")?.trim();
    const replayableOnly = parseBooleanFilter(url.searchParams.get("replayableOnly"));
    const limit = parsePositiveInteger(url.searchParams.get("limit")) ?? 100;
    const offset = parsePositiveInteger(url.searchParams.get("offset"));
    const deliveries = await listWebhookDeliveriesForWorkspace(
      result.session.workspace.id,
      { webhookId, limit, offset },
    );
    const { signingSecretEncrypted, ...safeWebhook } = webhook;
    const safeDeliveries = deliveries.filter((delivery) => {
      if (statusFilter && delivery.status !== statusFilter) {
        return false;
      }
      if (eventTypeFilter && delivery.eventType !== eventTypeFilter) {
        return false;
      }
      if (
        replayableOnly &&
        delivery.status !== "failed" &&
        delivery.status !== "pending"
      ) {
        return false;
      }
      return true;
    });

    return NextResponse.json({
      success: true,
      webhook: safeWebhook,
      deliveries: safeDeliveries,
    });
  } catch (error) {
    if (error instanceof SocialWebhookNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get social webhook",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ webhookId: string }> },
): Promise<NextResponse<WebhookDeleteResponse>> {
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

    const { webhookId } = await params;
    await deleteSocialWebhook(result.session.workspace.id, webhookId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SocialWebhookNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete social webhook",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ webhookId: string }> },
): Promise<NextResponse<WebhookPatchResponse>> {
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

    const { webhookId } = await params;
    const body = (await request.json()) as WebhookPatchRequest;

    if (body.targetUrl !== undefined) {
      if (!body.targetUrl.trim()) {
        return NextResponse.json(
          { success: false, error: "targetUrl must be a non-empty string." },
          { status: 400 },
        );
      }
      if (!isValidWebhookTargetUrl(body.targetUrl.trim())) {
        return NextResponse.json(
          {
            success: false,
            error: "targetUrl must be a valid https URL.",
          },
          { status: 400 },
        );
      }
    }

    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { success: false, error: "enabled must be a boolean." },
        { status: 400 },
      );
    }

    if (body.subscription !== undefined && !isRecord(body.subscription)) {
      return NextResponse.json(
        { success: false, error: "subscription must be an object." },
        { status: 400 },
      );
    }
    if (
      body.subscription &&
      body.subscription.enabled !== undefined &&
      typeof body.subscription.enabled !== "boolean"
    ) {
      return NextResponse.json(
        { success: false, error: "subscription.enabled must be a boolean." },
        { status: 400 },
      );
    }
    if (
      body.subscription &&
      body.subscription.filters !== undefined &&
      body.subscription.filters !== null &&
      !isRecord(body.subscription.filters)
    ) {
      return NextResponse.json(
        { success: false, error: "subscription.filters must be an object." },
        { status: 400 },
      );
    }

    const updatedWebhook = await updateSocialWebhook(
      result.session.workspace.id,
      webhookId,
      {
        ...(body.targetUrl !== undefined
          ? { targetUrl: body.targetUrl.trim() }
          : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      },
    );

    let updatedSubscription: Record<string, unknown> | null = null;
    if (body.subscription) {
      const subscriptions = await listSocialWebhookSubscriptions(
        result.session.workspace.id,
        { webhookId },
      );
      const primarySubscription = subscriptions[0];
      if (!primarySubscription) {
        throw new SocialWebhookSubscriptionNotFoundError();
      }
      updatedSubscription = await updateSocialWebhookSubscription(
        result.session.workspace.id,
        primarySubscription.id,
        {
          ...(body.subscription.name !== undefined
            ? { name: body.subscription.name }
            : {}),
          ...(body.subscription.enabled !== undefined
            ? { enabled: body.subscription.enabled }
            : {}),
          ...(body.subscription.filters !== undefined
            ? { filters: body.subscription.filters }
            : {}),
        },
      );
    }

    const { signingSecretEncrypted, ...safeWebhook } = updatedWebhook;
    return NextResponse.json({
      success: true,
      webhook: safeWebhook,
      subscription: updatedSubscription,
    });
  } catch (error) {
    if (
      error instanceof SocialWebhookNotFoundError ||
      error instanceof SocialWebhookSubscriptionNotFoundError
    ) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update social webhook",
      },
      { status: 500 },
    );
  }
}
