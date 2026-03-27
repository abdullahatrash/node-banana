import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import {
  listSocialWebhookDeliveryDeadLetters,
  markSocialWebhookDeliveryDeadLetterReplayRequested,
  markWebhookDeliveryPendingRetry,
} from "@/lib/social/repository";

interface WebhookReplayResponse {
  success: boolean;
  summary?: {
    scanned: number;
    replayed: number;
    skipped: number;
    failed: number;
  };
  deadLetters?: Awaited<ReturnType<typeof listSocialWebhookDeliveryDeadLetters>>;
  error?: string;
}

function positiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getReplayKey(request: NextRequest, body: Record<string, unknown>): string {
  const queryKey = request.nextUrl.searchParams.get("replayKey")?.trim();
  if (queryKey) return queryKey;

  const bodyKey = body.replayKey;
  if (typeof bodyKey === "string" && bodyKey.trim()) {
    return bodyKey.trim();
  }

  return `replay:${Date.now()}`;
}

function isAlreadyRequestedWithKey(
  metadata: unknown,
  replayKey: string,
): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }

  const replay = (metadata as Record<string, unknown>).replay;
  if (!replay || typeof replay !== "object" || Array.isArray(replay)) {
    return false;
  }

  return (replay as Record<string, unknown>).key === replayKey;
}

async function parseBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (request.method !== "POST") {
    return {};
  }

  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {};
    }
    return body as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function loadDeadLetters(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    throw new Error("workspaceId is required.");
  }

  const webhookId = request.nextUrl.searchParams.get("webhookId")?.trim() || undefined;
  const replayState =
    request.nextUrl.searchParams.get("replayState")?.trim() || undefined;
  const limit = positiveInt(request.nextUrl.searchParams.get("limit")) ?? 100;
  const offset = positiveInt(request.nextUrl.searchParams.get("offset")) ?? undefined;

  return listSocialWebhookDeliveryDeadLetters(workspaceId, {
    webhookId,
    replayState: replayState as
      | "dead_lettered"
      | "replay_requested"
      | "replayed"
      | "failed"
      | undefined,
    limit,
    offset,
  });
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<WebhookReplayResponse>> {
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
    const deadLetters = await loadDeadLetters(request);
    return NextResponse.json({
      success: true,
      summary: {
        scanned: deadLetters.length,
        replayed: 0,
        skipped: 0,
        failed: 0,
      },
      deadLetters,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to list webhook dead letters",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<WebhookReplayResponse>> {
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
    const body = await parseBody(request);
    const replayKey = getReplayKey(request, body);
    const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";
    const requestedDeadLetterId =
      typeof body.deadLetterId === "string" && body.deadLetterId.trim()
        ? body.deadLetterId.trim()
        : request.nextUrl.searchParams.get("deadLetterId")?.trim();

    const deadLetters = await loadDeadLetters(request);
    const candidates = requestedDeadLetterId
      ? deadLetters.filter((item) => item.deadLetterId === requestedDeadLetterId)
      : deadLetters;

    let replayed = 0;
    let skipped = 0;
    let failed = 0;

    if (!dryRun) {
      for (const item of candidates) {
        if (isAlreadyRequestedWithKey(item.replayMetadata, replayKey)) {
          skipped += 1;
          continue;
        }

        try {
          const now = new Date();
          await markSocialWebhookDeliveryDeadLetterReplayRequested({
            deadLetterId: item.deadLetterId,
            replayMetadata: {
              replay: {
                key: replayKey,
                requestedAt: now.toISOString(),
              },
            },
          });

          await markWebhookDeliveryPendingRetry({
            deliveryId: item.deliveryId,
            nextAttemptAt: now,
            responseStatus: item.responseStatus ?? undefined,
            responseBody: item.responseBody ?? undefined,
            lastError: `replay_requested:${replayKey}`,
          });

          replayed += 1;
        } catch {
          failed += 1;
        }
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        scanned: candidates.length,
        replayed: dryRun ? 0 : replayed,
        skipped,
        failed,
      },
      deadLetters: candidates,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to replay webhook dead letters",
      },
      { status: 500 },
    );
  }
}
