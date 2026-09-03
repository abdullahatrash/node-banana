import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import {
  getAuthenticatedUserFromHeaders,
  getDevFallbackUserId,
  getDevFallbackWorkspaceId,
  getServerAuthSession,
  isDevAuthBypassEnabled,
  parseHeaderValue,
} from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  workspaceMembers,
  workspaceSettings,
  workspaces,
  onboardingSessions,
  type WorkspaceRole,
} from "@/lib/db/schema";
import {
  ensureOrganizationMembership,
  ensureWorkspaceOrganizationMappingByWorkspaceId,
  ensurePersonalWorkspaceForUser,
  ensureWorkspaceUser,
} from "@/lib/studio/repository";
import { logger } from "@/utils/logger";
import { shouldRequireOnboarding } from "@/lib/onboarding/features";

export type ContentOSPlanTier = "free" | "pro" | "enterprise";

export type StudioPermission =
  | "workspaces:read"
  | "workspaces:write"
  | "workspaces:delete"
  | "projects:read"
  | "projects:write"
  | "projects:delete"
  | "assets:read"
  | "assets:write"
  | "assets:delete";

export type SocialPermission =
  | "social:view"
  | "social:connect"
  | "social:publish"
  | "social:manage";

export type ContentOSPermission = StudioPermission | SocialPermission;

type StudioAccessAction = "read" | "write" | "delete";

type AuthFailureReason = "unauthenticated" | "forbidden" | "invalid-workspace";

interface ContentOSWorkspaceContext {
  id: string;
  organizationId: string | null;
}

export interface ContentOSSession {
  /** Opaque server-validated session identity; never serialized to clients. */
  authContextId?: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
  };
  workspace: ContentOSWorkspaceContext;
  role: WorkspaceRole;
  planTier: ContentOSPlanTier;
  permissions: ContentOSPermission[];
}

interface StudioAuthorizationSuccess {
  authorized: true;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  authContextId: string;
  permissions: ContentOSPermission[];
  contentSession: ContentOSSession;
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

const STUDIO_ROLE_PERMISSIONS: Record<WorkspaceRole, StudioPermission[]> = {
  owner: [
    "workspaces:read",
    "workspaces:write",
    "workspaces:delete",
    "projects:read",
    "projects:write",
    "projects:delete",
    "assets:read",
    "assets:write",
    "assets:delete",
  ],
  admin: [
    "workspaces:read",
    "workspaces:write",
    "workspaces:delete",
    "projects:read",
    "projects:write",
    "projects:delete",
    "assets:read",
    "assets:write",
    "assets:delete",
  ],
  member: [
    "workspaces:read",
    "projects:read",
    "projects:write",
    "assets:read",
    "assets:write",
  ],
};

const SOCIAL_ROLE_PERMISSIONS: Record<WorkspaceRole, SocialPermission[]> = {
  owner: ["social:view", "social:connect", "social:publish", "social:manage"],
  admin: ["social:view", "social:connect", "social:publish", "social:manage"],
  member: ["social:view", "social:publish"],
};

export function getPermissionsForRole(role: WorkspaceRole): ContentOSPermission[] {
  return [...STUDIO_ROLE_PERMISSIONS[role], ...SOCIAL_ROLE_PERMISSIONS[role]];
}

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

function mapActionToPermission(
  route: string,
  action: StudioAccessAction,
): ContentOSPermission {
  const resource = route.includes("/projects")
    ? "projects"
    : route.includes("/assets")
      ? "assets"
      : "workspaces";

  if (resource === "projects") {
    if (action === "read") return "projects:read";
    if (action === "write") return "projects:write";
    return "projects:delete";
  }

  if (resource === "assets") {
    if (action === "read") return "assets:read";
    if (action === "write") return "assets:write";
    return "assets:delete";
  }

  if (action === "read") return "workspaces:read";
  if (action === "write") return "workspaces:write";
  return "workspaces:delete";
}

function hasPermission(
  permissions: ContentOSPermission[],
  permission: ContentOSPermission,
): boolean {
  return permissions.includes(permission);
}

function isAuthorizationFailure(
  value: ContentOSSession | StudioAuthorizationFailure,
): value is StudioAuthorizationFailure {
  return (
    "authorized" in value &&
    value.authorized === false
  );
}

async function getWorkspaceCandidates(userId: string) {
  const db = getDb();

  return db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      organizationId: workspaceSettings.organizationId,
      planTier: workspaceSettings.planTier,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        isNull(workspaces.deletedAt),
      ),
    );
}

function resolveActiveWorkspace(input: {
  candidates: Awaited<ReturnType<typeof getWorkspaceCandidates>>;
  headerWorkspaceId: string | null;
  sessionActiveOrganizationId: string | null;
}):
  | (Awaited<ReturnType<typeof getWorkspaceCandidates>>[number] & {
      planTier: ContentOSPlanTier;
    })
  | null {
  const withPlanTier = input.candidates.map((candidate) => ({
    ...candidate,
    planTier: (candidate.planTier ?? "free") as ContentOSPlanTier,
  }));

  if (withPlanTier.length === 0) {
    return null;
  }

  if (input.headerWorkspaceId) {
    return (
      withPlanTier.find(
        (candidate) => candidate.workspaceId === input.headerWorkspaceId,
      ) || null
    );
  }

  if (input.sessionActiveOrganizationId) {
    const byOrganization = withPlanTier.find(
      (candidate) =>
        candidate.organizationId === input.sessionActiveOrganizationId,
    );
    if (byOrganization) {
      return byOrganization;
    }
  }

  return withPlanTier[0] || null;
}

export function requireRole(
  session: ContentOSSession,
  roles: WorkspaceRole[],
): StudioAuthorizationFailure | null {
  if (roles.includes(session.role)) {
    return null;
  }

  return {
    authorized: false,
    status: 403,
    error: "You do not have the required role for this action.",
    reason: "forbidden",
  };
}

export async function getContentOSSession(
  request: Request,
  options: { route: string },
): Promise<ContentOSSession | StudioAuthorizationFailure> {
  const bypassEnabled = isDevAuthBypassEnabled();
  const authenticatedUser = await getAuthenticatedUserFromHeaders(request.headers);
  const headerUserId = parseHeaderValue(request.headers.get("x-user-id"));
  const userId =
    authenticatedUser?.id ||
    (bypassEnabled
      ? headerUserId || getDevFallbackUserId()
      : null);

  if (!userId) {
    return authFailure(
      options.route,
      "unauthenticated",
      401,
      "Please sign in to access AI Studio.",
    );
  }

  const headerWorkspaceId = parseHeaderValue(request.headers.get("x-workspace-id"));

  if (bypassEnabled) {
    const workspaceId = headerWorkspaceId || getDevFallbackWorkspaceId();
    await ensureWorkspaceUser(workspaceId, userId);

    const contentSession: ContentOSSession = {
      authContextId: `dev-bypass:${userId}`,
      user: {
        id: userId,
        name: authenticatedUser?.name ?? null,
        email: authenticatedUser?.email ?? null,
      },
      workspace: {
        id: workspaceId,
        organizationId: null,
      },
      role: "owner",
      planTier: "free",
      permissions: getPermissionsForRole("owner"),
    };

    return contentSession;
  }

  const rawSession = await getServerAuthSession(request.headers);
  if (rawSession?.user?.emailVerified !== true) {
    return authFailure(
      options.route,
      "forbidden",
      403,
      "Verify your email address before accessing the product.",
    );
  }
  if (shouldRequireOnboarding(userId)) {
    const [onboarding] = await getDb()
      .select({ status: onboardingSessions.status })
      .from(onboardingSessions)
      .where(eq(onboardingSessions.userId, userId))
      .limit(1);
    if (
      onboarding?.status !== "completed" &&
      onboarding?.status !== "completed_legacy"
    ) {
      return authFailure(
        options.route,
        "forbidden",
        403,
        "Complete onboarding before accessing the product.",
      );
    }
  } else {
    await ensurePersonalWorkspaceForUser({
      userId,
      userName: authenticatedUser?.name,
      userEmail: authenticatedUser?.email,
    });
  }
  const rawSessionData = rawSession?.session as
    | Record<string, unknown>
    | undefined;
  const sessionActiveOrganizationId = parseHeaderValue(
    typeof rawSessionData?.activeOrganizationId === "string"
      ? rawSessionData.activeOrganizationId
      : null,
  );
  const authContextId = parseHeaderValue(
    typeof rawSessionData?.id === "string" ? rawSessionData.id : null,
  );
  if (!authContextId) {
    return authFailure(
      options.route,
      "unauthenticated",
      401,
      "A current server session is required.",
    );
  }

  const candidates = await getWorkspaceCandidates(userId);
  const resolved = resolveActiveWorkspace({
    candidates,
    headerWorkspaceId,
    sessionActiveOrganizationId,
  });

  if (!resolved) {
    if (!headerWorkspaceId && candidates.length === 0) {
      return authFailure(
        options.route,
        "invalid-workspace",
        403,
        "Select a workspace to continue.",
      );
    }

    return authFailure(
      options.route,
      "forbidden",
      403,
      "No access to this workspace.",
    );
  }

  let organizationId = resolved.organizationId;
  if (!organizationId) {
    const mapped = await ensureWorkspaceOrganizationMappingByWorkspaceId(
      resolved.workspaceId,
    );
    organizationId = mapped.organizationId;
  }

  await ensureOrganizationMembership({
    workspaceId: resolved.workspaceId,
    userId,
    role: resolved.role,
  });

  const contentSession: ContentOSSession = {
    authContextId,
    user: {
      id: userId,
      name: authenticatedUser?.name ?? null,
      email: authenticatedUser?.email ?? null,
    },
    workspace: {
      id: resolved.workspaceId,
      organizationId,
    },
    role: resolved.role,
    planTier: resolved.planTier,
    permissions: getPermissionsForRole(resolved.role),
  };

  return contentSession;
}

export async function requireSession(
  request: Request,
  options: { route: string },
): Promise<ContentOSSession | StudioAuthorizationFailure> {
  return getContentOSSession(request, options);
}

export async function withApiPermission(
  request: Request,
  options: {
    route: string;
    permission: ContentOSPermission;
  },
): Promise<
  | {
      authorized: true;
      session: ContentOSSession;
    }
  | {
      authorized: false;
      response: NextResponse<{
        success: false;
        error: string;
      }>;
    }
> {
  const resolvedSession = await requireSession(request, { route: options.route });
  if (isAuthorizationFailure(resolvedSession)) {
    return {
      authorized: false,
      response: authzErrorResponse(resolvedSession),
    };
  }

  if (!hasPermission(resolvedSession.permissions, options.permission)) {
    return {
      authorized: false,
      response: authzErrorResponse(
        authFailure(
          options.route,
          "forbidden",
          403,
          "You do not have access to this workspace.",
        ),
      ),
    };
  }

  return {
    authorized: true,
    session: resolvedSession,
  };
}

export async function withApiAuthHandler<T>(
  request: Request,
  options: {
    route: string;
    permission: ContentOSPermission;
    handler: (session: ContentOSSession) => Promise<NextResponse<T>>;
  },
): Promise<
  | NextResponse<T>
  | NextResponse<{
      success: false;
      error: string;
    }>
> {
  const result = await withApiPermission(request, {
    route: options.route,
    permission: options.permission,
  });

  if (!result.authorized) {
    return result.response;
  }

  return options.handler(result.session);
}

export async function authorizeStudioRequest(
  request: Request,
  options: {
    route: string;
    action?: StudioAccessAction;
  },
): Promise<StudioAuthorizationResult> {
  const action = options.action ?? "read";
  const permission = mapActionToPermission(options.route, action);
  const permissionResult = await withApiPermission(request, {
    route: options.route,
    permission,
  });

  if (!permissionResult.authorized) {
    const data = await permissionResult.response.json();
    return authFailure(
      options.route,
      permissionResult.response.status === 401 ? "unauthenticated" : "forbidden",
      permissionResult.response.status === 401 ? 401 : 403,
      data.error,
    );
  }

  const session = permissionResult.session;
  if (!session.authContextId) {
    return authFailure(
      options.route,
      "unauthenticated",
      401,
      "A current server session is required.",
    );
  }

  return {
    authorized: true,
    userId: session.user.id,
    workspaceId: session.workspace.id,
    role: session.role,
    authContextId: session.authContextId,
    permissions: session.permissions,
    contentSession: session,
  };
}

export function authzErrorResponse(result: StudioAuthorizationFailure): NextResponse<{
  success: false;
  error: string;
}> {
  return noStoreJson(
    {
      success: false,
      error: result.error,
    },
    { status: result.status },
  );
}
