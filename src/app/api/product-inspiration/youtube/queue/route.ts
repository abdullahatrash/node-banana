import { NextResponse } from "next/server";
import { z } from "zod";
import { ARABIC_VARIETIES, CONTENT_FORMATS } from "@/lib/product-surfaces/definitions";
import { queueYoutubeMetadataRemix, YoutubeMetadataRemixError } from "@/lib/product-surfaces/youtube-metadata-remix";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const schema = z.object({
  sourceId: z.string().trim().min(1).max(200),
  videoId: z.string().trim().min(1).max(32),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable(),
  format: z.enum(CONTENT_FORMATS),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().superRefine((value, context) => {
  if ((value.contentLanguage === "ar") !== Boolean(value.arabicVariety)) context.addIssue({ code: "custom", path: ["arabicVariety"], message: "Arabic variety must be set only for Arabic content." });
});

export const POST = withStudioAuth<undefined>({ route: "/api/product-inspiration/youtube/queue", action: "write", permission: "product:content:write" }, async (request, authz) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || request.headers.get("x-workspace-id") !== authz.workspaceId) return NextResponse.json({ success: false, code: "YOUTUBE_REMIX_INPUT_INVALID" }, { status: 400 });
  try {
    return NextResponse.json({ success: true, result: await queueYoutubeMetadataRemix({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data }) }, { status: 201 });
  } catch (error) {
    if (error instanceof YoutubeMetadataRemixError) return NextResponse.json({ success: false, code: error.code }, { status: error.code === "YOUTUBE_TREND_NOT_FOUND" ? 404 : 422 });
    throw error;
  }
});
