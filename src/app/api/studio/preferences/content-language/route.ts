import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import {
  getWorkspaceContentLanguage,
  updateWorkspaceContentLanguage,
} from "@/lib/product-surfaces/workspace-language-preferences";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/preferences/content-language", action: "read", permission: "product:read" },
  async (_request, authz) => noStoreJson({
    success: true,
    contentLanguage: await getWorkspaceContentLanguage(authz.workspaceId),
  }),
);

export const PATCH = withStudioAuth<undefined>(
  { route: "/api/studio/preferences/content-language", action: "write", permission: "product:content:write" },
  async (request: NextRequest, authz) => {
    let body: unknown;
    try { body = await request.json(); } catch { return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
    try {
      const contentLanguage = await updateWorkspaceContentLanguage({
        workspaceId: authz.workspaceId,
        contentLanguage: (body as Record<string, unknown>).contentLanguage,
      });
      return noStoreJson({ success: true, contentLanguage });
    } catch (error) {
      const code = error instanceof Error ? error.message : "CONTENT_LANGUAGE_UNAVAILABLE";
      return noStoreJson({ success: false, code }, { status: code.endsWith("INVALID") ? 400 : 503 });
    }
  },
);
