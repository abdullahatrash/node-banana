import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { dispatchCapability } from "@/lib/agent-runtime/server-dispatcher";
import { ARTIFACT_ID_PATTERN } from "@/lib/agent-runtime/artifacts/validation";
import { requirePublishingApprovalMutation } from
  "@/lib/agent-runtime/publishing-approvals/http";
import { requirePublishingApprovalWorkspace } from
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
  z.object({
    capability: z.literal("publishing_deliveries.get@2"),
    input: z.object({
      deliveryId: id,
      channelIds: z.array(id).max(50).optional(),
      artifactIds: z.array(artifactId).max(200).optional(),
    }).strict(),
  }).strict(),
  z.object({
    capability: z.literal("publishing_deliveries.list@2"),
    input: z.object({
      channelIds: z.array(id).max(50).optional(),
      artifactIds: z.array(artifactId).max(200).optional(),
      planRevisionId: id.optional(),
      state: z.enum(["scheduled", "dispatching", "blocked", "confirmation_pending", "succeeded", "failed_transient", "failed_terminal", "outcome_unknown", "cancelled"]).optional(),
      targetId: id.optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().min(1).max(2_048).optional(),
    }).strict(),
  }).strict(),
  z.object({
    capability: z.literal("publishing_delivery_events.list@2"),
    input: z.object({
      deliveryId: id,
      channelIds: z.array(id).max(50).optional(),
      artifactIds: z.array(artifactId).max(200).optional(),
      afterSequence: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }).strict(),
  }).strict(),
  z.object({
    capability: z.literal("publishing_approvals.get@2"),
    input: z.object({
      approvalRequestId: id,
      channelIds: z.array(id).max(50).optional(),
      artifactIds: z.array(artifactId).max(200).optional(),
    }).strict(),
  }).strict(),
  z.object({
    capability: z.literal("publishing_plan_revisions.get@2"),
    input: z.object({ revisionId: id }).strict(),
  }).strict(),
  z.object({
    capability: z.enum([
      "budget_policies.get_effective@1",
      "budget_status.get@1",
      "budget_reservations.list@1",
      "quota_policies.get_effective@1",
      "quota_reservations.list@1",
      "quota_waits.list@1",
      "quota_waits.resume@1",
      "spend_controls.get@2",
      "spend_controls.suspend@2",
      "spend_controls.resume@2",
    ]),
    input: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
]);

const sameOriginMutations = new Set([
  "publishing_deliveries.cancel@1",
  "publishing_deliveries.retry@1",
  "publishing_deliveries.reconcile@1",
  "quota_waits.resume@1",
  "spend_controls.suspend@2",
  "spend_controls.resume@2",
]);

const idempotencyKey = z.string().trim().min(8).max(200).regex(/^[!-~]+$/);

function responseStatus(category: string): number {
  if (category === "authorization") return 403;
  if (category === "not_found") return 404;
  if (category === "conflict") return 409;
  if (category === "internal") return 500;
  return 400;
}

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/publishing-deliveries/capabilities", action: "read", permission: "social:view" },
  async (request: NextRequest, authz) => {
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

    const workspaceError = requirePublishingApprovalWorkspace(
      request,
      authz.workspaceId,
    );
    if (workspaceError) return workspaceError;
    if (sameOriginMutations.has(parsed.data.capability)) {
      const mutationError = requirePublishingApprovalMutation(
        request,
        authz.workspaceId,
      );
      if (mutationError) return mutationError;
    }
    const parsedIdempotencyKey = idempotencyKey.safeParse(
      request.headers.get("idempotency-key"),
    );
    if (
      parsed.data.capability === "quota_waits.resume@1" &&
      !parsedIdempotencyKey.success
    ) {
      return noStoreJson(
        {
          success: false,
          code: "IDEMPOTENCY_KEY_REQUIRED",
          error: "Idempotency-Key is required to resume a Quota Wait.",
        },
        { status: 400 },
      );
    }

    const response = await dispatchCapability(parsed.data, {
      securityContext: {
        kind: "human",
        workspaceId: authz.workspaceId,
        userId: authz.userId,
        role: authz.role,
        ...(parsedIdempotencyKey.success
          ? { idempotencyKey: parsedIdempotencyKey.data }
          : {}),
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
