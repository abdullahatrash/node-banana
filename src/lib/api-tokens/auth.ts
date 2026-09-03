import { NextResponse } from "next/server";

import {
  authzErrorResponse,
  resolveWorkspaceMemberPermissions,
  isWorkspacePermissionAdmittedDuringClosure,
  withApiPermission,
  type ContentOSPermission,
  type ContentOSSession,
} from "@/lib/studio/authz";

import { resolveApiTokenAuthorityByRawToken } from "./repository";
import { API_TOKEN_PREFIX } from "./tokens";

const BEARER_SCHEME = "Bearer ";

/**
 * Permissions granted to a workspace-scoped API token. A token acts with owner
 * permissions *within its single workspace* — enough for agents to drive the
 * full surface, while tenant isolation is guaranteed by the fixed workspace id.
 *
 * Tradeoff: this is coarse (all-or-nothing per workspace). Per-token scopes /
 * least-privilege roles would require a `scopes` column and are deliberately
 * deferred; the workspace boundary is the security-critical guarantee here.
 */
const API_TOKEN_ROLE = "member" as const;

/**
 * Extract a raw Node Banana API token from an `Authorization: Bearer nb_...`
 * header. Returns null when the header is absent, uses another scheme, or the
 * value does not carry the `nb_` prefix.
 */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith(BEARER_SCHEME)) return null;

  const token = header.slice(BEARER_SCHEME.length).trim();
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;

  return token;
}

/** True when the request presents any `Authorization: Bearer` credential. */
export function hasBearerCredential(request: Request): boolean {
  const header = request.headers.get("authorization");
  return Boolean(header && header.startsWith(BEARER_SCHEME));
}

/**
 * Resolve a Bearer token to a ContentOS session scoped to the token's
 * workspace. Reuses the studio authz permission model so downstream handlers
 * behave identically to session-authenticated requests. Returns null for
 * missing, malformed, unknown, or revoked tokens.
 */
export async function resolveApiTokenSession(
  request: Request,
): Promise<ContentOSSession | null> {
  const raw = extractBearerToken(request);
  if (!raw) return null;

  const authority = await resolveApiTokenAuthorityByRawToken(raw);
  if (!authority) return null;
  const permissions = await resolveWorkspaceMemberPermissions({ workspaceId: authority.workspaceId, userId: authority.createdByUserId });

  return {
    user: {
      id: authority.createdByUserId,
      name: null,
      email: null,
    },
    workspace: {
      id: authority.workspaceId,
      organizationId: null,
    },
    role: API_TOKEN_ROLE,
    planTier: "free",
    permissions,
  };
}

type PublicApiAuthResult =
  | { authorized: true; session: ContentOSSession }
  | {
      authorized: false;
      response: NextResponse<{ success: false; error: string }>;
    };

/**
 * Authorize a public API v1 request. If an `Authorization: Bearer` header is
 * present, it is resolved through the token path exclusively (an invalid token
 * yields 401 rather than silently falling back). Otherwise the request is
 * delegated to the existing session-based studio authz layer, so both entry
 * points share one tenant-isolation implementation.
 */
export async function authorizePublicApiRequest(
  request: Request,
  options: { route: string; permission: ContentOSPermission },
): Promise<PublicApiAuthResult> {
  if (hasBearerCredential(request)) {
    const session = await resolveApiTokenSession(request);
    if (!session) {
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "Invalid or revoked API token." },
          { status: 401 },
        ),
      };
    }

    if (!session.permissions.includes(options.permission)) {
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "This token cannot access this resource." },
          { status: 403 },
        ),
      };
    }

    if (!(await isWorkspacePermissionAdmittedDuringClosure({ workspaceId: session.workspace.id, permission: options.permission }))) {
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "Workspace closure blocks new write operations." },
          { status: 403 },
        ),
      };
    }

    return { authorized: true, session };
  }

  const result = await withApiPermission(request, {
    route: options.route,
    permission: options.permission,
  });

  if (!result.authorized) {
    return result;
  }

  return { authorized: true, session: result.session };
}

export { authzErrorResponse };
