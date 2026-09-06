import { NextResponse } from "next/server";
import { z } from "zod";
import { bindContentMediaOutputCommand, bindContentTextOutputCommand } from "@/lib/product-surfaces/domain-commands";
import { ProductRecordConflictError, ProductRecordIdempotencyError } from "@/lib/product-surfaces/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const common = { id: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(8).max(200) };
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), ...common, textOutputId: z.string().regex(/^text_[a-f0-9]{32}$/) }).strict(),
  z.object({ kind: z.literal("media"), ...common, generation: z.object({ assetId: z.string().min(1).max(200), intentId: z.string().min(1).max(200), operationId: z.string().min(1).max(240) }).strict() }).strict(),
  z.object({ kind: z.literal("upload"), ...common }).strict(),
]);

export const POST = withStudioAuth<undefined>({ route: "/api/product-content/generation", action: "write", permission: "product:content:write" }, async (request, authz) => {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "CONTENT_GENERATION_BIND_INVALID" }, { status: 400 });
  try {
    const record = parsed.data.kind === "text"
      ? await bindContentTextOutputCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data })
      : await bindContentMediaOutputCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data, generation: parsed.data.kind === "media" ? parsed.data.generation : null });
    return record ? NextResponse.json({ success: true, record }) : NextResponse.json({ success: false, code: "CONTENT_GENERATION_NOT_FOUND" }, { status: 404 });
  } catch (error) {
    if (error instanceof ProductRecordConflictError || error instanceof ProductRecordIdempotencyError) return NextResponse.json({ success: false, code: "CONTENT_GENERATION_CONFLICT" }, { status: 409 });
    if (error instanceof Error && error.message.startsWith("CONTENT_")) return NextResponse.json({ success: false, code: error.message }, { status: 422 });
    throw error;
  }
});
