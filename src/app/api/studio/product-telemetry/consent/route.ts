import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getReleaseControlService } from "@/lib/release-control/production";
import { ReleaseControlConflictError } from "@/lib/release-control/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const inputSchema = z.discriminatedUnion("status", [z.object({ status: z.literal("active"), expiresAt: z.string().datetime({ offset: true }) }).strict(), z.object({ status: z.literal("revoked") }).strict()]);
export const GET = withStudioAuth<undefined>({ route: "/api/studio/product-telemetry/consent", action: "read", permission: "product:read" }, async (_request, authz) => noStoreJson({ success: true, consent: await getReleaseControlService().getTelemetryConsent(authz.workspaceId, authz.userId) }));
export const POST = withStudioAuth<undefined>({ route: "/api/studio/product-telemetry/consent", action: "read", permission: "product:read" }, async (request: NextRequest, authz) => {
  const key = request.headers.get("idempotency-key")?.trim() || ""; if (key.length < 8 || key.length > 200) return noStoreJson({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  try { const input = inputSchema.parse(await request.json()); const result = await getReleaseControlService().setTelemetryConsent(authz.workspaceId, authz.userId, input.status, input.status === "active" ? new Date(input.expiresAt) : new Date(), key); return noStoreJson({ success: true, ...result }, { status: result.replayed ? 200 : 201 }); }
  catch (error) { if (error instanceof ReleaseControlConflictError) return noStoreJson({ success: false, code: "IDEMPOTENCY_CONFLICT" }, { status: 409 }); if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 }); throw error; }
});
