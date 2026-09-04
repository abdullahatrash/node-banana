import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  requirePublishingApprovalMutation,
  requirePublishingApprovalWorkspace,
} from "@/lib/agent-runtime/publishing-approvals/http";
import { PRODUCTION_PUBLISHING_APPROVAL_AUTHORITY_ADMIN } from "@/lib/agent-runtime/publishing-approvals/production";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const issueSchema = z
  .object({
    userId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,200}$/),
    channelId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,200}$/),
    expiresAt: z.string().datetime({ offset: false }).nullable(),
  })
  .strict();

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .refine((value) => /^[\x21-\x7e]+$/.test(value));

function adminDenied(role: string) {
  return role === "owner" || role === "admin"
    ? null
    : noStoreJson(
        {
          success: false,
          error: "Only Workspace owners and admins can administer Approval Authority grants.",
        },
        { status: 403 },
      );
}

function mutationResult(
  result: Awaited<
    ReturnType<
      typeof PRODUCTION_PUBLISHING_APPROVAL_AUTHORITY_ADMIN.issueGrantIdempotent
    >
  >,
) {
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
          : result.kind === "forbidden"
            ? "Grant administration is forbidden."
            : result.kind === "not_found"
              ? "The eligible Human Principal or LinkedIn Channel is unavailable."
              : "Approval Authority administration is unavailable.",
    },
    { status },
  );
}

export const GET = withStudioAuth<undefined>(
  { route: "/api/studio/publishing-approval-authority", action: "write", permission: "social:manage" },
  async (request: NextRequest, authz) => {
    const denied = adminDenied(authz.role);
    if (denied) return denied;
    const workspaceError = requirePublishingApprovalWorkspace(
      request,
      authz.workspaceId,
    );
    if (workspaceError) return workspaceError;
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId")?.trim() || undefined;
    const channelId = url.searchParams.get("channelId")?.trim() || undefined;
    if (
      (userId && !/^[A-Za-z0-9_-]{1,200}$/.test(userId)) ||
      (channelId && !/^[A-Za-z0-9_-]{1,200}$/.test(channelId))
    ) {
      return noStoreJson(
        { success: false, error: "Invalid Approval Authority filters." },
        { status: 400 },
      );
    }
    const grants = await PRODUCTION_PUBLISHING_APPROVAL_AUTHORITY_ADMIN.listGrants({
      workspaceId: authz.workspaceId,
      ...(userId ? { userId } : {}),
      ...(channelId ? { channelId } : {}),
    });
    return noStoreJson({
      success: true,
      grants: grants.map((grant) => ({
        ...grant,
        issuedAt: grant.issuedAt.toISOString(),
        expiresAt: grant.expiresAt?.toISOString() ?? null,
        revokedAt: grant.revokedAt?.toISOString() ?? null,
      })),
    });
  },
);

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/publishing-approval-authority", action: "write", permission: "social:manage" },
  async (request: NextRequest, authz) => {
    const denied = adminDenied(authz.role);
    if (denied) return denied;
    const requestError = requirePublishingApprovalMutation(
      request,
      authz.workspaceId,
    );
    if (requestError) return requestError;
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = issueSchema.safeParse(body);
    if (!idempotencyKey.success || !parsed.success) {
      return noStoreJson(
        { success: false, error: "Invalid idempotent Approval Authority grant." },
        { status: 400 },
      );
    }
    const now = new Date();
    const expiresAt = parsed.data.expiresAt
      ? new Date(parsed.data.expiresAt)
      : null;
    if (
      expiresAt &&
      (expiresAt <= now ||
        expiresAt.getTime() - now.getTime() > 366 * 24 * 60 * 60 * 1_000)
    ) {
      return noStoreJson(
        { success: false, error: "Grant expiry must be within the next year." },
        { status: 400 },
      );
    }
    const fingerprint = canonicalDigest({
      capability: "publishing_approval_authority.issue@1",
      userId: parsed.data.userId,
      channelId: parsed.data.channelId,
      action: "publish",
      expiresAt: expiresAt?.toISOString() ?? null,
    });
    const result =
      await PRODUCTION_PUBLISHING_APPROVAL_AUTHORITY_ADMIN.issueGrantIdempotent({
        workspaceId: authz.workspaceId,
        userId: parsed.data.userId,
        channelId: parsed.data.channelId,
        action: "publish",
        issuedByUserId: authz.userId,
        expiresAt,
        idempotencyKey: idempotencyKey.data,
        requestFingerprint: fingerprint,
      });
    return mutationResult(result);
  },
);
