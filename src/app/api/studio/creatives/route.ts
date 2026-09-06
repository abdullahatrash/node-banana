import { noStoreJson } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { assertCreativeRelease, creativeHttpError } from "@/lib/creative-generation/http";
import { CreativeError } from "@/lib/creative-generation/contracts";
import { CREATIVE_GENERATION } from "@/lib/creative-generation/production";

export const POST = withStudioAuth<undefined>({ route: "/api/studio/creatives", action: "write", permission: "product:content:write" }, async (request, authz) => {
  try {
    assertCreativeRelease();
    const body = await request.json().catch(() => null);
    const key = request.headers.get("idempotency-key");
    if (!key || key.length < 8 || key.length > 200 || body?.idempotencyKey !== key || request.headers.get("x-workspace-id") !== authz.workspaceId) throw new CreativeError("creative.errors.invalidInput");
    const session = await CREATIVE_GENERATION.create({ workspaceId: authz.workspaceId, userId: authz.userId, role: authz.role, planTier: authz.contentSession.planTier }, body);
    return noStoreJson({ success: true, session }, { status: 201 });
  } catch (error) { return creativeHttpError(error); }
});
