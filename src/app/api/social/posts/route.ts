import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { withApiPermission } from "@/lib/studio/authz";
import { getSocialPlanLimits, quotaExceededPayload } from "@/lib/social/limits";
import {
  countSocialPostsCreatedInRange,
  createSocialPost,
  listSocialPosts,
} from "@/lib/social/repository";
import type { SocialPostStatus } from "@/lib/db/schema";
import { logger } from "@/utils/logger";

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
  chain?: unknown;
  automation?: unknown;
  chainId?: string;
  automationId?: string;
  chainRunId?: string;
  automationRunId?: string;
  workflowContext?: Record<string, unknown>;
  rootPostId?: string;
  kind?: string;
  delaySeconds?: number;
  position?: number;
  sourceTemplatePostId?: string;
  triggerSource?: string;
  parentPostId?: string;
}

interface PostsPostResponse {
  success: boolean;
  post?: Awaited<ReturnType<typeof createSocialPost>>;
  error?: string;
  code?: string;
  billingUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readMediaUrls(value: unknown): Array<{ type: string; url: string; alt?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;

  const media = value
    .map((item) => {
      if (!isRecord(item)) return null;
      const type = readString(item.type);
      const url = readString(item.url);
      if (!type || !url) return null;
      const alt = readString(item.alt);
      return alt ? { type, url, alt } : { type, url };
    })
    .filter((item): item is { type: string; url: string; alt?: string } => item !== null);

  return media.length > 0 ? media : undefined;
}

function extractWorkflowContext(body: Record<string, unknown>): Record<string, unknown> | undefined {
  const context: Record<string, unknown> = {};
  const chain = isRecord(body.chain) ? body.chain : undefined;
  const automation = isRecord(body.automation) ? body.automation : undefined;

  if (body.chainId) context.chainId = body.chainId;
  if (body.automationId) context.automationId = body.automationId;
  if (body.chainRunId) context.chainRunId = body.chainRunId;
  if (body.automationRunId) context.automationRunId = body.automationRunId;
  if (body.workflowContext && isRecord(body.workflowContext)) {
    Object.assign(context, body.workflowContext);
  }
  if (chain) context.chain = chain;
  if (automation) context.automation = automation;

  return Object.keys(context).length > 0 ? context : undefined;
}

function resolveContent(body: Record<string, unknown>): string | undefined {
  const candidates: unknown[] = [
    body.content,
    body.text,
    body.message,
    isRecord(body.chain) ? body.chain.content : undefined,
    isRecord(body.chain) ? body.chain.text : undefined,
    isRecord(body.automation) ? body.automation.content : undefined,
    isRecord(body.automation) ? body.automation.text : undefined,
    isRecord(body.workflowContext) ? body.workflowContext.content : undefined,
    isRecord(body.workflowContext) ? body.workflowContext.text : undefined,
  ];

  for (const candidate of candidates) {
    const value = readString(candidate);
    if (value) return value;
  }

  return undefined;
}

function resolveMediaUrls(body: Record<string, unknown>): Array<{ type: string; url: string; alt?: string }> | undefined {
  const direct = readMediaUrls(body.mediaUrls);
  if (direct) return direct;

  const nestedCandidates = [
    isRecord(body.chain) ? body.chain.mediaUrls : undefined,
    isRecord(body.automation) ? body.automation.mediaUrls : undefined,
    isRecord(body.workflowContext) ? body.workflowContext.mediaUrls : undefined,
  ];

  for (const candidate of nestedCandidates) {
    const media = readMediaUrls(candidate);
    if (media) return media;
  }

  return undefined;
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
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const limit = url.searchParams.get("limit");
    const offset = url.searchParams.get("offset");

    const posts = await listSocialPosts(result.session.workspace.id, {
      status: status ?? undefined,
      socialAccountId: socialAccountId ?? undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
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
    const bodyRecord = body as unknown as Record<string, unknown>;

    if (!readString(body.socialAccountId)) {
      return NextResponse.json(
        { success: false, error: "socialAccountId is required." },
        { status: 400 },
      );
    }

    const content = resolveContent(bodyRecord);
    const mediaUrls = resolveMediaUrls(bodyRecord);
    const workflowContext = extractWorkflowContext(bodyRecord);
    const chainRecord = isRecord(body.chain) ? body.chain : undefined;
    const platformSettings = isRecord(body.platformSettings)
      ? { ...body.platformSettings }
      : undefined;
    const mergedPlatformSettings = workflowContext
      ? { ...(platformSettings ?? {}), workflowContext }
      : platformSettings;

    if (!content && (!mediaUrls || mediaUrls.length === 0)) {
      return NextResponse.json(
        { success: false, error: "Content or media is required." },
        { status: 400 },
      );
    }

    const limits = getSocialPlanLimits(result.session.planTier);
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const monthlyPosts = await countSocialPostsCreatedInRange(
      result.session.workspace.id,
      monthStart,
      monthEnd,
    );
    if (monthlyPosts >= limits.postsPerMonth) {
      return NextResponse.json(
        quotaExceededPayload({
          section: "posts_per_month",
          current: monthlyPosts,
          limit: limits.postsPerMonth,
        }),
        { status: 402 },
      );
    }

    const scheduledAtValue = readString(body.scheduledAt);
    const rootPostId =
      readString(body.rootPostId) ??
      readString(chainRecord?.rootPostId) ??
      undefined;
    const kind = readString(body.kind) ?? readString(chainRecord?.kind);
    const delaySeconds =
      readOptionalNumber(body.delaySeconds) ??
      readOptionalNumber(chainRecord?.delaySeconds);
    const position =
      readOptionalNumber(body.position) ??
      readOptionalNumber(chainRecord?.position);
    const sourceTemplatePostId =
      readString(body.sourceTemplatePostId) ??
      readString(chainRecord?.sourceTemplatePostId) ??
      undefined;
    const triggerSource =
      readString(body.triggerSource) ??
      readString(chainRecord?.triggerSource) ??
      undefined;
    const parentPostId =
      readString(body.parentPostId) ??
      readString(chainRecord?.parentPostId) ??
      undefined;

    const post = await createSocialPost({
      workspaceId: result.session.workspace.id,
      socialAccountId: body.socialAccountId,
      content,
      mediaUrls,
      platformSettings: mergedPlatformSettings,
      scheduledAt: scheduledAtValue ? new Date(scheduledAtValue) : undefined,
      rootPostId,
      kind,
      delaySeconds,
      position,
      sourceTemplatePostId,
      triggerSource,
      parentPostId,
      studioAssetId: body.studioAssetId,
      createdByUserId: result.session.user.id,
    });
    logger.info("system", "Social draft post created", {
      workspaceId: result.session.workspace.id,
      postId: post.id,
      accountId: post.socialAccountId,
      provider: null,
      dispatchKey: null,
      workflowRunRef: null,
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
