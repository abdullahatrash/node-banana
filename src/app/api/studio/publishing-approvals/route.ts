import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import {
  publishingApprovalErrorResponse,
  requirePublishingApprovalWorkspace,
} from "@/lib/agent-runtime/publishing-approvals/http";
import { PRODUCTION_PUBLISHING_APPROVAL_SERVICE } from "@/lib/agent-runtime/publishing-approvals/production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const querySchema = z.object({
  status: z
    .enum(["pending", "approved", "denied", "expired", "consumed"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/publishing-approvals", action: "read", permission: "social:view" },
  async (request: NextRequest, authz) => {
    const workspaceError = requirePublishingApprovalWorkspace(
      request,
      authz.workspaceId,
    );
    if (workspaceError) return workspaceError;
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      status: url.searchParams.get("status") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    if (!parsed.success) {
      return noStoreJson(
        { success: false, error: "Invalid Approval list filters." },
        { status: 400 },
      );
    }
    try {
      const items = await PRODUCTION_PUBLISHING_APPROVAL_SERVICE.list({
        workspaceId: authz.workspaceId,
        filters: parsed.data.status ? { status: parsed.data.status } : {},
        limit: parsed.data.limit,
        viewer: { kind: "human", userId: authz.userId },
      });
      return noStoreJson({ success: true, items });
    } catch (error) {
      return publishingApprovalErrorResponse(error);
    }
  },
);
