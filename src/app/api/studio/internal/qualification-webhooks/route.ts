import { NextRequest } from "next/server";
import { z } from "zod";

import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { isQualificationHarnessAuthorized, observeQualificationWebhook } from "@/lib/model-routing/qualification-webhook";

const querySchema = z.object({
  caseId: z.string().min(3).max(100),
  endpoint: z.enum(["official", "versioned"]),
  model: z.string().regex(/^[^/]+\/[^/]+$/),
  version: z.string().min(1).max(200),
  submissionKey: z.string().min(16).max(300).optional(),
  predictionId: z.string().min(1).max(200).optional(),
}).strict().refine((value) => Boolean(value.submissionKey) !== Boolean(value.predictionId));

export async function GET(request: NextRequest) {
  if (!isQualificationHarnessAuthorized(request.headers.get("authorization"))) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return noStoreJson({ success: false, code: "QUALIFICATION_OBSERVER_QUERY_INVALID" }, { status: 400 });
  const common = { database: getDb(), caseId: parsed.data.caseId, endpoint: parsed.data.endpoint, model: parsed.data.model, version: parsed.data.version };
  const result = parsed.data.submissionKey
    ? await observeQualificationWebhook({ ...common, submissionKey: parsed.data.submissionKey })
    : await observeQualificationWebhook({ ...common, predictionId: parsed.data.predictionId! });
  return result ? noStoreJson(result) : noStoreJson({ success: false, code: "QUALIFICATION_WEBHOOK_NOT_OBSERVED" }, { status: 404 });
}
