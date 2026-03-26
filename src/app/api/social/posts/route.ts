import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import {
  createSocialPost,
  listSocialPosts,
} from "@/lib/social/repository";
import type { SocialPostStatus } from "@/lib/db/schema";

interface PostsGetResponse {
  success: boolean;
  posts?: Awaited<ReturnType<typeof listSocialPosts>>;
  error?: string;
}

interface PostsPostRequest {
  socialAccountId: string;
  content?: string;
  mediaUrls?: Array<{ type: string; url: string; alt?: string }>;
  platformSettings?: Record<string, unknown>;
  scheduledAt?: string;
  studioAssetId?: string;
}

interface PostsPostResponse {
  success: boolean;
  post?: Awaited<ReturnType<typeof createSocialPost>>;
  error?: string;
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<PostsGetResponse>> {
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

    const url = new URL(request.url);
    const status = url.searchParams.get("status") as SocialPostStatus | null;
    const socialAccountId = url.searchParams.get("socialAccountId");
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");

    const posts = await listSocialPosts(result.session.workspace.id, {
      status: status ?? undefined,
      socialAccountId: socialAccountId ?? undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    return NextResponse.json({ success: true, posts });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to list posts",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<PostsPostResponse>> {
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

    const body = (await request.json()) as PostsPostRequest;

    if (!body.socialAccountId?.trim()) {
      return NextResponse.json(
        { success: false, error: "socialAccountId is required." },
        { status: 400 },
      );
    }

    if (!body.content?.trim() && (!body.mediaUrls || body.mediaUrls.length === 0)) {
      return NextResponse.json(
        { success: false, error: "Content or media is required." },
        { status: 400 },
      );
    }

    const post = await createSocialPost({
      workspaceId: result.session.workspace.id,
      socialAccountId: body.socialAccountId,
      content: body.content,
      mediaUrls: body.mediaUrls,
      platformSettings: body.platformSettings,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      studioAssetId: body.studioAssetId,
      createdByUserId: result.session.user.id,
    });

    return NextResponse.json({ success: true, post });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create post",
      },
      { status: 500 },
    );
  }
}
