import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { isDatabaseConfigured } from "@/lib/db";
import { getReleaseControlService } from "@/lib/release-control/production";

const querySchema = z.object({ workspaceId: z.string().min(1).max(200) }).strict();
function authorized(request: NextRequest): boolean { const expected = process.env.RELEASE_DEPLOYMENT_GATE_SECRET; const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""); if (!expected || expected.length < 32 || !actual) return false; const a = Buffer.from(expected); const b = Buffer.from(actual); return a.length === b.length && timingSafeEqual(a, b); }

export async function GET(request: NextRequest) {
  if (!authorized(request)) return noStoreJson({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "UNAVAILABLE" }, { status: 503 });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams)); if (!parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const readiness = await getReleaseControlService().readiness(parsed.data.workspaceId); return noStoreJson({ success: readiness.releasable, readiness }, { status: readiness.releasable ? 200 : 412 });
}
