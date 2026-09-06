import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { requirePublishingApprovalMutation } from "@/lib/agent-runtime/publishing-approvals/http";
import { PRODUCTION_PUBLISHING_APPROVAL_AUTHORITY_ADMIN } from "@/lib/agent-runtime/publishing-approvals/production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

type GrantContext = { params: Promise<{ grantId: string }> };
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .refine((value) => /^[\x21-\x7e]+$/.test(value));

export const DELETE = withStudioAuth<GrantContext>(
  {
    route: "/api/studio/publishing-approval-authority/[grantId]",
    action: "write",
    permission: "social:manage",
  },
  async (request: NextRequest, authz, context) => {
    if (authz.role !== "owner" && authz.role !== "admin") {
      return noStoreJson(
        { success: false, error: "Grant administration is forbidden." },
        { status: 403 },
      );
    }
    const requestError = requirePublishingApprovalMutation(
      request,
      authz.workspaceId,
    );
    if (requestError) return requestError;
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    const { grantId } = await context.params;
    if (
      !idempotencyKey.success ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(grantId)
    ) {
      return noStoreJson(
        { success: false, error: "Invalid idempotent grant revocation." },
        { status: 400 },
      );
    }
    const result =
      await PRODUCTION_PUBLISHING_APPROVAL_AUTHORITY_ADMIN.revokeGrantIdempotent({
        workspaceId: authz.workspaceId,
        grantId,
        revokedByUserId: authz.userId,
        idempotencyKey: idempotencyKey.data,
        requestFingerprint: canonicalDigest({
          capability: "publishing_approval_authority.revoke@1",
          grantId,
        }),
      });
    if (result.kind === "created" || result.kind === "replayed") {
      return noStoreJson({
        success: true,
        replayed: result.kind === "replayed",
        grant: {
          ...result.grant,
          issuedAt: result.grant.issuedAt.toISOString(),
          expiresAt: result.grant.expiresAt?.toISOString() ?? null,
          revokedAt: result.grant.revokedAt?.toISOString() ?? null,
        },
      });
    }
    const status =
      result.kind === "forbidden"
        ? 403
        : result.kind === "not_found"
          ? 404
          : result.kind === "conflict"
            ? 409
            : 503;
    return noStoreJson(
      {
        success: false,
        error:
          result.kind === "conflict"
            ? "The idempotency key is bound to another grant mutation."
            : result.kind === "not_found"
              ? "Approval Authority grant not found."
              : result.kind === "forbidden"
                ? "Grant administration is forbidden."
                : "Approval Authority administration is unavailable.",
      },
      { status },
    );
  },
);
