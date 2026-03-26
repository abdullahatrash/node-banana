import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { decryptToken } from "@/lib/social/crypto";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import {
  claimWebhookDelivery,
  listDueWebhookDeliveries,
  markWebhookDeliveryFailed,
  markWebhookDeliveryPendingRetry,
  markWebhookDeliverySuccess,
} from "@/lib/social/repository";
import { createWebhookSignature } from "@/lib/social/webhook-signing";
import { logger } from "@/utils/logger";

interface WebhookDeliveryResponse {
  success: boolean;
  summary?: {
    scanned: number;
    delivered: number;
    retried: number;
    failed: number;
    skipped: number;
  };
  error?: string;
}

const MAX_BATCH_SIZE = 100;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_ATTEMPTS = 6;

function positiveInteger(input: string | null): number | null {
  if (!input) return null;
  const value = Number.parseInt(input, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getBatchSize(request: NextRequest): number {
  const queryBatch = positiveInteger(request.nextUrl.searchParams.get("batch"));
  const envBatch = positiveInteger(process.env.SOCIAL_WEBHOOK_DELIVERY_BATCH_SIZE ?? null);

  return Math.min(MAX_BATCH_SIZE, queryBatch ?? envBatch ?? DEFAULT_BATCH_SIZE);
}

function getMaxAttempts(): number {
  return positiveInteger(process.env.SOCIAL_WEBHOOK_DELIVERY_MAX_ATTEMPTS ?? null)
    ?? DEFAULT_MAX_ATTEMPTS;
}

function webhookBackoffMs(attempt: number): number {
  const base = 60 * 1000;
  const exponential = base * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(6 * 60 * 60 * 1000, exponential);
}

function normalizeResponseBody(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 2000);
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<WebhookDeliveryResponse>> {
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
    const now = new Date();
    const batchSize = getBatchSize(request);
    const maxAttempts = getMaxAttempts();

    const dueDeliveries = await listDueWebhookDeliveries({
      now,
      limit: batchSize,
    });

    let delivered = 0;
    let retried = 0;
    let failed = 0;
    let skipped = 0;

    for (const delivery of dueDeliveries) {
      const claimed = await claimWebhookDelivery({
        deliveryId: delivery.deliveryId,
        now,
      });
      if (!claimed) {
        skipped += 1;
        continue;
      }

      const payloadObject = {
        id: delivery.eventId,
        type: delivery.eventType,
        message: delivery.message,
        severity: delivery.severity,
        userFacing: delivery.userFacing,
        createdAt: delivery.eventCreatedAt,
        workspaceId: delivery.workspaceId,
        postId: delivery.postId,
        accountId: delivery.accountId,
        provider: delivery.provider,
        dispatchKey: delivery.dispatchKey,
        workflowRunRef: delivery.workflowRunRef,
        metadata: delivery.metadata ?? {},
      };
      const payload = JSON.stringify(payloadObject);
      const timestamp = Date.now().toString();

      try {
        const signingSecret = decryptToken(delivery.signingSecretEncrypted);
        const signature = createWebhookSignature(signingSecret, payload, timestamp);

        const response = await fetch(delivery.targetUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-nodebanana-signature": signature,
            "x-nodebanana-timestamp": timestamp,
            "x-nodebanana-event-id": delivery.eventId,
            "x-nodebanana-webhook-id": delivery.webhookId,
          },
          body: payload,
        });

        const responseBody = normalizeResponseBody(await response.text());
        if (response.ok) {
          await markWebhookDeliverySuccess({
            deliveryId: delivery.deliveryId,
            responseStatus: response.status,
            responseBody,
          });
          delivered += 1;
          logger.info("system", "Social webhook delivered", {
            workspaceId: delivery.workspaceId,
            postId: delivery.postId,
            accountId: delivery.accountId,
            provider: delivery.provider,
            dispatchKey: delivery.dispatchKey,
            workflowRunRef: delivery.workflowRunRef,
            webhookId: delivery.webhookId,
            eventId: delivery.eventId,
            status: response.status,
          });
          continue;
        }

        const attempt = claimed.attemptCount;
        if (attempt >= maxAttempts) {
          await markWebhookDeliveryFailed({
            deliveryId: delivery.deliveryId,
            responseStatus: response.status,
            responseBody,
            lastError: `Webhook responded with status ${response.status}.`,
          });
          failed += 1;
          logger.error("system", "Social webhook delivery failed permanently", {
            workspaceId: delivery.workspaceId,
            postId: delivery.postId,
            accountId: delivery.accountId,
            provider: delivery.provider,
            dispatchKey: delivery.dispatchKey,
            workflowRunRef: delivery.workflowRunRef,
            webhookId: delivery.webhookId,
            eventId: delivery.eventId,
            status: response.status,
          });
          continue;
        }

        const nextAttemptAt = new Date(now.getTime() + webhookBackoffMs(attempt));
        await markWebhookDeliveryPendingRetry({
          deliveryId: delivery.deliveryId,
          nextAttemptAt,
          responseStatus: response.status,
          responseBody,
          lastError: `Webhook responded with status ${response.status}.`,
        });
        retried += 1;
        logger.warn("system", "Social webhook delivery scheduled retry", {
          workspaceId: delivery.workspaceId,
          postId: delivery.postId,
          accountId: delivery.accountId,
          provider: delivery.provider,
          dispatchKey: delivery.dispatchKey,
          workflowRunRef: delivery.workflowRunRef,
          webhookId: delivery.webhookId,
          eventId: delivery.eventId,
          status: response.status,
        });
      } catch (error) {
        const lastError = error instanceof Error ? error.message : "Unknown delivery error";
        const attempt = claimed.attemptCount;

        if (attempt >= maxAttempts) {
          await markWebhookDeliveryFailed({
            deliveryId: delivery.deliveryId,
            lastError,
          });
          failed += 1;
          logger.error("system", "Social webhook delivery errored permanently", {
            workspaceId: delivery.workspaceId,
            postId: delivery.postId,
            accountId: delivery.accountId,
            provider: delivery.provider,
            dispatchKey: delivery.dispatchKey,
            workflowRunRef: delivery.workflowRunRef,
            webhookId: delivery.webhookId,
            eventId: delivery.eventId,
            error: lastError,
          });
          continue;
        }

        const nextAttemptAt = new Date(now.getTime() + webhookBackoffMs(attempt));
        await markWebhookDeliveryPendingRetry({
          deliveryId: delivery.deliveryId,
          nextAttemptAt,
          lastError,
        });
        retried += 1;
        logger.warn("system", "Social webhook delivery errored and retry scheduled", {
          workspaceId: delivery.workspaceId,
          postId: delivery.postId,
          accountId: delivery.accountId,
          provider: delivery.provider,
          dispatchKey: delivery.dispatchKey,
          workflowRunRef: delivery.workflowRunRef,
          webhookId: delivery.webhookId,
          eventId: delivery.eventId,
          error: lastError,
        });
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        scanned: dueDeliveries.length,
        delivered,
        retried,
        failed,
        skipped,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to process social webhook deliveries",
      },
      { status: 500 },
    );
  }
}
