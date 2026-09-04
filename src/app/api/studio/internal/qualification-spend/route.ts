import { NextRequest } from "next/server";
import { z } from "zod";

import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import {
  authorizeQualificationSpend,
  loadQualificationSpendSigningAuthority,
  readQualificationSpendEvidence,
} from "@/lib/model-routing/qualification-spend-evidence";
import { isQualificationHarnessAuthorized } from "@/lib/model-routing/qualification-webhook";

export const runtime = "nodejs";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const capability = z.enum([
  "text_generation",
  "text_to_image",
  "image_to_image",
  "text_to_video",
  "image_to_video",
  "video_to_video",
]);
const authorizationRequest = z.object({
  kind: z.literal("authorize_qualification_spend"),
  runId: z.string().min(3).max(200),
  caseId: z.string().min(3).max(100),
  model: z.string().regex(/^[^/]+\/[^/]+$/),
  version: z.string().min(8).max(200),
  capability,
  billableQuantity: z.number().positive().max(600),
  maximumAmountUsd: z.number().positive().lt(0.4),
  pricingSourceDigest: digest,
  accountId: z.string().min(1).max(200),
  credentialFingerprint: digest,
}).strict();
const receiptQuery = z.object({
  predictionId: z.string().min(1).max(200),
  caseId: z.string().min(3).max(100),
}).strict();

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "QUALIFICATION_SPEND_SERVICE_FAILED";
  const status = code.includes("CONFLICT") || code.includes("MISMATCH") ? 409 : 422;
  return noStoreJson({ success: false, code }, { status });
}

export async function POST(request: NextRequest) {
  if (!isQualificationHarnessAuthorized(request.headers.get("authorization"))) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const parsed = authorizationRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ success: false, code: "QUALIFICATION_SPEND_AUTHORIZATION_REQUEST_INVALID" }, { status: 400 });
  try {
    const { accountId, credentialFingerprint, ...input } = parsed.data;
    const envelope = await authorizeQualificationSpend({
      ...input,
      pricingSourceDigest: input.pricingSourceDigest as `sha256:${string}`,
      account: { provider: "replicate", accountId, credentialFingerprint: credentialFingerprint as `sha256:${string}` },
      database: getDb(),
      authority: loadQualificationSpendSigningAuthority(),
      at: new Date(),
    });
    return noStoreJson(envelope, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  if (!isQualificationHarnessAuthorized(request.headers.get("authorization"))) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const parsed = receiptQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return noStoreJson({ success: false, code: "QUALIFICATION_SPEND_RECEIPT_QUERY_INVALID" }, { status: 400 });
  const envelope = await readQualificationSpendEvidence({ database: getDb(), ...parsed.data });
  return envelope ? noStoreJson(envelope) : noStoreJson({ success: false, code: "QUALIFICATION_SPEND_RECEIPT_NOT_FOUND" }, { status: 404 });
}
