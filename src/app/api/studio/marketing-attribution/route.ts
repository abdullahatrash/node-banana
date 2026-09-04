import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getMarketingAttributionService } from "@/lib/marketing-attribution/production";
import { MarketingAttributionConflictError } from "@/lib/marketing-attribution/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const command = z.discriminatedUnion("status", [z.object({ status: z.literal("active"), expiresAt: z.string().datetime({ offset: true }) }).strict(), z.object({ status: z.literal("revoked") }).strict()]);

export const GET = withStudioAuth<undefined>({ route: "/api/studio/marketing-attribution", action: "read", permission: "product:read" }, async (_request, authz) => noStoreJson({ success: true, status: await getMarketingAttributionService().status(authz.workspaceId, authz.userId) }));

export const POST = withStudioAuth<undefined>({ route: "/api/studio/marketing-attribution", action: "write", permission: "product:read" }, async (request: NextRequest, authz) => {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) return noStoreJson({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  try {
    const input = command.parse(await request.json());
    const result = await getMarketingAttributionService().setConsent({ workspaceId: authz.workspaceId, userId: authz.userId, status: input.status, expiresAt: input.status === "active" ? new Date(input.expiresAt) : new Date(), idempotencyKey });
    return noStoreJson({ success: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof MarketingAttributionConflictError) return noStoreJson({ success: false, code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) return noStoreJson({ success: false, code: error instanceof TypeError ? error.message : "INVALID_INPUT" }, { status: error instanceof TypeError && error.message === "ATTRIBUTION_NOT_CONFIGURED" ? 503 : 400 });
    throw error;
  }
});
