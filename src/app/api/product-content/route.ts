import { NextResponse } from "next/server";
import { z } from "zod";
import { saveContentCommand } from "@/lib/product-surfaces/domain-commands";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const schema = z.object({ id: z.string().min(1).max(200).optional(), expectedRevision: z.number().int().positive().optional(), title: z.string().trim().min(1).max(240), payload: z.record(z.string(), z.unknown()), idempotencyKey: z.string().min(8).max(200) }).strict();
export const POST = withStudioAuth<undefined>({ route: "/api/product-content", action: "write", permission: "product:content:write" }, async (request, authz) => {
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "CONTENT_COMMAND_INVALID" }, { status: 400 });
  const record = await saveContentCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
  return record ? NextResponse.json({ success: true, record }) : NextResponse.json({ success: false, code: "CONTENT_NOT_FOUND" }, { status: 404 });
});
