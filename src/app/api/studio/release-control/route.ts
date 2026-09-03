import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { ReleaseControlConflictError } from "@/lib/release-control/repository";
import { getReleaseControlService } from "@/lib/release-control/production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const idempotencyKey = (request: NextRequest) => request.headers.get("idempotency-key")?.trim() || "";

export const GET = withStudioAuth<undefined>({ route: "/api/studio/release-control", action: "read" }, async (request: NextRequest, authz) => {
  const service = getReleaseControlService();
  const [snapshot, readiness] = await Promise.all([service.snapshot(authz.workspaceId), service.readiness(authz.workspaceId)]);
  return noStoreJson({ success: true, snapshot, readiness });
});

export const POST = withStudioAuth<undefined>({ route: "/api/studio/release-control", action: "write" }, async (request: NextRequest, authz) => {
  const key = idempotencyKey(request);
  if (key.length < 8 || key.length > 200) return noStoreJson({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  try {
    const result = await getReleaseControlService().append(authz.workspaceId, authz.userId, await request.json(), key);
    return noStoreJson({ success: true, ...result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof ReleaseControlConflictError) return noStoreJson({ success: false, code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
    throw error;
  }
});
