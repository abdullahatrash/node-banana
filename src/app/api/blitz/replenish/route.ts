import { NextResponse } from "next/server";
import { z } from "zod";
import { BlitzReplenisher } from "@/lib/product-surfaces/blitz-replenisher";
import { PRODUCTION_BLITZ_REPLENISHMENT_REPOSITORY } from "@/lib/product-surfaces/blitz-replenishment-repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const command = z.object({ campaignId: z.string().min(1).max(200), idempotencyKey: z.string().min(8).max(200) }).strict();

export const POST = withStudioAuth<undefined>({ route: "/api/blitz/replenish", action: "write", permission: "product:content:write" }, async (request, authz) => {
  const parsed = command.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "BLITZ_REPLENISHMENT_INVALID" }, { status: 400 });
  try {
    const result = await new BlitzReplenisher(PRODUCTION_BLITZ_REPLENISHMENT_REPOSITORY).replenish({ workspaceId: authz.workspaceId, campaignId: parsed.data.campaignId, invocation: "manual", actorUserId: authz.userId, sourceKey: `campaign-blitz:manual:${parsed.data.campaignId}:${parsed.data.idempotencyKey}` });
    return NextResponse.json({ success: true, result }, { status: result.kind === "busy" ? 202 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BLITZ_REPLENISHMENT_FAILED";
    return NextResponse.json({ success: false, code }, { status: code === "BLITZ_CAMPAIGN_NOT_ACTIVE" ? 409 : 422 });
  }
});
