import { NextRequest, NextResponse } from "next/server";
import { exportSupportRecord } from "@/lib/product-support/export";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

type Context = { params: Promise<{ recordId: string }> };
export const GET = withStudioAuth<Context>({ route: "/api/product-support/[recordId]/export", action: "read", permission: "product:read" }, async (_request: NextRequest, authz, context) => {
  const { recordId } = await context.params;
  const exported = await exportSupportRecord({ workspaceId: authz.workspaceId, recordId });
  if (!exported) return NextResponse.json({ success: false, error: "Support record not found." }, { status: 404 });
  return new NextResponse(JSON.stringify(exported), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="support-${recordId.replaceAll(/[^A-Za-z0-9_-]/g, "_")}.json"`, "cache-control": "private, no-store" } });
});
