import { NextResponse } from "next/server";
import { z } from "zod";
import { createAnalyticsSourceCommand } from "@/lib/product-surfaces/domain-commands";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("website_analytics_source"), title: z.string().trim().min(1).max(253), payload: z.object({ hostname: z.string().trim().min(1).max(253) }).strict(), idempotencyKey: z.string().min(8).max(200) }).strict(),
  z.object({ kind: z.literal("geo_analytics_source"), title: z.string().trim().min(1).max(253), payload: z.object({ domain: z.string().trim().min(1).max(253), topics: z.array(z.string().trim().min(1).max(300)).min(1).max(50) }).strict(), idempotencyKey: z.string().min(8).max(200) }).strict(),
]);
export const POST = withStudioAuth<undefined>({ route: "/api/product-analytics/sources", action: "write", permission: "product:analytics:write" }, async (request, authz) => {
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "ANALYTICS_SOURCE_COMMAND_INVALID" }, { status: 400 });
  return NextResponse.json({ success: true, record: await createAnalyticsSourceCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data }) });
});
