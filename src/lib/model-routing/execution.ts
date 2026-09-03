import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { OperationStatusService } from "@/lib/agent-runtime/operation-status/service";
import type { OperationMutationResult, OperationRecord, OperationState } from "@/lib/agent-runtime/operation-status/types";
import { findCuratedModel } from "./catalog";
import type { ModelRoutingRepository } from "./repository";
import type { ReplicatePredictionAdapter, ReplicateExecutionResult } from "./replicate-contract";
import type { ExactModelRef, ModelDescriptor } from "./types";
import { authorizeFallback } from "./compatibility";

export type GenerationExecutionResult =
  | { kind: "accepted"; operation: OperationRecord; provider: ReplicateExecutionResult }
  | { kind: "invalid" | "not_found" | "expired" | "unavailable"; code: string };

export class GenerationExecutionService {
  constructor(
    private readonly routing: ModelRoutingRepository,
    private readonly operations: OperationStatusService,
    private readonly replicate: ReplicatePredictionAdapter,
    private readonly now = () => new Date(),
    private readonly resolveModel: (ref: ExactModelRef) => ModelDescriptor | null = findCuratedModel,
  ) {}

  async execute(input: { workspaceId: string; userId: string; intentId: string; rawPrompt: string; sourceUrls: string[]; idempotencyKey: string }): Promise<GenerationExecutionResult> {
    const intent = await this.routing.getIntent(input.workspaceId, input.intentId);
    if (!intent) return { kind: "not_found", code: "GENERATION_INTENT_NOT_FOUND" };
    if (intent.quote.expiresAt <= this.now()) return { kind: "expired", code: "GENERATION_QUOTE_EXPIRED" };
    if (canonicalDigest(input.rawPrompt) !== intent.promptDigest) return { kind: "invalid", code: "PROMPT_DIGEST_MISMATCH" };
    if (input.sourceUrls.length && !intent.rights.evidenceRefs.length) return { kind: "invalid", code: "RIGHTS_EVIDENCE_REQUIRED" };
    const descriptor = this.resolveModel(intent.selectedModel);
    if (!descriptor || descriptor.qualification.status !== "qualified") return { kind: "unavailable", code: "MODEL_NOT_EXECUTABLE" };
    if (intent.fallbackAuthorizationId) {
      const grant = await this.routing.getAuthorization(input.workspaceId, intent.fallbackAuthorizationId);
      if (!grant) return { kind: "invalid", code: "FALLBACK_AUTHORIZATION_UNAVAILABLE" };
      const compatible = authorizeFallback({ authorization: grant, target: intent.selectedModel, quote: intent.quote, at: this.now(), resolveModel: this.resolveModel });
      if (!compatible.authorized) return { kind: "invalid", code: `FALLBACK_AUTHORIZATION_${compatible.reasons.join("_").toUpperCase()}` };
    }
    const contract = descriptor.qualification.inputContract;
    if (input.sourceUrls.length && !contract.imageKey) return { kind: "invalid", code: "MODEL_IMAGE_INPUT_UNSUPPORTED" };
    const providerInput: Record<string, unknown> = {
      ...structuredClone(contract.lockedParameters),
      [contract.promptKey]: input.rawPrompt,
      [contract.aspectRatioKey]: "9:16",
    };
    if (contract.quantityKey) providerInput[contract.quantityKey] = intent.quote.quantity;
    if (contract.imageKey && input.sourceUrls.length) providerInput[contract.imageKey] = contract.imageMode === "array" ? input.sourceUrls : input.sourceUrls[0];

    const actor = { type: "human" as const, userId: input.userId };
    const created = await this.operations.create({ workspaceId: input.workspaceId, kind: "generation", resourceId: intent.id, actor, metadata: { provider: "replicate", intentId: intent.id, model: intent.selectedModel.model, version: intent.selectedModel.version, inputSchemaDigest: intent.selectedModel.inputSchemaDigest, brandRevision: intent.brand.revision, contentLanguage: intent.contentLanguage, arabicVariety: intent.arabicVariety, quoteAmountUsd: intent.quote.amount, quoteQuantity: intent.quote.quantity, quoteBasis: intent.quote.basis, reservationIds: intent.reservationIds, rightsEvidenceRefs: intent.rights.evidenceRefs, provenanceRefs: intent.rights.sourceUrls, providerState: "admitted", nextAction: "submit_provider" }, idempotencyKey: `${input.idempotencyKey}:operation` });
    if (created.kind !== "applied" && created.kind !== "replayed") return { kind: "unavailable", code: `OPERATION_${created.kind.toUpperCase()}` };
    let operation = created.operation;
    if (operation.state === "queued") operation = await this.transition(operation, "admitted", null, actor, `${input.idempotencyKey}:admit`, "generation.intent_admitted");
    if (operation.state === "admitted") operation = await this.transition(operation, "running", "provider.submit", actor, `${input.idempotencyKey}:run`, "generation.provider_submission_claimed");
    if (operation.state !== "running") return { kind: "accepted", operation, provider: { state: "waiting_provider", predictionId: typeof operation.metadata.predictionId === "string" ? operation.metadata.predictionId : null, code: "OPERATION_ALREADY_ACTIVE" } };

    const provider = await this.replicate.submit(intent, providerInput);
    operation = await this.projectProvider(operation, provider, actor, input.idempotencyKey);
    return { kind: "accepted", operation, provider };
  }

  private async transition(operation: OperationRecord, to: OperationState, stage: string | null, actor: { type: "human"; userId: string }, key: string, reasonCode: string, metadata?: Record<string, unknown>) {
    const result: OperationMutationResult = await this.operations.transition({ workspaceId: operation.workspaceId, operationId: operation.id, expectedRevision: operation.revision, to, stage, actor, reasonCode, metadata, idempotencyKey: key });
    if (result.kind !== "applied" && result.kind !== "replayed") throw new Error(`OPERATION_TRANSITION_${result.kind.toUpperCase()}`);
    return result.operation;
  }

  private async projectProvider(operation: OperationRecord, provider: ReplicateExecutionResult, actor: { type: "human"; userId: string }, key: string) {
    const metadata = { predictionId: provider.predictionId, providerCode: "code" in provider ? provider.code ?? null : null, providerState: provider.state, nextAction: provider.state === "waiting_provider" ? "poll_provider" : provider.state === "outcome_unknown" ? "reconcile_provider" : "none" };
    if (provider.state === "waiting_provider") return this.transition(operation, "waiting_provider", null, actor, `${key}:waiting`, "generation.waiting_provider", metadata);
    if (provider.state === "succeeded") return this.transition(operation, "succeeded", null, actor, `${key}:succeeded`, "generation.succeeded", { ...metadata, artifactCount: provider.artifactIds.length });
    if (provider.state === "failed_known") return this.transition(operation, "failed_known", null, actor, `${key}:failed`, "generation.failed_known", metadata);
    if (provider.state === "outcome_unknown") return this.transition(operation, "outcome_unknown", null, actor, `${key}:unknown`, "generation.outcome_unknown", metadata);
    const cancelling = await this.transition(operation, "cancelling", null, actor, `${key}:cancelling`, "generation.provider_reported_cancelled", metadata);
    return this.transition(cancelling, "cancelled", null, actor, `${key}:cancelled`, "generation.cancelled", metadata);
  }
}
