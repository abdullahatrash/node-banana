import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  deleteSocialPost,
  getSocialPost,
  updateSocialPost,
  SocialPostNotFoundError,
  SocialPostStateTransitionError,
} from "@/lib/social/repository";

interface PostResponse {
  success: boolean;
  post?: Awaited<ReturnType<typeof getSocialPost>>;
  error?: string;
}

interface PatchRequest {
  content?: string;
  mediaUrls?: Array<{ type: string; url: string; alt?: string }>;
  platformSettings?: Record<string, unknown>;
  scheduledAt?: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
): Promise<NextResponse<PostResponse>> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await withApiPermission(request, {
      route: "/api/social/posts",
      permission: "social:view",
    });

    if (!result.authorized) {
      return result.response;
    }

    const { postId } = await params;
    const post = await getSocialPost(result.session.workspace.id, postId);

    return NextResponse.json({ success: true, post });
  } catch (error) {
    if (error instanceof SocialPostNotFoundError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get post",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
): Promise<NextResponse<PostResponse>> {
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
    const body = (await request.json()) as PatchRequest;

    const post = await updateSocialPost(
      result.session.workspace.id,
      postId,
      {
        content: body.content,
        mediaUrls: body.mediaUrls,
        platformSettings: body.platformSettings,
        scheduledAt:
          body.scheduledAt === null
            ? null
            : body.scheduledAt
              ? new Date(body.scheduledAt)
              : undefined,
      },
    );

    return NextResponse.json({ success: true, post });
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
          error instanceof Error ? error.message : "Failed to update post",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
): Promise<NextResponse<{ success: boolean; error?: string }>> {
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
    await deleteSocialPost(result.session.workspace.id, postId);

    return NextResponse.json({ success: true });
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
          error instanceof Error ? error.message : "Failed to delete post",
      },
      { status: 500 },
    );
  }
}
