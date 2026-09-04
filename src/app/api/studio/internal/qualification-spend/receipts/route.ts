import { NextRequest } from "next/server";
import { z } from "zod";

import { noStoreJson } from "@/lib/agent-auth/http-request";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import {
  importQualificationSpendEvidence,
  listPendingQualificationSpendEvidence,
  loadQualificationSpendSigningAuthority,
} from "@/lib/model-routing/qualification-spend-evidence";
import { isQualificationHarnessAuthorized } from "@/lib/model-routing/qualification-webhook";

export const runtime = "nodejs";

const importRequest = z.object({
  runId: z.string().min(3).max(200),
  caseId: z.string().min(3).max(100),
  predictionId: z.string().min(1).max(200),
  amountUsd: z.number().nonnegative().lt(0.4),
  providerObservedAt: z.string().datetime({ offset: true }),
  providerEvidenceKind: z.enum([
    "replicate_account_usage_export",
    "replicate_invoice",
    "replicate_account_screenshot",
  ]),
  providerEvidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  importedBy: z.string().trim().min(3).max(200),
  notes: z.string().trim().min(3).max(2_000),
  exactPredictionChargeConfirmed: z.literal(true),
}).strict();
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();

function authorized(request: NextRequest) {
  return isQualificationHarnessAuthorized(request.headers.get("authorization"));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const parsed = listQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return noStoreJson({ success: false, code: "QUALIFICATION_SPEND_RECEIPT_LIST_QUERY_INVALID" }, { status: 400 });
  return noStoreJson({ success: true, items: await listPendingQualificationSpendEvidence({ database: getDb(), limit: parsed.data.limit }) });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const parsed = importRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ success: false, code: "QUALIFICATION_SPEND_RECEIPT_IMPORT_INVALID" }, { status: 400 });
  try {
    const { exactPredictionChargeConfirmed: _confirmed, providerObservedAt, ...input } = parsed.data;
    const result = await importQualificationSpendEvidence({
      ...input,
      providerEvidenceDigest: input.providerEvidenceDigest as `sha256:${string}`,
      providerObservedAt: new Date(providerObservedAt),
      database: getDb(),
      authority: loadQualificationSpendSigningAuthority(),
      at: new Date(),
    });
    return noStoreJson({ success: true, ...result }, { status: result.kind === "recorded" ? 201 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUALIFICATION_SPEND_RECEIPT_IMPORT_FAILED";
    const status = code.includes("CONFLICT") || code.includes("MISMATCH") ? 409 : 422;
    return noStoreJson({ success: false, code }, { status });
  }
}
