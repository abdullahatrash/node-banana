import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { socialEvents } from "@/lib/db/schema";
import { ensureInternalSocialAuth } from "@/lib/social/internal-auth";
import {
  getSocialNotificationPreferences,
  markSocialEventReadForUser,
  SocialNotificationPreferencesNotFoundError,
} from "@/lib/social/repository";

interface DigestDispatchResponse {
  success: boolean;
  summary?: {
    scanned: number;
    digests: number;
    recipients: number;
    deduplicated: number;
    consumed: number;
  };
  digests?: Array<{
    recipientKey: string;
    userId: string;
    workspaceId: string;
    channels: Array<"in_app" | "email">;
    count: number;
    eventIds: string[];
    eventTypes: string[];
    messages: string[];
  }>;
  error?: string;
}

function positiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getRecipientKey(userId: string): string {
  return `user:${userId}`;
}

async function buildDigestDispatch(
  request: NextRequest,
): Promise<NextResponse<DigestDispatchResponse>> {
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
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim() || null;
    const batchSize = positiveInt(request.nextUrl.searchParams.get("batch")) ?? 100;
    const consume =
      request.method === "POST" &&
      (request.nextUrl.searchParams.get("consume") === "true" ||
        request.nextUrl.searchParams.get("markRead") === "true");

    const db = getDb();
    const conditions = [eq(socialEvents.userFacing, true), isNull(socialEvents.readAt)];
    if (workspaceId) {
      conditions.unshift(eq(socialEvents.workspaceId, workspaceId));
    }

    const events = await db
      .select({
        id: socialEvents.id,
        workspaceId: socialEvents.workspaceId,
        eventType: socialEvents.eventType,
        message: socialEvents.message,
        createdByUserId: socialEvents.createdByUserId,
        createdAt: socialEvents.createdAt,
        dispatchKey: socialEvents.dispatchKey,
      })
      .from(socialEvents)
      .where(and(...conditions))
      .orderBy(desc(socialEvents.createdAt))
      .limit(batchSize);

    const grouped = new Map<
      string,
      {
        recipientKey: string;
        userId: string;
        workspaceId: string;
        channels: Array<"in_app" | "email">;
        count: number;
        eventIds: string[];
        eventTypes: string[];
        messages: string[];
      }
    >();
    const seenDigestKeys = new Set<string>();
    const preferenceCache = new Map<
      string,
      {
        muteAll: boolean;
        inAppEnabled: boolean;
        emailEnabled: boolean;
      }
    >();

    for (const event of events) {
      if (!event.createdByUserId) {
        continue;
      }

      const recipientKey = getRecipientKey(event.createdByUserId);
      let preferences = preferenceCache.get(recipientKey);
      if (!preferences) {
        try {
          const row = await getSocialNotificationPreferences(
            event.workspaceId,
            event.createdByUserId,
          );
          preferences = {
            muteAll: row.muteAll,
            inAppEnabled: row.inAppEnabled,
            emailEnabled: row.emailEnabled,
          };
        } catch (error) {
          if (!(error instanceof SocialNotificationPreferencesNotFoundError)) {
            throw error;
          }
          // Default-safe policy: in-app on, digest email off.
          preferences = {
            muteAll: false,
            inAppEnabled: true,
            emailEnabled: false,
          };
        }
        preferenceCache.set(recipientKey, preferences);
      }

      if (preferences.muteAll) {
        continue;
      }

      const channels: Array<"in_app" | "email"> = [];
      if (preferences.inAppEnabled) {
        channels.push("in_app");
      }
      if (preferences.emailEnabled) {
        channels.push("email");
      }
      if (channels.length === 0) {
        continue;
      }

      const dedupeKey = `${recipientKey}:${event.dispatchKey ?? event.id}:${event.eventType}:${event.message}`;
      if (seenDigestKeys.has(dedupeKey)) {
        continue;
      }
      seenDigestKeys.add(dedupeKey);

      const existing = grouped.get(recipientKey);
      if (existing) {
        for (const channel of channels) {
          if (!existing.channels.includes(channel)) {
            existing.channels.push(channel);
          }
        }
        existing.count += 1;
        existing.eventIds.push(event.id);
        existing.eventTypes.push(event.eventType);
        existing.messages.push(event.message);
      } else {
        grouped.set(recipientKey, {
          recipientKey,
          userId: event.createdByUserId,
          workspaceId: event.workspaceId,
          channels,
          count: 1,
          eventIds: [event.id],
          eventTypes: [event.eventType],
          messages: [event.message],
        });
      }
    }

    let consumed = 0;
    if (consume) {
      for (const digest of grouped.values()) {
        for (const eventId of digest.eventIds) {
          await markSocialEventReadForUser({
            workspaceId: digest.workspaceId,
            eventId,
            userId: digest.userId,
          });
          consumed += 1;
        }
      }
    }

    const digests = Array.from(grouped.values());
    return NextResponse.json({
      success: true,
      summary: {
        scanned: events.length,
        digests: digests.length,
        recipients: grouped.size,
        deduplicated: events.length - digests.reduce((sum, digest) => sum + digest.eventIds.length, 0),
        consumed,
      },
      digests,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to dispatch social digests",
      },
      { status: 500 },
    );
  }
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<DigestDispatchResponse>> {
  return buildDigestDispatch(request);
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<DigestDispatchResponse>> {
  return buildDigestDispatch(request);
}
