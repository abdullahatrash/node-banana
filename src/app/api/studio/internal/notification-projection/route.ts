import { type NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { WORKSPACE_NOTIFICATION_PROJECTOR } from "@/lib/product-notifications/production";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";

async function handle(request: NextRequest) {
  const denied = ensureInternalStudioOrCronAuth(request);
  if (denied) return denied;
  const parsed = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
  return noStoreJson({ success: true, result: await WORKSPACE_NOTIFICATION_PROJECTOR.project(limit) });
}

export const GET = handle;
export const POST = handle;
