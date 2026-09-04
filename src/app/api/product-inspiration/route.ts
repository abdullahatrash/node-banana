import { NextResponse } from "next/server";
import { z } from "zod";
import { ARABIC_VARIETIES, CONTENT_FORMATS } from "@/lib/product-surfaces/definitions";
import { InspirationAdmissionError, queueInspirationCommand, submitInspirationCommand } from "@/lib/product-surfaces/inspiration-commands";
import { ProductRecordConflictError, ProductRecordIdempotencyError } from "@/lib/product-surfaces/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), title: z.string().trim().min(1).max(240), sourceName: z.string().trim().min(1).max(200), sourceAssetId: z.string().trim().min(1).max(200), rightsSnapshotId: z.string().trim().min(1).max(200), rightsSnapshotRevision: z.number().int().positive(), region: z.string().trim().max(80), contentLanguage: z.enum(["ar", "en"]), arabicVariety: z.enum(ARABIC_VARIETIES).nullable(), format: z.enum(CONTENT_FORMATS), tags: z.array(z.string().trim().min(1).max(80)).max(30), idempotencyKey: z.string().trim().min(8).max(200) }).strict(),
  z.object({ action: z.literal("queue"), inspirationItemId: z.string().trim().min(1).max(200), idempotencyKey: z.string().trim().min(8).max(200) }).strict(),
]);

export const POST = withStudioAuth<undefined>({ route: "/api/product-inspiration", action: "write", permission: "product:inspiration:write" }, async (request, authz) => {
  const parsed = command.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "INSPIRATION_COMMAND_INVALID" }, { status: 400 });
  try {
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
