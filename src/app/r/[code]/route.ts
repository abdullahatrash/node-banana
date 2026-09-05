import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { CommercialError } from "@/lib/commercial/repository";
import { REFERRAL_CAPTURE_COOKIE, referralCaptureCookieOptions } from "@/lib/commercial/referral-capture";
import { getPublicAppUrl } from "@/lib/site-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function signUpUrl(request: NextRequest, state: "captured" | "unavailable"): URL {
  const target = new URL(getPublicAppUrl("/sign-up"), request.nextUrl.origin);
  target.searchParams.set("referral", state);
  return target;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  if (!isDatabaseConfigured()) return NextResponse.redirect(signUpUrl(request, "unavailable"), 302);
  const { code } = await params;
  try {
    const { COMMERCIAL } = await import("@/lib/commercial/production");
    const capture = await COMMERCIAL.captureReferralVisit({
      code,
      existingToken: request.cookies.get(REFERRAL_CAPTURE_COOKIE)?.value ?? null,
    });
    const response = NextResponse.redirect(signUpUrl(request, "captured"), 302);
    response.cookies.set(REFERRAL_CAPTURE_COOKIE, capture.token, referralCaptureCookieOptions());
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    if (!(error instanceof CommercialError)) throw error;
    const response = NextResponse.redirect(signUpUrl(request, "unavailable"), 302);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
}
