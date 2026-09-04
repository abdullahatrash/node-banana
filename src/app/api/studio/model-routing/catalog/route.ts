import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { configuredCatalog } from "@/lib/model-routing/catalog";
import { readProductionGenerationReadiness } from "@/lib/model-routing/production-readiness";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/model-routing/catalog", action: "read", permission: "product:read" },
  async (request: NextRequest, authz) => {
    if (request.headers.get("x-workspace-id") !== authz.workspaceId) {
      return noStoreJson({ success: false, code: "WORKSPACE_REQUIRED" }, { status: 400 });
    }

    const items = configuredCatalog();
    const generationReadiness = await readProductionGenerationReadiness(authz.workspaceId, items);
    return noStoreJson({ success: true, snapshot: "2026-09", items, generationReadiness });
  },
);
