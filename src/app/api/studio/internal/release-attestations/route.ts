import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { isDatabaseConfigured } from "@/lib/db";
import { getReleaseControlService } from "@/lib/release-control/production";
import { ReleaseControlConflictError } from "@/lib/release-control/repository";

function authorized(request: NextRequest): boolean { const expected = process.env.RELEASE_ATTESTATION_INGEST_SECRET; const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""); if (!expected || expected.length < 32 || !actual) return false; const a = Buffer.from(expected); const b = Buffer.from(actual); return a.length === b.length && timingSafeEqual(a, b); }

export async function POST(request: NextRequest) {
  if (!authorized(request)) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "UNAVAILABLE" }, { status: 503 });
  const key = request.headers.get("idempotency-key")?.trim() || ""; if (key.length < 8 || key.length > 200) return noStoreJson({ success: false, code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  try { const result = await getReleaseControlService().appendAttested(await request.json(), key); return noStoreJson({ success: true, ...result }, { status: result.replayed ? 200 : 201 }); }
  catch (error) { if (error instanceof ReleaseControlConflictError) return noStoreJson({ success: false, code: "IDEMPOTENCY_CONFLICT" }, { status: 409 }); if (error instanceof SyntaxError || error instanceof TypeError || error instanceof z.ZodError) return noStoreJson({ success: false, code: error instanceof Error ? error.message : "INVALID_ATTESTATION" }, { status: 400 }); throw error; }
}
