import { NextResponse, type NextRequest } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { PRODUCTION_TREND_INGESTION_WORKER } from "@/lib/product-surfaces/trend-ingestion-repository";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";

async function handle(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request);
  if (denied) return denied;
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, code: "DATABASE_REQUIRED" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }

  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;
  const workerId = request.headers.get("x-vercel-id")?.slice(0, 200) || `inspiration-trends:${crypto.randomUUID()}`;
  const summary = await PRODUCTION_TREND_INGESTION_WORKER.run({ workerId, limit });
  return NextResponse.json(
    { success: true, summary },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export const GET = handle;
export const POST = handle;
