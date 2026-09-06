import { getDb } from "@/lib/db";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { PostgresModelRoutingRepository } from "./postgres-repository";
import { PostgresProviderEffectClaims } from "./prediction-ledger";
import { ReplicateHttpClient } from "./replicate-http-client";
import { ReplicatePredictionAdapter } from "./replicate-contract";
import { S3CanonicalArtifactIngestion } from "./artifact-ingestion";
import { GenerationExecutionService } from "./execution";
import type { DurableProviderCredentialRef } from "@/lib/byok/repository";
import { PRODUCTION_GENERATION_REGIONS } from "./production";
import { PostgresCanonicalTextOutputIngestion } from "./text-output-receipts";

export function productionGenerationExecution(credential: { key: string; ref: DurableProviderCredentialRef }) {
  const routing = new PostgresModelRoutingRepository(getDb);
  return new GenerationExecutionService(routing, PRODUCTION_OPERATION_STATUS, productionReplicateAdapter(credential), undefined, undefined, PRODUCTION_GENERATION_REGIONS);
}

export function productionReplicateAdapter(credential: { key: string; ref: DurableProviderCredentialRef }) {
  return new ReplicatePredictionAdapter(
    new ReplicateHttpClient(() => credential.key),
    new PostgresProviderEffectClaims(getDb),
    new S3CanonicalArtifactIngestion(),
    credential.ref,
    undefined,
    undefined,
    new PostgresCanonicalTextOutputIngestion(getDb),
  );
}
