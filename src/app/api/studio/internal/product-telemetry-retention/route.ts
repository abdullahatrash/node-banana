import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { isDatabaseConfigured } from "@/lib/db";
import { getReleaseControlService } from "@/lib/release-control/production";

function authorized(request: NextRequest): boolean { const expected = process.env.RELEASE_TELEMETRY_RETENTION_SECRET || process.env.CRON_SECRET; const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""); if (!expected || expected.length < 32 || !actual) return false; const a = Buffer.from(expected); const b = Buffer.from(actual); return a.length === b.length && timingSafeEqual(a, b); }

export async function POST(request: NextRequest) {
  if (!authorized(request)) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "UNAVAILABLE" }, { status: 503 });
  const rawLimit = new URL(request.url).searchParams.get("limit"); const limit = rawLimit ? Number(rawLimit) : 500;
  try {
    const service = getReleaseControlService();
    const [backfill, deleted] = await Promise.all([service.backfillTelemetryPrivacyFields(limit), service.deleteExpiredTelemetry(new Date(), Math.min(limit, 1000))]);
    return noStoreJson({ success: true, deleted, backfill });
  }
  catch (error) { if (error instanceof TypeError) return noStoreJson({ success: false, code: error.message }, { status: 400 }); throw error; }
}
