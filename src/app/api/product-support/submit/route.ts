import { z } from "zod";
import { NextResponse } from "next/server";
import { SupportAttachmentPolicyError } from "@/lib/product-support/attachments";
import { submitSupportCommand } from "@/lib/product-support/commands";
import { ProductRecordIdempotencyError } from "@/lib/product-surfaces/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const base = { title: z.string().trim().min(1).max(240), body: z.string().trim().min(1).max(5_000), attachmentAssetIds: z.array(z.string().trim().min(1).max(200)).max(5).default([]), idempotencyKey: z.string().trim().min(1).max(200) };
const submissionSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("feedback"), category: z.enum(["idea", "problem", "praise"]), route: z.string().trim().max(500) }).strict(),
  z.object({ ...base, kind: z.literal("support_case"), category: z.enum(["account", "billing", "generation", "publishing", "safety", "other"]), severity: z.enum(["normal", "urgent"]) }).strict(),
]);

export const POST = withStudioAuth<undefined>({ route: "/api/product-support/submit", action: "write", permission: "product:support:submit" }, async (request, authz) => {
  const parsed = submissionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, code: "SUPPORT_SUBMISSION_INVALID", error: "Invalid support submission." }, { status: 400 });
  try {
    const record = await submitSupportCommand({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data });
    return NextResponse.json({ success: true, record }, { status: 201 });
  } catch (error) {
    if (error instanceof SupportAttachmentPolicyError) return NextResponse.json({ success: false, code: error.code, error: error.code }, { status: 422 });
    if (error instanceof ProductRecordIdempotencyError) return NextResponse.json({ success: false, code: "SUPPORT_SUBMISSION_IDEMPOTENCY_CONFLICT", error: error.message }, { status: 409 });
    throw error;
  }
});
