import { NextResponse } from "next/server";
import { z } from "zod";
import { createMediaSetCommand } from "@/lib/product-surfaces/domain-commands";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const schema = z.object({ title: z.string().trim().min(1).max(240), assetIds: z.array(z.string().min(1).max(200)).min(1).max(100), category: z.string().trim().max(100), description: z.string().trim().max(1_000), idempotencyKey: z.string().min(8).max(200) }).strict();
export const POST = withStudioAuth<undefined>({ route: "/api/product-library/media-sets", action: "write", permission: "product:content:write" }, async (request, authz) => {
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "MEDIA_SET_COMMAND_INVALID" }, { status: 400 });
  try { return NextResponse.json({ success: true, record: await createMediaSetCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data }) }); }
  catch (error) { if (error instanceof Error && error.message === "MEDIA_SET_ASSET_NOT_AVAILABLE") return NextResponse.json({ success: false, code: error.message }, { status: 422 }); throw error; }
});
