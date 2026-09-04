import { NextResponse } from "next/server";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { COMMERCIAL } from "@/lib/commercial/production";
import { publicCommercialCommandSchema } from "@/lib/commercial/schemas";
import { CommercialError } from "@/lib/commercial/repository";

const failed = (error: unknown) => error instanceof CommercialError ? NextResponse.json({ success: false, code: error.code }, { status: error.code.includes("EXISTS") || error.code.includes("USED") ? 409 : 422 }) : Promise.reject(error);
export const GET = withStudioAuth<undefined>({ route: "/api/studio/billing", action: "read", permission: "product:billing:read" }, async (_request, authz) => NextResponse.json({ success: true, data: await COMMERCIAL.summary(authz.workspaceId) }));
export const POST = withStudioAuth<undefined>({ route: "/api/studio/billing", action: "write", permission: "product:billing:manage" }, async (request, authz) => {
  const parsed = publicCommercialCommandSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_BILLING_COMMAND" }, { status: 400 });
  try {
    if (parsed.data.action === "start_trial") return NextResponse.json({ success: true, result: await COMMERCIAL.startTrial({ workspaceId: authz.workspaceId, userId: authz.userId, planId: parsed.data.planId, planVersion: parsed.data.planVersion, idempotencyKey: parsed.data.idempotencyKey }) });
    if (parsed.data.action === "accept_quote") return NextResponse.json({ success: true, result: await COMMERCIAL.acceptQuote({ workspaceId: authz.workspaceId, userId: authz.userId, quoteId: parsed.data.quoteId, idempotencyKey: parsed.data.idempotencyKey }) });
    return NextResponse.json({ success: true, result: await COMMERCIAL.createReferralCode({ workspaceId: authz.workspaceId, userId: authz.userId, rewardMode: parsed.data.rewardMode, idempotencyKey: parsed.data.idempotencyKey }) });
  } catch (error) { return failed(error); }
});
