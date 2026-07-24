import { NextRequest, NextResponse } from "next/server";
import { AGENT_AUTH_SERVICE } from "@/lib/agent-auth";
import { agentAuthErrorResponse } from "@/lib/agent-auth/http";
import { getPairingClientRateLimitKey } from "@/lib/agent-auth/request-client";
import { noStoreJson, parseAgentJson } from "@/lib/agent-auth/http-request";
import { z } from "zod";

const redeemPairingSchema = z
  .object({
    challenge: z.string().trim().min(1),
    keyExpiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const parsed = await parseAgentJson(request, redeemPairingSchema);
    if (!parsed.success) return parsed.response;
    const body = parsed.data;
    const keyExpiresAt =
      body.keyExpiresAt === undefined
        ? undefined
        : new Date(body.keyExpiresAt);
    const result = await AGENT_AUTH_SERVICE.redeemPairing({
      challenge: body.challenge,
      clientRateLimitKey: getPairingClientRateLimitKey(request.headers),
      keyExpiresAt,
    });
    return noStoreJson({
      success: true,
      agentKey: result.agentKey,
      principal: {
        id: result.principal.id,
        workspaceId: result.principal.workspaceId,
        name: result.principal.name,
        status: result.principal.status,
      },
      key: result.key,
    });
  } catch (error) {
    return agentAuthErrorResponse(error);
  }
}
