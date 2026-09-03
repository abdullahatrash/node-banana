import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PRODUCTION_MODEL_ROUTING } from "@/lib/model-routing/production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
export const DELETE = withStudioAuth<{ params: Promise<Record<string, string>> }>({ route: "/api/studio/model-routing/authorizations/[authorizationId]", action: "write" }, async (request: NextRequest, authz, context) => {
  const parsed = id.safeParse((await context.params).authorizationId); if (!parsed.success || request.headers.get("x-workspace-id") !== authz.workspaceId) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  if (authz.role !== "owner" && authz.role !== "admin") return noStoreJson({ success: false, code: "FORBIDDEN" }, { status: 403 });
  const result = await PRODUCTION_MODEL_ROUTING.revokeAuthorization(authz.workspaceId, parsed.data, authz.userId); const status = result === "not_found" ? 404 : result === "conflict" ? 409 : 200; return noStoreJson({ success: status === 200, result }, { status });
});
