import { type NextRequest, NextResponse } from "next/server";
import { WORKSPACE_NOTIFICATIONS } from "@/lib/product-notifications/production";
import { WorkspaceNotificationError } from "@/lib/product-notifications/service";
import { withApiPermission } from "@/lib/studio/authz";

async function setRead(request: NextRequest, context: { params: Promise<{ eventId: string }> }, read: boolean) {
  const auth = await withApiPermission(request, { route: "/api/studio/notifications/:eventId/read", permission: "workspaces:read" });
  if (!auth.authorized) return auth.response;
  try {
    const { eventId } = await context.params;
    const result = await WORKSPACE_NOTIFICATIONS.setRead({ workspaceId: auth.session.workspace.id, eventId, userId: auth.session.user.id, read });
    return NextResponse.json({ success: true, result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceNotificationError && error.code === "NOTIFICATION_NOT_FOUND") return NextResponse.json({ success: false, code: error.code }, { status: 404 });
    throw error;
  }
}

export function POST(request: NextRequest, context: { params: Promise<{ eventId: string }> }) { return setRead(request, context, true); }
export function DELETE(request: NextRequest, context: { params: Promise<{ eventId: string }> }) { return setRead(request, context, false); }
