import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/db";
import { grantLicensedTrendEntitlement, LicensedTrendCatalogError, publishLicensedTrendCatalogRevision, revokeLicensedTrendEntitlement, setLicensedTrendCatalogState } from "@/lib/product-surfaces/licensed-trend-catalog";
import { licensedTrendCatalogUnsignedSchema } from "@/lib/product-surfaces/licensed-trend-types";
import { ensureInternalStudioAuth } from "@/lib/studio/internal-auth";

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), document: licensedTrendCatalogUnsignedSchema }).strict(),
  z.object({ action: z.literal("set_catalog_state"), catalogId: z.string().trim().min(1).max(200), state: z.enum(["active", "paused", "revoked"]) }).strict(),
  z.object({ action: z.literal("grant"), workspaceId: z.string().trim().min(1).max(200), catalogId: z.string().trim().min(1).max(200), catalogRevision: z.number().int().positive(), territories: z.array(z.string().trim().min(1).max(80)).min(1).max(100), expiresAt: z.string().datetime().nullable(), grantAuthority: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal("revoke_entitlement"), workspaceId: z.string().trim().min(1).max(200), entitlementId: z.string().trim().min(1).max(200) }).strict(),
]);

export async function POST(request: NextRequest) {
  const denied = ensureInternalStudioAuth(request); if (denied) return denied;
  if (!isDatabaseConfigured()) return NextResponse.json({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  let raw: unknown; try { raw = await request.json(); } catch { raw = null; }
  const parsed = command.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ success: false, code: "LICENSED_TREND_COMMAND_INVALID" }, { status: 400 });
  try {
    const value = parsed.data.action === "publish" ? await publishLicensedTrendCatalogRevision({ document: parsed.data.document })
      : parsed.data.action === "set_catalog_state" ? await setLicensedTrendCatalogState(parsed.data)
      : parsed.data.action === "grant" ? await grantLicensedTrendEntitlement({ ...parsed.data, expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null })
      : await revokeLicensedTrendEntitlement(parsed.data);
    return NextResponse.json({ success: true, result: value }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof LicensedTrendCatalogError) return NextResponse.json({ success: false, code: error.code }, { status: 409 });
    throw error;
  }
}
