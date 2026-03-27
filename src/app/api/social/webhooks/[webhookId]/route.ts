import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  deleteSocialWebhook,
  getSocialWebhook,
  listWebhookDeliveriesForWorkspace,
  SocialWebhookNotFoundError,
} from "@/lib/social/repository";

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
