import { NextResponse, type NextRequest } from "next/server";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";
import { internalCommercialCommandSchema } from "@/lib/commercial/schemas";
import { COMMERCIAL } from "@/lib/commercial/production";
import { CommercialError } from "@/lib/commercial/repository";
export async function POST(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  const parsed = internalCommercialCommandSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_COMMERCIAL_COMMAND" }, { status: 400 });
  try {
    const command = parsed.data;
    if (command.action === "publish_plan") { const { action: _action, effectiveAt, ...input } = command; return NextResponse.json({ success: true, result: await COMMERCIAL.publishPlan({ ...input, status: "active", effectiveAt: new Date(effectiveAt), retiredAt: null, createdAt: new Date() }) }); }
    if (command.action === "issue_quote") { const { action: _action, expiresAt, ...input } = command; return NextResponse.json({ success: true, result: await COMMERCIAL.issueQuote({ ...input, expiresAt: new Date(expiresAt) }) }); }
    if (command.action === "reserve_quote") { const { action: _action, ...input } = command; return NextResponse.json({ success: true, result: await COMMERCIAL.reserveQuote(input) }); }
    if (command.action === "settle_reservation") { const { action: _action, ...input } = command; return NextResponse.json({ success: true, result: await COMMERCIAL.settleReservation(input) }); }
    if (command.action === "grant_purchased_credits") { const { action: _action, ...input } = command; return NextResponse.json({ success: true, result: await COMMERCIAL.grantPurchasedCredits(input) }); }
    if (command.action === "attribute_referral") { const { action: _action, ...input } = command; return NextResponse.json({ success: true, result: await COMMERCIAL.attributeReferral(input) }); }
    if (command.action === "decide_referral") { const { action: _action, ...input } = command; return NextResponse.json({ success: true, result: await COMMERCIAL.decideReferral(input) }); }
    const { action: _action, periodEndsAt, graceEndsAt, ...input } = command; return NextResponse.json({ success: true, result: await COMMERCIAL.transitionSubscription({ ...input, periodEndsAt: new Date(periodEndsAt), graceEndsAt: graceEndsAt ? new Date(graceEndsAt) : null }) });
  } catch (error) { if (error instanceof CommercialError) return NextResponse.json({ success: false, code: error.code }, { status: 422 }); throw error; }
}
