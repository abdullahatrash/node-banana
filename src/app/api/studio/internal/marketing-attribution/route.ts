import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { isDatabaseConfigured } from "@/lib/db";
import { getMarketingAttributionCommercialReconciler, getMarketingAttributionService } from "@/lib/marketing-attribution/production";
import { MarketingAttributionConflictError } from "@/lib/marketing-attribution/repository";
import { ensureInternalStudioAuth, ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";

const event = z.object({ action: z.literal("enqueue"), workspaceId: z.string().trim().min(1).max(200), userId: z.string().trim().min(1).max(200), email: z.string().email().max(320).optional(), twclid: z.string().trim().max(200).optional(), eventName: z.enum(["sign_up", "trial_started", "purchase"]), occurredAt: z.string().datetime({ offset: true }), value: z.string().optional(), currency: z.string().optional(), idempotencyKey: z.string().min(8).max(200) }).strict();
const dispatch = z.object({ action: z.literal("dispatch"), limit: z.number().int().min(1).max(100).default(20) }).strict();
const reconcile = z.object({ action: z.literal("reconcile"), limit: z.number().int().min(1).max(500).default(100) }).strict();
const retention = z.object({ action: z.literal("retention"), limit: z.number().int().min(1).max(1000).default(500) }).strict();
const command = z.discriminatedUnion("action", [event, dispatch, reconcile, retention]);

export async function POST(request: NextRequest) {
  const denied = ensureInternalStudioAuth(request); if (denied) return denied;
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  try {
    const input = command.parse(await request.json()); const service = getMarketingAttributionService();
    const result = input.action === "enqueue" ? await service.enqueue({ ...input, occurredAt: new Date(input.occurredAt) }) : input.action === "dispatch" ? await service.dispatch(input.limit) : input.action === "reconcile" ? await getMarketingAttributionCommercialReconciler().reconcile(input.limit) : await service.deleteExpired(new Date(), input.limit);
    return noStoreJson({ success: true, result });
  } catch (error) {
    if (error instanceof MarketingAttributionConflictError) return noStoreJson({ success: false, code: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) return noStoreJson({ success: false, code: error instanceof TypeError ? error.message : "ATTRIBUTION_COMMAND_INVALID" }, { status: 400 });
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const requested = Number.parseInt(request.nextUrl.searchParams.get("limit") ?? "", 10);
  const retention = request.nextUrl.searchParams.get("action") === "retention";
  const limit = Number.isSafeInteger(requested) ? Math.min(Math.max(requested, 1), retention ? 1000 : 100) : retention ? 500 : 20;
  const service = getMarketingAttributionService();
  const result = retention ? await service.deleteExpired(new Date(), limit) : { reconciliation: await getMarketingAttributionCommercialReconciler().reconcile(Math.min(limit * 5, 500)), dispatch: await service.dispatch(limit) };
  return noStoreJson({ success: true, result });
}
