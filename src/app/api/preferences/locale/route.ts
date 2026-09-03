import { NextResponse } from "next/server";
import { isAppLocale, localeCookieName, type AppLocale } from "@/i18n/config";
import { getAuthenticatedUserFromHeaders } from "@/lib/auth/session";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema";

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
  if (!user || !isDatabaseConfigured()) {
    return localeResponse(body.locale, 204);
  }

  const db = getDb();
  await db
    .insert(userPreferences)
    .values({ userId: user.id, interfaceLocale: body.locale })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { interfaceLocale: body.locale, updatedAt: new Date() },
    });

  const response = localeResponse(body.locale, 200);
  return response;
}

function isSameOrigin(origin: string | null, requestUrl: string) {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

function localeResponse(locale: AppLocale, status: 200 | 204) {
  const response = status === 204
    ? new NextResponse(null, { status })
    : NextResponse.json({ success: true, locale }, { status });
  response.headers.set("cache-control", "no-store");
  response.cookies.set(localeCookieName, locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });
  return response;
}
