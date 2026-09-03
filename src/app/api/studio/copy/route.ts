import { NextRequest } from "next/server";
import { admittedGenerationRequired } from "@/lib/model-routing/legacy-boundary";
import { authorizeStudioRequest, authzErrorResponse } from "@/lib/studio/authz";

export const maxDuration = 60;

/** Disabled until text providers implement the admitted, brand-aware generation contract. */
export async function POST(request: NextRequest) {
  const authz = await authorizeStudioRequest(request, { route: "/api/studio/copy", action: "write" });
  if (!authz.authorized) return authzErrorResponse(authz);
  return admittedGenerationRequired("text");
}
