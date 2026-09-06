import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { MERCHANT_CHECKOUTS } from "@/lib/commercial/production";
import { MerchantCheckoutError } from "@/lib/commercial/checkout";

const id = z.string().trim().min(1).max(200);
const purpose = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subscription"), planId: id, planVersion: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("credit_pack"), packId: id, packVersion: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("channel_onboarding"), orderId: id, expectedRevision: z.number().int().positive() }).strict(),
]);
const bodySchema = z.object({ purpose, idempotencyKey: id }).strict();

export const POST = withStudioAuth<undefined>({ route: "/api/studio/billing/checkout", action: "write", permission: "product:billing:purchase" }, async (request: NextRequest, authz) => {
  const parsed = bodySchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_CHECKOUT" }, { status: 400 });
  try { const checkout = await MERCHANT_CHECKOUTS.create({ workspaceId: authz.workspaceId, userId: authz.userId, purpose: parsed.data.purpose, idempotencyKey: parsed.data.idempotencyKey, successPath: "/settings?section=billing&checkout=success", cancelPath: "/settings?section=billing&checkout=cancelled" }); return NextResponse.json({ success: true, checkout }, { status: 201 }); }
  catch (error) { if (error instanceof MerchantCheckoutError) return NextResponse.json({ success: false, code: error.code }, { status: 422 }); throw error; }
});
