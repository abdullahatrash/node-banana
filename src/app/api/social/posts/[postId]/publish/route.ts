import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  getSocialPost,
  updatePostStatus,
  SocialPostNotFoundError,
  SocialPostStateTransitionError,
} from "@/lib/social/repository";
import { resolveWorkflowRunRef } from "@/lib/social/workflow-utils";
import { start } from "workflow/api";
import { publishPostWorkflow } from "@/../workflows/social-publish";

interface PublishResponse {
  success: boolean;
  post?: Record<string, unknown>;
  error?: string;
}

const PUBLISHABLE_STATES = new Set(["draft", "failed"]);
const DISPATCH_RETRY_DELAY_MS = 5 * 60 * 1000;

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
    const post = await getSocialPost(result.session.workspace.id, postId);

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

    // Transition to "queued" and persist dispatch intent metadata first.
    await updatePostStatus(postId, "queued", {
      errorMessage: undefined,
      retryCount: post.status === "failed" ? 0 : undefined,
      dispatchStatus: "pending",
      dispatchAttempts,
      workflowRunRef: null,
      nextDispatchAt: null,
      lastDispatchError: null,
      lockedAt: new Date(),
    });

    // Start the durable publish workflow — returns immediately
    // Workflow handles sleep (scheduled), token refresh, media processing, and publish
    try {
      const workflowRun = await start(publishPostWorkflow, [postId, result.session.workspace.id]);
      const workflowRunRef = resolveWorkflowRunRef(workflowRun, `publish:${postId}`);
      const updated = await updatePostStatus(postId, "queued", {
        dispatchStatus: "dispatched",
        workflowRunRef,
        lockedAt: null,
      });
      return NextResponse.json({ success: true, post: updated });
    } catch (workflowError) {
      const retryAt = new Date(Date.now() + DISPATCH_RETRY_DELAY_MS);
      const workflowMessage =
        workflowError instanceof Error
          ? workflowError.message
          : "Unknown workflow dispatch error";
      const updated = await updatePostStatus(postId, "queued", {
        errorMessage: "Dispatch failed. Automatic retry has been scheduled.",
        dispatchStatus: "retry_scheduled",
        nextDispatchAt: retryAt,
        lastDispatchError: workflowMessage,
        workflowRunRef: null,
        lockedAt: null,
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
