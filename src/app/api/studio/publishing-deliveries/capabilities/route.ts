import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { dispatchCapability } from "@/lib/agent-runtime/server-dispatcher";
import { ARTIFACT_ID_PATTERN } from "@/lib/agent-runtime/artifacts/validation";
import { requirePublishingApprovalMutation } from
  "@/lib/agent-runtime/publishing-approvals/http";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const artifactId = z.string().min(1).max(200).regex(ARTIFACT_ID_PATTERN);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const resources = {
  deliveryId: id,
  channelIds: z.array(id).min(1).max(50),
  artifactIds: z.array(artifactId).min(1).max(200),
};
const invocation = z.discriminatedUnion("capability", [
  z.object({
    capability: z.literal("publishing_deliveries.cancel@1"),
    input: z.object(resources).strict(),
  }).strict(),
  z.object({
    capability: z.literal("publishing_deliveries.retry@1"),
    input: z.object({
      ...resources,
      approvalRequestId: id,
      expectedFailureEvidenceDigest: digest,
      idempotencyKey: z.string().min(8).max(200).regex(/^[!-~]+$/),
    }).strict(),
  }).strict(),
  z.object({
    capability: z.literal("publishing_deliveries.reconcile@1"),
    input: z.object({
      ...resources,
      expectedUnknownEvidenceDigest: digest,
    }).strict(),
  }).strict(),
]);

function responseStatus(category: string): number {
  if (category === "authorization") return 403;
  if (category === "not_found") return 404;
  if (category === "conflict") return 409;
  if (category === "internal") return 500;
  return 400;
}

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/publishing-deliveries/capabilities", action: "write" },
  async (request: NextRequest, authz) => {
    const mutationError = requirePublishingApprovalMutation(
      request,
      authz.workspaceId,
    );
    if (mutationError) return mutationError;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStoreJson(
        { success: false, error: "Invalid Publishing Delivery command." },
        { status: 400 },
      );
    }
    const parsed = invocation.safeParse(body);
    if (!parsed.success) {
      return noStoreJson(
        { success: false, error: "Invalid Publishing Delivery command." },
        { status: 400 },
      );
    }

    const response = await dispatchCapability(parsed.data, {
      securityContext: {
        kind: "human",
        workspaceId: authz.workspaceId,
        userId: authz.userId,
        role: authz.role,
      },
    });
    if (response.type === "capability_error") {
      return noStoreJson(
        {
          success: false,
          error: response.message,
          code: response.code,
          operatorTraceRef: response.operatorTraceRef,
        },
        { status: responseStatus(response.category) },
      );
    }
    return noStoreJson({
      success: true,
      capability: `${response.capability.name}@${response.capability.version}`,
      result: response.output,
    });
  },
);
