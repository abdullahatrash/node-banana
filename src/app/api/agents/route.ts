import { NextResponse } from "next/server";
import { AGENT_AUTH_SERVICE } from "@/lib/agent-auth";
import {
  agentAuthErrorResponse,
  requireAgentManagerRole,
  serializePrincipal,
} from "@/lib/agent-auth/http";
import { requireExplicitAgentWorkspace } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<undefined>(
  { route: "/api/agents", action: "read", permission: "workspaces:read" },
  async (request, authz) => {
    const denied = requireAgentManagerRole(authz.role);
    if (denied) return denied;
    const workspaceError = requireExplicitAgentWorkspace(
      request,
      authz.workspaceId,
    );
    if (workspaceError) return workspaceError;
    try {
      const principals = await AGENT_AUTH_SERVICE.listPrincipals(
        authz.workspaceId,
        authz.userId,
      );
      return NextResponse.json({
        success: true,
        principals: principals.map(serializePrincipal),
      });
    } catch (error) {
      return agentAuthErrorResponse(error);
    }
  },
);
