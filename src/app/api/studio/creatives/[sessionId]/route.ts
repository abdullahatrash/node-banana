import { noStoreJson } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { assertCreativeRelease, creativeHttpError, dispatchCreativeCommand } from "@/lib/creative-generation/http";
import { CreativeError } from "@/lib/creative-generation/contracts";
import { CREATIVE_GENERATION } from "@/lib/creative-generation/production";

export const maxDuration = 300;
type Context = { params: Promise<{ sessionId: string }> };
export const GET = withStudioAuth<Context>({ route: "/api/studio/creatives/[sessionId]", action: "read", permission: "product:read" }, async (request, authz, context) => {
  try {
    assertCreativeRelease();
    if (request.headers.get("x-workspace-id") !== authz.workspaceId) throw new CreativeError("creative.errors.workspaceMismatch");
    const { sessionId } = await context.params;
    const result = await CREATIVE_GENERATION.get({ workspaceId: authz.workspaceId, userId: authz.userId, role: authz.role, planTier: authz.contentSession.planTier }, sessionId);
    return noStoreJson({ success: true, ...result });
  } catch (error) { return creativeHttpError(error); }
});
export const POST = withStudioAuth<Context>({ route: "/api/studio/creatives/[sessionId]", action: "write", permission: "product:content:write" }, async (request, authz, context) => {
  try {
    assertCreativeRelease();
    const key = request.headers.get("idempotency-key");
    if (!key || key.length < 8 || key.length > 200 || request.headers.get("x-workspace-id") !== authz.workspaceId) throw new CreativeError("creative.errors.invalidInput");
    const { sessionId } = await context.params;
    return await dispatchCreativeCommand({ workspaceId: authz.workspaceId, userId: authz.userId, role: authz.role, planTier: authz.contentSession.planTier }, sessionId, key, await request.json().catch(() => null), request.signal);
  } catch (error) { return creativeHttpError(error); }
});
