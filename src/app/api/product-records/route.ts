import { NextResponse } from "next/server";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { isProductRecordKind, listProductRecords } from "@/lib/product-surfaces/repository";

export const GET = withStudioAuth<undefined>({ route: "/api/product-records", action: "read", permission: "product:read" }, async (request, authz) => {
  const requested = request.nextUrl.searchParams.getAll("kind");
  if (requested.some((kind) => !isProductRecordKind(kind))) return NextResponse.json({ success: false, error: "Unsupported record kind." }, { status: 400 });
  const kinds = requested.filter(isProductRecordKind);
  const records = await listProductRecords({ workspaceId: authz.workspaceId, kinds: kinds.length ? kinds : undefined });
  return NextResponse.json({ success: true, records });
});
