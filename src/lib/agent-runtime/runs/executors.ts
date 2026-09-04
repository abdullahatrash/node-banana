import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { admissionExposureFor } from "@/lib/agent-runtime/budgets/catalog";
import {
  PROVIDER_ADAPTER_MANIFEST,
  type ProviderAdapterModuleId,
} from "@/lib/provider-adapters/manifest";
import {
  GeminiImageAdapter,
  GeminiTextAdapter,
  type GeminiImageIntent,
  type GeminiTextIntent,
} from "@/lib/provider-adapters/gemini/generate-content";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { WorkflowOperationRegistryReader } from "../workflows/types";
import {
  GOLDEN_BRIEF,
  GOLDEN_IMAGE_FIXTURES,
  GOLDEN_LINKEDIN_COPY,
  GOLDEN_PROVIDER_RESULTS,
} from "./fixtures/golden";
import type {
  ProviderAdapter,
  ResolveWorkflowProviderInvocation,
  WorkflowProviderInvocationBoundary,
  WorkflowProviderOutputs,
} from "./provider-adapter";
import {
  canonicalProviderAdapterContractDigest,
  createWorkflowStepExecutorFromProviderAdapter,
} from "./provider-adapter";
import type {
  WorkflowStepExecutor,
  WorkflowStepExecutorRegistry,
} from "./types";
import { CONTENT_GENERATION_DISPATCH_OPERATIONS } from "@/lib/model-routing/content-workflow-operation";

const IDENTITY = "runtime.digest_text@1";

class DigestTextExecutor implements WorkflowStepExecutor {
  readonly provider = "runtime";
  readonly providerOperation = "digest_text";
  readonly model = "sha256";
  readonly providerResolution = {
    adapterModule: "runtime/digest-text",
    adapterContractDigest: canonicalDigest({
      schema: "runtime-step-executor/v1",
      identity: IDENTITY,
      provider: "runtime",
      operation: "digest_text",
      model: "sha256",
    }),
    provider: "runtime",
    providerOperation: "digest_text",
    model: "sha256",
    effectKeySupport: "native" as const,
    observation: "none" as const,
    launchSafety: {
      mode: "native_effect_key" as const,
      guard: "workflow-step-attempt/v1" as const,
      replay: "provider_deduplicated" as const,
    },
    usageCeilings: [],
  };
  readonly calls: string[] = [];

  admissionExposure() {
    return admissionExposureFor({
      provider: this.provider,
      providerOperation: this.providerOperation,
      model: this.model,
      serviceTier: "local",
    });
  }

  async execute(
    input: Parameters<WorkflowStepExecutor["execute"]>[0],
  ): ReturnType<WorkflowStepExecutor["execute"]> {
    this.calls.push(input.runId);
    const binding = input.step.inputs.text;
    if (!binding || binding.from !== "workflow_input") {
      throw new Error("Deterministic text binding is unavailable.");
    }
    const text = input.inputs.text?.textContent;
    if (typeof text !== "string") {
      throw new Error("Deterministic text input is unavailable.");
    }
    const textDigest = canonicalDigest(text);
    if (input.snapshot.definition.steps.length > 1) {
      return Promise.resolve({
        kind: "generated",
        providerOperationRef: textDigest,
        outputs: {
          textDigest: {
            kind: "text",
            mediaType: "text/plain; charset=utf-8",
            bytes: Buffer.from(textDigest, "utf8"),
          },
        },
      });
    }
    return Promise.resolve({
      kind: "legacy",
      output: { textDigest },
    });
  }
}

class ContentGenerationDispatchExecutor implements WorkflowStepExecutor {
  readonly provider = "runtime";
  readonly providerOperation: string;
  readonly model = "content-workflow-v1";
  constructor(readonly operationIdentity: string, private readonly operationContractDigest: string) { this.providerOperation = operationIdentity.split("@")[0]!.slice("runtime.".length); }
  get providerResolution() {
    return {
      adapterModule: "runtime/legacy-executor",
      adapterContractDigest: canonicalDigest({ schema: "runtime-step-executor/v1", operationIdentity: this.operationIdentity, operationContractDigest: this.operationContractDigest, provider: this.provider, providerOperation: this.providerOperation, model: this.model }),
      provider: this.provider, providerOperation: this.providerOperation, model: this.model,
      effectKeySupport: "native" as const, observation: "provider_operation_ref" as const,
      launchSafety: { mode: "native_effect_key" as const, guard: "workflow-step-attempt/v1" as const, replay: "provider_deduplicated" as const },
      usageCeilings: [],
    };
  }
  admissionExposure() {
    return admissionExposureFor({ provider: this.provider, providerOperation: this.providerOperation, model: this.model, serviceTier: "local" });
  }
  async execute(input: Parameters<WorkflowStepExecutor["execute"]>[0]): ReturnType<WorkflowStepExecutor["execute"]> {
    const raw = input.inputs.recipe?.textContent;
    if (!raw) return { kind: "failed_known", failureCode: "CONTENT_DISPATCH_REQUEST_MISSING", retryable: false, providerOperationRef: null };
    let request: { workspaceId: string; userId: string; role: string; planTier: string; intentId: string; prompt: string; sourceAssetIds: string[]; idempotencyKey: string; workflowInputs: Record<string, unknown> };
    try { request = JSON.parse(raw) as typeof request; }
    catch { return { kind: "failed_known", failureCode: "CONTENT_DISPATCH_REQUEST_INVALID", retryable: false, providerOperationRef: null }; }
    const expectedOperation = `runtime.${this.providerOperation}@1`;
    const declared = Object.keys(input.step.inputs).filter((name) => name !== "guard" && name !== "recipe");
    const typedInputsMatch = request.workflowInputs && declared.every((name) => input.inputs[name]?.textContent === (typeof request.workflowInputs[name] === "string" ? request.workflowInputs[name] : canonicalJson(request.workflowInputs[name] ?? null)));
    if (request.workspaceId !== input.workspaceId || input.step.operation.identity !== expectedOperation || !request.intentId || !request.userId || !Array.isArray(request.sourceAssetIds) || !typedInputsMatch) return { kind: "failed_known", failureCode: "CONTENT_DISPATCH_REQUEST_INVALID", retryable: false, providerOperationRef: null };
    const { executeAdmittedGeneration } = await import("@/lib/model-routing/execute-admitted-generation");
    const result = await executeAdmittedGeneration({ ...request, contentWorkflowRunId: input.runId });
    if (!result.ok) return { kind: "failed_known", failureCode: result.code, retryable: result.status === 503, providerOperationRef: request.intentId };
    const receipt = { schema: "content-workflow-dispatch-receipt/v1", intentId: request.intentId, operationId: result.result.operation.id, operationState: result.result.operation.state, providerState: result.result.provider.state };
    return { kind: "generated", providerOperationRef: request.intentId, outputs: { receipt: { kind: "text", mediaType: "application/json", bytes: Buffer.from(JSON.stringify(receipt), "utf8") } } };
  }
  async reconcile(input: Parameters<NonNullable<WorkflowStepExecutor["reconcile"]>>[0]): ReturnType<NonNullable<WorkflowStepExecutor["reconcile"]>> {
    const result = await this.execute(input);
    return result.kind === "legacy"
      ? { kind: "failed_known", failureCode: "CONTENT_DISPATCH_RECEIPT_INVALID", retryable: false, providerOperationRef: null }
      : result;
  }
}

class GoldenConformanceExecutor implements WorkflowStepExecutor {
  readonly provider = "conformance";
  readonly model = "golden-v1";
  readonly calls: Array<{ effectKey: string; intentDigest: string }> = [];
  private readonly ledger = new Map<
    string,
    { intentDigest: string; result: Awaited<ReturnType<WorkflowStepExecutor["execute"]>> }
  >();

  constructor(
    readonly providerOperation: "generate_text" | "generate_image",
  ) {}

  get providerResolution() {
    return {
      adapterModule: "runtime/golden-conformance",
      adapterContractDigest: canonicalDigest({
        schema: "runtime-step-executor/v1",
        provider: this.provider,
        operation: this.providerOperation,
        model: this.model,
      }),
      provider: this.provider,
      providerOperation: this.providerOperation,
      model: this.model,
      effectKeySupport: "native" as const,
      observation: "provider_operation_ref" as const,
      launchSafety: {
        mode: "native_effect_key" as const,
        guard: "workflow-step-attempt/v1" as const,
        replay: "provider_deduplicated" as const,
      },
      usageCeilings: [],
    };
  }

  admissionExposure() {
    return admissionExposureFor({
      provider: this.provider,
      providerOperation: this.providerOperation,
      model: this.model,
      serviceTier: "test",
    });
  }

  async execute(
    input: Parameters<WorkflowStepExecutor["execute"]>[0],
  ): ReturnType<WorkflowStepExecutor["execute"]> {
    const existing = this.ledger.get(input.effectKey);
    if (existing) {
      if (existing.intentDigest !== input.intentDigest) {
        throw new Error("Effect Key is bound to another provider intent.");
      }
      return structuredClone(existing.result);
    }

    let result: Awaited<ReturnType<WorkflowStepExecutor["execute"]>>;
    if (this.providerOperation === "generate_text") {
      const prompt = input.inputs.prompt?.textContent;
      if (prompt !== GOLDEN_BRIEF) {
        throw new Error("Golden copy intent does not match the frozen fixture.");
      }
      result = {
        kind: "generated",
        providerOperationRef:
          GOLDEN_PROVIDER_RESULTS.draftCopy.providerOperationRef,
        outputs: {
          text: {
            kind: "text",
            mediaType: "text/plain; charset=utf-8",
            bytes: Buffer.from(GOLDEN_LINKEDIN_COPY, "utf8"),
          },
        },
      };
    } else {
      const prompt = input.inputs.prompt?.textContent;
      const reference = input.inputs.referenceImage;
      if (
        prompt !== GOLDEN_LINKEDIN_COPY ||
        reference?.contentDigest !== GOLDEN_IMAGE_FIXTURES.reference.digest
      ) {
        throw new Error("Golden hero intent does not match the frozen fixture.");
      }
      const bytes = await readFile(
        resolve(process.cwd(), GOLDEN_IMAGE_FIXTURES.heroResult.path),
      );
      result = {
        kind: "generated",
        providerOperationRef:
          GOLDEN_PROVIDER_RESULTS.generateHero.providerOperationRef,
        outputs: {
          image: {
            kind: "image",
            mediaType: GOLDEN_IMAGE_FIXTURES.heroResult.mediaType,
            bytes,
            width: GOLDEN_IMAGE_FIXTURES.heroResult.width,
            height: GOLDEN_IMAGE_FIXTURES.heroResult.height,
          },
        },
      };
    }
    this.calls.push({
      effectKey: input.effectKey,
      intentDigest: input.intentDigest,
    });
    this.ledger.set(input.effectKey, {
      intentDigest: input.intentDigest,
      result: structuredClone(result),
    });
    return result;
  }

  async reconcile(
    input: Parameters<NonNullable<WorkflowStepExecutor["reconcile"]>>[0],
  ): ReturnType<NonNullable<WorkflowStepExecutor["reconcile"]>> {
    const existing = this.ledger.get(input.effectKey);
    if (
      !existing ||
      existing.intentDigest !== input.intentDigest ||
      existing.result.kind !== "generated" ||
      existing.result.providerOperationRef !== input.providerOperationRef
    ) {
      return Promise.resolve({
        kind: "outcome_unknown",
        failureCode: "PROVIDER_RESULT_NOT_YET_RECOVERABLE",
        providerOperationRef: input.providerOperationRef,
      });
    }
    return Promise.resolve(structuredClone(existing.result));
  }
}

export class WorkflowRunExecutorRegistry
  implements WorkflowStepExecutorRegistry
{
  private readonly executors = new Map<string, WorkflowStepExecutor>();

  private register(
    identity: string,
    contractDigest: string,
    executor: WorkflowStepExecutor,
  ): void {
    const key = `${identity}\u0000${contractDigest}`;
    if (this.executors.has(key)) {
      throw new TypeError(`Duplicate Workflow Run executor: ${identity}.`);
    }
    this.executors.set(key, executor);
  }

  registerProviderAdapter<I>(
    moduleId: ProviderAdapterModuleId,
    identity: string,
    contractDigest: string,
    adapter: ProviderAdapter<I, WorkflowProviderOutputs>,
    resolveInvocation:
      | ResolveWorkflowProviderInvocation<I>
      | WorkflowProviderInvocationBoundary<I>,
  ): void {
    const registration = PROVIDER_ADAPTER_MANIFEST.find(
      (candidate) =>
        candidate.module === moduleId &&
        candidate.workflowOperationIdentity ===
          adapter.contract.identity.workflowOperationIdentity &&
        candidate.model === adapter.contract.identity.model,
    );
    if (
      !registration ||
      registration.workflowOperationIdentity !==
        adapter.contract.identity.workflowOperationIdentity ||
      registration.adapterRevision !== adapter.contract.adapterRevision ||
      registration.adapterContractDigest !==
        canonicalProviderAdapterContractDigest(adapter.contract) ||
      registration.workflowOperationContractDigest !==
        adapter.contract.identity.workflowOperationContractDigest ||
      registration.provider !== adapter.contract.identity.provider ||
      registration.operation !== adapter.contract.identity.operation ||
      registration.model !== adapter.contract.identity.model
    ) {
      throw new TypeError(
        "Provider Adapter identity does not match its reviewed manifest entry.",
      );
    }
    if (
      adapter.contract.effectKeySupport === "unsupported" &&
      (adapter.contract.launchSafety.mode !== "durable_at_most_once" ||
        adapter.contract.launchSafety.replay !== "never_launch")
    ) {
      throw new TypeError(
        "Provider Adapter without native Effect Key support requires the durable at-most-once launch guard.",
      );
    }
    if (
      adapter.contract.identity.workflowOperationIdentity !== identity ||
      adapter.contract.identity.workflowOperationContractDigest !==
        contractDigest
    ) {
      throw new TypeError(
        "Provider Adapter identity does not match the Workflow operation contract.",
      );
    }
    this.register(
      identity,
      contractDigest,
      createWorkflowStepExecutorFromProviderAdapter(
        moduleId,
        adapter,
        resolveInvocation,
      ),
    );
  }

  static createDeterministic(
    operations: WorkflowOperationRegistryReader,
  ): WorkflowRunExecutorRegistry {
    const operation = operations.get(IDENTITY);
    if (!operation) {
      throw new TypeError(`${IDENTITY} must be published before execution.`);
    }
    const registry = new WorkflowRunExecutorRegistry();
    registry.register(
      operation.identity,
      operation.contractDigest,
      new DigestTextExecutor(),
    );
    for (const [identity, providerOperation] of [
      ["gemini.generate_text@1", "generate_text"],
      ["gemini.generate_image@1", "generate_image"],
    ] as const) {
      const definition = operations.get(identity);
      if (!definition) {
        throw new TypeError(`${identity} must be published before execution.`);
      }
      registry.register(
        identity,
        definition.contractDigest,
        new GoldenConformanceExecutor(providerOperation),
      );
    }
    return registry;
  }

  static createProduction(
    operations: WorkflowOperationRegistryReader,
    boundaries: {
      text: WorkflowProviderInvocationBoundary<GeminiTextIntent>;
      image: WorkflowProviderInvocationBoundary<GeminiImageIntent>;
    },
  ): WorkflowRunExecutorRegistry {
    const digest = operations.get(IDENTITY);
    const text = operations.get("gemini.generate_text@1");
    const image = operations.get("gemini.generate_image@1");
    if (!digest || !text || !image) {
      throw new TypeError("Production Workflow operations must be published.");
    }
    const registry = new WorkflowRunExecutorRegistry();
    registry.register(digest.identity, digest.contractDigest, new DigestTextExecutor());
    for (const operation of CONTENT_GENERATION_DISPATCH_OPERATIONS) registry.register(operation.identity, operation.contractDigest, new ContentGenerationDispatchExecutor(operation.identity, operation.contractDigest));
    registry.registerProviderAdapter(
      "gemini/generate-content",
      text.identity,
      text.contractDigest,
      new GeminiTextAdapter(),
      boundaries.text,
    );
    registry.registerProviderAdapter(
      "gemini/generate-content",
      image.identity,
      image.contractDigest,
      new GeminiImageAdapter(),
      boundaries.image,
    );
    return registry;
  }

  get(identity: string, contractDigest: string) {
    return this.executors.get(`${identity}\u0000${contractDigest}`);
  }

  resolve(
    identity: string,
    contractDigest: string,
    config: Record<string, unknown>,
  ) {
    const executor = this.get(identity, contractDigest);
    if (!executor) return undefined;
    if (
      executor.provider === "gemini" &&
      typeof config.model === "string" &&
      executor.model !== config.model
    ) {
      return undefined;
    }
    return executor;
  }

  getPinned(
    identity: string,
    contractDigest: string,
    resolution: NonNullable<WorkflowStepExecutor["providerResolution"]>,
  ) {
    const executor = this.get(identity, contractDigest);
    return executor &&
      executor.providerResolution &&
      canonicalDigest(executor.providerResolution) === canonicalDigest(resolution)
      ? executor
      : undefined;
  }
}

export function createDeterministicWorkflowRunExecutorRegistry(
  operations: WorkflowOperationRegistryReader,
): WorkflowRunExecutorRegistry {
  return WorkflowRunExecutorRegistry.createDeterministic(operations);
}
