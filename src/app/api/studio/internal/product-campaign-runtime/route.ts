import { NextResponse, type NextRequest } from "next/server";
import { PRODUCT_CAMPAIGN_RUNTIME_WORKER } from "@/lib/product-surfaces/campaign-runtime-worker";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";

async function handle(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  const workerId = request.headers.get("x-vercel-id") ?? `campaign-runtime:${Date.now()}`;
  return NextResponse.json({ success: true, result: await PRODUCT_CAMPAIGN_RUNTIME_WORKER.run({ workerId }) });
}

export const GET = handle;
export const POST = handle;
