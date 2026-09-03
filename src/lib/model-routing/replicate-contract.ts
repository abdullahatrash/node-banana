import { randomUUID } from "node:crypto";
import { findCuratedModel } from "./catalog";
import type { ExactModelRef, GenerationIntent, ModelDescriptor } from "./types";
import type { DurableProviderCredentialRef } from "@/lib/byok/repository";

export interface ReplicatePrediction { id: string; status: "starting" | "processing" | "succeeded" | "failed" | "canceled" | "aborted"; version?: string | null; output?: unknown; error?: string | null; }
export interface ReplicateClientPort { create(input: { endpoint: "versioned"; model: string; version: string; input: Record<string, unknown>; cancelAfterSeconds: number }): Promise<ReplicatePrediction>; get(id: string): Promise<ReplicatePrediction>; cancel(id: string): Promise<ReplicatePrediction>; }
export interface ProviderEffectClaimPort {
  claim(input: { workspaceId: string; intentId: string; provider: "replicate"; claimToken: string; credentialRef: DurableProviderCredentialRef; at: Date }): Promise<{ kind: "claimed" } | { kind: "existing"; state: "claimed" | "submitted" | "outcome_unknown"; predictionId: string | null }>;
  bindPrediction(input: { workspaceId: string; intentId: string; claimToken: string; predictionId: string; model: ExactModelRef; executedVersion: string | null; credentialRef: DurableProviderCredentialRef; at: Date }): Promise<"bound" | "replayed" | "conflict">;
  markOutcomeUnknown(input: { workspaceId: string; intentId: string; claimToken: string; at: Date }): Promise<void>;
}
export interface CanonicalArtifactIngestionPort { ingest(input: { workspaceId: string; intent: GenerationIntent; providerPredictionId: string; output: unknown }): Promise<{ artifactIds: string[] }>; }
export type ReplicateExecutionResult = { state: "waiting_provider"; predictionId: string | null; code?: string } | { state: "succeeded"; predictionId: string; artifactIds: string[] } | { state: "cancelled"; predictionId: string } | { state: "failed_known"; predictionId: string | null; code: string } | { state: "outcome_unknown"; predictionId: string | null; code: string };

/** A single-attempt contract. Scheduling/poll cadence belongs to the durable worker; this adapter never retries or selects a fallback. */
export class ReplicatePredictionAdapter {
  constructor(private readonly client: ReplicateClientPort, private readonly effects: ProviderEffectClaimPort, private readonly artifacts: CanonicalArtifactIngestionPort, private readonly credentialRef: DurableProviderCredentialRef, private readonly now = () => new Date(), private readonly resolveModel: (ref: ExactModelRef) => ModelDescriptor | null = findCuratedModel) {}
  async submit(intent: GenerationIntent, providerInput: Record<string, unknown>): Promise<ReplicateExecutionResult> {
    if (intent.selectedModel.provider !== "replicate") return { state: "failed_known", predictionId: null, code: "PROVIDER_MISMATCH" };
    const descriptor = this.resolveModel(intent.selectedModel);
    if (!descriptor || descriptor.qualification.status !== "qualified") return { state: "failed_known", predictionId: null, code: "MODEL_NOT_EXECUTABLE" };
    const claimToken = randomUUID();
    const claim = await this.effects.claim({ workspaceId: intent.workspaceId, intentId: intent.id, provider: "replicate", claimToken, credentialRef: this.credentialRef, at: this.now() });
    if (claim.kind === "existing") {
      if (claim.state === "submitted" && claim.predictionId) return { state: "waiting_provider", predictionId: claim.predictionId, code: "SUBMISSION_ALREADY_EXISTS" };
      if (claim.state === "claimed") return { state: "waiting_provider", predictionId: null, code: "SUBMISSION_IN_PROGRESS" };
      return { state: "outcome_unknown", predictionId: claim.predictionId, code: "SUBMISSION_OUTCOME_UNKNOWN" };
    }
    let prediction: ReplicatePrediction;
    try { prediction = await this.client.create({ endpoint: descriptor.qualification.endpoint, model: intent.selectedModel.model, version: intent.selectedModel.version, input: structuredClone(providerInput), cancelAfterSeconds: descriptor.qualification.cancelAfterSeconds }); }
    catch { await this.effects.markOutcomeUnknown({ workspaceId: intent.workspaceId, intentId: intent.id, claimToken, at: this.now() }); return { state: "outcome_unknown", predictionId: null, code: "REPLICATE_SUBMIT_TRANSPORT_LOST" }; }
    let persisted: Awaited<ReturnType<ProviderEffectClaimPort["bindPrediction"]>>;
    try { persisted = await this.effects.bindPrediction({ workspaceId: intent.workspaceId, intentId: intent.id, claimToken, predictionId: prediction.id, model: intent.selectedModel, executedVersion: prediction.version ?? null, credentialRef: this.credentialRef, at: this.now() }); }
    catch { return { state: "outcome_unknown", predictionId: prediction.id, code: "PREDICTION_IDENTITY_PERSIST_FAILED" }; }
    if (persisted === "conflict") return { state: "outcome_unknown", predictionId: prediction.id, code: "PREDICTION_IDENTITY_CONFLICT" };
    if (prediction.version !== intent.selectedModel.version) return { state: "outcome_unknown", predictionId: prediction.id, code: "EXECUTED_VERSION_UNVERIFIED" };
    return this.map(intent, prediction);
  }
  async poll(intent: GenerationIntent, predictionId: string): Promise<ReplicateExecutionResult> {
    try { const prediction = await this.client.get(predictionId); return prediction.version === intent.selectedModel.version ? this.map(intent, prediction) : { state: "outcome_unknown", predictionId, code: "EXECUTED_VERSION_UNVERIFIED" }; }
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
    catch (error) { return error && typeof error === "object" && "code" in error && error.code === "ARTIFACT_INGESTION_BUSY" ? { state: "waiting_provider", predictionId: value.id, code: "ARTIFACT_INGESTION_IN_PROGRESS" } : { state: "failed_known", predictionId: value.id, code: "ARTIFACT_INGESTION_FAILED" }; }
  }
}
