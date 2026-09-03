import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { synchronizeOperationProjections } from "@/lib/agent-runtime/operation-status/projection-sync";
import { readSourceOperationProjections } from "@/lib/agent-runtime/operation-status/source-reader";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";
async function handle(request: NextRequest) {
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!workspaceId || !/^[A-Za-z0-9._:-]{1,200}$/.test(workspaceId)) return noStoreJson({ success: false, code: "WORKSPACE_REQUIRED" }, { status: 400 });
  const sources = await readSourceOperationProjections(getDb(), workspaceId, 500);
  return noStoreJson({ success: true, summary: await synchronizeOperationProjections(PRODUCTION_OPERATION_STATUS, sources) });
}
export const GET = handle; export const POST = handle;
