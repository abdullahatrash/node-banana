import { NextResponse } from "next/server";
import { z } from "zod";
import { bindContentTextOutputCommand } from "@/lib/product-surfaces/domain-commands";
import { ProductRecordConflictError, ProductRecordIdempotencyError } from "@/lib/product-surfaces/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const schema = z.object({ id: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), textOutputId: z.string().regex(/^text_[a-f0-9]{32}$/), idempotencyKey: z.string().min(8).max(200) }).strict();

export const POST = withStudioAuth<undefined>({ route: "/api/product-content/generation", action: "write", permission: "product:content:write" }, async (request, authz) => {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "CONTENT_GENERATION_BIND_INVALID" }, { status: 400 });
  try {
    const record = await bindContentTextOutputCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    return record ? NextResponse.json({ success: true, record }) : NextResponse.json({ success: false, code: "CONTENT_GENERATION_NOT_FOUND" }, { status: 404 });
  } catch (error) {
    if (error instanceof ProductRecordConflictError || error instanceof ProductRecordIdempotencyError) return NextResponse.json({ success: false, code: "CONTENT_GENERATION_CONFLICT" }, { status: 409 });
    if (error instanceof Error && error.message === "CONTENT_TEXT_OUTPUT_NOT_ADMITTED") return NextResponse.json({ success: false, code: error.message }, { status: 422 });
    throw error;
  }
});
