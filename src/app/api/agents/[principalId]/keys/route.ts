import { NextRequest } from "next/server";
import { AGENT_AUTH_SERVICE } from "@/lib/agent-auth";
import {
  agentAuthErrorResponse,
  requireAgentManagerRole,
} from "@/lib/agent-auth/http";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import {
  noStoreJson,
  parseAgentJson,
  requireAgentMutationRequest,
} from "@/lib/agent-auth/http-request";
import { z } from "zod";

type PrincipalContext = { params: Promise<{ principalId: string }> };
const rotateKeySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const POST = withStudioAuth<PrincipalContext>(
  { route: "/api/agents/[principalId]/keys", action: "write" },
  async (request: NextRequest, authz, context) => {
    const denied = requireAgentManagerRole(authz.role);
    if (denied) return denied;
    const requestError = requireAgentMutationRequest(
      request,
      authz.workspaceId,
    );
    if (requestError) return requestError;
    try {
      const parsed = await parseAgentJson(request, rotateKeySchema);
      if (!parsed.success) return parsed.response;
      const body = parsed.data;
      const expiresAt =
        body.expiresAt === undefined ? undefined : new Date(body.expiresAt);
      const { principalId } = await context.params;
      const result = await AGENT_AUTH_SERVICE.rotateKey({
        principalId,
        workspaceId: authz.workspaceId,
        actorUserId: authz.userId,
        name: body.name,
        expiresAt,
      });
      return noStoreJson({
        success: true,
        agentKey: result.agentKey,
        key: {
          id: result.key.id,
          principalId: result.key.principalId,
          name: result.key.name,
          lookupPrefix: result.key.lookupPrefix,
          expiresAt: result.key.expiresAt?.toISOString() ?? null,
          createdAt: result.key.createdAt.toISOString(),
        },
      });
    } catch (error) {
      return agentAuthErrorResponse(error);
    }
  },
);
