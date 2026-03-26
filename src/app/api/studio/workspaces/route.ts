import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  getAuthenticatedUserFromHeaders,
  getDevFallbackUserId,
  getDevFallbackWorkspaceId,
  isDevAuthBypassEnabled,
  parseHeaderValue,
} from "@/lib/auth/session";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import { ensurePersonalWorkspaceForUser, ensureWorkspaceUser } from "@/lib/studio/repository";

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface WorkspacesResponse {
  success: boolean;
  workspaces?: WorkspaceItem[];
  error?: string;
}

async function getSessionUser(request: Request): Promise<{
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
}> {
  const user = await getAuthenticatedUserFromHeaders(request.headers);
  if (!user) {
    return {
      userId: null,
      userName: null,
      userEmail: null,
    };
  }

  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
  };
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<WorkspacesResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "DATABASE_URL is not configured. Configure Postgres to use workspace APIs.",
      },
      { status: 503 },
    );
  }

  const bypassEnabled = isDevAuthBypassEnabled();
  const sessionUser = await getSessionUser(request);
  const headerUserId = parseHeaderValue(request.headers.get("x-user-id"));
  const userId =
    sessionUser.userId ||
    (bypassEnabled ? headerUserId || getDevFallbackUserId() : null);

  if (!userId) {
    return NextResponse.json(
      {
        success: false,
        error: "Please sign in to access AI Studio.",
      },
      { status: 401 },
    );
  }

  if (bypassEnabled) {
    const devWorkspaceId = getDevFallbackWorkspaceId();
    await ensureWorkspaceUser(devWorkspaceId, userId);
  }

  try {
    const db = getDb();

    let rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          isNull(workspaces.deletedAt),
        ),
      );

    if (rows.length === 0 && !bypassEnabled) {
      await ensurePersonalWorkspaceForUser({
        userId,
        userName: sessionUser.userName,
        userEmail: sessionUser.userEmail,
      });

      rows = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          slug: workspaces.slug,
          role: workspaceMembers.role,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(
          and(
            eq(workspaceMembers.userId, userId),
            isNull(workspaces.deletedAt),
          ),
        );
    }

    return NextResponse.json({
      success: true,
      workspaces: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        role: row.role,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list workspaces",
      },
      { status: 500 },
    );
  }
}
