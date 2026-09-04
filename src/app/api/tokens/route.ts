import { NextRequest, NextResponse } from "next/server";

import {
  createApiToken,
  listApiTokens,
  type ApiTokenSummary,
  type CreatedApiToken,
} from "@/lib/api-tokens/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

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

/** List the current workspace's API tokens (hashes never exposed). */
export const GET = withStudioAuth<undefined>(
  { route: ROUTE, action: "read", permission: "workspaces:read" },
  async (
    _request: NextRequest,
    authz,
  ): Promise<NextResponse<TokensListResponse>> => {
    const tokens = await listApiTokens(authz.workspaceId);
    return NextResponse.json({ success: true, tokens });
  },
);

/** Create a new API token; the raw secret is returned exactly once. */
export const POST = withStudioAuth<undefined>(
  { route: ROUTE, action: "write", permission: "workspaces:write" },
  async (
    request: NextRequest,
    authz,
  ): Promise<NextResponse<TokenCreateResponse>> => {
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

    const token = await createApiToken({
      workspaceId: authz.workspaceId,
      name,
      createdByUserId: authz.userId,
    });

    return NextResponse.json({ success: true, token }, { status: 201 });
  },
);
