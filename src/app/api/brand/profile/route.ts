import { NextResponse } from "next/server";
import { z } from "zod";
import { brandProfileCorrectionSchema } from "@/lib/onboarding/schemas";
import { activateBrandRevision, BrandRevisionConflictError, createBrandRevision } from "@/lib/product-surfaces/brand";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_revision"), expectedActiveRevision: z.number().int().positive(), correction: brandProfileCorrectionSchema, idempotencyKey: z.string().min(8).max(200) }),
  z.object({ action: z.literal("activate_revision"), profileId: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(8).max(200) }),
]);

export const POST = withStudioAuth<undefined>({ route: "/api/brand/profile", action: "write" }, async (request, authz) => {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid Brand Profile command.", issues: parsed.error.issues }, { status: 400 });
  try {
    const result = parsed.data.action === "create_revision"
      ? await createBrandRevision({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data })
      : await activateBrandRevision({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    return NextResponse.json({ success: true, ...result }, { status: parsed.data.action === "create_revision" ? 201 : 200 });
  } catch (error) {
    if (error instanceof BrandRevisionConflictError) return NextResponse.json({ success: false, error: error.message }, { status: 409 });
    throw error;
  }
});
