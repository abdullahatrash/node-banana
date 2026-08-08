import { NextRequest, NextResponse } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PRODUCTION_PUBLISHING_APPROVAL_AUDIT_ARTIFACTS } from "@/lib/agent-runtime/publishing-approvals/audit-artifacts";
import {
  publishingApprovalErrorResponse,
  requirePublishingApprovalWorkspace,
} from "@/lib/agent-runtime/publishing-approvals/http";
import { PRODUCTION_PUBLISHING_APPROVAL_SERVICE } from "@/lib/agent-runtime/publishing-approvals/production";
import type { PublishingApprovalPresentationTarget } from "@/lib/agent-runtime/publishing-approvals/types";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

type MediaContext = {
  params: Promise<{ approvalRequestId: string; artifactId: string }>;
};

export const GET = withStudioAuth<MediaContext>(
  {
    route:
      "/api/studio/publishing-approvals/[approvalRequestId]/media/[artifactId]",
    action: "read",
  },
  async (request: NextRequest, authz, context) => {
    const workspaceError = requirePublishingApprovalWorkspace(
      request,
      authz.workspaceId,
    );
    if (workspaceError) return workspaceError;
    try {
      const { approvalRequestId, artifactId } = await context.params;
      const presentation =
        await PRODUCTION_PUBLISHING_APPROVAL_SERVICE.inspectForHuman({
          workspaceId: authz.workspaceId,
          userId: authz.userId,
          approvalRequestId,
        });
      const binding = presentation.targets
        .flatMap((target: PublishingApprovalPresentationTarget) =>
          target.media.map((media) => ({
            media,
            evidence: target.validation.artifacts.media.find(
              (candidate) => candidate.id === media.artifactId,
            ),
          })),
        )
        .find(({ media }) => media.artifactId === artifactId);
      if (!binding?.evidence) {
        return noStoreJson(
          { success: false, error: "Approval media is unavailable." },
          { status: 404 },
        );
      }
      const bytes =
        await PRODUCTION_PUBLISHING_APPROVAL_AUDIT_ARTIFACTS.readRetainedBytes({
          workspaceId: authz.workspaceId,
          evidence: binding.evidence,
        });
      const body = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      return new NextResponse(body, {
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          "Content-Type": binding.media.mediaType,
          "Content-Length": String(bytes.byteLength),
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      return publishingApprovalErrorResponse(error);
    }
  },
);
