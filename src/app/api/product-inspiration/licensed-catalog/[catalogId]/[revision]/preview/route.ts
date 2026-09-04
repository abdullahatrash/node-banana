import { NextResponse } from "next/server";
import { z } from "zod";
import { getLicensedTrendPreview, LicensedTrendCatalogError } from "@/lib/product-surfaces/licensed-trend-catalog";
import { createPresignedDownload } from "@/lib/storage";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

export const GET = withStudioAuth<{ params: Promise<Record<string, string>> }>({ route: "/api/product-inspiration/licensed-catalog/[catalogId]/[revision]/preview", action: "read", permission: "product:read" }, async (_request, authz, context) => {
  const params = await context.params;
  const parsed = z.object({ catalogId: z.string().trim().min(1).max(200), revision: z.coerce.number().int().positive() }).safeParse(params);
  if (!parsed.success) return NextResponse.json({ success: false, code: "LICENSED_TREND_PREVIEW_INVALID" }, { status: 400 });
  try {
    const preview = await getLicensedTrendPreview({ workspaceId: authz.workspaceId, ...parsed.data });
    const signed = await createPresignedDownload({ key: preview.storageKey, expiresInSeconds: 300 });
    return NextResponse.redirect(signed.downloadUrl, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof LicensedTrendCatalogError) return NextResponse.json({ success: false, code: error.code }, { status: 404 });
    throw error;
  }
});
