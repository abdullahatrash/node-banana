import { NextResponse } from "next/server";
import { z } from "zod";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { getAsset } from "@/lib/studio/repository";
import {
  getProductRecord,
  createProductRecord,
  listProductRecords,
  updateProductRecord,
  ProductRecordConflictError,
  ProductRecordIdempotencyError,
} from "@/lib/product-surfaces/repository";
import {
  compositionSchema,
  duration,
  roles,
  mediaKind,
} from "@/lib/video-editor/composition";

const command = z
  .object({
    id: z.string().min(1).max(200).optional(),
    expectedRevision: z.number().int().positive().optional(),
    idempotencyKey: z.string().min(8).max(200),
    composition: compositionSchema,
  })
  .strict()
  .refine((value) => Boolean(value.id) === Boolean(value.expectedRevision));
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function project(record: {
  id: string;
  revision: number;
  payload: Record<string, unknown>;
}) {
  const parsed = compositionSchema.safeParse(record.payload.videoEditor);
  return parsed.success
    ? { id: record.id, revision: record.revision, composition: parsed.data }
    : null;
}

export const GET = withStudioAuth<undefined>(
  { route: "/api/video-editor", action: "read", permission: "product:read" },
  async (request, authz) => {
    const records = await listProductRecords({
      workspaceId: authz.workspaceId,
      kinds: ["content_piece"],
      limit: 250,
    });
    const id = request.nextUrl.searchParams.get("id");
    if (id && !records.some((record) => record.id === id)) {
      const record = await getProductRecord(authz.workspaceId, id);
      if (record?.kind === "content_piece") records.unshift(record);
    }
    return json({
      success: true,
      records: records.flatMap((record) => project(record) ?? []),
    });
  },
);

export const POST = withStudioAuth<undefined>(
  {
    route: "/api/video-editor",
    action: "write",
    permission: "product:content:write",
  },
  async (request, authz) => {
    const parsed = command.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !parsed.data.composition.main)
      return json({ success: false, code: "EDITOR_COMPOSITION_INVALID" }, 400);
    const { composition, ...revision } = parsed.data;
    for (const role of roles) {
      const clip = composition[role];
      if (!clip) continue;
      const asset = await getAsset(authz.workspaceId, clip.assetId);
      if (
        !asset ||
        !asset.checksum ||
        asset.metadata?.uploadState !== "ready" ||
        asset.type !== mediaKind(role)
      )
        return json(
          { success: false, code: "EDITOR_MEDIA_UNAVAILABLE", role },
          400,
        );
      if (
        (mediaKind(role) === "video" &&
          (!asset.width ||
            !asset.height ||
            Math.max(asset.width, asset.height) > 1920 ||
            Math.min(asset.width, asset.height) > 1080)) ||
        !asset.durationSeconds ||
        clip.trimEnd > asset.durationSeconds + 0.5
      )
        return json({ success: false, code: "EDITOR_MEDIA_LIMIT", role }, 400);
    }
    const payload = {
      format: "custom_upload",
      contentLanguage: "mixed",
      aspectRatio: "9:16",
      durationSeconds: duration(composition),
      sourceAssetIds: roles.flatMap((role) => composition[role]?.assetId ?? []),
      videoEditor: composition,
    };
    try {
      const input = {
        ...revision,
        workspaceId: authz.workspaceId,
        userId: authz.userId,
        title: composition.title,
        payload,
        state: "draft",
      };
      const record = revision.id
        ? await updateProductRecord({
            ...input,
            id: revision.id,
            expectedRevision: revision.expectedRevision!,
            expectedKind: "content_piece",
            beforeUpdate: async (_tx, current) => {
              if (current.archivedAt || !current.payload.videoEditor)
                throw new ProductRecordConflictError(
                  "Editor draft is unavailable",
                );
            },
          })
        : await createProductRecord({ ...input, kind: "content_piece" });
      return record
        ? json({ success: true, record: project(record) })
        : json({ success: false, code: "EDITOR_NOT_FOUND" }, 404);
    } catch (error) {
      if (
        error instanceof ProductRecordConflictError ||
        error instanceof ProductRecordIdempotencyError
      )
        return json({ success: false, code: "EDITOR_SAVE_CONFLICT" }, 409);
      throw error;
    }
  },
);
