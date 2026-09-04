import { NextResponse, type NextRequest } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { PRODUCTION_LICENSED_TREND_MATERIALIZATION_WORKER } from "@/lib/product-surfaces/licensed-trend-materialization";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";

async function handle(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  if (!isDatabaseConfigured()) return NextResponse.json({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const raw = Number(request.nextUrl.searchParams.get("limit") ?? "10");
  const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 50) : 10;
  const workerId = request.headers.get("x-vercel-id")?.slice(0, 200) || `licensed-trends:${crypto.randomUUID()}`;
  const summary = await PRODUCTION_LICENSED_TREND_MATERIALIZATION_WORKER.run({ workerId, limit });
  return NextResponse.json({ success: true, summary }, { headers: { "cache-control": "private, no-store" } });
}

export const GET = handle;
export const POST = handle;
