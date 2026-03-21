import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { workspaceMembers, workspaces, type WorkspaceRole } from "@/lib/db/schema";
import { ensureWorkspaceUser } from "@/lib/studio/repository";
import { logger } from "@/utils/logger";

type StudioAccessAction = "read" | "write" | "delete";

type AuthFailureReason = "unauthenticated" | "forbidden" | "invalid-workspace";

interface StudioAuthorizationSuccess {
  authorized: true;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

interface StudioAuthorizationFailure {
  authorized: false;
  status: 401 | 403;
  error: string;
  reason: AuthFailureReason;
}

export type StudioAuthorizationResult =
  | StudioAuthorizationSuccess
  | StudioAuthorizationFailure;

const deleteRoles = new Set<WorkspaceRole>(["owner", "admin"]);

function authFailure(
  route: string,
  reason: AuthFailureReason,
  status: 401 | 403,
  error: string,
): StudioAuthorizationFailure {
  logger.warn("system", "Studio authorization failed", {
    route,
    reason,
  });

  return {
    authorized: false,
    status,
    error,
    reason,
  };
}

function parseHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isDevBypassEnabled(): boolean {
  if (process.env.DEV_AUTH_BYPASS !== "true") {
    return false;
  }

  if (process.env.NODE_ENV === "production") {
    logger.warn("system", "Ignoring DEV_AUTH_BYPASS in production", {
      route: "studio-authz",
      reason: "invalid-workspace",
    });
    return false;
  }

  return true;
}

async function getSessionUserId(request: Request): Promise<string | null> {
  try {
    const session = await (
      auth as unknown as {
        api?: {
          getSession?: (args: { headers: Headers }) => Promise<{ user?: { id?: string } } | null>;
        };
      }
    ).api?.getSession?.({ headers: request.headers });

    const userId = parseHeaderValue(session?.user?.id ?? null);
    return userId;
  } catch {
    return null;
  }
}

async function getMembership(workspaceId: string, userId: string) {
  const db = getDb();

  const [membership] = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);

  return membership ?? null;
}

async function getDefaultWorkspaceForUser(userId: string): Promise<string | null> {
  const db = getDb();

  const [membership] = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)))
    .limit(1);

  return parseHeaderValue(membership?.workspaceId ?? null);
}

function canPerformAction(role: WorkspaceRole, action: StudioAccessAction): boolean {
  if (action === "delete") {
    return deleteRoles.has(role);
  }
  return true;
}

export async function authorizeStudioRequest(
  request: Request,
  options: {
    route: string;
    action?: StudioAccessAction;
  },
): Promise<StudioAuthorizationResult> {
  const action = options.action ?? "read";
  const bypassEnabled = isDevBypassEnabled();

  const sessionUserId = await getSessionUserId(request);
  const headerUserId = parseHeaderValue(request.headers.get("x-user-id"));
  const userId = sessionUserId || (bypassEnabled ? headerUserId || process.env.DEV_USER_ID || "local-user" : null);

  if (!userId) {
    return authFailure(
      options.route,
      "unauthenticated",
      401,
      "Please sign in to access AI Studio.",
    );
  }

  const headerWorkspaceId = parseHeaderValue(request.headers.get("x-workspace-id"));
  const workspaceId =
    headerWorkspaceId ||
    (bypassEnabled
      ? process.env.DEV_WORKSPACE_ID || "local-workspace"
      : await getDefaultWorkspaceForUser(userId));

  if (!workspaceId) {
    return authFailure(
      options.route,
      "invalid-workspace",
      403,
      "No access to this workspace.",
    );
  }

  if (bypassEnabled) {
    await ensureWorkspaceUser(workspaceId, userId);
    return {
      authorized: true,
      userId,
      workspaceId,
      role: "owner",
    };
  }

  const membership = await getMembership(workspaceId, userId);
  if (!membership) {
    return authFailure(
      options.route,
      "forbidden",
      403,
      "No access to this workspace.",
    );
  }

  if (!canPerformAction(membership.role, action)) {
    return authFailure(
      options.route,
      "forbidden",
      403,
      "Only workspace owners and admins can perform this action.",
    );
  }

  return {
    authorized: true,
    userId,
    workspaceId,
    role: membership.role,
  };
}

export function authzErrorResponse(result: StudioAuthorizationFailure): NextResponse<{
  success: false;
  error: string;
}> {
  return NextResponse.json(
    {
      success: false,
      error: result.error,
    },
    { status: result.status },
  );
}
