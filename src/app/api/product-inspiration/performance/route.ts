import { NextResponse, type NextRequest } from "next/server";
import { recordWorkspacePerformanceObservation, workspacePerformanceObservationInputSchema, WorkspacePerformanceObservationError } from "@/lib/product-surfaces/workspace-performance-observations";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const POST = withStudioAuth<undefined>({ route: "/api/product-inspiration/performance", action: "write", permission: "product:analytics:write" }, async (request: NextRequest, authz) => {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ success: false, code: "PERFORMANCE_OBSERVATION_INVALID" }, { status: 400, headers: { "cache-control": "private, no-store" } }); }
  const parsed = workspacePerformanceObservationInputSchema.safeParse(body);
  if (!parsed.success || request.headers.get("x-workspace-id") !== authz.workspaceId) return NextResponse.json({ success: false, code: "PERFORMANCE_OBSERVATION_INVALID" }, { status: 400, headers: { "cache-control": "private, no-store" } });
  try {
    const result = await recordWorkspacePerformanceObservation({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    return NextResponse.json({ success: true, result }, { status: result.kind === "created" ? 201 : 200, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof WorkspacePerformanceObservationError) {
      const status = error.code === "PERFORMANCE_OBSERVATION_IDEMPOTENCY_CONFLICT" ? 409 : 422;
      return NextResponse.json({ success: false, code: error.code }, { status, headers: { "cache-control": "private, no-store" } });
    }
    throw error;
  }
});
