import {
  getAuthenticatedUserFromHeaders,
  getDevFallbackUserId,
  getDevFallbackWorkspaceId,
} from "@/lib/auth/session";

export interface RequestContext {
  userId: string;
  workspaceId: string;
  hasAuthenticatedSession: boolean;
}

/**
 * Resolve request user/workspace context.
 *
 * Priority:
 * 1) Better Auth session
 * 2) Explicit headers (`x-user-id`, `x-workspace-id`)
 * 3) Local dev defaults from env
 */
export async function resolveRequestContext(request: Request): Promise<RequestContext> {
  const fallbackUserId = getDevFallbackUserId();
  const fallbackWorkspaceId = getDevFallbackWorkspaceId();

  const headerUserId = request.headers.get("x-user-id") || undefined;
  const headerWorkspaceId = request.headers.get("x-workspace-id") || undefined;

  const sessionUser = await getAuthenticatedUserFromHeaders(request.headers);
  if (sessionUser?.id) {
    return {
      userId: sessionUser.id,
      workspaceId: headerWorkspaceId || fallbackWorkspaceId,
      hasAuthenticatedSession: true,
    };
  }

  return {
    userId: headerUserId || fallbackUserId,
    workspaceId: headerWorkspaceId || fallbackWorkspaceId,
    hasAuthenticatedSession: false,
  };
}
