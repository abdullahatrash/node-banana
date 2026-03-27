import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  claimSocialDispatchRun,
  finalizeSocialDispatchRun,
  getSocialPost,
  updatePostStatus,
  SocialPostNotFoundError,
  SocialPostStateTransitionError,
} from "@/lib/social/repository";
import { resolveWorkflowRunRef } from "@/lib/social/workflow-utils";
import { emitSocialEvent } from "@/lib/social/events";
import { start } from "workflow/api";
import { publishPostWorkflow } from "@/../workflows/social-publish";
import { logger } from "@/utils/logger";

interface PublishResponse {
  success: boolean;
  post?: Record<string, unknown>;
  error?: string;
}

const PUBLISHABLE_STATES = new Set(["draft", "failed"]);
const DISPATCH_RETRY_DELAY_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readOptionalJsonBody(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  const contentLength = request.headers.get("content-length");
  if (contentLength === "0") {
    return {};
  }

  const text = await request.clone().text();
  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function extractWorkflowContext(
  body: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const context: Record<string, unknown> = {};

  const chain = isRecord(body.chain) ? body.chain : undefined;
  const automation = isRecord(body.automation) ? body.automation : undefined;

  const chainId = readString(body.chainId);
  const automationId = readString(body.automationId);
  const chainRunId = readString(body.chainRunId);
  const automationRunId = readString(body.automationRunId);

  if (chainId) context.chainId = chainId;
  if (automationId) context.automationId = automationId;
  if (chainRunId) context.chainRunId = chainRunId;
  if (automationRunId) context.automationRunId = automationRunId;
  if (chain) context.chain = chain;
  if (automation) context.automation = automation;

  return Object.keys(context).length > 0 ? context : undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
): Promise<NextResponse<PublishResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/posts",
      permission: "social:publish",
    });

    if (!result.authorized) {
      return result.response;
    }

    const { postId } = await params;
    const workspaceId = result.session.workspace.id;
    const body = await readOptionalJsonBody(request);
    const workflowContext = extractWorkflowContext(body);
    const post = await getSocialPost(workspaceId, postId);

    if (!PUBLISHABLE_STATES.has(post.status)) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot publish a post with status "${post.status}". Only draft and failed posts can be published.`,
        },
        { status: 400 },
      );
    }

    const dispatchAttempts = (post.dispatchAttempts ?? 0) + 1;
    const dispatchKey = `publish:${postId}:${dispatchAttempts}`;
    const dispatchClaimToken = randomUUID();
    const eventMetadata = {
      previousStatus: post.status,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      ...(workflowContext ? { workflowContext } : {}),
    };

    // Transition to "queued" and persist dispatch intent metadata first.
    await updatePostStatus(postId, "queued", {
      errorMessage: null,
      retryCount: post.status === "failed" ? 0 : undefined,
      dispatchStatus: "pending",
      dispatchAttempts,
      workflowRunRef: null,
      nextDispatchAt: null,
      lastDispatchError: null,
      lockedAt: new Date(),
    });
    await emitSocialEvent({
      workspaceId,
      eventType: "post.queued",
      severity: "info",
      message: "Social post queued for publishing.",
      postId,
      accountId: post.socialAccountId,
      dispatchKey,
      metadata: eventMetadata,
      createdByUserId: result.session.user.id,
    });
    logger.info("system", "Social post queued for publish", {
      workspaceId,
      postId,
      accountId: post.socialAccountId,
      dispatchKey,
      workflowRunRef: null,
    });

    const dispatchRun = await claimSocialDispatchRun({
      workspaceId,
      dispatchKey,
      claimToken: dispatchClaimToken,
      kind: "post",
      postId,
      accountId: post.socialAccountId,
      payload: {
        postId,
        workspaceId,
      },
      metadata: {
        source: "publish-route",
      },
    });

    if (!dispatchRun || dispatchRun.claimToken !== dispatchClaimToken) {
      const duplicate = await updatePostStatus(postId, "queued", {
        dispatchStatus: "dispatched",
        lockedAt: null,
      });
      return NextResponse.json(
        {
          success: false,
          post: duplicate,
          error: "Dispatch already claimed by another run.",
        },
        { status: 409 },
      );
    }

    // Start the durable publish workflow — returns immediately
    // Workflow handles sleep (scheduled), token refresh, media processing, and publish
    try {
      const workflowRun = await start(publishPostWorkflow, [postId, result.session.workspace.id]);
      const workflowRunRef = resolveWorkflowRunRef(workflowRun, dispatchKey);
      const updated = await updatePostStatus(postId, "queued", {
        dispatchStatus: "dispatched",
        workflowRunRef,
        lockedAt: null,
      });
      await finalizeSocialDispatchRun({
        dispatchKey,
        state: "succeeded",
        result: { workflowRunRef },
      });
      logger.info("system", "Social publish workflow dispatched", {
        workspaceId,
        postId,
        accountId: post.socialAccountId,
        dispatchKey,
        workflowRunRef,
      });
      return NextResponse.json({ success: true, post: updated });
    } catch (workflowError) {
      const retryAt = new Date(Date.now() + DISPATCH_RETRY_DELAY_MS);
      const workflowMessage =
        workflowError instanceof Error
          ? workflowError.message
          : "Unknown workflow dispatch error";
      await finalizeSocialDispatchRun({
        dispatchKey,
        state: "failed",
        errorMessage: workflowMessage,
      });
      const updated = await updatePostStatus(postId, "queued", {
        errorMessage: "Dispatch failed. Automatic retry has been scheduled.",
        dispatchStatus: "retry_scheduled",
        nextDispatchAt: retryAt,
        lastDispatchError: workflowMessage,
        workflowRunRef: null,
        lockedAt: null,
      });
      await emitSocialEvent({
        workspaceId,
        eventType: "dispatch.failed",
        severity: "warn",
        message: "Dispatch failed and retry was scheduled.",
        postId,
        accountId: post.socialAccountId,
        dispatchKey,
        metadata: {
          error: workflowMessage,
          retryAt: retryAt.toISOString(),
          ...(workflowContext ? { workflowContext } : {}),
        },
      });
      logger.warn("system", "Social publish dispatch failed", {
        workspaceId,
        postId,
        accountId: post.socialAccountId,
        dispatchKey,
        workflowRunRef: null,
        error: workflowMessage,
      });
      return NextResponse.json(
        {
          success: false,
          post: updated,
          error: "Failed to dispatch workflow. Automatic retry has been scheduled.",
        },
        { status: 503 },
      );
    }
  } catch (error) {
    if (error instanceof SocialPostNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }
    if (error instanceof SocialPostStateTransitionError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to publish post",
      },
      { status: 500 },
    );
  }
}
