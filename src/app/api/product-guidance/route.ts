import { NextResponse } from "next/server";
import { z } from "zod";
import { saveGuidanceProgressCommand } from "@/lib/product-surfaces/domain-commands";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const schema = z.object({ id: z.string().min(1).max(200).optional(), expectedRevision: z.number().int().positive().optional(), completedKeys: z.array(z.string().min(1).max(120)).max(200), dismissedReleaseIds: z.array(z.string().min(1).max(120)).max(200), idempotencyKey: z.string().min(8).max(200) }).strict();
export const POST = withStudioAuth<undefined>({ route: "/api/product-guidance", action: "write", permission: "product:support:submit" }, async (request, authz) => {
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "GUIDANCE_COMMAND_INVALID" }, { status: 400 });
  const { completedKeys, dismissedReleaseIds, ...identity } = parsed.data;
  const record = await saveGuidanceProgressCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...identity, payload: { completedKeys, dismissedReleaseIds } });
  return record ? NextResponse.json({ success: true, record }) : NextResponse.json({ success: false, code: "GUIDANCE_NOT_FOUND" }, { status: 404 });
});
