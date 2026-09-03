import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { ReleaseControlConflictError } from "@/lib/release-control/repository";
import { getReleaseControlService } from "@/lib/release-control/production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const querySchema = z.object({ buildId: z.string().min(1).max(120), routes: z.string().min(1), clients: z.string().min(1) }).strict();
const idempotencyKey = (request: NextRequest) => request.headers.get("idempotency-key")?.trim() || "";

export const GET = withStudioAuth<undefined>({ route: "/api/studio/release-control", action: "read" }, async (request: NextRequest, authz) => {
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const routes = query.data.routes.split(",").map((item) => item.trim()).filter((item) => item.startsWith("/"));
  const clients = query.data.clients.split(",").map((item) => item.trim()).filter(Boolean);
  if (!routes.length || !clients.length) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const service = getReleaseControlService();
  const [snapshot, readiness] = await Promise.all([service.snapshot(authz.workspaceId), service.readiness(authz.workspaceId, query.data.buildId, routes, clients)]);
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
