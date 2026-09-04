import { NextResponse } from "next/server";
import { z } from "zod";
import { createAnalyticsSourceCommand } from "@/lib/product-surfaces/domain-commands";
import { AnalyticsSourceError, requestAnalyticsRefresh, verifyAnalyticsSource } from "@/lib/product-surfaces/analytics-sources";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("website_analytics_source"), title: z.string().trim().min(1).max(253), payload: z.object({ hostname: z.string().trim().min(1).max(253) }).strict(), idempotencyKey: z.string().min(8).max(200) }).strict(),
  z.object({ kind: z.literal("geo_analytics_source"), title: z.string().trim().min(1).max(253), payload: z.object({ domain: z.string().trim().min(1).max(253), topics: z.array(z.string().trim().min(1).max(300)).min(1).max(50) }).strict(), idempotencyKey: z.string().min(8).max(200) }).strict(),
]);
const commandSchema = z.object({ action: z.enum(["verify", "refresh"]), id: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(8).max(200) }).strict();
const schema = z.union([createSchema, commandSchema]);
export const POST = withStudioAuth<undefined>({ route: "/api/product-analytics/sources", action: "write", permission: "product:analytics:write" }, async (request, authz) => {
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "ANALYTICS_SOURCE_COMMAND_INVALID" }, { status: 400 });
  try {
    const record = "action" in parsed.data
      ? parsed.data.action === "verify"
        ? await verifyAnalyticsSource({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data })
        : await requestAnalyticsRefresh({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data })
      : await createAnalyticsSourceCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    return NextResponse.json({ success: true, record });
  } catch (error) {
    if (error instanceof AnalyticsSourceError) return NextResponse.json({ success: false, code: error.code }, { status: error.code === "ANALYTICS_SOURCE_NOT_FOUND" ? 404 : 409 });
    throw error;
  }
});
