import { NextResponse } from "next/server";
import { z } from "zod";
import { ARABIC_VARIETIES, CONTENT_FORMATS } from "@/lib/product-surfaces/definitions";
import { LicensedTrendCatalogError, listLicensedTrendCatalog, requestLicensedTrendMaterialization, retryLicensedTrendMaterialization } from "@/lib/product-surfaces/licensed-trend-catalog";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const importCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("import"), entitlementId: z.string().trim().min(1).max(200), idempotencyKey: z.string().trim().min(8).max(200) }).strict(),
  z.object({ action: z.literal("retry"), jobId: z.string().trim().min(1).max(200) }).strict(),
]);

export const GET = withStudioAuth<undefined>({ route: "/api/product-inspiration/licensed-catalog", action: "read", permission: "product:read" }, async (request, authz) => {
  const query = request.nextUrl.searchParams;
  const parsed = z.object({ query: z.string().trim().max(200).default(""), language: z.enum(["ar", "en"]).optional(), arabicVariety: z.enum(ARABIC_VARIETIES).optional(), region: z.string().trim().max(80).optional(), format: z.enum(CONTENT_FORMATS).optional(), limit: z.coerce.number().int().min(1).max(100).default(60) }).strict().safeParse({ query: query.get("query") ?? "", language: query.get("language") || undefined, arabicVariety: query.get("arabicVariety") || undefined, region: query.get("region") || undefined, format: query.get("format") || undefined, limit: query.get("limit") || 60 });
  if (!parsed.success) return NextResponse.json({ success: false, code: "LICENSED_TREND_FILTER_INVALID" }, { status: 400 });
  const items = await listLicensedTrendCatalog({ workspaceId: authz.workspaceId, ...parsed.data });
  return NextResponse.json({ success: true, items }, { headers: { "cache-control": "private, no-store" } });
});

export const POST = withStudioAuth<undefined>({ route: "/api/product-inspiration/licensed-catalog", action: "write", permission: "product:inspiration:write" }, async (request, authz) => {
  let raw: unknown; try { raw = await request.json(); } catch { raw = null; }
  const parsed = importCommand.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ success: false, code: "LICENSED_TREND_IMPORT_INVALID" }, { status: 400 });
  try {
    const result = parsed.data.action === "import"
      ? await requestLicensedTrendMaterialization({ workspaceId: authz.workspaceId, userId: authz.userId, entitlementId: parsed.data.entitlementId, idempotencyKey: parsed.data.idempotencyKey })
      : await retryLicensedTrendMaterialization({ workspaceId: authz.workspaceId, jobId: parsed.data.jobId });
    return NextResponse.json({ success: true, result }, { status: result.kind === "created" || result.kind === "retried" ? 202 : 200, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof LicensedTrendCatalogError) return NextResponse.json({ success: false, code: error.code }, { status: error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 422 });
    throw error;
  }
});
