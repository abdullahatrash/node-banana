import { NextRequest } from "next/server";
import { admittedGenerationRequired } from "@/lib/model-routing/legacy-boundary";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";

export const maxDuration = 60;

/** Text execution remains closed until its adapters honor Generation Intent admission. */
export async function POST(request: NextRequest) {
  if (!request.headers.get("x-workspace-id")?.trim()) return Response.json({ success: false, error: "An explicit Workspace is required.", code: "WORKSPACE_REQUIRED" }, { status: 400 });
  const authz = await authorizeStudioRequest(request, { route: "/api/llm", action: "write", permission: "product:content:write" });
  if (!authz.authorized) return authzErrorResponse(authz);
  return admittedGenerationRequired("text");
}
