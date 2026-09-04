import { NextResponse } from "next/server";
import { activeWorkspaceCookieName } from "@/i18n/config";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const POST = withStudioAuth<undefined>({
  route: "/api/preferences/workspace",
  action: "read",
  permission: "product:read",
}, async (request, authz) => {
  const origin = request.headers.get("origin");
  try {
    if (!origin || new URL(origin).origin !== new URL(request.url).origin) {
      return NextResponse.json({ success: false, code: "ACTIVE_WORKSPACE_SAME_ORIGIN_REQUIRED" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ success: false, code: "ACTIVE_WORKSPACE_SAME_ORIGIN_REQUIRED" }, { status: 403 });
  }
  const response = new NextResponse(null, { status: 204 });
  response.headers.set("cache-control", "no-store");
  response.cookies.set(activeWorkspaceCookieName, authz.workspaceId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });
  return response;
});
