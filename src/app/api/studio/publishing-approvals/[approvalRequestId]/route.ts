import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import {
  publishingApprovalErrorResponse,
  requirePublishingApprovalMutation,
  requirePublishingApprovalWorkspace,
} from "@/lib/agent-runtime/publishing-approvals/http";
import { PRODUCTION_PUBLISHING_APPROVAL_SERVICE } from "@/lib/agent-runtime/publishing-approvals/production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

type ApprovalContext = {
  params: Promise<{ approvalRequestId: string }>;
};

const decisionSchema = z
  .object({
    decision: z.enum(["approved", "denied"]),
    expectedInspectionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .refine((value) => /^[\x21-\x7e]+$/.test(value));

export const GET = withStudioAuth<ApprovalContext>(
  {
    route: "/api/studio/publishing-approvals/[approvalRequestId]",
    action: "read",
    permission: "social:view",
  },
  async (request, authz, context) => {
    const workspaceError = requirePublishingApprovalWorkspace(
      request,
      authz.workspaceId,
    );
    if (workspaceError) return workspaceError;
    try {
      const { approvalRequestId } = await context.params;
      const presentation =
        await PRODUCTION_PUBLISHING_APPROVAL_SERVICE.inspectForHuman({
          workspaceId: authz.workspaceId,
          userId: authz.userId,
          approvalRequestId,
        });
      return noStoreJson({ success: true, presentation });
    } catch (error) {
      return publishingApprovalErrorResponse(error);
    }
  },
);
export const POST = withStudioAuth<ApprovalContext>(
  {
    route: "/api/studio/publishing-approvals/[approvalRequestId]",
    // Social publishing admission establishes a Human Principal; the Approval service and
    // repository independently require explicit current per-Channel grants.
    action: "read",
    permission: "social:publish",
  },
  async (request: NextRequest, authz, context) => {
    const requestError = requirePublishingApprovalMutation(
      request,
      authz.workspaceId,
    );
    if (requestError) return requestError;
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    if (!idempotencyKey.success) {
      return noStoreJson(
        {
          success: false,
          error: "A stable Idempotency-Key is required for this human decision.",
        },
        { status: 400 },
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStoreJson(
        { success: false, error: "Decision body must be valid JSON." },
        { status: 400 },
      );
    }
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) {
      return noStoreJson(
        { success: false, error: "Invalid human Approval decision." },
        { status: 400 },
      );
    }
    try {
      const { approvalRequestId } = await context.params;
      const approval = await PRODUCTION_PUBLISHING_APPROVAL_SERVICE.decide({
        workspaceId: authz.workspaceId,
        userId: authz.userId,
        idempotencyKey: idempotencyKey.data,
        approvalRequestId,
        expectedInspectionDigest: parsed.data.expectedInspectionDigest,
        decision: parsed.data.decision,
      });
      return noStoreJson({ success: true, approval });
    } catch (error) {
      return publishingApprovalErrorResponse(error);
    }
  },
);
