import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { resolveProviderKeyByRef, type DurableProviderCredentialRef } from "@/lib/byok/repository";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";
import { recoverReplicatePredictions } from "@/lib/model-routing/prediction-recovery";
import { productionReplicateAdapter } from "@/lib/model-routing/execution-production";

async function handle(request: NextRequest) {
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  const database = getDb();
  const summary = await recoverReplicatePredictions({ database, operations: PRODUCTION_OPERATION_STATUS, adapterFor: async (workspaceId, credentialRef) => { const token = await resolveProviderKeyByRef(workspaceId, credentialRef as DurableProviderCredentialRef); if (!token) throw new Error("DURABLE_REPLICATE_CREDENTIAL_REVISION_UNAVAILABLE"); return productionReplicateAdapter({ key: token, ref: credentialRef }); } });
  return noStoreJson({ success: true, summary });
}
export const GET = handle; export const POST = handle;
