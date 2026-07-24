import { NextResponse } from "next/server";
import type { AgentPrincipalSummary } from "./types";
import { AgentAuthError, AgentValidationError } from "./service";

export function requireAgentManagerRole(role: string): NextResponse | null {
  if (role === "owner" || role === "admin") return null;
  return NextResponse.json(
    {
      success: false,
      error: "Only Workspace owners and admins can manage Agents.",
    },
    { status: 403 },
  );
}

export function agentAuthErrorResponse(error: unknown): NextResponse {
  if (error instanceof AgentAuthError) {
    const status =
      error.code === "PAIRING_RATE_LIMITED"
        ? 429
        : error.code === "AGENT_PRINCIPAL_NOT_FOUND" ||
      error.code === "AGENT_KEY_NOT_FOUND"
        ? 404
        : error.code === "PAIRING_SPONSOR_FORBIDDEN"
          ? 403
          : error.code === "PAIRING_CHALLENGE_REPLAYED" ||
              error.code === "AGENT_AUTHORITY_CONFLICT"
            ? 409
            : 400;
    const retryAfterSeconds = error.retryAfterMs
      ? Math.max(1, Math.ceil(error.retryAfterMs / 1000))
      : null;
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      {
        status,
        headers:
          status === 429 && retryAfterSeconds
            ? { "retry-after": String(retryAfterSeconds) }
            : undefined,
      },
    );
  }
  if (error instanceof AgentValidationError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 },
    );
  }
  throw error;
}

export function serializePrincipal(principal: AgentPrincipalSummary) {
  return {
    id: principal.id,
    workspaceId: principal.workspaceId,
    name: principal.name,
    requestedAccess: principal.requestedAccess,
    status: principal.status,
    suspendedAt: principal.suspendedAt?.toISOString() ?? null,
    revokedAt: principal.revokedAt?.toISOString() ?? null,
    createdAt: principal.createdAt.toISOString(),
    updatedAt: principal.updatedAt.toISOString(),
    keys: principal.keys.map((key) => ({
      id: key.id,
      principalId: key.principalId,
      name: key.name,
      lookupPrefix: key.lookupPrefix,
      authorizationScopes: key.authorizationScopes,
      expiresAt: key.expiresAt?.toISOString() ?? null,
      revokedAt: key.revokedAt?.toISOString() ?? null,
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      createdAt: key.createdAt.toISOString(),
    })),
  };
}
