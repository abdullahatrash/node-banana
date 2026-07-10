import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { authorizePublicApiRequest } from "@/lib/api-tokens/auth";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";

const ROUTE = "/api/v1/workspaces";

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
}

interface WorkspacesResponse {
  success: boolean;
  workspaces?: WorkspaceItem[];
  error?: string;
}

/**
 * Public API v1: list the workspace(s) the caller can reach.
 *
 * Accepts either an `Authorization: Bearer nb_...` API token (scoped to exactly
 * one workspace) or an app session. This is the first endpoint proving the
 * Bearer path end-to-end.
 */
export async function GET(
  request: NextRequest,
): Promise<NextResponse<WorkspacesResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "DATABASE_URL is not configured. Configure Postgres to use the API.",
      },
      { status: 503 },
    );
  }

  const auth = await authorizePublicApiRequest(request, {
    route: ROUTE,
    permission: "workspaces:read",
  });

  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
      })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, auth.session.workspace.id),
          isNull(workspaces.deletedAt),
        ),
      );

    return NextResponse.json({
      success: true,
      workspaces: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to list workspaces",
      },
      { status: 500 },
    );
  }
}
