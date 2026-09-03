import type { ExactModelRef, GenerationIntent } from "./types";

export interface ReplicatePrediction { id: string; status: "starting" | "processing" | "succeeded" | "failed" | "canceled" | "aborted"; output?: unknown; error?: string | null; }
export interface ReplicateClientPort { create(input: { version: string; input: Record<string, unknown> }): Promise<ReplicatePrediction>; get(id: string): Promise<ReplicatePrediction>; cancel(id: string): Promise<ReplicatePrediction>; }
export interface PredictionLedgerPort { persist(input: { workspaceId: string; intentId: string; provider: "replicate"; predictionId: string; model: ExactModelRef; createdAt: Date }): Promise<"created" | "replayed" | "conflict">; }
export interface CanonicalArtifactIngestionPort { ingest(input: { workspaceId: string; intent: GenerationIntent; providerPredictionId: string; output: unknown }): Promise<{ artifactIds: string[] }>; }
export type ReplicateExecutionResult = { state: "waiting_provider"; predictionId: string } | { state: "succeeded"; predictionId: string; artifactIds: string[] } | { state: "cancelled"; predictionId: string } | { state: "failed_known"; predictionId: string | null; code: string } | { state: "outcome_unknown"; predictionId: string | null; code: string };

/** A single-attempt contract. Scheduling/poll cadence belongs to the durable worker; this adapter never retries or selects a fallback. */
export class ReplicatePredictionAdapter {
  constructor(private readonly client: ReplicateClientPort, private readonly ledger: PredictionLedgerPort, private readonly artifacts: CanonicalArtifactIngestionPort, private readonly now = () => new Date()) {}
  async submit(intent: GenerationIntent, providerInput: Record<string, unknown>): Promise<ReplicateExecutionResult> {
    if (intent.selectedModel.provider !== "replicate") return { state: "failed_known", predictionId: null, code: "PROVIDER_MISMATCH" };
    let prediction: ReplicatePrediction;
    try { prediction = await this.client.create({ version: intent.selectedModel.version, input: structuredClone(providerInput) }); }
    catch { return { state: "outcome_unknown", predictionId: null, code: "REPLICATE_SUBMIT_TRANSPORT_LOST" }; }
    const persisted = await this.ledger.persist({ workspaceId: intent.workspaceId, intentId: intent.id, provider: "replicate", predictionId: prediction.id, model: intent.selectedModel, createdAt: this.now() });
    if (persisted === "conflict") return { state: "failed_known", predictionId: prediction.id, code: "PREDICTION_IDENTITY_CONFLICT" };
    return this.map(intent, prediction);
  }
  async poll(intent: GenerationIntent, predictionId: string): Promise<ReplicateExecutionResult> {
    try { return this.map(intent, await this.client.get(predictionId)); }
    catch { return { state: "outcome_unknown", predictionId, code: "REPLICATE_POLL_TRANSPORT_LOST" }; }
  }
  async cancel(intent: GenerationIntent, predictionId: string): Promise<ReplicateExecutionResult> {
    try { return this.map(intent, await this.client.cancel(predictionId)); }
    catch { return { state: "outcome_unknown", predictionId, code: "REPLICATE_CANCEL_TRANSPORT_LOST" }; }
  }
  private async map(intent: GenerationIntent, value: ReplicatePrediction): Promise<ReplicateExecutionResult> {
    if (value.status === "starting" || value.status === "processing") return { state: "waiting_provider", predictionId: value.id };
    if (value.status === "canceled" || value.status === "aborted") return { state: "cancelled", predictionId: value.id };
    if (value.status === "failed") return { state: "failed_known", predictionId: value.id, code: "REPLICATE_FAILED" };
    try { const result = await this.artifacts.ingest({ workspaceId: intent.workspaceId, intent, providerPredictionId: value.id, output: value.output }); return { state: "succeeded", predictionId: value.id, artifactIds: result.artifactIds }; }
    catch { return { state: "failed_known", predictionId: value.id, code: "ARTIFACT_INGESTION_FAILED" }; }
  }
}
