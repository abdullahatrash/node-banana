import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
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

function isDevBypassEnabled(): boolean {
  if (process.env.DEV_AUTH_BYPASS !== "true") return false;
  return process.env.NODE_ENV !== "production";
}

function parseHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function getSessionUser(request: Request): Promise<{
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
}> {
  try {
    const session = await (
      auth as unknown as {
        api?: {
          getSession?: (args: { headers: Headers }) => Promise<{
            user?: { id?: string; name?: string; email?: string };
          } | null>;
        };
      }
    ).api?.getSession?.({ headers: request.headers });

    return {
      userId: parseHeaderValue(session?.user?.id ?? null),
      userName: parseHeaderValue(session?.user?.name ?? null),
      userEmail: parseHeaderValue(session?.user?.email ?? null),
    };
  } catch {
    return {
      userId: null,
      userName: null,
      userEmail: null,
    };
  }
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

  const bypassEnabled = isDevBypassEnabled();
  const sessionUser = await getSessionUser(request);
  const headerUserId = parseHeaderValue(request.headers.get("x-user-id"));
  const userId =
    sessionUser.userId ||
    (bypassEnabled ? headerUserId || process.env.DEV_USER_ID || "local-user" : null);

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
    const devWorkspaceId = process.env.DEV_WORKSPACE_ID || "local-workspace";
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
