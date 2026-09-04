import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { OperationStatusService } from "@/lib/agent-runtime/operation-status/service";
import type { OperationMutationResult, OperationRecord, OperationState } from "@/lib/agent-runtime/operation-status/types";
import { findCuratedModel } from "./catalog";
import type { ModelRoutingRepository } from "./repository";
import type { ReplicatePredictionAdapter, ReplicateExecutionResult } from "./replicate-contract";
import type { ExactModelRef, ModelDescriptor } from "./types";
import { authorizeFallback } from "./compatibility";
import { DENYING_GENERATION_REGION_AUTHORITY, type GenerationRegionAuthority } from "./generation-region";
import { validateImmutableBrandContext } from "./brand-context";
import { ensureAdmittedGenerationOperation } from "./generation-operation";

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
    private readonly regions: GenerationRegionAuthority = DENYING_GENERATION_REGION_AUTHORITY,
  ) {}

  async execute(input: { workspaceId: string; userId: string; intentId: string; rawPrompt: string; sourceUrls: string[]; brandReferenceUrls: Array<{ assetId: string; url: string }>; idempotencyKey: string }): Promise<GenerationExecutionResult> {
    const intent = await this.routing.getIntent(input.workspaceId, input.intentId);
    if (!intent) return { kind: "not_found", code: "GENERATION_INTENT_NOT_FOUND" };
    if (intent.quote.expiresAt <= this.now()) return { kind: "expired", code: "GENERATION_QUOTE_EXPIRED" };
    if (canonicalDigest(input.rawPrompt) !== intent.promptDigest) return { kind: "invalid", code: "PROMPT_DIGEST_MISMATCH" };
    if (input.sourceUrls.length !== intent.rights.sourceAssetIds.length || input.sourceUrls.length !== intent.rights.evidence.length) return { kind: "invalid", code: "RIGHTS_EVIDENCE_REQUIRED" };
    if (!validateImmutableBrandContext(intent.brand.context) || intent.brand.context.profileId !== intent.brand.profileId || intent.brand.context.revision !== intent.brand.revision || input.brandReferenceUrls.length !== intent.brand.context.referenceAssets.length || input.brandReferenceUrls.some((reference, index) => reference.assetId !== intent.brand.context.referenceAssets[index]?.assetId)) return { kind: "invalid", code: "BRAND_CONTEXT_MISMATCH" };
    const descriptor = this.resolveModel(intent.selectedModel);
    if (!descriptor || descriptor.qualification.status !== "qualified") return { kind: "unavailable", code: "MODEL_NOT_EXECUTABLE" };
    const qualification = descriptor.qualification.evidence;
    if (intent.qualification.id !== qualification.id || intent.qualification.revision !== qualification.revision ||
      intent.qualification.digest !== qualification.digest || intent.qualification.expiresAt.getTime() !== qualification.expiresAt.getTime() ||
      intent.qualification.expiresAt <= this.now()) return { kind: "unavailable", code: "MODEL_QUALIFICATION_EXPIRED_OR_CHANGED" };
    const region = await this.regions.revalidate({ workspaceId: input.workspaceId, model: intent.selectedModel, evidence: intent.regionAdmission, at: this.now() });
    if (region.kind !== "admitted") return { kind: "invalid", code: region.code };
    if (intent.fallbackAuthorizationId) {
      const grant = await this.routing.getAuthorization(input.workspaceId, intent.fallbackAuthorizationId);
      if (!grant) return { kind: "invalid", code: "FALLBACK_AUTHORIZATION_UNAVAILABLE" };
      const compatible = authorizeFallback({ authorization: grant, target: intent.selectedModel, quote: intent.quote, at: this.now(), resolveModel: this.resolveModel });
      if (!compatible.authorized) return { kind: "invalid", code: `FALLBACK_AUTHORIZATION_${compatible.reasons.join("_").toUpperCase()}` };
    }
    const contract = descriptor.qualification.inputContract;
    const expectedAspectRatio = intent.outputContract.mediaType === "text" ? null : "9:16";
    if (intent.outputContract.aspectRatio !== expectedAspectRatio || intent.outputContract.width !== descriptor.qualification.outputShape.width || intent.outputContract.height !== descriptor.qualification.outputShape.height || intent.outputContract.fps !== descriptor.qualification.outputShape.fps || intent.outputContract.durationSeconds !== (intent.outputContract.mediaType === "video" ? intent.quote.quantity : null) || intent.outputContract.safetyParameterKey !== (contract.safety?.parameterKey ?? null) || intent.outputContract.safetyValue !== (contract.safety?.safeValue ?? null) || intent.outputContract.lockedParametersDigest !== canonicalDigest(contract.lockedParameters)) return { kind: "invalid", code: "OUTPUT_CONTRACT_MISMATCH" };
    if (input.sourceUrls.length && !contract.imageKey) return { kind: "invalid", code: "MODEL_IMAGE_INPUT_UNSUPPORTED" };
    const providerInput: Record<string, unknown> = {
      ...structuredClone(contract.lockedParameters),
      [contract.promptKey]: input.rawPrompt,
      [contract.brandContextKey]: JSON.stringify({ ...intent.brand.context, referenceAssets: intent.brand.context.referenceAssets.map((reference, index) => ({ ...reference, url: input.brandReferenceUrls[index]!.url })) }),
    };
    if (contract.aspectRatioKey) providerInput[contract.aspectRatioKey] = "9:16";
    if (contract.quantityKey) providerInput[contract.quantityKey] = intent.quote.quantity;
    if (contract.imageKey && input.sourceUrls.length) providerInput[contract.imageKey] = contract.imageMode === "array" ? input.sourceUrls : input.sourceUrls[0];

    const actor = { type: "human" as const, userId: input.userId };
    let operation = await ensureAdmittedGenerationOperation(this.operations, intent);
    if (!operation) return { kind: "unavailable", code: "OPERATION_UNAVAILABLE" };
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
    if (provider.state === "succeeded") return this.transition(operation, "succeeded", null, actor, `${key}:succeeded`, "generation.succeeded", { ...metadata, artifactIds: provider.artifactIds, artifactCount: provider.artifactIds.length, textOutputIds: provider.textOutputIds, textOutputCount: provider.textOutputIds.length });
    if (provider.state === "failed_known") return this.transition(operation, "failed_known", null, actor, `${key}:failed`, "generation.failed_known", metadata);
    if (provider.state === "outcome_unknown") return this.transition(operation, "outcome_unknown", null, actor, `${key}:unknown`, "generation.outcome_unknown", metadata);
    const cancelling = await this.transition(operation, "cancelling", null, actor, `${key}:cancelling`, provider.state === "aborted_pre_start" ? "generation.provider_aborted_pre_start" : "generation.provider_reported_cancelled", metadata);
    return this.transition(cancelling, "cancelled", null, actor, `${key}:cancelled`, "generation.cancelled", metadata);
  }
}
