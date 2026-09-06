import { type NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";
import { MERCHANT_CHECKOUTS } from "@/lib/commercial/production";

async function handle(request: NextRequest) { const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied; const parsed = Number(request.nextUrl.searchParams.get("limit") ?? "20"); const limit = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 20) : 20; return noStoreJson({ success: true, result: await MERCHANT_CHECKOUTS.reconcile(limit) }); }
export const GET = handle;
export const POST = handle;
