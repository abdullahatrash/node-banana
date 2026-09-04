import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { configuredCatalog } from "@/lib/model-routing/catalog";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
export const GET = withStudioAuth<undefined>({ route: "/api/studio/model-routing/catalog", action: "read", permission: "product:read" }, async (request: NextRequest, authz) => request.headers.get("x-workspace-id") === authz.workspaceId ? noStoreJson({ success: true, snapshot: "2026-09", items: configuredCatalog() }) : noStoreJson({ success: false, code: "WORKSPACE_REQUIRED" }, { status: 400 }));
