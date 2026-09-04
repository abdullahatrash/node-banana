import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runMicrofrontendsMiddleware } from "@vercel/microfrontends/next/middleware";
import { getSiteRedirect, normalizeOrigin } from "./lib/site-routing";
import { getPublicLocaleFromPath, localeCookieName } from "./i18n/config";

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

  const publicLocale = getPublicLocaleFromPath(request.nextUrl.pathname);
  if (publicLocale) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-interface-locale", publicLocale);
    requestHeaders.set(
      "x-interface-route",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    const localizedResponse = NextResponse.next({
      request: { headers: requestHeaders },
    });
    localizedResponse.cookies.set(localeCookieName, publicLocale, {
      path: "/",
      sameSite: "lax",
    });
    return localizedResponse;
  }

  // Phase 1: all /editor/* routes go directly to the OpenCut microfrontend.
  // Phase 2 can add flag values here to gate access by plan.
  const response = await runMicrofrontendsMiddleware({
    request,
    flagValues: {},
  });

  if (response) return response;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-interface-route",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/",
    "/ar/:path*",
    "/en/:path*",
    "/agents/:path*",
    "/ai-studio/:path*",
    "/analytics/:path*",
    "/approvals/:path*",
    "/automations/:path*",
    "/blitz/:path*",
    "/brand/:path*",
    "/calendar/:path*",
    "/channels/:path*",
    "/compose/:path*",
    "/content/:path*",
    "/dashboard/:path*",
    "/deliveries/:path*",
    "/influencers/:path*",
    "/inspiration/:path*",
    "/library/:path*",
    "/onboarding/:path*",
    "/sign-in",
    "/sign-up",
    "/verify-email",
    "/simple-studio/:path*",
    "/social/:path*",
    "/settings/:path*",
    "/studio/:path*",
    "/.well-known/vercel/microfrontends/client-config",
    "/editor/:path*",
  ],
};
