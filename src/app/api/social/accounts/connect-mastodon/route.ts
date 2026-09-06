import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured, getDb } from "@/lib/db";
import { socialMastodonInstances } from "@/lib/db/schema";
import { withApiPermission } from "@/lib/studio/authz";
import "@/lib/social/runtime-bootstrap";
import { createOAuthState } from "@/lib/social/repository";
import { quotaExceededPayload } from "@/lib/social/limits";
import { getWorkspaceChannelEntitlement } from "@/lib/commercial/channel-entitlement";
import { countActiveSocialAccounts } from "@/lib/social/repository";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { logger } from "@/utils/logger";

interface ConnectMastodonRequest {
  instanceUrl: string;
}

interface ConnectMastodonResponse {
  success: boolean;
  authUrl?: string;
  error?: string;
  code?: string;
  billingUrl?: string;
}

const MASTODON_SCOPES = "read write:statuses write:media";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function normalizeInstanceUrl(raw: string): string {
  let url = raw.trim().toLowerCase();
  if (!url.startsWith("http")) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, "");
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ConnectMastodonResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/accounts/connect-mastodon",
      permission: "social:connect",
    });

    if (!result.authorized) {
      return result.response;
    }

    const body = (await request.json()) as ConnectMastodonRequest;

    if (!body.instanceUrl?.trim()) {
      return NextResponse.json(
        { success: false, error: "Instance URL is required." },
        { status: 400 },
      );
    }

    const entitlement = await getWorkspaceChannelEntitlement(result.session.workspace.id);
    const activeChannels = await countActiveSocialAccounts(
      result.session.workspace.id,
    );
    if (activeChannels >= entitlement.connectedChannels) {
      return NextResponse.json(
        quotaExceededPayload({
          section: "channels",
          current: activeChannels,
          limit: entitlement.connectedChannels,
        }),
        { status: 402 },
      );
    }

    const instanceUrl = normalizeInstanceUrl(body.instanceUrl);
    const db = getDb();

    let instance = await db.query.socialMastodonInstances.findFirst({
      where: eq(socialMastodonInstances.instanceUrl, instanceUrl),
    });

    if (!instance) {
      const origin =
        request.headers.get("origin") ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000";

      const appResponse = await fetch(`${instanceUrl}/api/v1/apps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Node Banana",
          redirect_uris: `${origin}/api/social/accounts/callback`,
          scopes: MASTODON_SCOPES,
          website: origin,
        }),
      });

      if (!appResponse.ok) {
        const text = await appResponse.text();
        throw new Error(
          `Failed to register app on ${instanceUrl}: ${appResponse.status} ${text}`,
        );
      }

      const app = (await appResponse.json()) as {
        client_id: string;
        client_secret: string;
      };

      let maxCharacters = 500;
      try {
        const instanceInfo = await fetch(`${instanceUrl}/api/v2/instance`);
        if (instanceInfo.ok) {
          const info = (await instanceInfo.json()) as {
            configuration?: { statuses?: { max_characters?: number } };
          };
          maxCharacters =
            info.configuration?.statuses?.max_characters ?? 500;
        }
      } catch {
        // default to 500
      }

      const now = new Date();
      const [row] = await db
        .insert(socialMastodonInstances)
        .values({
          id: nanoid(),
          instanceUrl,
          clientId: app.client_id,
          clientSecret: app.client_secret,
          maxCharacters,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      instance = row;

      logger.info("system", "Mastodon instance registered dynamically", {
        workspaceId: result.session.workspace.id,
        provider: "mastodon",
        postId: null,
        accountId: null,
        dispatchKey: instanceUrl,
        workflowRunRef: null,
      });
    }

    const state = randomBytes(16).toString("hex");
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";
    const callbackUrl = `${origin}/api/social/accounts/callback`;

    await createOAuthState({
      workspaceId: result.session.workspace.id,
      platform: "mastodon",
      state,
      codeVerifier: JSON.stringify({
        instanceUrl,
        clientId: instance.clientId,
        clientSecret: instance.clientSecret,
      }),
      metadata: { callbackUrl },
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });

    const authParams = new URLSearchParams({
      client_id: instance.clientId,
      response_type: "code",
      redirect_uri: callbackUrl,
      scope: MASTODON_SCOPES,
      state,
    });

    return NextResponse.json({
      success: true,
      authUrl: `${instanceUrl}/oauth/authorize?${authParams.toString()}`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to connect Mastodon instance";
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    );
  }
}
