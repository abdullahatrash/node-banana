import { NextResponse, type NextRequest } from "next/server";
import { MERCHANT_ADJUSTMENT_INBOX, MERCHANT_CHECKOUTS, MERCHANT_FINANCIALS, MERCHANT_OF_RECORD, MERCHANT_SUBSCRIPTIONS } from "@/lib/commercial/production";
import { MerchantCheckoutError } from "@/lib/commercial/checkout";
import { MerchantSubscriptionLifecycleError } from "@/lib/commercial/subscription-lifecycle";
import { MerchantFinancialEvidenceError } from "@/lib/commercial/financial-evidence";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const verification = MERCHANT_OF_RECORD.verifyWebhook({ body, timestamp: request.headers.get("x-merchant-timestamp"), signature: request.headers.get("x-merchant-signature"), paddleSignature: request.headers.get("paddle-signature"), at: new Date() });
  if (verification.kind === "invalid") return NextResponse.json({ success: false, code: "INVALID_MERCHANT_SIGNATURE" }, { status: 401 });
  if (verification.kind === "ignored") return NextResponse.json({ success: true, result: { state: "ignored", reason: verification.reason } }, { status: 202 });
  try {
    let result: unknown;
    if (verification.kind === "checkout_event") {
      result = await MERCHANT_CHECKOUTS.applyVerifiedEvent(verification.event);
    } else if (verification.kind === "subscription_event") {
      result = await MERCHANT_SUBSCRIPTIONS.applyVerifiedEvent(verification.event);
      await MERCHANT_FINANCIALS.recordSubscription(verification.event);
    } else result = await MERCHANT_ADJUSTMENT_INBOX.applyVerifiedEvent(verification.event);
    const status = verification.kind === "adjustment_event" && ["received", "pending_dependency", "processing", "outcome_unknown"].includes((result as { state?: string }).state ?? "") ? 202 : 200;
    return NextResponse.json({ success: true, result }, { status });
  }
  catch (error) {
    if (error instanceof MerchantCheckoutError || error instanceof MerchantSubscriptionLifecycleError || error instanceof MerchantFinancialEvidenceError) return NextResponse.json({ success: false, code: error.code }, { status: error.code.includes("CONFLICT") || error.code.includes("MISMATCH") ? 409 : 422 });
    throw error;
  }
}
