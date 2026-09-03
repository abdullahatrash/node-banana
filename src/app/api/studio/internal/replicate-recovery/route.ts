import { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { resolveInferenceKey } from "@/lib/byok/resolveInferenceKey";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { ensureInternalStudioOrCronAuth } from "@/lib/studio/internal-auth";
import { recoverReplicatePredictions } from "@/lib/model-routing/prediction-recovery";
import { ReplicatePredictionAdapter } from "@/lib/model-routing/replicate-contract";
import { ReplicateHttpClient } from "@/lib/model-routing/replicate-http-client";
import { PostgresProviderEffectClaims } from "@/lib/model-routing/prediction-ledger";
import { S3CanonicalArtifactIngestion } from "@/lib/model-routing/artifact-ingestion";

async function handle(request: NextRequest) {
  if (!isDatabaseConfigured()) return noStoreJson({ success: false, code: "DATABASE_REQUIRED" }, { status: 503 });
  const denied = ensureInternalStudioOrCronAuth(request); if (denied) return denied;
  const database = getDb();
  const summary = await recoverReplicatePredictions({ database, operations: PRODUCTION_OPERATION_STATUS, adapterFor: async (workspaceId) => { const token = await resolveInferenceKey({ headerKey: null, workspaceId, provider: "replicate" }); return new ReplicatePredictionAdapter(new ReplicateHttpClient(() => token), new PostgresProviderEffectClaims(getDb), new S3CanonicalArtifactIngestion()); } });
  return noStoreJson({ success: true, summary });
}
export const GET = handle; export const POST = handle;
