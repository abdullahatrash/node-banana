import { type NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { WORKSPACE_NOTIFICATIONS } from "@/lib/product-notifications/production";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";

async function handle(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request);
  if (denied) return denied;
  const parsed = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 20) : 20;
  return noStoreJson({ success: true, result: await WORKSPACE_NOTIFICATIONS.dispatchEmail(limit) });
}

export const GET = handle;
export const POST = handle;
