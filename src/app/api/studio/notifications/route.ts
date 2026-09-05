import { type NextRequest, NextResponse } from "next/server";
import { WORKSPACE_NOTIFICATIONS } from "@/lib/product-notifications/production";
import { withApiPermission } from "@/lib/studio/authz";

export async function GET(request: NextRequest) {
  const auth = await withApiPermission(request, { route: "/api/studio/notifications", permission: "workspaces:read" });
  if (!auth.authorized) return auth.response;
  const unreadOnly = request.nextUrl.searchParams.get("unreadOnly") === "true";
  const parsed = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
  return NextResponse.json({ success: true, notifications: await WORKSPACE_NOTIFICATIONS.listForUser({ workspaceId: auth.session.workspace.id, userId: auth.session.user.id, unreadOnly, limit }) }, { headers: { "Cache-Control": "private, no-store" } });
}
