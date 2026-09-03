import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { synchronizeOperationProjections } from "@/lib/agent-runtime/operation-status/projection-sync";
import { readSourceOperationProjections } from "@/lib/agent-runtime/operation-status/source-reader";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";
import { randomUUID } from "node:crypto";
import { claimOperationProjectionWorkspaces, completeOperationProjectionLease } from "@/lib/agent-runtime/operation-status/projection-leases";
import { advanceOperationProjectionCheckpoints, loadOperationProjectionCheckpoints, saveOperationProjectionCheckpoints } from "@/lib/agent-runtime/operation-status/projection-checkpoints";
async function handle(request: NextRequest) {
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  const database = getDb(); const at = new Date(); const owner = randomUUID();
  const workspaceIds = await claimOperationProjectionWorkspaces(database, { owner, at, limit: 25, leaseMs: 55_000 });
  const summaries = [];
  for (const workspaceId of workspaceIds) {
    try {
      const checkpoints = await loadOperationProjectionCheckpoints(database, workspaceId);
      const sources = await readSourceOperationProjections(database, workspaceId, 500, checkpoints);
      const summary = await synchronizeOperationProjections(PRODUCTION_OPERATION_STATUS, sources);
      if (summary.conflicts === 0) await saveOperationProjectionCheckpoints(database, { workspaceId, owner, checkpoints: advanceOperationProjectionCheckpoints(checkpoints, sources), at: new Date() });
      summaries.push({ workspaceId, ...summary });
    }
    finally { await completeOperationProjectionLease(database, { workspaceId, owner, at: new Date() }); }
  }
  return noStoreJson({ success: true, claimed: workspaceIds.length, summaries });
}
export const GET = handle; export const POST = handle;
