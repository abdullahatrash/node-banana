import { NextResponse } from "next/server";
import { activeWorkspaceCookieName, isAppLocale, localeCookieName, type AppLocale } from "@/i18n/config";
import { getAuthenticatedUserFromHeaders } from "@/lib/auth/session";
import { isDatabaseConfigured } from "@/lib/db";
import { saveWorkspaceLocalePreference } from "@/lib/interface-locale/repository";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!isSameOrigin(origin, request.url)) {
    return NextResponse.json(
      { success: false, code: "INTERFACE_LOCALE_SAME_ORIGIN_REQUIRED" },
      { status: 403 },
    );
  }
  const body = await request.json().catch(() => null) as { locale?: unknown } | null;
  if (!isAppLocale(body?.locale)) {
    return NextResponse.json({ success: false, code: "INVALID_INTERFACE_LOCALE" }, { status: 400 });
  }

  const user = await getAuthenticatedUserFromHeaders(request.headers);
  const workspaceId = request.headers.get("x-workspace-id")?.trim();
  if (!user || !isDatabaseConfigured() || !workspaceId) {
    return localeResponse(body.locale, 204, null);
  }

  const outcome = await saveWorkspaceLocalePreference({
    userId: user.id,
    workspaceId,
    locale: body.locale,
  });
  if (outcome === "not_member") {
    return NextResponse.json(
      { success: false, code: "WORKSPACE_ACCESS_DENIED" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  return localeResponse(body.locale, 200, workspaceId);
}

function isSameOrigin(origin: string | null, requestUrl: string) {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

function localeResponse(locale: AppLocale, status: 200 | 204, workspaceId: string | null) {
  const response = status === 204
    ? new NextResponse(null, { status })
    : NextResponse.json({ success: true, locale }, { status });
  response.headers.set("cache-control", "no-store");
  response.cookies.set(localeCookieName, locale, {
    path: "/",
    sameSite: "lax",
  });
  if (workspaceId) response.cookies.set(activeWorkspaceCookieName, workspaceId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });
  return response;
}
