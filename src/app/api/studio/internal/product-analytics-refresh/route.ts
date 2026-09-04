import { NextResponse, type NextRequest } from "next/server"
import { PRODUCTION_ANALYTICS_REFRESH_WORKER } from "@/lib/product-surfaces/analytics-refresh-repository"
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth"

async function handle(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request)
  if (denied) return denied
  const workerId = request.headers.get("x-vercel-id") ?? `analytics-refresh:${Date.now()}`
  return NextResponse.json({ success: true, result: await PRODUCTION_ANALYTICS_REFRESH_WORKER.run({ workerId, limit: 20 }) })
}

export const GET = handle
export const POST = handle
