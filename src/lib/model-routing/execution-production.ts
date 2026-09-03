import { getDb } from "@/lib/db";
import { PRODUCTION_OPERATION_STATUS } from "@/lib/agent-runtime/operation-status/production";
import { PostgresModelRoutingRepository } from "./postgres-repository";
import { PostgresProviderEffectClaims } from "./prediction-ledger";
import { ReplicateHttpClient } from "./replicate-http-client";
import { ReplicatePredictionAdapter } from "./replicate-contract";
import { S3CanonicalArtifactIngestion } from "./artifact-ingestion";
import { GenerationExecutionService } from "./execution";

export function productionGenerationExecution(token: string) {
  const routing = new PostgresModelRoutingRepository(getDb);
  const adapter = new ReplicatePredictionAdapter(
    new ReplicateHttpClient(() => token),
    new PostgresProviderEffectClaims(getDb),
    new S3CanonicalArtifactIngestion(),
  );
  return new GenerationExecutionService(routing, PRODUCTION_OPERATION_STATUS, adapter);
}
