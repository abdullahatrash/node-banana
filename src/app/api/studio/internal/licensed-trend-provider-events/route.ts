import { NextRequest } from "next/server";
import { z } from "zod";

import { noStoreJson } from "@/lib/agent-auth/http-request";
import { isDatabaseConfigured } from "@/lib/db";
import {
  PRODUCTION_LICENSED_TREND_PROVIDER_INBOX,
  LicensedTrendProviderInboxError,
} from "@/lib/product-surfaces/licensed-trend-provider-inbox";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";

const providerKey = z.string().regex(/^[a-z][a-z0-9._-]{1,119}$/);
const eventId = z.string().trim().min(1).max(200);
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), limit: z.number().int().min(1).max(50).optional() }).strict(),
  z.object({ action: z.literal("retry"), providerKey, eventId }).strict(),
  z.object({ action: z.literal("skip"), providerKey, eventId, reason: z.string().trim().min(8).max(500) }).strict(),
]);

async function run(request: NextRequest, limit?: number) {
  const workerId = request.headers.get("x-vercel-id")?.slice(0, 200)
    || `licensed-trend-provider:${crypto.randomUUID()}`;
  const summary = await PRODUCTION_LICENSED_TREND_PROVIDER_INBOX.run({ workerId, limit: limit ?? 10 });
  return noStoreJson({ success: true, summary });
}

export async function GET(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request);
  if (denied) return denied;
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "10");
  return run(request, Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 10);
}

export async function POST(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request);
  if (denied) return denied;
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  let raw: unknown;
  try { raw = await request.json(); } catch { raw = null; }
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) return noStoreJson({ success: false, code: "LICENSED_TREND_PROVIDER_COMMAND_INVALID" }, { status: 400 });
  try {
    if (parsed.data.action === "run") return run(request, parsed.data.limit);
    const result = parsed.data.action === "retry"
      ? await PRODUCTION_LICENSED_TREND_PROVIDER_INBOX.retry(parsed.data)
      : await PRODUCTION_LICENSED_TREND_PROVIDER_INBOX.skip(parsed.data);
    return noStoreJson({ success: true, result });
  } catch (error) {
    if (error instanceof LicensedTrendProviderInboxError) {
      return noStoreJson({ success: false, code: error.code }, { status: 409 });
    }
    return noStoreJson({ success: false, code: "LICENSED_TREND_PROVIDER_COMMAND_UNAVAILABLE" }, { status: 500 });
  }
}
