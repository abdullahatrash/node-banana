import { NextRequest, NextResponse } from "next/server";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { productCreateSchema, productUpdateSchema } from "@/lib/product-surfaces/definitions";
import { createProductRecord, isProductRecordKind, listProductRecords, ProductRecordConflictError, ProductRecordIdempotencyError, ProductRecordTransitionError, updateProductRecord } from "@/lib/product-surfaces/repository";

export const GET = withStudioAuth<undefined>({ route: "/api/product-records", action: "read" }, async (request, authz) => {
  const requested = request.nextUrl.searchParams.getAll("kind");
  if (requested.some((kind) => !isProductRecordKind(kind))) return NextResponse.json({ success: false, error: "Unsupported record kind." }, { status: 400 });
  const kinds = requested.filter(isProductRecordKind);
  const records = await listProductRecords({ workspaceId: authz.workspaceId, kinds: kinds.length ? kinds : undefined });
  return NextResponse.json({ success: true, records });
});

export const POST = withStudioAuth<undefined>({ route: "/api/product-records", action: "write" }, async (request, authz) => {
  const parsed = productCreateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid product record.", issues: parsed.error.issues }, { status: 400 });
  try {
    const record = await createProductRecord({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    return NextResponse.json({ success: true, record }, { status: 201 });
  } catch (error) {
    if (error instanceof ProductRecordIdempotencyError) return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    if (error instanceof ProductRecordTransitionError) return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    throw error;
  }
});

export const PATCH = withStudioAuth<undefined>({ route: "/api/product-records", action: "write" }, async (request, authz) => {
  const parsed = productUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid product record update.", issues: parsed.error.issues }, { status: 400 });
  try {
    const record = await updateProductRecord({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    if (!record) return NextResponse.json({ success: false, error: "Record not found." }, { status: 404 });
    return NextResponse.json({ success: true, record });
  } catch (error) {
    if (error instanceof ProductRecordConflictError || error instanceof ProductRecordIdempotencyError) return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    if (error instanceof ProductRecordTransitionError) return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    throw error;
  }
});
