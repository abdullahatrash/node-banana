import { auth } from "@/lib/auth/server";

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
  const fallbackUserId = process.env.DEV_USER_ID || "local-user";
  const fallbackWorkspaceId = process.env.DEV_WORKSPACE_ID || "local-workspace";

  const headerUserId = request.headers.get("x-user-id") || undefined;
  const headerWorkspaceId = request.headers.get("x-workspace-id") || undefined;

  try {
    const session = await (auth as unknown as {
      api?: { getSession?: (args: { headers: Headers }) => Promise<{ user?: { id?: string } } | null> };
    }).api?.getSession?.({ headers: request.headers });

    const sessionUserId = session?.user?.id;
    if (sessionUserId) {
      return {
        userId: sessionUserId,
        workspaceId: headerWorkspaceId || fallbackWorkspaceId,
        hasAuthenticatedSession: true,
      };
    }
  } catch {
    // Non-breaking fallback for unauthenticated/development flows.
  }

  return {
    userId: headerUserId || fallbackUserId,
    workspaceId: headerWorkspaceId || fallbackWorkspaceId,
    hasAuthenticatedSession: false,
  };
}

