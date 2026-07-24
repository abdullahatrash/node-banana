import { NextRequest, NextResponse } from "next/server";
import { AGENT_AUTH_SERVICE } from "@/lib/agent-auth";
import { agentAuthErrorResponse } from "@/lib/agent-auth/http";
import { getPairingClientRateLimitKey } from "@/lib/agent-auth/request-client";
import { noStoreJson, parseAgentJson } from "@/lib/agent-auth/http-request";
import { z } from "zod";

const createPairingChallengeSchema = z
  .object({
    agentName: z.string().trim().min(1).max(120),
    keyName: z.string().trim().min(1).max(120).optional(),
    requestedAccess: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(32),
  })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const parsed = await parseAgentJson(request, createPairingChallengeSchema);
    if (!parsed.success) return parsed.response;
    const body = parsed.data;
    const result = await AGENT_AUTH_SERVICE.createPairingChallenge({
      agentName: body.agentName,
      keyName: body.keyName,
      requestedAccess: body.requestedAccess,
      clientRateLimitKey: getPairingClientRateLimitKey(request.headers),
    });
    return noStoreJson({
      success: true,
      challenge: result.challenge,
      expiresAt: result.expiresAt,
      confirmationPath: `/agents/pair/${encodeURIComponent(result.confirmationId)}`,
    });
  } catch (error) {
    return agentAuthErrorResponse(error);
  }
}
