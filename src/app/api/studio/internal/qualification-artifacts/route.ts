import { NextRequest } from "next/server";
import { z } from "zod";

import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { inspectQualificationArtifact, readQualificationIngestionReceipt, recordQualificationArtifactInspection, recordQualificationArtifactReview } from "@/lib/model-routing/qualification-artifact-review";
import { isQualificationHarnessAuthorized } from "@/lib/model-routing/qualification-webhook";

export const runtime = "nodejs";
export const maxDuration = 300;

const capability = z.enum(["text_generation", "text_to_image", "image_to_image", "text_to_video", "image_to_video", "video_to_video"]);
const identity = z.object({ predictionId: z.string().min(1).max(200), caseId: z.string().min(3).max(100), capability, contentLanguage: z.enum(["ar", "en"]) }).strict();
const inspectRequest = identity.extend({ output: z.unknown() }).strict();

function resultResponse(result: Awaited<ReturnType<typeof readQualificationIngestionReceipt>>) {
  if (!result) return noStoreJson({ success: false, code: "QUALIFICATION_ARTIFACT_NOT_INSPECTED" }, { status: 404 });
  if (result.state === "pending") return noStoreJson({ success: false, code: "QUALIFICATION_ARTIFACT_REVIEW_REQUIRED", inspection: result }, { status: 202 });
  if (result.state === "rejected") return noStoreJson({ success: false, code: "QUALIFICATION_ARTIFACT_REVIEW_REJECTED", receiptId: result.receiptId }, { status: 409 });
  return noStoreJson(result.receipt);
}

export async function POST(request: NextRequest) {
  if (!isQualificationHarnessAuthorized(request.headers.get("authorization"))) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const parsed = inspectRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ success: false, code: "QUALIFICATION_ARTIFACT_REQUEST_INVALID" }, { status: 400 });
  try {
    const inspected = await inspectQualificationArtifact(parsed.data);
    await recordQualificationArtifactInspection({ database: getDb(), inspection: inspected.inspection, at: new Date() });
    if (inspected.automaticallyObservedLanguages) {
      if (inspected.automaticallyObservedLanguages.length === 0) return noStoreJson({ success: false, code: "QUALIFICATION_TEXT_LANGUAGE_UNDETECTED" }, { status: 422 });
      await recordQualificationArtifactReview({ database: getDb(), receiptId: inspected.inspection.receiptId, reviewedContentDigest: inspected.inspection.contentDigest, decision: inspected.automaticallyObservedLanguages.includes(parsed.data.contentLanguage) ? "accepted" : "rejected", reviewerId: "system:unicode-script-v1", method: "automatic_unicode_script", observedLanguages: inspected.automaticallyObservedLanguages, notes: "Deterministic Unicode script detection over the complete text output.", at: new Date() });
    }
    return resultResponse(await readQualificationIngestionReceipt({ database: getDb(), predictionId: parsed.data.predictionId, caseId: parsed.data.caseId, capability: parsed.data.capability, contentLanguage: parsed.data.contentLanguage }));
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUALIFICATION_ARTIFACT_INSPECTION_FAILED";
    const status = code.includes("CONFLICT") || code.includes("MISMATCH") ? 409 : 422;
    return noStoreJson({ success: false, code }, { status });
  }
}

export async function GET(request: NextRequest) {
  if (!isQualificationHarnessAuthorized(request.headers.get("authorization"))) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const parsed = identity.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return noStoreJson({ success: false, code: "QUALIFICATION_ARTIFACT_QUERY_INVALID" }, { status: 400 });
  return resultResponse(await readQualificationIngestionReceipt({ database: getDb(), ...parsed.data }));
}
