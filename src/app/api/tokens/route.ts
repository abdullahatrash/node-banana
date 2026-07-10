import { NextRequest, NextResponse } from "next/server";

import {
  createApiToken,
  listApiTokens,
  type ApiTokenSummary,
  type CreatedApiToken,
} from "@/lib/api-tokens/repository";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";

const ROUTE = "/api/tokens";

interface TokensListResponse {
  success: boolean;
  tokens?: ApiTokenSummary[];
  error?: string;
}

interface TokenCreateResponse {
  success: boolean;
  token?: CreatedApiToken;
  error?: string;
}

function databaseUnavailable(): NextResponse<{
  success: false;
  error: string;
}> {
  return NextResponse.json(
    {
      success: false,
      error: "DATABASE_URL is not configured. Configure Postgres to use API tokens.",
    },
    { status: 503 },
  );
}

/** List the current workspace's API tokens (hashes never exposed). */
export async function GET(
  request: NextRequest,
): Promise<NextResponse<TokensListResponse>> {
  if (!isDatabaseConfigured()) {
    return databaseUnavailable();
  }

  const auth = await withApiPermission(request, {
    route: ROUTE,
    permission: "workspaces:read",
  });
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const tokens = await listApiTokens(auth.session.workspace.id);
    return NextResponse.json({ success: true, tokens });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to list API tokens",
      },
      { status: 500 },
    );
  }
}

/** Create a new API token; the raw secret is returned exactly once. */
export async function POST(
  request: NextRequest,
): Promise<NextResponse<TokenCreateResponse>> {
  if (!isDatabaseConfigured()) {
    return databaseUnavailable();
  }

  const auth = await withApiPermission(request, {
    route: ROUTE,
    permission: "workspaces:write",
  });
  if (!auth.authorized) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const rawName =
    body && typeof body === "object" && "name" in body
      ? (body as { name?: unknown }).name
      : undefined;
  const name = typeof rawName === "string" ? rawName.trim() : "";

  if (!name) {
    return NextResponse.json(
      { success: false, error: "A token name is required." },
      { status: 400 },
    );
  }

  try {
    const token = await createApiToken({
      workspaceId: auth.session.workspace.id,
      name,
      createdByUserId: auth.session.user.id,
    });
    return NextResponse.json({ success: true, token }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create API token",
      },
      { status: 500 },
    );
  }
}
