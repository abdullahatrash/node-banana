import { NextRequest } from "next/server";
import { z } from "zod";

import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { listPendingQualificationArtifactInspections, recordQualificationArtifactReview } from "@/lib/model-routing/qualification-artifact-review";
import { isQualificationHarnessAuthorized } from "@/lib/model-routing/qualification-webhook";

const reviewRequest = z.object({
  receiptId: z.string().regex(/^qai_[a-f0-9]{32}$/),
  reviewedContentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  decision: z.enum(["accepted", "rejected"]),
  reviewerId: z.string().min(3).max(200),
  method: z.enum(["operator_visual_review", "operator_playback_review"]),
  observedLanguages: z.array(z.enum(["ar", "en"])).min(1).max(2),
  notes: z.string().min(3).max(2_000),
}).strict();

function authorized(request: NextRequest) {
  return isQualificationHarnessAuthorized(request.headers.get("authorization"));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const parsed = z.coerce.number().int().min(1).max(100).safeParse(request.nextUrl.searchParams.get("limit") ?? "25");
  if (!parsed.success) return noStoreJson({ success: false, code: "QUALIFICATION_REVIEW_QUERY_INVALID" }, { status: 400 });
  return noStoreJson({ items: await listPendingQualificationArtifactInspections({ database: getDb(), limit: parsed.data }) });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const parsed = reviewRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ success: false, code: "QUALIFICATION_REVIEW_INVALID" }, { status: 400 });
  try {
    const result = await recordQualificationArtifactReview({ database: getDb(), ...parsed.data, at: new Date() });
    return noStoreJson({ success: true, ...result }, { status: result.kind === "recorded" ? 201 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUALIFICATION_REVIEW_FAILED";
    return noStoreJson({ success: false, code }, { status: code.includes("CONFLICT") || code.includes("MISMATCH") || code.includes("MISSING") ? 409 : 422 });
  }
}
