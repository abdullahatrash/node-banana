import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runMicrofrontendsMiddleware } from "@vercel/microfrontends/next/middleware";
import { getSiteRedirect, normalizeOrigin } from "./lib/site-routing";

export async function proxy(request: NextRequest) {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const hostname = (
    forwardedHost ||
    request.headers.get("host") ||
    request.nextUrl.host
  ).split(":")[0];
  const redirectUrl = getSiteRedirect({
    requestUrl: request.url,
    hostname,
    marketingOrigin: normalizeOrigin(process.env.NEXT_PUBLIC_MARKETING_URL),
    appOrigin: normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
  });

  if (redirectUrl) {
    return NextResponse.redirect(redirectUrl, 308);
  }

  // Phase 1: all /editor/* routes go directly to the OpenCut microfrontend.
  // Phase 2 can add flag values here to gate access by plan.
  const response = await runMicrofrontendsMiddleware({
    request,
    flagValues: {},
  });

  if (response) return response;
}

export const config = {
  matcher: [
    "/",
    "/agents/:path*",
    "/dashboard/:path*",
    "/sign-in",
    "/sign-up",
    "/simple-studio/:path*",
    "/social/:path*",
    "/studio/:path*",
    "/.well-known/vercel/microfrontends/client-config",
    "/editor/:path*",
  ],
};
