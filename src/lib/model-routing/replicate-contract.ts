import { randomUUID } from "node:crypto";
import { findCuratedModel } from "./catalog";
import type { ExactModelRef, GenerationIntent, ModelDescriptor, ReplicateEndpoint } from "./types";
import type { DurableProviderCredentialRef } from "@/lib/byok/repository";

export interface ReplicatePrediction { id: string; status: "starting" | "processing" | "succeeded" | "failed" | "canceled" | "aborted"; model?: string | null; version?: string | null; output?: unknown; error?: string | null; }
export interface ReplicateClientPort { create(input: { endpoint: ReplicateEndpoint; model: string; version: string; input: Record<string, unknown>; cancelAfterSeconds: number }): Promise<ReplicatePrediction>; get(id: string): Promise<ReplicatePrediction>; cancel(id: string): Promise<ReplicatePrediction>; }
export interface ProviderEffectClaimPort {
  claim(input: { workspaceId: string; intentId: string; provider: "replicate"; claimToken: string; credentialRef: DurableProviderCredentialRef; at: Date }): Promise<{ kind: "claimed" } | { kind: "existing"; state: "claimed" | "submitted" | "outcome_unknown"; predictionId: string | null }>;
  bindPrediction(input: { workspaceId: string; intentId: string; claimToken: string; predictionId: string; model: ExactModelRef; executedVersion: string | null; credentialRef: DurableProviderCredentialRef; at: Date }): Promise<"bound" | "replayed" | "conflict">;
  markOutcomeUnknown(input: { workspaceId: string; intentId: string; claimToken: string; at: Date }): Promise<void>;
}
export interface CanonicalArtifactIngestionPort { ingest(input: { workspaceId: string; intent: GenerationIntent; providerPredictionId: string; output: unknown }): Promise<{ artifactIds: string[] }>; }
export interface CanonicalTextOutputIngestionPort { ingest(input: { workspaceId: string; intent: GenerationIntent; providerPredictionId: string; output: unknown }): Promise<{ textOutputIds: string[] }>; }
export type ReplicateExecutionResult = { state: "waiting_provider"; predictionId: string | null; code?: string } | { state: "succeeded"; predictionId: string; artifactIds: string[]; textOutputIds: string[] } | { state: "cancelled"; predictionId: string } | { state: "aborted_pre_start"; predictionId: string } | { state: "failed_known"; predictionId: string | null; code: string } | { state: "outcome_unknown"; predictionId: string | null; code: string };

function executedIdentity(descriptor: ModelDescriptor, ref: ExactModelRef, prediction: ReplicatePrediction): string | null {
  if (descriptor.qualification.status !== "qualified") return null;
  if (descriptor.qualification.endpoint === "official") return prediction.model === ref.model ? ref.model : null;
  return prediction.version === ref.version ? ref.version : null;
}

function observedIdentity(descriptor: ModelDescriptor, prediction: ReplicatePrediction): string | null {
  if (descriptor.qualification.status !== "qualified") return null;
  return descriptor.qualification.endpoint === "official"
    ? prediction.model ?? prediction.version ?? null
    : prediction.version ?? null;
}

/** A single-attempt contract. Scheduling/poll cadence belongs to the durable worker; this adapter never retries or selects a fallback. */
export class ReplicatePredictionAdapter {
  constructor(private readonly client: ReplicateClientPort, private readonly effects: ProviderEffectClaimPort, private readonly artifacts: CanonicalArtifactIngestionPort, private readonly credentialRef: DurableProviderCredentialRef, private readonly now = () => new Date(), private readonly resolveModel: (ref: ExactModelRef) => ModelDescriptor | null = findCuratedModel, private readonly textOutputs?: CanonicalTextOutputIngestionPort) {}
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
    const identity = executedIdentity(descriptor, intent.selectedModel, prediction);
    try { persisted = await this.effects.bindPrediction({ workspaceId: intent.workspaceId, intentId: intent.id, claimToken, predictionId: prediction.id, model: intent.selectedModel, executedVersion: observedIdentity(descriptor, prediction), credentialRef: this.credentialRef, at: this.now() }); }
    catch { return { state: "outcome_unknown", predictionId: prediction.id, code: "PREDICTION_IDENTITY_PERSIST_FAILED" }; }
    if (persisted === "conflict") return { state: "outcome_unknown", predictionId: prediction.id, code: "PREDICTION_IDENTITY_CONFLICT" };
    if (!identity) return { state: "outcome_unknown", predictionId: prediction.id, code: "EXECUTED_VERSION_UNVERIFIED" };
    return this.map(intent, prediction);
  }
  async poll(intent: GenerationIntent, predictionId: string): Promise<ReplicateExecutionResult> {
    try { const prediction = await this.client.get(predictionId); const descriptor = this.resolveModel(intent.selectedModel); return descriptor && executedIdentity(descriptor, intent.selectedModel, prediction) ? this.map(intent, prediction) : { state: "outcome_unknown", predictionId, code: "EXECUTED_VERSION_UNVERIFIED" }; }
    catch { return { state: "outcome_unknown", predictionId, code: "REPLICATE_POLL_TRANSPORT_LOST" }; }
  }
  async cancel(intent: GenerationIntent, predictionId: string): Promise<ReplicateExecutionResult> {
    try { const prediction = await this.client.cancel(predictionId); const descriptor = this.resolveModel(intent.selectedModel); return descriptor && executedIdentity(descriptor, intent.selectedModel, prediction) ? this.map(intent, prediction) : { state: "outcome_unknown", predictionId, code: "EXECUTED_VERSION_UNVERIFIED" }; }
    catch { return { state: "outcome_unknown", predictionId, code: "REPLICATE_CANCEL_TRANSPORT_LOST" }; }
  }
  private async map(intent: GenerationIntent, value: ReplicatePrediction): Promise<ReplicateExecutionResult> {
    if (value.status === "starting" || value.status === "processing") return { state: "waiting_provider", predictionId: value.id };
    if (value.status === "aborted") return { state: "aborted_pre_start", predictionId: value.id };
    if (value.status === "canceled") return { state: "cancelled", predictionId: value.id };
    if (value.status === "failed") return { state: "failed_known", predictionId: value.id, code: "REPLICATE_FAILED" };
    try {
      if (intent.outputContract.mediaType === "text") {
        if (!this.textOutputs) return { state: "failed_known", predictionId: value.id, code: "TEXT_OUTPUT_INGESTION_UNAVAILABLE" };
        const result = await this.textOutputs.ingest({ workspaceId: intent.workspaceId, intent, providerPredictionId: value.id, output: value.output });
        return { state: "succeeded", predictionId: value.id, artifactIds: [], textOutputIds: result.textOutputIds };
      }
      const result = await this.artifacts.ingest({ workspaceId: intent.workspaceId, intent, providerPredictionId: value.id, output: value.output }); return { state: "succeeded", predictionId: value.id, artifactIds: result.artifactIds, textOutputIds: [] };
    }
    catch (error) { return error && typeof error === "object" && "code" in error && error.code === "ARTIFACT_INGESTION_BUSY" ? { state: "waiting_provider", predictionId: value.id, code: "ARTIFACT_INGESTION_IN_PROGRESS" } : { state: "failed_known", predictionId: value.id, code: "ARTIFACT_INGESTION_FAILED" }; }
  }
}
