import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getReleaseControlService } from "@/lib/release-control/production";
import { ReleaseControlConflictError } from "@/lib/release-control/repository";
import { classifyTelemetryRegion } from "@/lib/release-control/telemetry-region";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const POST = withStudioAuth<undefined>({ route: "/api/studio/product-telemetry", action: "write", permission: "product:read" }, async (request: NextRequest, authz) => {
  const key = request.headers.get("idempotency-key")?.trim() || "";
  if (key.length < 8 || key.length > 200) return noStoreJson({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  try {
    const result = await getReleaseControlService().telemetry(authz.workspaceId, authz.userId, authz.authContextId, classifyTelemetryRegion(request.headers), await request.json(), key);
    return noStoreJson({ success: true, ...result }, { status: result.replayed ? 200 : 202 });
  } catch (error) {
    if (error instanceof ReleaseControlConflictError) return noStoreJson({ success: false, code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) return noStoreJson({ success: false, code: "TELEMETRY_NOT_ALLOWLISTED" }, { status: 400 });
    throw error;
  }
});
