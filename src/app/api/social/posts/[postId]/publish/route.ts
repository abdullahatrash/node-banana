import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  getSocialPost,
  updatePostStatus,
  SocialPostNotFoundError,
  SocialPostStateTransitionError,
} from "@/lib/social/repository";

interface PublishResponse {
  success: boolean;
  post?: Record<string, unknown>;
  error?: string;
}

const PUBLISHABLE_STATES = new Set(["draft", "failed"]);

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

    // Transition to "queued" — the Vercel Workflow will pick it up
    // On retry (failed → queued), reset retryCount and clear error
    const updated = await updatePostStatus(postId, "queued", {
      errorMessage: undefined,
      retryCount: post.status === "failed" ? 0 : undefined,
    });

    // TODO: Start Vercel Workflow here once workflows/social-publish.ts is implemented
    // await publishPostWorkflow.start(postId, result.session.workspace.id);

    return NextResponse.json({ success: true, post: updated });
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
