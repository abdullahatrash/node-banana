import { NextResponse } from "next/server";
import { z } from "zod";
import { ARABIC_VARIETIES, CONTENT_FORMATS } from "@/lib/product-surfaces/definitions";
import { InspirationAdmissionError, queueInspirationCommand, submitInspirationCommand } from "@/lib/product-surfaces/inspiration-commands";
import { ProductRecordConflictError, ProductRecordIdempotencyError } from "@/lib/product-surfaces/repository";
import { listInspirationTrendFeed, trendFeedFiltersSchema } from "@/lib/product-surfaces/trend-feed";
import { requestWorkspaceTrendRefresh } from "@/lib/product-surfaces/trend-ingestion-repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), title: z.string().trim().min(1).max(240), sourceName: z.string().trim().min(1).max(200), sourceAssetId: z.string().trim().min(1).max(200), rightsSnapshotId: z.string().trim().min(1).max(200), region: z.string().trim().max(80), contentLanguage: z.enum(["ar", "en"]), arabicVariety: z.enum(ARABIC_VARIETIES).nullable(), format: z.enum(CONTENT_FORMATS), tags: z.array(z.string().trim().min(1).max(80)).max(30), idempotencyKey: z.string().trim().min(8).max(200) }).strict(),
  z.object({ action: z.literal("queue"), inspirationItemId: z.string().trim().min(1).max(200), idempotencyKey: z.string().trim().min(8).max(200) }).strict(),
  z.object({ action: z.literal("refresh"), idempotencyKey: z.string().trim().min(8).max(200) }).strict(),
]);

export const GET = withStudioAuth<undefined>({ route: "/api/product-inspiration", action: "read", permission: "product:read" }, async (request, authz) => {
  const query = request.nextUrl.searchParams;
  const rawBlitzReady = query.get("blitzReady");
  if (rawBlitzReady !== null && rawBlitzReady !== "true" && rawBlitzReady !== "false") return NextResponse.json({ success: false, code: "INSPIRATION_FILTER_INVALID" }, { status: 400 });
  const parsed = trendFeedFiltersSchema.safeParse({
    query: query.get("query") ?? "",
    region: query.get("region") ?? "",
    language: query.get("language") || undefined,
    arabicVariety: query.get("arabicVariety") || undefined,
    format: query.get("format") || undefined,
    rightsStatus: query.get("rightsStatus") || undefined,
    blitzReady: rawBlitzReady === null ? undefined : rawBlitzReady === "true",
    limit: query.has("limit") ? Number(query.get("limit")) : 60,
  });
  if (!parsed.success) return NextResponse.json({ success: false, code: "INSPIRATION_FILTER_INVALID" }, { status: 400 });
  const items = await listInspirationTrendFeed({ workspaceId: authz.workspaceId, filters: parsed.data });
  return NextResponse.json({ success: true, items }, { headers: { "cache-control": "private, no-store" } });
});

export const POST = withStudioAuth<undefined>({ route: "/api/product-inspiration", action: "write", permission: "product:inspiration:write" }, async (request, authz) => {
  const parsed = command.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "INSPIRATION_COMMAND_INVALID" }, { status: 400 });
  try {
    if (parsed.data.action === "refresh") {
      const result = await requestWorkspaceTrendRefresh({ workspaceId: authz.workspaceId, userId: authz.userId, idempotencyKey: parsed.data.idempotencyKey });
      return NextResponse.json({ success: true, result }, { status: 202 });
    }
    const record = parsed.data.action === "submit"
      ? await submitInspirationCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data })
      : await queueInspirationCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    return NextResponse.json({ success: true, record }, { status: 201 });
  } catch (error) {
    if (error instanceof InspirationAdmissionError) return NextResponse.json({ success: false, code: error.code }, { status: 422 });
    if (error instanceof ProductRecordConflictError) return NextResponse.json({ success: false, code: error.message }, { status: 409 });
    if (error instanceof ProductRecordIdempotencyError) return NextResponse.json({ success: false, code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    throw error;
  }
});
