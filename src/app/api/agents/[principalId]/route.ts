import { NextRequest, NextResponse } from "next/server";
import { AGENT_AUTH_SERVICE } from "@/lib/agent-auth";
import {
  agentAuthErrorResponse,
  requireAgentManagerRole,
} from "@/lib/agent-auth/http";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import {
  parseAgentJson,
  requireAgentMutationRequest,
} from "@/lib/agent-auth/http-request";
import { z } from "zod";

type PrincipalContext = { params: Promise<{ principalId: string }> };
const principalStatusSchema = z
  .object({
    status: z.enum(["active", "suspended", "revoked"]),
  })
  .strict();

export const PATCH = withStudioAuth<PrincipalContext>(
  { route: "/api/agents/[principalId]", action: "write", permission: "workspaces:write" },
  async (request: NextRequest, authz, context) => {
    const denied = requireAgentManagerRole(authz.role);
    if (denied) return denied;
    const requestError = requireAgentMutationRequest(
      request,
      authz.workspaceId,
    );
    if (requestError) return requestError;
    try {
      const parsed = await parseAgentJson(request, principalStatusSchema);
      if (!parsed.success) return parsed.response;
      const body = parsed.data;
      const { principalId } = await context.params;
      const principal = await AGENT_AUTH_SERVICE.setPrincipalStatus({
        principalId,
        workspaceId: authz.workspaceId,
        actorUserId: authz.userId,
        status: body.status,
      });
      return NextResponse.json({
        success: true,
        principal: {
          id: principal.id,
          workspaceId: principal.workspaceId,
          name: principal.name,
          requestedAccess: principal.requestedAccess,
          status: principal.status,
          suspendedAt: principal.suspendedAt?.toISOString() ?? null,
          revokedAt: principal.revokedAt?.toISOString() ?? null,
        },
      });
    } catch (error) {
      return agentAuthErrorResponse(error);
    }
  },
);
