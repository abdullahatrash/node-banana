import { NextResponse } from "next/server";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { CHANNEL_ONBOARDING } from "@/lib/channel-onboarding/production";
import { ChannelOnboardingError } from "@/lib/channel-onboarding/repository";
type Context = { params: Promise<{ orderId: string }> };
export const GET = withStudioAuth<Context>({ route: "/api/studio/channel-onboarding/[orderId]", action: "read" }, async (_request, authz, context) => {
  try { return NextResponse.json({ success: true, data: await CHANNEL_ONBOARDING.detail(authz.workspaceId, (await context.params).orderId) }); }
  catch (error) { if (error instanceof ChannelOnboardingError) return NextResponse.json({ success: false, code: error.code }, { status: 404 }); throw error; }
});
