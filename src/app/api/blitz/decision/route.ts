import { NextResponse } from "next/server";
import { z } from "zod";
import { decideBlitzItem } from "@/lib/product-surfaces/blitz";
import { ProductRecordConflictError, ProductRecordIdempotencyError } from "@/lib/product-surfaces/repository";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { BLITZ_REJECTION_CODES } from "@/lib/product-surfaces/definitions";
import { BlitzSimilarityServiceError } from "@/lib/product-surfaces/blitz-similarity-service";

const schema = z.object({ itemId: z.string().min(1).max(200), expectedRevision: z.number().int().positive(), decision: z.enum(["accepted", "rejected"]), reasons: z.array(z.object({ code: z.enum(BLITZ_REJECTION_CODES), note: z.string().trim().max(300).default("") }).strict()).max(12).default([]), generation: z.object({ assetId: z.string().min(1).max(200), intentId: z.string().min(1).max(200), operationId: z.string().min(1).max(200) }).strict().nullable().default(null), similarityEvidenceId: z.string().min(1).max(200).nullable().default(null), idempotencyKey: z.string().min(8).max(200) }).strict().superRefine((value, context) => {
  if (value.decision === "rejected" && value.reasons.length === 0) context.addIssue({ code: "custom", path: ["reasons"], message: "A structured rejection reason is required." });
  if (value.decision === "accepted" && value.reasons.length > 0) context.addIssue({ code: "custom", path: ["reasons"], message: "Acceptance cannot include rejection reasons." });
  if (value.decision === "accepted" && !value.similarityEvidenceId) context.addIssue({ code: "custom", path: ["similarityEvidenceId"], message: "Acceptance requires pinned similarity evidence." });
  if (value.decision === "rejected" && (value.generation || value.similarityEvidenceId)) context.addIssue({ code: "custom", path: ["generation"], message: "Rejection cannot bind generation evidence." });
});

export const POST = withStudioAuth<undefined>({ route: "/api/blitz/decision", action: "write", permission: "product:content:write" }, async (request, authz) => {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid Blitz decision.", issues: parsed.error.issues }, { status: 400 });
  try { return NextResponse.json({ success: true, ...(await decideBlitzItem({ workspaceId: authz.workspaceId, userId: authz.userId, ...parsed.data })) }); }
  catch (error) { if (error instanceof ProductRecordConflictError || error instanceof ProductRecordIdempotencyError) return NextResponse.json({ success: false, error: error.message }, { status: 409 }); if (error instanceof BlitzSimilarityServiceError) return NextResponse.json({ success: false, code: error.code }, { status: 422 }); if (error instanceof Error && error.message.startsWith("BLITZ_GENERATION_")) return NextResponse.json({ success: false, code: error.message }, { status: 422 }); throw error; }
});
