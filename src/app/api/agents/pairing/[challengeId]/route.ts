import { NextRequest, NextResponse } from "next/server";
import { AGENT_AUTH_SERVICE } from "@/lib/agent-auth";
import {
  agentAuthErrorResponse,
  requireAgentManagerRole,
} from "@/lib/agent-auth/http";
import {
  requireAgentMutationRequest,
  requireExplicitAgentWorkspace,
} from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { requireGovernanceStepUp } from "@/lib/governance/step-up-http";

type PairingContext = { params: Promise<{ challengeId: string }> };

export const GET = withStudioAuth<PairingContext>(
  { route: "/api/agents/pairing/[challengeId]", action: "read", permission: "workspaces:read" },
  async (request, authz, context) => {
    const denied = requireAgentManagerRole(authz.role);
    if (denied) return denied;
    const workspaceError = requireExplicitAgentWorkspace(
      request,
      authz.workspaceId,
    );
    if (workspaceError) return workspaceError;
    try {
      const { challengeId } = await context.params;
      const challenge =
        await AGENT_AUTH_SERVICE.inspectPairingConfirmation(challengeId);
      return NextResponse.json({ success: true, challenge });
    } catch (error) {
      return agentAuthErrorResponse(error);
    }
  },
);

export const POST = withStudioAuth<PairingContext>(
  { route: "/api/agents/pairing/[challengeId]", action: "write", permission: "workspaces:write" },
  async (request: NextRequest, authz, context) => {
    const denied = requireAgentManagerRole(authz.role);
    if (denied) return denied;
    const requestError = requireAgentMutationRequest(
      request,
      authz.workspaceId,
    );
    if (requestError) return requestError;
    try {
      const { challengeId } = await context.params;
      const stepUpDenied = await requireGovernanceStepUp({ request, workspaceId: authz.workspaceId, userId: authz.userId, purpose: "agent.principal.create", resourceId: challengeId });
      if (stepUpDenied) return stepUpDenied;
      const approval = await AGENT_AUTH_SERVICE.approvePairingConfirmation({
        confirmationId: challengeId,
        workspaceId: authz.workspaceId,
        sponsorUserId: authz.userId,
      });
      return NextResponse.json({ success: true, approval });
    } catch (error) {
      return agentAuthErrorResponse(error);
    }
  },
);
