import { NextResponse, type NextRequest } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { runPerformanceSyncWorker } from "@/lib/product-surfaces/social-performance-sync";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";

async function handle(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request);
  if (denied) return denied;
  if (!isDatabaseConfigured()) return NextResponse.json({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const requested = Number(request.nextUrl.searchParams.get("limit") ?? "25");
  const limit = Number.isInteger(requested) ? Math.min(100, Math.max(1, requested)) : 25;
  const workerId = request.headers.get("x-vercel-id")?.slice(0, 200) || `social-performance:${crypto.randomUUID()}`;
  const summary = await runPerformanceSyncWorker({ workerId, limit });
  return NextResponse.json({ success: true, summary }, { headers: { "cache-control": "private, no-store" } });
}

export const GET = handle;
export const POST = handle;
