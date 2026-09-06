import { NextRequest } from "next/server";
import { z } from "zod";

import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { recordQualificationWebhook } from "@/lib/model-routing/qualification-webhook";
import { verifyReplicateWebhook } from "@/lib/model-routing/replicate-webhook";

const payloadSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(["starting", "processing", "succeeded", "failed", "canceled", "aborted"]),
  model: z.string().min(1).max(200).nullable().optional(),
  version: z.string().min(1).max(200).nullable().optional(),
}).passthrough();

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const caseId = request.nextUrl.searchParams.get("caseId")?.trim() ?? "";
  const submissionKey = request.nextUrl.searchParams.get("submissionKey")?.trim() ?? "";
  if (caseId.length < 3 || caseId.length > 100 || submissionKey.length < 16 || submissionKey.length > 300) return noStoreJson({ success: false, code: "QUALIFICATION_CORRELATION_INVALID" }, { status: 400 });
  const body = await request.text();
  const at = new Date();
  const verified = verifyReplicateWebhook({ body, eventId: request.headers.get("webhook-id"), timestamp: request.headers.get("webhook-timestamp"), signature: request.headers.get("webhook-signature"), secret: process.env.REPLICATE_WEBHOOK_SIGNING_SECRET, at });
  if (!verified.ok) return noStoreJson({ success: false, code: verified.code }, { status: 401 });
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return noStoreJson({ success: false, code: "WEBHOOK_PAYLOAD_INVALID" }, { status: 400 }); }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return noStoreJson({ success: false, code: "WEBHOOK_PAYLOAD_INVALID" }, { status: 400 });
  const result = await recordQualificationWebhook({ database: getDb(), eventId: verified.eventId, caseId, submissionKey, predictionId: parsed.data.id, providerStatus: parsed.data.status, providerModel: parsed.data.model ?? null, providerVersion: parsed.data.version ?? null, payload: raw, at });
  const status = result.kind === "not_found" ? 404 : result.kind === "version_mismatch" || result.kind === "conflict" ? 409 : 202;
  return noStoreJson({ success: status === 202, result }, { status });
}
