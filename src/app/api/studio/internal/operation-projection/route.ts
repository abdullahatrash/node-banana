import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { synchronizeBoundedOperationProjectionPages } from "@/lib/agent-runtime/operation-status/projection-sync";
import { OPERATION_PROJECTION_SOURCE_IDS, readSourceOperationProjectionPage } from "@/lib/agent-runtime/operation-status/source-reader";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";
import { randomUUID } from "node:crypto";
import { claimOperationProjectionWorkspaces, completeOperationProjectionLease, renewOperationProjectionLease } from "@/lib/agent-runtime/operation-status/projection-leases";
import { loadOperationProjectionCheckpoints, saveOperationProjectionCheckpoints } from "@/lib/agent-runtime/operation-status/projection-checkpoints";
async function handle(request: NextRequest) {
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  const database = getDb(); const at = new Date(); const owner = randomUUID(); const deadline = Date.now() + 45_000;
  const workspaceIds = await claimOperationProjectionWorkspaces(database, { owner, at, limit: 25, leaseMs: 55_000 });
  const summaries = [];
  for (const workspaceId of workspaceIds) {
    try {
      const checkpoints = await loadOperationProjectionCheckpoints(database, workspaceId);
      const result = await synchronizeBoundedOperationProjectionPages({
        service: PRODUCTION_OPERATION_STATUS,
        sourceIds: OPERATION_PROJECTION_SOURCE_IDS,
        checkpoints,
        pageSize: 200,
        maxPages: 25,
        renewLease: () => renewOperationProjectionLease(database, { workspaceId, owner, at: new Date(), leaseMs: 55_000 }),
        readPage: (sourceId, checkpoint, pageSize) => readSourceOperationProjectionPage(database, workspaceId, sourceId, pageSize, checkpoint),
        persistPage: (sourceId, checkpoint) => saveOperationProjectionCheckpoints(database, { workspaceId, owner, checkpoints: { [sourceId]: checkpoint }, at: new Date() }),
        shouldContinue: () => Date.now() < deadline,
      });
      const { checkpoints: _checkpoints, ...summary } = result;
      summaries.push({ workspaceId, ...summary });
    }
    finally { await completeOperationProjectionLease(database, { workspaceId, owner, at: new Date() }); }
  }
  return noStoreJson({ success: true, claimed: workspaceIds.length, summaries });
}
export const GET = handle; export const POST = handle;
