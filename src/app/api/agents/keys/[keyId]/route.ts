import { NextResponse } from "next/server";
import { AGENT_AUTH_SERVICE } from "@/lib/agent-auth";
import {
  agentAuthErrorResponse,
  requireAgentManagerRole,
} from "@/lib/agent-auth/http";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { requireAgentMutationRequest } from "@/lib/agent-auth/http-request";

type KeyContext = { params: Promise<{ keyId: string }> };

export const DELETE = withStudioAuth<KeyContext>(
  { route: "/api/agents/keys/[keyId]", action: "delete", permission: "workspaces:delete" },
  async (request, authz, context) => {
    const denied = requireAgentManagerRole(authz.role);
    if (denied) return denied;
    const requestError = requireAgentMutationRequest(
      request,
      authz.workspaceId,
    );
    if (requestError) return requestError;
    try {
      const { keyId } = await context.params;
      await AGENT_AUTH_SERVICE.revokeKey({
        keyId,
        workspaceId: authz.workspaceId,
        actorUserId: authz.userId,
      });
      return NextResponse.json({ success: true });
    } catch (error) {
      return agentAuthErrorResponse(error);
    }
  },
);
