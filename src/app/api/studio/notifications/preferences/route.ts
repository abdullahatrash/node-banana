import { type NextRequest, NextResponse } from "next/server";
import { WORKSPACE_NOTIFICATIONS } from "@/lib/product-notifications/production";
import { withApiPermission } from "@/lib/studio/authz";

export async function GET(request: NextRequest) {
  const auth = await withApiPermission(request, { route: "/api/studio/notifications/preferences", permission: "workspaces:read" });
  if (!auth.authorized) return auth.response;
  return NextResponse.json({ success: true, preferences: await WORKSPACE_NOTIFICATIONS.getPreferences(auth.session.workspace.id, auth.session.user.id) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: NextRequest) {
  const auth = await withApiPermission(request, { route: "/api/studio/notifications/preferences", permission: "workspaces:read" });
  if (!auth.authorized) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, code: "INVALID_JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ success: false, code: "INVALID_PREFERENCES" }, { status: 422 });
  const value = body as Record<string, unknown>;
  if (![null, "ar", "en"].includes(value.deliveryLocale as null | string) || typeof value.billingEmailEnabled !== "boolean" || Object.keys(value).some((key) => !["deliveryLocale", "billingEmailEnabled"].includes(key))) return NextResponse.json({ success: false, code: "INVALID_PREFERENCES" }, { status: 422 });
  const preferences = await WORKSPACE_NOTIFICATIONS.updatePreferences({ workspaceId: auth.session.workspace.id, userId: auth.session.user.id, deliveryLocale: value.deliveryLocale as "ar" | "en" | null, billingEmailEnabled: value.billingEmailEnabled });
  return NextResponse.json({ success: true, preferences }, { headers: { "Cache-Control": "private, no-store" } });
}
