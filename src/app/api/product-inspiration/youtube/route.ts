import { NextResponse, type NextRequest } from "next/server";
import { configureYoutubeTrendDiscovery, listYoutubeTrendDiscovery, YoutubeTrendDiscoveryError, youtubeTrendCommandSchema } from "@/lib/product-surfaces/youtube-trend-discovery";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<undefined>({ route: "/api/product-inspiration/youtube", action: "read", permission: "product:read" }, async (_request, authz) => {
  const result = await listYoutubeTrendDiscovery(authz.workspaceId);
  return NextResponse.json({ success: true, ...result }, { headers: { "cache-control": "private, no-store" } });
});

export const POST = withStudioAuth<undefined>({ route: "/api/product-inspiration/youtube", action: "write", permission: "product:analytics:write" }, async (request: NextRequest, authz) => {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, code: "YOUTUBE_SOURCE_INVALID" }, { status: 400 }); }
  const parsed = youtubeTrendCommandSchema.safeParse(body);
  if (!parsed.success || request.headers.get("x-workspace-id") !== authz.workspaceId) return NextResponse.json({ success: false, code: "YOUTUBE_SOURCE_INVALID" }, { status: 400 });
  try {
    const source = await configureYoutubeTrendDiscovery({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    return NextResponse.json({ success: true, source }, { status: parsed.data.action === "enable" ? 201 : 200, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof YoutubeTrendDiscoveryError) return NextResponse.json({ success: false, code: error.code }, { status: error.code === "YOUTUBE_SOURCE_NOT_FOUND" ? 404 : 422, headers: { "cache-control": "private, no-store" } });
    throw error;
  }
});
