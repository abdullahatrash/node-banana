import { NextResponse, type NextRequest } from "next/server";
import { MERCHANT_CHECKOUTS, MERCHANT_OF_RECORD } from "@/lib/commercial/production";
import { MerchantCheckoutError } from "@/lib/commercial/checkout";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const event = MERCHANT_OF_RECORD.verifyWebhook({ body, timestamp: request.headers.get("x-merchant-timestamp"), signature: request.headers.get("x-merchant-signature"), at: new Date() });
  if (!event) return NextResponse.json({ success: false, code: "INVALID_MERCHANT_SIGNATURE" }, { status: 401 });
  try { return NextResponse.json({ success: true, result: await MERCHANT_CHECKOUTS.applyVerifiedEvent(event) }); }
  catch (error) { if (error instanceof MerchantCheckoutError) return NextResponse.json({ success: false, code: error.code }, { status: error.code.includes("CONFLICT") || error.code.includes("MISMATCH") ? 409 : 422 }); throw error; }
}
