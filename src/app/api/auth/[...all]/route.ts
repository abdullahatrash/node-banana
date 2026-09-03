import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";
import { requireGovernanceStepUp } from "@/lib/governance/step-up-http";

export const dynamic = "force-dynamic";

const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;

const FACTOR_MUTATION_PATHS = new Set([
  "/api/auth/two-factor/enable",
  "/api/auth/two-factor/disable",
  "/api/auth/two-factor/generate-backup-codes",
]);

export async function POST(request: NextRequest) {
  if (FACTOR_MUTATION_PATHS.has(request.nextUrl.pathname)) {
    if (!request.headers.get("x-workspace-id")?.trim()) return Response.json({ success: false, error: "An explicit Workspace is required.", code: "WORKSPACE_REQUIRED" }, { status: 400 });
    const authz = await authorizeStudioRequest(request, { route: request.nextUrl.pathname, action: "write" });
    if (!authz.authorized) return authzErrorResponse(authz);
    const stepUpDenied = await requireGovernanceStepUp({ request, workspaceId: authz.workspaceId, userId: authz.userId, purpose: "auth.factor.change", resourceId: authz.userId });
    if (stepUpDenied) return stepUpDenied;
  }
  return handlers.POST(request);
}
