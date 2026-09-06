import { NextResponse } from "next/server";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { COMMERCIAL, MERCHANT_OF_RECORD } from "@/lib/commercial/production";
export const POST = withStudioAuth<undefined>({ route: "/api/studio/billing/portal", action: "write", permission: "product:billing:manage" }, async (_request, authz) => {
  const { subscription } = await COMMERCIAL.summary(authz.workspaceId); if (!subscription?.merchantCustomerRef) return NextResponse.json({ success: false, code: "MERCHANT_ACCOUNT_NOT_READY" }, { status: 422 });
  const portal = await MERCHANT_OF_RECORD.createPortal({ workspaceId: authz.workspaceId, customerRef: subscription.merchantCustomerRef, returnPath: "/settings?section=billing" });
  if (portal.kind !== "ready") return NextResponse.json({ success: false, code: "MERCHANT_PORTAL_UNAVAILABLE" }, { status: 503 });
  if (!URL.canParse(portal.url)) return NextResponse.json({ success: false, code: "MERCHANT_PORTAL_UNSAFE" }, { status: 502 });
  const portalUrl = new URL(portal.url);
  if (portalUrl.protocol !== "https:") return NextResponse.json({ success: false, code: "MERCHANT_PORTAL_UNSAFE" }, { status: 502 });
  return NextResponse.json({ success: true, portal: { url: portalUrl.toString(), expiresAt: portal.expiresAt.toISOString() } });
});
