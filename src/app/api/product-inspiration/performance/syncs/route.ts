import { NextResponse, type NextRequest } from "next/server";
import { configurePerformanceSync, listPerformanceSyncs, performanceSyncCommandSchema, SocialPerformanceSyncError } from "@/lib/product-surfaces/social-performance-sync";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<undefined>({ route: "/api/product-inspiration/performance/syncs", action: "read", permission: "product:read" }, async (_request, authz) => {
  const syncs = await listPerformanceSyncs(authz.workspaceId);
  return NextResponse.json({ success: true, syncs }, { headers: { "cache-control": "private, no-store" } });
});

export const POST = withStudioAuth<undefined>({ route: "/api/product-inspiration/performance/syncs", action: "write", permission: "product:analytics:write" }, async (request: NextRequest, authz) => {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, code: "PERFORMANCE_SYNC_INVALID" }, { status: 400 }); }
  const parsed = performanceSyncCommandSchema.safeParse(body);
  if (!parsed.success || request.headers.get("x-workspace-id") !== authz.workspaceId) return NextResponse.json({ success: false, code: "PERFORMANCE_SYNC_INVALID" }, { status: 400 });
  try {
    const sync = await configurePerformanceSync({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    return NextResponse.json({ success: true, sync }, { status: parsed.data.action === "enable" ? 201 : 200, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SocialPerformanceSyncError) return NextResponse.json({ success: false, code: error.code }, { status: error.code === "PERFORMANCE_SYNC_NOT_FOUND" ? 404 : 422, headers: { "cache-control": "private, no-store" } });
    throw error;
  }
});
