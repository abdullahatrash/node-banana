import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { createMediaSetCommand, updateMediaSetCommand } from "@/lib/product-surfaces/domain-commands";
import { mediaSetSchema } from "@/lib/product-surfaces/definitions";
import { MEDIA_SET_PURPOSES, mediaSetAssetIssue } from "@/lib/product-surfaces/media-set-policy";
import type { MediaSetAssetSummary, MediaSetsSummary } from "@/lib/product-surfaces/media-set-summary";
import { ProductRecordConflictError, listProductRecords } from "@/lib/product-surfaces/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const purpose = z.enum(MEDIA_SET_PURPOSES);
const common = { title: z.string().trim().min(1).max(240), assetIds: z.array(z.string().min(1).max(200)).max(100), category: z.string().trim().max(100), description: z.string().trim().max(1_000), purpose };
const createSchema = z.object({ ...common, assetIds: common.assetIds.min(1), purpose: purpose.default("general"), idempotencyKey: z.string().min(8).max(200) }).strict();
const updateSchema = z.object({ ...common, id: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(8).max(200) }).strict();

function assetName(row: { id: string; storageKey: string; metadata: Record<string, unknown> | null }) {
  const candidate = row.metadata?.name ?? row.metadata?.originalFileName;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim().slice(0, 240) : row.storageKey.split("/").at(-1)?.slice(0, 240) || row.id;
}

function projectAsset(row: typeof assets.$inferSelect, issue: string | null): MediaSetAssetSummary {
  return { id: row.id, name: assetName(row), mimeType: row.mimeType, sizeBytes: row.sizeBytes, durationSeconds: row.durationSeconds, width: row.width, height: row.height, createdAt: row.createdAt.toISOString(), eligibilityIssue: issue };
}

export const GET = withStudioAuth<undefined>({ route: "/api/product-library/media-sets", action: "read", permission: "assets:read" }, async (request, authz) => {
  const requestedPurpose = request.nextUrl.searchParams.get("purpose");
  if (requestedPurpose && !MEDIA_SET_PURPOSES.includes(requestedPurpose as (typeof MEDIA_SET_PURPOSES)[number])) return NextResponse.json({ success: false, code: "MEDIA_SET_PURPOSE_INVALID" }, { status: 400 });
  const selectedPurpose = requestedPurpose as (typeof MEDIA_SET_PURPOSES)[number] | null;
  const records = (await listProductRecords({ workspaceId: authz.workspaceId, kinds: ["media_set"] }))
    .map((record) => ({ record, payload: mediaSetSchema.parse(record.payload) }))
    .filter(({ payload }) => !selectedPurpose || payload.purpose === selectedPurpose);
  const memberIds = [...new Set(records.flatMap(({ payload }) => payload.assetIds))];
  const rows = selectedPurpose === "demo_videos"
    ? await getDb().select().from(assets).where(and(eq(assets.workspaceId, authz.workspaceId), isNull(assets.deletedAt), memberIds.length ? or(eq(assets.type, "video"), inArray(assets.id, memberIds)) : eq(assets.type, "video")))
    : memberIds.length ? await getDb().select().from(assets).where(and(eq(assets.workspaceId, authz.workspaceId), isNull(assets.deletedAt), inArray(assets.id, memberIds))) : [];
  const eligibleRows = selectedPurpose === "demo_videos" ? rows.filter((row) => mediaSetAssetIssue("demo_videos", row) === null) : rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const summary: MediaSetsSummary = {
    sets: records.map(({ record, payload }) => ({ id: record.id, title: record.title, revision: record.revision, purpose: payload.purpose, category: payload.category, description: payload.description, assetIds: payload.assetIds, assets: payload.assetIds.map((id) => byId.get(id)).filter((row): row is typeof assets.$inferSelect => Boolean(row)).map((row) => projectAsset(row, selectedPurpose === "demo_videos" ? mediaSetAssetIssue("demo_videos", row) : mediaSetAssetIssue("general", row))), unavailableAssetIds: payload.assetIds.filter((id) => !byId.has(id)) })),
    eligibleAssets: eligibleRows.map((row) => projectAsset(row, null)),
    measuredAt: new Date().toISOString(),
  };
  return NextResponse.json({ success: true, data: summary }, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST = withStudioAuth<undefined>({ route: "/api/product-library/media-sets", action: "write", permission: "product:content:write" }, async (request, authz) => {
  const parsed = createSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "MEDIA_SET_COMMAND_INVALID" }, { status: 400 });
  try { return NextResponse.json({ success: true, record: await createMediaSetCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data }) }); }
  catch (error) { if (error instanceof Error && error.message === "DEMO_VIDEO_SET_EXISTS") return NextResponse.json({ success: false, code: error.message }, { status: 409 }); if (error instanceof Error && /^(MEDIA_SET_|DEMO_VIDEO_)/.test(error.message)) return NextResponse.json({ success: false, code: error.message }, { status: 422 }); throw error; }
});

export const PATCH = withStudioAuth<undefined>({ route: "/api/product-library/media-sets", action: "write", permission: "product:content:write" }, async (request, authz) => {
  const parsed = updateSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "MEDIA_SET_COMMAND_INVALID" }, { status: 400 });
  try {
    const record = await updateMediaSetCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    if (!record) return NextResponse.json({ success: false, code: "MEDIA_SET_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ success: true, record });
  } catch (error) {
    if (error instanceof ProductRecordConflictError) return NextResponse.json({ success: false, code: "MEDIA_SET_REVISION_CONFLICT" }, { status: 409 });
    if (error instanceof Error && /^(MEDIA_SET_|DEMO_VIDEO_)/.test(error.message)) return NextResponse.json({ success: false, code: error.message }, { status: 422 });
    throw error;
  }
});
