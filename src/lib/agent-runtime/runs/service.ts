import { createHash, randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { credentialEffectRef } from "@/lib/credential-vault/effect-ref";
import { WorkflowRunError } from "./errors";
import { parseWorkflowStepExecutionResult } from "./provider-adapter";
import { GOLDEN_WORKFLOW_DEFINITION_DIGEST } from "./fixtures/golden";
import { workflowRunDto, workflowRunReceiptResult } from "./types";
import type {
  WorkflowRunAcceptedDto,
  WorkflowRunArtifactPort,
  WorkflowRunClock,
  WorkflowRunDto,
  WorkflowRunEventCursorCodec,
  WorkflowRunEventDto,
  WorkflowRunExecutionLeaseRecord,
  WorkflowRunQueue,
  WorkflowRunRecord,
  WorkflowRunRecoveryDto,
  WorkflowRunRepository,
  WorkflowRunRevisionReader,
  WorkflowRunStartSnapshot,
  ResolvedWorkflowStepInput,
  WorkflowStepAttemptDto,
  WorkflowStepAttemptInput,
  WorkflowStepAttemptRecord,
  WorkflowStepExecutor,
  WorkflowStepExecutorRegistry,
  WorkflowRunProviderResolution,
  WorkflowRunBudgetPort,
  WorkflowRunQuotaPort,
} from "./types";
import type { BudgetAdmissionInput, BudgetAdmissionPlan, RunStepExposure } from "../budgets/types";
import type { RunAdmissionPreview } from "../budgets/types";
import { BudgetServiceError } from "../budgets/service";
import type {
  SettleProviderUsageInput,
  UsageSettlementPort,
} from "../usage/types";
import type { QuotaExhaustionEvidence } from "../quotas/types";
import {
  emitProviderEffectMetric,
  emitQueueWaitMetric,
  emitQuotaDecisionMetric,
  emitRunStatusMetric,
  operationFamily,
  providerFamily,
  quotaReasonFamily,
} from "../operational-metrics";
import {
  WorkflowRunSpendQuoteCodec,
  workflowRunQuoteCeilingDigest,
  workflowRunQuoteInputDigest,
  type WorkflowRunAcceptedSpendQuote,
} from "./spend-quote";

const ID = /^[a-zA-Z0-9_-]{1,200}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,200}$/;
const MAX_INPUT_BYTES = 256 * 1024;
const EXECUTABLE_OPERATION = "runtime.digest_text@1";
const GOLDEN_OPERATIONS = [
  "gemini.generate_text@1",
  "gemini.generate_image@1",
] as const;
const PROVIDER_FAILURE_CODE = "STEP_EXECUTION_FAILED";
const ARTIFACT_FAILURE_CODE = "ARTIFACT_PERSISTENCE_FAILED";
const USAGE_QUOTA_FAILURE_CODE = "QUOTA_USAGE_CEILING_UNAVAILABLE";
const systemClock: WorkflowRunClock = { now: () => new Date() };

function artifactQuotaRunError(
  error: unknown,
  usageEvidenceDurable: boolean,
): WorkflowRunError | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "ARTIFACT_QUOTA_EXCEEDED"
  ) {
    return null;
  }
  return new WorkflowRunError(
    "ARTIFACT_QUOTA_EXCEEDED",
    usageEvidenceDurable
      ? "Provider success and Usage evidence are durable, but the generated Artifact exceeds its storage quota."
      : "Provider effect evidence is durable, but the generated Artifact exceeds its storage quota.",
    "details" in error &&
      typeof error.details === "object" &&
      error.details !== null
      ? (error.details as Record<string, unknown>)
      : undefined,
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function usageQuotaSubjectId(input: {
  settlementId: string;
  dimension: string;
  unit: string;
}): string {
  return `usage_${canonicalDigest({
    schema: "workflow-run-usage-quota-subject/v1",
    ...input,
  }).slice(7, 39)}`;
}

function matchesAcceptedSpendQuote(quote: WorkflowRunAcceptedSpendQuote, plan: BudgetAdmissionPlan): boolean {
  const providerModels = plan.stepExposures.map((exposure) => ({
    provider: exposure.provider,
    model: exposure.model,
    pricePerAttempt: exposure.amountPerAttempt ?? "",
    automaticAttempts: exposure.automaticAttempts,
    pricingSnapshotIds: [...exposure.pricingSnapshotIds].sort(),
  }));
  const pricingSnapshotIds = [...new Set(providerModels.flatMap((item) => item.pricingSnapshotIds))].sort();
  return plan.reservations.length > 0 &&
    plan.reservations.every((reservation) => reservation.currency === quote.currency && reservation.reservedAmount === quote.amount) &&
    workflowRunQuoteCeilingDigest({ amount: quote.amount, currency: quote.currency, providerModels, pricingSnapshotIds }) === quote.ceilingDigest;
}

function usageQuotaReconciliationId(input: {
  subjectId: string;
  evidenceRef: string;
  actualAmount: string | null;
}): string {
  return `usage_reconcile_${canonicalDigest({
    schema: "workflow-run-usage-quota-reconciliation/v1",
    ...input,
  }).slice(7, 39)}`;
}

function quotaDenialDetails(
  reasonCodes: string[],
  evidence: QuotaExhaustionEvidence[],
): Record<string, unknown> {
  return {
    reasonCodes: [...reasonCodes],
    evidence: evidence.map((item) => ({
      ...item,
      window: {
        ...item.window,
        startsAt: item.window.startsAt.toISOString(),
        endsAt: item.window.endsAt?.toISOString() ?? null,
      },
      evaluatedAt: item.evaluatedAt.toISOString(),
      eligibleAt: item.eligibleAt?.toISOString() ?? null,
      eligibility: item.eligibility.kind === "window_renewal"
        ? {
            kind: item.eligibility.kind,
            eligibleAt: item.eligibility.eligibleAt.toISOString(),
          }
        : item.eligibility,
    })),
  };
}

function executorResolution(
  executor: WorkflowStepExecutor,
  step: WorkflowRunRecord["startSnapshot"]["definition"]["steps"][number],
): Omit<WorkflowRunProviderResolution, "stepId"> {
  return structuredClone(
    executor.providerResolution ?? {
      adapterModule: "runtime/legacy-executor",
      adapterContractDigest: canonicalDigest({
        schema: "runtime-step-executor/v1",
        operationIdentity: step.operation.identity,
        operationContractDigest: step.operation.contractDigest,
        provider: executor.provider,
        providerOperation: executor.providerOperation,
        model: executor.model,
      }),
      provider: executor.provider,
      providerOperation: executor.providerOperation,
      model: executor.model,
      effectKeySupport: "native",
      observation: executor.reconcile ? "provider_operation_ref" : "none",
      launchSafety: {
        mode: "native_effect_key",
        guard: "workflow-step-attempt/v1",
        replay: "provider_deduplicated",
      },
      usageCeilings: [],
    },
  );
}

function matchesPinnedExecutor(
  executor: WorkflowStepExecutor | undefined,
  step: WorkflowRunRecord["startSnapshot"]["definition"]["steps"][number],
  pinned: Omit<WorkflowRunProviderResolution, "stepId">,
): executor is WorkflowStepExecutor {
  return Boolean(
    executor &&
      canonicalDigest(executorResolution(executor, step)) ===
        canonicalDigest(pinned),
  );
}

type ResolvedRunRevision = NonNullable<
  Awaited<ReturnType<WorkflowRunRevisionReader["getRevision"]>>
>;

function eligibleWorkflowExecutors(
  revision: ResolvedRunRevision,
  registry: WorkflowStepExecutorRegistry,
): { executors: WorkflowStepExecutor[]; isGolden: boolean } {
  const steps = revision.definition.steps;
  const isLegacy =
    steps.length === 1 &&
    steps[0]?.operation.identity === EXECUTABLE_OPERATION &&
    Object.values(revision.definition.inputs).every(
      (definition) => definition.kind === "text",
    ) &&
    Object.keys(steps[0]?.credentials ?? {}).length === 0;
  const isGolden =
    revision.definitionDigest === GOLDEN_WORKFLOW_DEFINITION_DIGEST &&
    steps.length === 2 &&
    steps.every(
      (step, index) => step.operation.identity === GOLDEN_OPERATIONS[index],
    ) &&
    Object.values(revision.definition.inputs).filter(
      (definition) => definition.kind === "text",
    ).length === 1 &&
    Object.values(revision.definition.inputs).filter(
      (definition) => definition.kind === "image",
    ).length === 1;
  const resolved = steps.map((step) =>
    registry.resolve
      ? registry.resolve(
          step.operation.identity,
          step.operation.contractDigest,
          step.config,
        )
      : registry.get(step.operation.identity, step.operation.contractDigest),
  );
  if ((!isLegacy && !isGolden) || resolved.some((executor) => !executor)) {
    throw new WorkflowRunError(
      "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
      "This runtime slice accepts the exact deterministic digest or frozen two-step golden Workflow.",
    );
  }
  return {
    executors: resolved as WorkflowStepExecutor[],
    isGolden,
  };
}

function identifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!ID.test(trimmed)) {
    throw new WorkflowRunError(
      "WORKFLOW_RUN_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
  return trimmed;
}

function stableKey(value: string): string {
  const trimmed = value.trim();
  if (!IDEMPOTENCY_KEY.test(trimmed)) {
    throw new WorkflowRunError(
      "WORKFLOW_RUN_INVALID_INPUT",
      "A stable idempotency key between 8 and 200 visible ASCII characters is required.",
    );
  }
  return trimmed;
}

function mutationReceiptResult(input: {
  receipt: { runId: string; result: Record<string, unknown> | null };
}): WorkflowRunRecoveryDto {
  const result = input.receipt.result;
  const run =
    result?.run && typeof result.run === "object"
      ? (result.run as Record<string, unknown>)
      : null;
  if (
    !result ||
    !run ||
    run.id !== input.receipt.runId ||
    typeof run.state !== "string"
  ) {
    throw new WorkflowRunError(
      "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
      "The original mutation result is unavailable.",
    );
  }
  return structuredClone(result) as unknown as WorkflowRunRecoveryDto;
}

function evidence(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) {
    throw new WorkflowRunError(
      "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
      `${label} is unavailable.`,
    );
  }
  return trimmed;
}

function canonicalInputs(value: Record<string, unknown>): Record<string, unknown> {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
    canonicalDigest(value);
  } catch {
    throw new WorkflowRunError(
      "WORKFLOW_RUN_INVALID_INPUT",
      "Workflow Run inputs must be canonical JSON.",
    );
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_INPUT_BYTES) {
    throw new WorkflowRunError(
      "WORKFLOW_RUN_INVALID_INPUT",
      "Workflow Run inputs exceed the 256 KiB snapshot limit.",
    );
  }
  return structuredClone(value);
}

function bytesDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function eventDto(event: {
  id: string;
  runId: string;
  sequence: number;
  type: WorkflowRunEventDto["type"];
  data: Record<string, unknown>;
  occurredAt: Date;
}): WorkflowRunEventDto {
  if (
    !ID.test(event.id) ||
    !ID.test(event.runId) ||
    !Number.isInteger(event.sequence) ||
    event.sequence < 1 ||
    !Number.isFinite(event.occurredAt.getTime())
  ) {
    throw new WorkflowRunError(
      "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
      "Retained Workflow Run event evidence is invalid.",
    );
  }
  const matched = (key: string, pattern: RegExp) => {
    const value = event.data[key];
    return typeof value === "string" && pattern.test(value) ? value : undefined;
  };
  const id = (key: string) => matched(key, ID);
  const digest = (key: string) =>
    matched(key, /^sha256:[a-f0-9]{64}$/);
  const code = (key: string) =>
    matched(key, /^[A-Z][A-Z0-9_]{0,79}$/);
  const dateTime = (key: string) => {
    const value = event.data[key];
    if (typeof value !== "string") return undefined;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
      ? value
      : undefined;
  };
  const oneOf = <T extends string>(key: string, values: readonly T[]) => {
    const value = event.data[key];
    return typeof value === "string" && values.includes(value as T)
      ? value as T
      : undefined;
  };
  const effectKey = (key: string) =>
    matched(
      key,
      /^workflow-effect:v1:[A-Za-z0-9_-]{1,200}:[A-Za-z0-9_-]{1,200}:[A-Za-z0-9_-]{1,200}:[1-9][0-9]*$/,
    );
  const operationIdentity = (key: string) =>
    matched(key, /^[a-z][a-z0-9_.-]{0,199}@[1-9][0-9]*$/);
  const boolean = (key: string) =>
    typeof event.data[key] === "boolean" ? event.data[key] : undefined;
  const integer = (key: string) =>
    Number.isInteger(event.data[key]) ? event.data[key] : undefined;
  const ids = (key: string) =>
    Array.isArray(event.data[key]) &&
    (event.data[key] as unknown[]).every(
      (value) => typeof value === "string" && ID.test(value),
    )
      ? structuredClone(event.data[key])
      : undefined;
  const compact = (value: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
  const data = (() => {
    switch (event.type) {
      case "run.accepted":
        return compact({ startSnapshotDigest: digest("startSnapshotDigest") });
      case "run.derived":
        return compact({
          kind: oneOf("kind", ["manual_retry"] as const),
          sourceRunId: id("sourceRunId"),
          rootRunId: id("rootRunId"),
          retryFromStepId: id("retryFromStepId"),
        });
      case "step.attempt.started":
        return compact({
          stepAttemptId: id("stepAttemptId"),
          stepId: id("stepId"),
          attempt: integer("attempt"),
          effectKey: effectKey("effectKey"),
          operationIdentity: operationIdentity("operationIdentity"),
          intentDigest: digest("intentDigest"),
        });
      case "artifact.generated":
        return compact({
          stepAttemptId: id("stepAttemptId"),
          stepId: id("stepId"),
          outputName: id("outputName"),
          artifactId: id("artifactId"),
          digest: digest("digest"),
        });
      case "step.attempt.completed":
        return compact({
          stepAttemptId: id("stepAttemptId"),
          stepId: id("stepId"),
          attempt: integer("attempt"),
          effectKey: effectKey("effectKey"),
          outputArtifactIds: ids("outputArtifactIds"),
        });
      case "step.attempt.failed":
      case "step.attempt.outcome_unknown":
        return compact({
          stepAttemptId: id("stepAttemptId"),
          stepId: id("stepId"),
          attempt: integer("attempt"),
          effectKey: effectKey("effectKey"),
          reasonCode: code("reasonCode"),
        });
      case "step.retry.scheduled":
        return compact({
          stepAttemptId: id("stepAttemptId"),
          stepId: id("stepId"),
          attempt: integer("attempt"),
          nextAttempt: integer("nextAttempt"),
          effectKey: effectKey("effectKey"),
          retryAt: dateTime("retryAt"),
        });
      case "step.attempt.reconciled":
        return compact({
          stepAttemptId: id("stepAttemptId"),
          resolution: oneOf("resolution", ["succeeded", "failed_known"] as const),
        });
      case "run.waiting":
        return compact({
          waitId: id("waitId"),
          boundary: oneOf("boundary", [
            "run_admission",
            "run_concurrency",
            "provider_effect",
            "usage_settlement",
            "artifact_storage",
          ] as const),
          reasonCode: code("reasonCode"),
          eligibleAt: dateTime("eligibleAt"),
          resumeAt: dateTime("resumeAt"),
          stepAttemptId: id("stepAttemptId"),
        });
      case "run.resumed":
        return compact({
          automatic: boolean("automatic"),
          waitId: id("waitId"),
          reason: id("reason"),
          reservationIds: ids("reservationIds"),
        });
      case "run.outcome_unknown":
        return compact({
          stepAttemptId: id("stepAttemptId"),
          reasonCode: code("reasonCode"),
        });
      case "step.completed":
        return compact({
          stepId: id("stepId"),
          outputDigest: digest("outputDigest"),
        });
      case "run.completed":
        return compact({
          finalSnapshotDigest: digest("finalSnapshotDigest"),
          outputArtifactIds: ids("outputArtifactIds"),
        });
      case "run.failed":
        return compact({
          stepAttemptId: id("stepAttemptId"),
          reasonCode: code("reasonCode"),
          quotaBoundary: oneOf("quotaBoundary", [
            "run_admission",
            "run_concurrency",
            "provider_effect",
            "usage_settlement",
            "artifact_storage",
          ] as const),
        });
    }
  })();
  return {
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    data,
    occurredAt: event.occurredAt.toISOString(),
  };
}

function attemptDto(
  attempt: WorkflowStepAttemptRecord,
): WorkflowStepAttemptDto {
  return {
    ...structuredClone(attempt),
    startedAt: attempt.startedAt.toISOString(),
    completedAt: attempt.completedAt?.toISOString() ?? null,
  };
}

function acceptance(
  run: WorkflowRunRecord,
  initialEventCursor: string,
): WorkflowRunAcceptedDto {
  return {
    run: {
      id: run.id,
      workflowId: run.workflowId,
      workflowRevisionId: run.workflowRevisionId,
      state: "accepted",
      startSnapshotDigest: run.startSnapshotDigest,
      acceptedAt: run.acceptedAt.toISOString(),
    },
    inspect: {
      capability: "workflow_runs.get@1",
      input: { workflowId: run.workflowId, runId: run.id },
    },
    events: {
      capability: "workflow_run_events.list@1",
      input: {
        workflowId: run.workflowId,
        runId: run.id,
        cursor: initialEventCursor,
      },
    },
  };
}

function requireRunPrincipal(
  run: WorkflowRunRecord,
  principalId: string,
): void {
  if (run.startSnapshot.authorization.principalId !== principalId) {
    throw new WorkflowRunError(
      "WORKFLOW_RUN_UNAVAILABLE",
      "The Workflow Run is unavailable.",
    );
  }
}

export type WorkflowRunInspectionActor =
  | { kind: "agent"; principalId: string }
  | { kind: "human"; viewerId: string };

type WorkflowRunInspectionActorInput =
  | { actor: WorkflowRunInspectionActor; principalId?: never }
  | { actor?: never; principalId: string };

function inspectionActor(input: WorkflowRunInspectionActorInput): {
  cursorPrincipalId: string;
  enforceCreatorOwnership: boolean;
  mayReadInputArtifacts: boolean;
} {
  if (!input.actor || input.actor.kind === "agent") {
    const principalId = evidence(
      input.actor ? input.actor.principalId : input.principalId,
      "Principal",
    );
    return {
      cursorPrincipalId: principalId,
      enforceCreatorOwnership: true,
      mayReadInputArtifacts: false,
    };
  }
  return {
    cursorPrincipalId: `human:${evidence(input.actor.viewerId, "Viewer")}`,
    enforceCreatorOwnership: false,
    mayReadInputArtifacts: true,
  };
}

export class WorkflowRunService {
  constructor(
    private readonly repository: WorkflowRunRepository,
    private readonly revisions: WorkflowRunRevisionReader,
    private readonly queue: WorkflowRunQueue,
    private readonly executors: WorkflowStepExecutorRegistry,
    private readonly cursors: WorkflowRunEventCursorCodec,
    private readonly clock: WorkflowRunClock = systemClock,
    private readonly artifacts?: WorkflowRunArtifactPort,
    private readonly usage?: UsageSettlementPort,
    private readonly budgets?: WorkflowRunBudgetPort,
    private readonly quotas?: WorkflowRunQuotaPort,
    private readonly spendQuotes: WorkflowRunSpendQuoteCodec = new WorkflowRunSpendQuoteCodec(null),
  ) {}

  private quotaRunClaim(input: {
    workspaceId: string;
    principalId: string;
    runId: string;
    boundary: "run_admission" | "run_concurrency";
    generation?: number;
    at: Date;
  }) {
    return this.quotas?.planClaim({
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      runId: input.runId,
      transitionKey: input.boundary === "run_concurrency"
        ? `quota:${input.boundary}:${input.runId}:v${input.generation ?? 1}`
        : `quota:${input.boundary}:${input.runId}:v1`,
      boundary: input.boundary,
      subject: { kind: "run", id: input.runId },
      claims: [{
        dimension: input.boundary === "run_admission"
          ? "runtime.run_admissions@1"
          : "runtime.concurrent_runs@1",
        unit: "count",
        amount: "1",
      }],
      recordedAt: input.at,
    }) ?? Promise.resolve(null);
  }

  private budgetAdmissionInput(input: {
    workspaceId: string;
    principalId: string;
    workflowId: string;
    workflowRevisionId: string;
    steps: WorkflowRunStartSnapshot["definition"]["steps"];
    executors: WorkflowStepExecutor[];
    credentialReferences: WorkflowRunStartSnapshot["credentialReferences"];
    at: Date;
  }): BudgetAdmissionInput {
    const stepExposures: RunStepExposure[] = input.steps.map((step, index) => {
      const executor = input.executors[index]!;
      const exposure = executor.admissionExposure?.() ?? {
        schema: "workflow-step-admission-exposure/v1" as const,
        provider: executor.provider,
        providerOperation: executor.providerOperation,
        model: executor.model,
        serviceTier: "standard",
        certainty: "unknown" as const,
        reason: "pricing_catalog_entry_unavailable" as const,
        perAttemptCeiling: null,
        currency: null,
        pricingSnapshotIds: [] as [],
        catalogVersion: "unavailable",
        sourceReferences: [] as string[],
      };
      const credentialSlotId = input.credentialReferences.find(
        (reference) => reference.stepId === step.id && reference.requirement === "provider",
      )?.slotId ?? null;
      return {
        stepId: step.id,
        provider: exposure.provider,
        providerOperation: exposure.providerOperation,
        model: exposure.model,
        serviceTier: exposure.serviceTier,
        automaticAttempts: step.retry.maxAttempts,
        credentialSlotId,
        credentialProfileId: null,
        amountPerAttempt: exposure.perAttemptCeiling,
        currency: exposure.currency,
        pricingSnapshotIds: [...exposure.pricingSnapshotIds],
        pricingSource: exposure.certainty === "exact" ? "builtin_catalog" : "unknown",
      };
    });
    return {
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      workflowId: input.workflowId,
      workflowRevisionId: input.workflowRevisionId,
      stepExposures,
      at: input.at,
    };
  }

  async preview(input: {
    workspaceId: string;
    workflowId: string;
    revisionId: string;
    inputs: Record<string, unknown>;
    principalId: string;
    inputArtifactIds?: string[];
  }): Promise<RunAdmissionPreview> {
    if (!this.budgets) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Run admission preview is unavailable.",
      );
    }
    const workflowId = identifier(input.workflowId, "Workflow ID");
    const revisionId = identifier(input.revisionId, "Workflow Revision ID");
    const principalId = evidence(input.principalId, "Principal");
    const inputs = canonicalInputs(input.inputs);
    const revision = await this.revisions.getRevision({
      workspaceId: input.workspaceId,
      workflowId,
      revisionId,
    });
    if (!revision) {
      throw new WorkflowRunError("WORKFLOW_RUN_UNAVAILABLE", "The immutable Workflow Revision is unavailable.");
    }
    const steps = revision.definition.steps;
    const { executors: resolvedExecutors } = eligibleWorkflowExecutors(
      revision,
      this.executors,
    );
    const resolvedArtifactIds: string[] = [];
    for (const [name, definition] of Object.entries(revision.definition.inputs)) {
      const value = inputs[name];
      if (definition.required && value === undefined) {
        throw new WorkflowRunError("WORKFLOW_RUN_INVALID_INPUT", `Required Workflow input ${name} is missing.`);
      }
      if (value === undefined) continue;
      if (typeof value !== "string") {
        throw new WorkflowRunError("WORKFLOW_RUN_INVALID_INPUT", `Workflow input ${name} must be text or an Artifact ID.`);
      }
      if (definition.kind === "image") {
        if (!this.artifacts) {
          throw new WorkflowRunError("WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE", "Artifact input resolution is unavailable.");
        }
        const found = await this.artifacts.getArtifact({ workspaceId: input.workspaceId, artifactId: value });
        if (found.artifact.kind !== "image" || found.artifact.origin.kind !== "imported") {
          throw new WorkflowRunError("WORKFLOW_RUN_INVALID_INPUT", `Workflow input ${name} must reference an imported image Artifact.`);
        }
        resolvedArtifactIds.push(found.artifact.id);
      }
    }
    const unexpected = Object.keys(inputs).filter((name) => !(name in revision.definition.inputs));
    if (unexpected.length) {
      throw new WorkflowRunError("WORKFLOW_RUN_INVALID_INPUT", `Workflow input ${unexpected.sort(compareCodeUnits)[0]} is not declared.`);
    }
    const declared = [...(input.inputArtifactIds ?? [])].map((id) => identifier(id, "Input Artifact ID")).sort(compareCodeUnits);
    resolvedArtifactIds.sort(compareCodeUnits);
    if (declared.length !== resolvedArtifactIds.length || declared.some((id, index) => id !== resolvedArtifactIds[index])) {
      throw new WorkflowRunError("WORKFLOW_RUN_INVALID_INPUT", "inputArtifactIds must exactly match the Workflow input Artifact bindings.");
    }
    const credentialReferences = steps.flatMap((step) =>
      Object.entries(step.credentials).map(([requirement, slotName]) => ({
        stepId: step.id,
        requirement,
        slotId: revision.definition.credentialSlots[slotName]?.slotId ?? slotName,
      })),
    );
    return this.budgets.previewRun(this.budgetAdmissionInput({
      workspaceId: input.workspaceId,
      principalId,
      workflowId,
      workflowRevisionId: revision.id,
      steps,
      executors: resolvedExecutors,
      credentialReferences,
      at: this.clock.now(),
    }));
  }

  private usageInput(input: {
    run: WorkflowRunRecord;
    attempt: WorkflowStepAttemptRecord;
    metadata: import("./types").WorkflowStepProviderMetadata | null;
    providerOperationRef: string | null;
    outcome: SettleProviderUsageInput["outcome"];
    endedAt: Date;
  }): SettleProviderUsageInput {
    return {
      binding: {
        workspaceId: input.run.workspaceId,
        principalId: input.run.startSnapshot.authorization.principalId,
        workflowId: input.run.workflowId,
        runId: input.run.id,
        stepAttemptId: input.attempt.id,
        stepId: input.attempt.stepId,
        attempt: input.attempt.attempt,
        provider: input.attempt.provider,
        providerOperation: input.attempt.providerOperation,
        providerOperationRef: input.providerOperationRef,
        model: input.attempt.model,
        effectKey: input.attempt.effectKey,
      },
      interval: {
        startedAt: input.attempt.startedAt,
        endedAt: input.endedAt,
      },
      metadata: input.metadata,
      providerReportedCost: input.metadata?.reportedCost ?? null,
      outcome: input.outcome,
      lineageArtifactIds: input.attempt.inputs
        .map((item) => item.artifactId)
        .filter((id): id is string => Boolean(id)),
      recordedAt: input.endedAt,
    };
  }

  private usageSettlementId(
    run: WorkflowRunRecord,
    attempt: WorkflowStepAttemptRecord,
  ): string | null {
    if (!this.usage) return null;
    return this.usage.settlementIdFor(
      this.usageInput({
        run,
        attempt,
        metadata: null,
        providerOperationRef: null,
        outcome: "outcome_unknown",
        endedAt: attempt.startedAt,
      }).binding,
    );
  }

  private async usageQuotaClaimPlans(input: {
    run: WorkflowRunRecord;
    attempt: WorkflowStepAttemptRecord;
    resolution: WorkflowRunProviderResolution;
    recordedAt: Date;
  }): Promise<{ plans: import("../quotas/types").QuotaClaimPlan[]; unavailable: boolean }> {
    if (!this.quotas) return { plans: [], unavailable: false };
    const settlementId = this.usageSettlementId(input.run, input.attempt);
    if (!settlementId || input.resolution.usageCeilings.some((item) => item.maximumQuantity === null)) {
      return { plans: [], unavailable: true };
    }
    const capacities = await this.quotas.getEffectiveCapacity({
      workspaceId: input.run.workspaceId,
      principalId: input.run.startSnapshot.authorization.principalId,
      boundary: "usage_settlement",
      at: input.recordedAt,
    });
    if (input.resolution.usageCeilings.some((ceiling) =>
      !capacities.some((capacity) =>
        capacity.policy.scope === "workspace" &&
        capacity.policy.dimension === ceiling.dimension &&
        capacity.policy.unit === ceiling.unit))) {
      return { plans: [], unavailable: true };
    }
    const plans = await Promise.all(
      input.resolution.usageCeilings.map((ceiling) => {
        const subjectId = usageQuotaSubjectId({
          settlementId,
          dimension: ceiling.dimension,
          unit: ceiling.unit,
        });
        return this.quotas!.planClaim({
          workspaceId: input.run.workspaceId,
          principalId: input.run.startSnapshot.authorization.principalId,
          runId: input.run.id,
          transitionKey: `quota:usage:${subjectId}:v1`,
          boundary: "usage_settlement",
          subject: { kind: "usage_settlement", id: subjectId },
          claims: [{
            dimension: ceiling.dimension,
            unit: ceiling.unit,
            amount: ceiling.maximumQuantity!,
          }],
          recordedAt: input.recordedAt,
        });
      }),
    );
    return { plans, unavailable: false };
  }

  private async usageQuotaReconciliationPlans(input: {
    run: WorkflowRunRecord;
    attempt: WorkflowStepAttemptRecord;
    usagePlan: import("../usage/types").UsageLedgerAppendPlan | null | undefined;
    metadata: import("./types").WorkflowStepProviderMetadata | null;
    recordedAt: Date;
  }): Promise<import("../quotas/types").QuotaUsageReconciliationPlan[]> {
    if (!this.quotas || !input.usagePlan) return [];
    const resolution = input.run.startSnapshot.providerResolutions?.find(
      (candidate) => candidate.stepId === input.attempt.stepId,
    );
    if (!resolution) return [];
    const reservations = (await Promise.all(
      resolution.usageCeilings.map(async (ceiling) => {
        const subject = {
          kind: "usage_settlement" as const,
          id: usageQuotaSubjectId({
          settlementId: input.usagePlan!.settlementId,
          dimension: ceiling.dimension,
          unit: ceiling.unit,
          }),
        };
        return this.quotas!.listReservations({
          workspaceId: input.run.workspaceId,
          subject,
        });
      }),
    )).flat();
    const held = reservations.filter((reservation) =>
      reservation.runId === input.run.id &&
      reservation.boundary === "usage_settlement" &&
      reservation.subject.kind === "usage_settlement" &&
      reservation.state === "held" &&
      reservation.heldAmount !== "0");
    const subjects = new Map<string, (typeof held)[number]>();
    for (const reservation of held) subjects.set(reservation.subject.id, reservation);
    const provenNotCreated = input.metadata?.evidence.effectDisposition === "not_created";
    const plans = [];
    for (const reservation of subjects.values()) {
      const record = input.usagePlan.records.find((candidate) =>
        candidate.dimension === reservation.dimension && candidate.unit === reservation.unit);
      const actualAmount = provenNotCreated ? "0" : record?.quantity ?? null;
      const evidenceRef = record?.id ?? input.usagePlan.records[0]?.id ?? input.attempt.id;
      plans.push(await this.quotas.planUsageReconciliation({
        workspaceId: input.run.workspaceId,
        reconciliationId: usageQuotaReconciliationId({
          subjectId: reservation.subject.id,
          evidenceRef,
          actualAmount,
        }),
        subject: { kind: "usage_settlement", id: reservation.subject.id },
        dimension: reservation.dimension,
        unit: reservation.unit,
        actualAmount,
        evidenceRef,
        recordedAt: input.recordedAt,
      }));
    }
    return plans;
  }

  private async budgetSettlementForUsage(input: {
    plan: import("../usage/types").UsageLedgerAppendPlan | null | undefined;
    workspaceId?: string;
    settlementId?: string;
    outcome: import("../budgets/types").BudgetSettlementPlan["outcome"];
    runTerminal: boolean;
  }): Promise<import("../budgets/types").BudgetSettlementPlan | null> {
    if (!this.budgets) return null;
    const valuation = input.plan?.valuation ?? (
      input.workspaceId && input.settlementId && this.usage?.getCurrentValuation
        ? await this.usage.getCurrentValuation(input.workspaceId, input.settlementId)
        : null
    );
    if (!valuation) return null;
    return this.budgets.planSettlement({
      schema: "budget-settlement-plan/v1",
      workspaceId: valuation.workspaceId,
      runId: valuation.runId,
      stepAttemptId: valuation.stepAttemptId,
      settlementId: valuation.settlementId,
      costValuationId: valuation.id,
      outcome: input.outcome,
      amount: valuation.amount,
      currency: valuation.currency,
      fxSnapshotId: valuation.fxSnapshotId,
      runTerminal: input.runTerminal,
      recordedAt: valuation.recordedAt,
    });
  }

  async start(input: {
    workspaceId: string;
    workflowId: string;
    revisionId: string;
    inputs: Record<string, unknown>;
    principalId: string;
    keyId: string;
    authorizationEvidenceRef: string;
    idempotencyKey: string;
    inputArtifactIds?: string[];
    capability?: "workflow_runs.start@1" | "workflow_runs.start@2";
    acceptedSpendQuoteRef?: string;
  }): Promise<WorkflowRunAcceptedDto> {
    const capability = input.capability ?? "workflow_runs.start@1";
    const workflowId = identifier(input.workflowId, "Workflow ID");
    const revisionId = identifier(input.revisionId, "Workflow Revision ID");
    const idempotencyKey = stableKey(input.idempotencyKey);
    const principalId = evidence(input.principalId, "Principal");
    const keyId = evidence(input.keyId, "Key");
    const evidenceRef = evidence(
      input.authorizationEvidenceRef,
      "Authorization evidence",
    );
    const inputs = canonicalInputs(input.inputs);
    const revision = await this.revisions.getRevision({
      workspaceId: input.workspaceId,
      workflowId,
      revisionId,
    });
    if (!revision) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The immutable Workflow Revision is unavailable.",
      );
    }
    const steps = revision.definition.steps;
    const { executors: resolvedExecutors, isGolden } =
      eligibleWorkflowExecutors(revision, this.executors);
    if (isGolden && capability !== "workflow_runs.start@2") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_INVALID_INPUT",
        "Artifact-backed Workflow Runs require workflow_runs.start@2.",
      );
    }

    const artifactReferences: WorkflowRunStartSnapshot["artifactReferences"] =
      [];
    const normalizedInputs: WorkflowRunStartSnapshot["inputs"] = [];
    for (const [name, definition] of Object.entries(
      revision.definition.inputs,
    ).sort(([left], [right]) => compareCodeUnits(left, right))) {
      const value = inputs[name];
      if (definition.required && value === undefined) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_INVALID_INPUT",
          `Required Workflow input ${name} is missing.`,
        );
      }
      if (value === undefined) continue;
      if (typeof value !== "string") {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_INVALID_INPUT",
          `Workflow input ${name} must be text or an Artifact ID.`,
        );
      }
      if (definition.kind === "text") {
        normalizedInputs.push({ name, kind: "text", value });
        continue;
      }
      if (!this.artifacts) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
          "Artifact input resolution is unavailable.",
        );
      }
      let found;
      try {
        found = await this.artifacts.getArtifact({
          workspaceId: input.workspaceId,
          artifactId: value,
        });
      } catch {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_UNAVAILABLE",
          "A Workflow input Artifact is unavailable.",
        );
      }
      if (
        found.artifact.kind !== "image" ||
        found.artifact.origin.kind !== "imported"
      ) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_INVALID_INPUT",
          `Workflow input ${name} must reference an imported image Artifact.`,
        );
      }
      normalizedInputs.push({
        name,
        kind: "image",
        value: {
          artifactId: found.artifact.id,
          digest: found.artifact.digest,
        },
      });
      artifactReferences.push({
        inputName: name,
        artifactId: found.artifact.id,
        digest: found.artifact.digest,
        kind: found.artifact.kind,
        mediaType: found.artifact.mediaType,
        sizeBytes: found.artifact.sizeBytes,
        width: found.artifact.width,
        height: found.artifact.height,
      });
    }
    const unexpected = Object.keys(inputs)
      .filter((name) => !(name in revision.definition.inputs))
      .sort(compareCodeUnits);
    if (unexpected.length > 0) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_INVALID_INPUT",
        `Workflow input ${unexpected[0]} is not declared.`,
      );
    }
    const declaredArtifactIds = [...(input.inputArtifactIds ?? [])]
      .map((value) => identifier(value, "Input Artifact ID"))
      .sort(compareCodeUnits);
    const resolvedArtifactIds = artifactReferences
      .map((reference) => reference.artifactId)
      .sort(compareCodeUnits);
    if (
      declaredArtifactIds.length !== resolvedArtifactIds.length ||
      declaredArtifactIds.some(
        (artifactId, index) => artifactId !== resolvedArtifactIds[index],
      )
    ) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_INVALID_INPUT",
        "inputArtifactIds must exactly match the Workflow input Artifact bindings.",
      );
    }

    const acceptedSpendQuote = input.acceptedSpendQuoteRef
      ? this.spendQuotes.open(input.acceptedSpendQuoteRef)
      : null;
    if (input.acceptedSpendQuoteRef && !acceptedSpendQuote) {
      throw new WorkflowRunError("WORKFLOW_RUN_INVALID_INPUT", "The accepted provider-spend quote is invalid.");
    }
    if (acceptedSpendQuote) {
      const quoteInputDigest = workflowRunQuoteInputDigest({ workflowId, revisionId, inputs, inputArtifactIds: resolvedArtifactIds });
      if (
        capability !== "workflow_runs.start@2" ||
        acceptedSpendQuote.targetWorkspaceId !== input.workspaceId ||
        acceptedSpendQuote.delegatedPrincipalId !== principalId ||
        acceptedSpendQuote.delegatedKeyId !== keyId ||
        acceptedSpendQuote.workflowId !== workflowId ||
        acceptedSpendQuote.workflowRevisionId !== revisionId ||
        acceptedSpendQuote.inputDigest !== quoteInputDigest
      ) throw new WorkflowRunError("WORKFLOW_RUN_INVALID_INPUT", "The provider-spend quote does not match this exact Run request.");
    }

    const snapshot: WorkflowRunStartSnapshot = {
      schema: "workflow-run-start-snapshot/v2",
      workflowId,
      workflowRevisionId: revision.id,
      workflowRevision: revision.revision,
      definitionDigest: revision.definitionDigest,
      operationRegistryDigest: revision.operationRegistryDigest,
      definition: structuredClone(revision.definition),
      inputs: normalizedInputs,
      operationContracts: steps.map((step) => ({
        stepId: step.id,
        identity: step.operation.identity,
        contractDigest: step.operation.contractDigest,
      })),
      providerResolutions: steps.map((step, index) => ({
        stepId: step.id,
        ...executorResolution(resolvedExecutors[index]!, step),
      })),
      artifactReferences,
      credentialReferences: steps.flatMap((step) =>
        Object.entries(step.credentials).map(([requirement, slotName]) => ({
          stepId: step.id,
          requirement,
          slotId:
            revision.definition.credentialSlots[slotName]?.slotId ?? slotName,
        })),
      ),
      authorization: {
        principalId,
        keyId,
        evidenceRef,
      },
      ...(acceptedSpendQuote ? { acceptedSpendQuote } : {}),
    };
    // Admission evidence is deliberately outside the caller-intent
    // fingerprint: a retry receives fresh evidence but must replay the same
    // durable acceptance.
    const requestFingerprint = canonicalDigest({
      workflowId,
      revisionId,
      definitionDigest: revision.definitionDigest,
      operationRegistryDigest: revision.operationRegistryDigest,
      operationContracts: steps.map((step) => ({
        stepId: step.id,
        identity: step.operation.identity,
        contractDigest: step.operation.contractDigest,
      })),
      inputs: normalizedInputs,
      inputArtifactIds: resolvedArtifactIds,
      acceptedSpendQuoteId: acceptedSpendQuote?.quoteId ?? null,
    });
    const replay = await this.repository.getMutationReceipt({
      workspaceId: input.workspaceId,
      principalId,
      capability,
      idempotencyKey,
    });
    if (replay) {
      if (replay.receipt.requestFingerprint !== requestFingerprint) {
        throw new WorkflowRunError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key is already bound to another Workflow Run.",
        );
      }
      return acceptance(replay.run, replay.receipt.initialEventCursor);
    }
    const now = this.clock.now();
    if (acceptedSpendQuote && (
      !Number.isFinite(new Date(acceptedSpendQuote.expiresAt).getTime()) ||
      new Date(acceptedSpendQuote.expiresAt) <= now ||
      !Number.isFinite(new Date(acceptedSpendQuote.quotedAt).getTime()) ||
      new Date(acceptedSpendQuote.quotedAt) > now
    )) throw new WorkflowRunError("WORKFLOW_RUN_INVALID_INPUT", "The accepted provider-spend quote is stale.");
    const runId = `run_${randomUUID().replaceAll("-", "")}`;
    const run: WorkflowRunRecord = {
      id: runId,
      workspaceId: input.workspaceId,
      workflowId,
      workflowRevisionId: revision.id,
      state: "accepted",
      startSnapshotDigest: canonicalDigest(snapshot),
      startSnapshot: snapshot,
      nextEventSequence: 2,
      output: null,
      finalSnapshot: null,
      finalSnapshotDigest: null,
      derivation: null,
      resumeAt: null,
      failureCode: null,
      acceptedAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    };
    const quotaAdmissionPlan = await this.quotaRunClaim({
      workspaceId: input.workspaceId,
      principalId,
      runId,
      boundary: "run_admission",
      at: now,
    });
    let budgetAdmissionPlan = null;
    try {
      budgetAdmissionPlan = this.budgets
        ? await this.budgets.planAdmission({
          ...this.budgetAdmissionInput({
            workspaceId: input.workspaceId,
            principalId,
            workflowId,
            workflowRevisionId: revision.id,
            steps,
            executors: resolvedExecutors,
            credentialReferences: snapshot.credentialReferences,
            at: now,
          }),
          runId,
        })
        : null;
    } catch (error) {
      if (!(error instanceof BudgetServiceError)) throw error;
      const message = error.message;
      const code = message.includes("EMERGENCY_SPEND_SUSPENDED")
        ? "SPEND_SUSPENDED"
        : message.includes("CREDENTIAL_SPEND_GRANT_UNAVAILABLE")
          ? "CREDENTIAL_SPEND_NOT_AUTHORIZED"
          : message.includes("UNKNOWN_PRICING") || message.includes("unknown ceiling")
            ? "RUN_COST_UNKNOWN"
            : "BUDGET_LIMIT_EXCEEDED";
      throw new WorkflowRunError(code, message);
    }
    if (acceptedSpendQuote && (!budgetAdmissionPlan || !matchesAcceptedSpendQuote(acceptedSpendQuote, budgetAdmissionPlan))) {
      throw new WorkflowRunError("RUN_COST_UNKNOWN", "The current provider-spend reservation no longer matches the accepted fixed quote.");
    }
    if (acceptedSpendQuote && budgetAdmissionPlan) {
      budgetAdmissionPlan = {
        ...budgetAdmissionPlan,
        acceptedSpendQuote,
        requestDigest: canonicalDigest({ baseAdmissionDigest: budgetAdmissionPlan.requestDigest, acceptedSpendQuote }),
      };
    }
    const initialEventCursor = this.cursors.seal({
      workspaceId: input.workspaceId,
      principalId,
      workflowId,
      runId,
      afterSequence: 0,
    });
    const result = await this.repository.start({
      run,
      firstEvent: {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        runId,
        sequence: 1,
        type: "run.accepted",
        data: {
          workflowId,
          workflowRevisionId: revision.id,
          startSnapshotDigest: run.startSnapshotDigest,
        },
        occurredAt: now,
      },
      receipt: {
      workspaceId: input.workspaceId,
      principalId,
      keyId,
      authorizationEvidenceRef: evidenceRef,
      capability,
        idempotencyKey,
        requestFingerprint,
        runId,
        initialEventCursor,
        result: null,
        createdAt: now,
      },
      outboxIntent: {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        runId,
        generation: 1,
        dedupeKey: `workflow-run:${input.workspaceId}:${runId}:v1`,
        state: "pending",
        deliveryToken: null,
        deliveryAttempts: 0,
        availableAt: now,
        claimedAt: null,
        deliveredAt: null,
        createdAt: now,
      },
      budgetAdmissionPlan,
      quotaAdmissionPlan,
      quotaWaitEventId: quotaAdmissionPlan ? randomUUID() : null,
      acceptedSpendQuote,
      acceptedSpendQuoteRef: input.acceptedSpendQuoteRef ?? null,
    });
    if (result.kind === "conflict") {
      throw new WorkflowRunError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to another Workflow Run.",
      );
    }
    if (result.kind === "quota_denied") {
      if (quotaAdmissionPlan) {
        void emitQuotaDecisionMetric({
          workspaceId: input.workspaceId,
          canonicalEventId: quotaAdmissionPlan.transitionKey,
          boundary: quotaAdmissionPlan.boundary,
          outcome: "denied",
          reasonFamily: quotaReasonFamily(result.reasonCodes),
          recordedAt: quotaAdmissionPlan.createdAt,
        });
      }
      throw new WorkflowRunError(
        "QUOTA_EXCEEDED",
        "The Workflow Run exceeds an applicable non-monetary quota.",
        quotaDenialDetails(result.reasonCodes, result.evidence),
      );
    }
    if (result.kind === "unavailable") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Workflow Run acceptance could not be committed.",
      );
    }
    void emitRunStatusMetric({
      workspaceId: result.run.workspaceId,
      canonicalEventId: result.run.id,
      status: "accepted",
      recordedAt: result.run.acceptedAt,
    });
    if (quotaAdmissionPlan) {
      void emitQuotaDecisionMetric({
        workspaceId: result.run.workspaceId,
        canonicalEventId: quotaAdmissionPlan.transitionKey,
        boundary: quotaAdmissionPlan.boundary,
        outcome: "succeeded",
        reasonFamily: "unknown",
        recordedAt: quotaAdmissionPlan.createdAt,
      });
    }
    return acceptance(result.run, result.receipt.initialEventCursor);
  }

  async get(input: WorkflowRunInspectionActorInput & {
    workspaceId: string;
    workflowId: string;
    runId: string;
  }): Promise<WorkflowRunDto> {
    const workflowId = identifier(input.workflowId, "Workflow ID");
    const runId = identifier(input.runId, "Workflow Run ID");
    const run = await this.repository.get({
      workspaceId: input.workspaceId,
      workflowId,
      runId,
    });
    if (!run) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The Workflow Run is unavailable.",
      );
    }
    const viewer = inspectionActor(input);
    if (viewer.enforceCreatorOwnership) {
      requireRunPrincipal(run, viewer.cursorPrincipalId);
    }
    return workflowRunDto(run);
  }

  async retry(input: {
    workspaceId: string;
    workflowId: string;
    runId: string;
    principalId: string;
    keyId: string;
    authorizationEvidenceRef: string;
    idempotencyKey: string;
    inputArtifactIds: string[];
  }): Promise<WorkflowRunRecoveryDto> {
    const workflowId = identifier(input.workflowId, "Workflow ID");
    const sourceRunId = identifier(input.runId, "Workflow Run ID");
    const principalId = evidence(input.principalId, "Principal");
    const keyId = evidence(input.keyId, "Key");
    const evidenceRef = evidence(
      input.authorizationEvidenceRef,
      "Authorization evidence",
    );
    const idempotencyKey = stableKey(input.idempotencyKey);
    const declaredArtifactIds = [...input.inputArtifactIds]
      .map((artifactId) => identifier(artifactId, "Input Artifact ID"))
      .sort(compareCodeUnits);
    const requestFingerprint = canonicalDigest({
      workflowId,
      sourceRunId,
      inputArtifactIds: declaredArtifactIds,
    });
    const replay = await this.repository.getMutationReceipt({
      workspaceId: input.workspaceId,
      principalId,
      capability: "workflow_runs.retry@1",
      idempotencyKey,
    });
    if (replay) {
      if (replay.receipt.requestFingerprint !== requestFingerprint) {
        throw new WorkflowRunError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key is already bound to another retry.",
        );
      }
      return mutationReceiptResult(replay);
    }
    const source = await this.repository.get({
      workspaceId: input.workspaceId,
      workflowId,
      runId: sourceRunId,
    });
    if (!source) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The source Workflow Run is unavailable.",
      );
    }
    requireRunPrincipal(source, principalId);
    if (
      source.startSnapshot.schema !== "workflow-run-start-snapshot/v2" ||
      !source.startSnapshot.providerResolutions?.length
    ) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_NOT_RESUMABLE",
        "Legacy Runs without immutable provider resolutions cannot be retried.",
      );
    }
    if (source.state === "outcome_unknown") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_RECONCILIATION_REQUIRED",
        "The source Workflow Run must be reconciled before retry.",
      );
    }
    if (source.state !== "failed") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_NOT_RESUMABLE",
        "Only a terminal failed Workflow Run can create a manual retry.",
      );
    }
    const sourceArtifactIds = source.startSnapshot.artifactReferences
      .map((reference) => reference.artifactId)
      .sort(compareCodeUnits);
    if (
      canonicalDigest(declaredArtifactIds) !== canonicalDigest(sourceArtifactIds)
    ) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_INVALID_INPUT",
        "inputArtifactIds must exactly match the source Run snapshot.",
      );
    }
    const attempts =
      (await this.repository.listStepAttempts({
        workspaceId: input.workspaceId,
        runId: source.id,
      })) ?? [];
    const failed = attempts
      .filter((attempt) => attempt.state === "failed")
      .sort((left, right) => right.completedAt!.getTime() - left.completedAt!.getTime())[0];
    const failedStepId =
      failed?.stepId ??
      (source.startSnapshot.definition.steps.length === 1
        ? source.startSnapshot.definition.steps[0]?.id
        : undefined);
    if (!failedStepId) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_NOT_RESUMABLE",
        "The source Run has no known failed Step Attempt.",
      );
    }
    const failedIndex = source.startSnapshot.definition.steps.findIndex(
      (step) => step.id === failedStepId,
    );
    const reusedOutputs = source.startSnapshot.definition.steps
      .slice(0, failedIndex)
      .map((step) => {
        const completed = attempts
          .filter(
            (attempt) =>
              attempt.stepId === step.id &&
              attempt.state === "completed" &&
              attempt.outputs &&
              attempt.providerOperationRef,
          )
          .sort((left, right) => right.attempt - left.attempt)[0];
        if (completed) {
          return {
            stepId: completed.stepId,
            sourceRunId: source.id,
            sourceStepAttemptId: completed.id,
            sourceAttempt: completed.attempt,
            sourceEffectKey: completed.effectKey,
            sourceProviderOperationRef: completed.providerOperationRef!,
            outputs: structuredClone(completed.outputs!),
          };
        }
        const inherited = source.derivation?.reusedOutputs.find(
          (reused) => reused.stepId === step.id,
        );
        return inherited ? structuredClone(inherited) : null;
      })
      .filter(
        (
          reused,
        ): reused is NonNullable<typeof reused> => reused !== null,
      );
    const snapshot: WorkflowRunStartSnapshot = {
      ...structuredClone(source.startSnapshot),
      authorization: { principalId, keyId, evidenceRef },
    };
    const now = this.clock.now();
    const runId = `run_${randomUUID().replaceAll("-", "")}`;
    const derivation = {
      kind: "manual_retry" as const,
      sourceRunId: source.id,
      rootRunId: source.derivation?.rootRunId ?? source.id,
      sourceStartSnapshotDigest: source.startSnapshotDigest,
      retryFromStepId: failedStepId,
      reusedOutputs,
    };
    const run: WorkflowRunRecord = {
      id: runId,
      workspaceId: input.workspaceId,
      workflowId,
      workflowRevisionId: source.workflowRevisionId,
      state: "accepted",
      startSnapshotDigest: canonicalDigest(snapshot),
      startSnapshot: snapshot,
      nextEventSequence: 3,
      output: null,
      finalSnapshot: null,
      finalSnapshotDigest: null,
      derivation,
      resumeAt: null,
      failureCode: null,
      acceptedAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    };
    const quotaAdmissionPlan = await this.quotaRunClaim({
      workspaceId: input.workspaceId,
      principalId,
      runId,
      boundary: "run_admission",
      at: now,
    });
    let budgetAdmissionPlan = null;
    if (this.budgets) {
      const retrySteps = source.startSnapshot.definition.steps.slice(failedIndex);
      const retryExecutors = retrySteps.map((step) =>
        this.executors.resolve
          ? this.executors.resolve(
              step.operation.identity,
              step.operation.contractDigest,
              step.config,
            )
          : this.executors.get(
              step.operation.identity,
              step.operation.contractDigest,
            ),
      );
      if (retryExecutors.some((executor) => !executor)) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
          "A retried Workflow operation has no pinned runtime executor.",
        );
      }
      try {
        budgetAdmissionPlan = await this.budgets.planAdmission({
          ...this.budgetAdmissionInput({
            workspaceId: input.workspaceId,
            principalId,
            workflowId,
            workflowRevisionId: source.workflowRevisionId,
            steps: retrySteps,
            executors: retryExecutors.map((executor) => executor!),
            credentialReferences: snapshot.credentialReferences.filter((reference) =>
              retrySteps.some((step) => step.id === reference.stepId),
            ),
            at: now,
          }),
          runId,
        });
      } catch (error) {
        if (!(error instanceof BudgetServiceError)) throw error;
        const message = error.message;
        const code = message.includes("EMERGENCY_SPEND_SUSPENDED")
          ? "SPEND_SUSPENDED"
          : message.includes("CREDENTIAL_SPEND_GRANT_UNAVAILABLE")
            ? "CREDENTIAL_SPEND_NOT_AUTHORIZED"
            : message.includes("UNKNOWN_PRICING") || message.includes("unknown ceiling")
              ? "RUN_COST_UNKNOWN"
              : "BUDGET_LIMIT_EXCEEDED";
        throw new WorkflowRunError(code, message);
      }
    }
    const cursor = this.cursors.seal({
      workspaceId: input.workspaceId,
      principalId,
      workflowId,
      runId,
      afterSequence: 0,
    });
    const receipt = {
      workspaceId: input.workspaceId,
      principalId,
      keyId,
      authorizationEvidenceRef: evidenceRef,
      capability: "workflow_runs.retry@1" as const,
      idempotencyKey,
      requestFingerprint,
      runId,
      initialEventCursor: cursor,
      result: null,
      createdAt: now,
    };
    const result = await this.repository.deriveRun({
      run,
      events: [
        {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          runId,
          sequence: 1,
          type: "run.accepted",
          data: { startSnapshotDigest: run.startSnapshotDigest },
          occurredAt: now,
        },
        {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          runId,
          sequence: 2,
          type: "run.derived",
          data: {
            kind: "manual_retry",
            sourceRunId: source.id,
            rootRunId: derivation.rootRunId,
            retryFromStepId: failedStepId,
          },
          occurredAt: now,
        },
      ],
      receipt,
      outboxIntent: {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        runId,
        generation: 1,
        dedupeKey: `workflow-run:${input.workspaceId}:${runId}:v1`,
        state: "pending",
        deliveryToken: null,
        deliveryAttempts: 0,
        availableAt: now,
        claimedAt: null,
        deliveredAt: null,
        createdAt: now,
      },
      budgetAdmissionPlan,
      quotaAdmissionPlan,
      quotaWaitEventId: quotaAdmissionPlan ? randomUUID() : null,
    });
    if (result.kind === "conflict") {
      throw new WorkflowRunError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to another retry.",
      );
    }
    if (result.kind === "quota_denied") {
      if (quotaAdmissionPlan) {
        void emitQuotaDecisionMetric({
          workspaceId: input.workspaceId,
          canonicalEventId: quotaAdmissionPlan.transitionKey,
          boundary: quotaAdmissionPlan.boundary,
          outcome: "denied",
          reasonFamily: quotaReasonFamily(result.reasonCodes),
          recordedAt: quotaAdmissionPlan.createdAt,
        });
      }
      throw new WorkflowRunError(
        "QUOTA_EXCEEDED",
        "The derived Workflow Run exceeds an applicable non-monetary quota.",
        quotaDenialDetails(result.reasonCodes, result.evidence),
      );
    }
    if (result.kind !== "created" && result.kind !== "replayed") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "The derived Workflow Run could not be committed.",
      );
    }
    void emitRunStatusMetric({
      workspaceId: result.run.workspaceId,
      canonicalEventId: result.run.id,
      status: "accepted",
      recordedAt: result.run.acceptedAt,
    });
    if (quotaAdmissionPlan) {
      void emitQuotaDecisionMetric({
        workspaceId: result.run.workspaceId,
        canonicalEventId: quotaAdmissionPlan.transitionKey,
        boundary: quotaAdmissionPlan.boundary,
        outcome: "succeeded",
        reasonFamily: "unknown",
        recordedAt: quotaAdmissionPlan.createdAt,
      });
    }
    return mutationReceiptResult(result);
  }

  async resume(input: {
    workspaceId: string;
    workflowId: string;
    runId: string;
    principalId: string;
    keyId: string;
    authorizationEvidenceRef: string;
    waitEventSequence: number;
    idempotencyKey: string;
  }): Promise<WorkflowRunRecoveryDto> {
    const workflowId = identifier(input.workflowId, "Workflow ID");
    const runId = identifier(input.runId, "Workflow Run ID");
    const principalId = evidence(input.principalId, "Principal");
    const keyId = evidence(input.keyId, "Key");
    const authorizationEvidenceRef = evidence(
      input.authorizationEvidenceRef,
      "Authorization evidence",
    );
    const waitEventSequence = input.waitEventSequence;
    if (!Number.isInteger(waitEventSequence) || waitEventSequence < 1) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_INVALID_INPUT",
        "A positive wait event sequence is required.",
      );
    }
    const idempotencyKey = stableKey(input.idempotencyKey);
    const requestFingerprint = canonicalDigest({
      workflowId,
      runId,
      waitEventSequence,
    });
    const replay = await this.repository.getMutationReceipt({
      workspaceId: input.workspaceId,
      principalId,
      capability: "workflow_runs.resume@1",
      idempotencyKey,
    });
    if (replay) {
      if (replay.receipt.requestFingerprint !== requestFingerprint) {
        throw new WorkflowRunError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key is already bound.",
        );
      }
      return mutationReceiptResult(replay);
    }
    const run = await this.repository.get({
      workspaceId: input.workspaceId,
      workflowId,
      runId,
    });
    if (!run) {
      throw new WorkflowRunError("WORKFLOW_RUN_UNAVAILABLE", "The Workflow Run is unavailable.");
    }
    requireRunPrincipal(run, principalId);
    if (run.state === "outcome_unknown") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_RECONCILIATION_REQUIRED",
        "Unknown provider outcomes cannot be resumed.",
      );
    }
    if (run.state !== "waiting") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_NOT_RESUMABLE",
        "The Workflow Run is not waiting for a known-safe retry.",
      );
    }
    const now = this.clock.now();
    if (run.resumeAt && run.resumeAt > now) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_NOT_RESUMABLE",
        "The retry backoff has not elapsed.",
      );
    }
    let quotaResumePlan = null;
    if (run.failureCode === "QUOTA_WAIT") {
      if (!this.quotas) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_NOT_RESUMABLE",
          "Quota capacity cannot be re-evaluated.",
        );
      }
      const waitEvents = await this.repository.listEvents({
        workspaceId: input.workspaceId,
        workflowId,
        runId,
        afterSequence: waitEventSequence - 1,
        limit: 1,
      });
      const requestedWaitId = waitEvents?.[0]?.sequence === waitEventSequence &&
        waitEvents[0].type === "run.waiting" &&
        typeof waitEvents[0].data.waitId === "string"
        ? waitEvents[0].data.waitId
        : null;
      if (!requestedWaitId) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_NOT_RESUMABLE",
          "The requested wait event has no durable Quota Wait evidence.",
        );
      }
      const waits = await this.quotas.listWaits({
        workspaceId: input.workspaceId,
        runId,
        state: "waiting",
      });
      const activeWait = waits.find((wait) => wait.id === requestedWaitId);
      if (!activeWait) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_NOT_RESUMABLE",
          "The durable Quota Wait is unavailable.",
        );
      }
      quotaResumePlan = await this.quotas.planResumeWait({
        workspaceId: input.workspaceId,
        waitId: activeWait.id,
        actor: { kind: "principal", principalId },
        resumeReason: "manual_resume",
        idempotencyKey,
        recordedAt: now,
      });
    }
    const generation = run.nextEventSequence;
    const receipt = {
      workspaceId: input.workspaceId,
      principalId,
      keyId,
      authorizationEvidenceRef,
      capability: "workflow_runs.resume@1" as const,
      idempotencyKey,
      requestFingerprint,
      runId,
      initialEventCursor: this.cursors.seal({
        workspaceId: input.workspaceId,
        principalId,
        workflowId,
        runId,
        afterSequence: 0,
      }),
      result: null,
      createdAt: now,
    };
    const result = await this.repository.resumeRun({
      workspaceId: input.workspaceId,
      workflowId,
      runId,
      principalId,
      keyId,
      authorizationEvidenceRef,
      waitEventSequence,
      idempotencyKey,
      requestFingerprint,
      receipt,
      outboxIntent: {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        runId,
        generation,
        dedupeKey: `workflow-run:${input.workspaceId}:${runId}:v${generation}`,
        state: "pending",
        deliveryToken: null,
        deliveryAttempts: 0,
        availableAt: now,
        claimedAt: null,
        deliveredAt: null,
        createdAt: now,
      },
      resumedAt: now,
      eventId: randomUUID(),
      quotaResumePlan,
    });
    if (result.kind === "conflict") {
      throw new WorkflowRunError("IDEMPOTENCY_CONFLICT", "The idempotency key is already bound.");
    }
    if (result.kind !== "created" && result.kind !== "replayed") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_NOT_RESUMABLE",
        "The Workflow Run could not be resumed safely.",
      );
    }
    return mutationReceiptResult(result);
  }

  async resumeQuotaWait(input: {
    workspaceId: string;
    waitId: string;
    actor: { kind: "human"; userId: string };
    idempotencyKey: string;
  }): Promise<WorkflowRunRecoveryDto> {
    if (!this.quotas) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_NOT_RESUMABLE",
        "Quota capacity cannot be re-evaluated.",
      );
    }
    const idempotencyKey = stableKey(input.idempotencyKey);
    const waits = await this.quotas.listWaits({
      workspaceId: input.workspaceId,
    });
    const wait = waits.find((candidate) => candidate.id === input.waitId);
    if (!wait) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_NOT_RESUMABLE",
        "The durable Quota Wait is unavailable.",
      );
    }
    const run = await this.repository.getById({
      workspaceId: input.workspaceId,
      runId: wait.runId,
    });
    if (!run) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The Workflow Run is unavailable.",
      );
    }
    const events = await this.repository.listEvents({
      workspaceId: input.workspaceId,
      workflowId: run.workflowId,
      runId: run.id,
      afterSequence: 0,
      limit: 100,
    });
    const waitEvent = events?.find(
      (event) => event.type === "run.waiting" && event.data.waitId === wait.id,
    );
    if (!waitEvent) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_NOT_RESUMABLE",
        "The Quota Wait is not bound to this Run lifecycle.",
      );
    }
    const initialEventCursor = this.cursors.seal({
      workspaceId: input.workspaceId,
      principalId: wait.admittedPrincipalId,
      workflowId: run.workflowId,
      runId: run.id,
      afterSequence: 0,
    });
    if (wait.state === "resumed") {
      if (
        wait.resumedBy?.kind !== "human" ||
        wait.resumedBy.userId !== input.actor.userId ||
        wait.resumeIdempotencyKey !== idempotencyKey
      ) {
        throw new WorkflowRunError(
          "IDEMPOTENCY_CONFLICT",
          "The Quota Wait resume is bound to another actor or idempotency key.",
        );
      }
      return workflowRunReceiptResult(run, initialEventCursor) as unknown as WorkflowRunRecoveryDto;
    }
    const now = this.clock.now();
    const quotaResumePlan = await this.quotas.planResumeWait({
      workspaceId: input.workspaceId,
      waitId: wait.id,
      actor: input.actor,
      resumeReason: "manual_resume",
      idempotencyKey,
      recordedAt: now,
    });
    const result = await this.repository.resumeQuotaWait({
      workspaceId: input.workspaceId,
      workflowId: run.workflowId,
      runId: run.id,
      waitEventSequence: waitEvent.sequence,
      quotaResumePlan,
      outboxIntent: {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        runId: run.id,
        generation: run.nextEventSequence,
        dedupeKey: `quota-wait-manual-resume:${wait.id}`,
        state: "pending",
        deliveryToken: null,
        deliveryAttempts: 0,
        availableAt: now,
        claimedAt: null,
        deliveredAt: null,
        createdAt: now,
      },
      resumedAt: now,
      eventId: randomUUID(),
    });
    if (result.kind === "unavailable") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_NOT_RESUMABLE",
        "Quota capacity is not currently available.",
      );
    }
    return workflowRunReceiptResult(result.run, initialEventCursor) as unknown as WorkflowRunRecoveryDto;
  }

  async reconcile(input: {
    workspaceId: string;
    workflowId: string;
    runId: string;
    principalId: string;
    keyId: string;
    authorizationEvidenceRef: string;
    stepAttemptId: string;
    idempotencyKey: string;
  }): Promise<WorkflowRunRecoveryDto> {
    const workflowId = identifier(input.workflowId, "Workflow ID");
    const runId = identifier(input.runId, "Workflow Run ID");
    const principalId = evidence(input.principalId, "Principal");
    const keyId = evidence(input.keyId, "Key");
    const authorizationEvidenceRef = evidence(
      input.authorizationEvidenceRef,
      "Authorization evidence",
    );
    const stepAttemptId = identifier(
      input.stepAttemptId,
      "Workflow Step Attempt ID",
    );
    const idempotencyKey = stableKey(input.idempotencyKey);
    const requestFingerprint = canonicalDigest({
      workflowId,
      runId,
      stepAttemptId,
    });
    const replay = await this.repository.getMutationReceipt({
      workspaceId: input.workspaceId,
      principalId,
      capability: "workflow_runs.reconcile@1",
      idempotencyKey,
    });
    if (replay) {
      if (replay.receipt.requestFingerprint !== requestFingerprint) {
        throw new WorkflowRunError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key is already bound.",
        );
      }
      return mutationReceiptResult(replay);
    }
    const run = await this.repository.get({
      workspaceId: input.workspaceId,
      workflowId,
      runId,
    });
    if (!run) {
      throw new WorkflowRunError("WORKFLOW_RUN_UNAVAILABLE", "The Workflow Run is unavailable.");
    }
    requireRunPrincipal(run, principalId);
    if (run.state !== "outcome_unknown") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_NOT_RESUMABLE",
        "Only a Workflow Run with an unknown provider outcome can be reconciled.",
      );
    }
    const attempts =
      (await this.repository.listStepAttempts({
        workspaceId: input.workspaceId,
        runId,
      })) ?? [];
    const attempt = attempts.find(
      (candidate) =>
        candidate.id === stepAttemptId &&
        candidate.state === "outcome_unknown",
    );
    if (!attempt) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "The unknown Step Attempt is unavailable.",
      );
    }
    const step = run.startSnapshot.definition.steps.find(
      (candidate) => candidate.id === attempt.stepId,
    )!;
    const providerResolution = run.startSnapshot.providerResolutions?.find(
      (candidate) => candidate.stepId === step.id,
    );
    if (!providerResolution) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
        "The Run has no immutable provider resolution for this step.",
      );
    }
    const { stepId: _stepId, ...pinnedResolution } = providerResolution;
    const selectedExecutor = this.executors.getPinned
      ? this.executors.getPinned(
          step.operation.identity,
          step.operation.contractDigest,
          pinnedResolution,
        )
      : this.executors.get(
          step.operation.identity,
          step.operation.contractDigest,
        );
    const executor = matchesPinnedExecutor(
      selectedExecutor,
      step,
      pinnedResolution,
    )
      ? selectedExecutor
      : undefined;
    if (!executor?.reconcile) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_RECONCILIATION_PENDING",
        "The provider adapter cannot yet reconcile this effect.",
      );
    }
    const completedByStep = new Map<string, WorkflowStepAttemptRecord>([
      ...(run.derivation?.reusedOutputs.map((reused) => [
        reused.stepId,
        {
          id: reused.sourceStepAttemptId,
          workspaceId: run.workspaceId,
          runId: reused.sourceRunId,
          stepId: reused.stepId,
          attempt: reused.sourceAttempt,
          state: "completed" as const,
          operationIdentity:
            run.startSnapshot.definition.steps.find(
              (candidate) => candidate.id === reused.stepId,
            )?.operation.identity ?? "",
          operationContractDigest:
            run.startSnapshot.definition.steps.find(
              (candidate) => candidate.id === reused.stepId,
            )?.operation.contractDigest ?? "",
          provider: "derived",
          providerOperation: "reused",
          model: "reused",
          intentDigest: canonicalDigest(reused.outputs),
          effectKey: reused.sourceEffectKey,
          inputs: [],
          outputs: structuredClone(reused.outputs),
          providerOperationRef: reused.sourceProviderOperationRef,
          outcome: {
            kind: "succeeded" as const,
            providerOperationRef: reused.sourceProviderOperationRef,
          },
          reconciliation: null,
          failureCode: null,
          startedAt: run.acceptedAt,
          completedAt: run.acceptedAt,
        } satisfies WorkflowStepAttemptRecord,
      ] as const) ?? []),
      ...attempts
        .filter(
          (candidate) =>
            candidate.state === "completed" && candidate.outputs,
        )
        .map((candidate) => [candidate.stepId, candidate] as const),
    ]);
    const { resolved, lineage } = await this.resolveStepInputs(
      run,
      step,
      completedByStep,
    );
    const providerResult = await executor.reconcile({
      workspaceId: run.workspaceId,
      runId,
      stepAttemptId: attempt.id,
      attempt: attempt.attempt,
      effectKey: attempt.effectKey,
      intentDigest: attempt.intentDigest,
      providerOperationRef: attempt.providerOperationRef,
      snapshot: structuredClone(run.startSnapshot),
      step: structuredClone(step),
      inputs: structuredClone(resolved),
    });
    const priorSucceededProviderOperationRef =
      attempt.outcome?.kind === "outcome_unknown"
        ? attempt.outcome.priorSucceededProviderOperationRef
        : null;
    if (
      priorSucceededProviderOperationRef !== null &&
      (providerResult.kind !== "generated" ||
        providerResult.providerOperationRef !==
          priorSucceededProviderOperationRef)
    ) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_RECONCILIATION_PENDING",
        "Reconciliation cannot contradict durable provider success evidence.",
      );
    }
    if (providerResult.kind === "outcome_unknown") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_RECONCILIATION_PENDING",
        "The provider outcome is still unknown.",
      );
    }
    const now = this.clock.now();
    const reconciliationUsagePlan = this.usage
      ? await this.usage.planProviderReconciliation(
          this.usageInput({
            run,
            attempt,
            metadata: providerResult.providerMetadata ?? null,
            providerOperationRef: providerResult.providerOperationRef,
            outcome:
              providerResult.kind === "failed_known"
                ? "failed_known"
                : "succeeded",
            endedAt: now,
          }),
        )
      : null;
    let reconciliationAttributionPlan: ReturnType<
      UsageSettlementPort["planGeneratedArtifactAttribution"]
    > | null = null;
    let resolution:
      Parameters<WorkflowRunRepository["reconcileStepAttempt"]>[0]["resolution"];
    if (providerResult.kind === "failed_known") {
      const retryable =
        providerResult.retryable &&
        attempt.attempt < step.retry.maxAttempts;
      const retryDelay = retryable
        ? Math.min(
            step.retry.backoff.maxMs,
            Math.round(
              step.retry.backoff.initialMs *
                step.retry.backoff.multiplier **
                  Math.max(0, attempt.attempt - 1),
            ),
          )
        : 0;
      const retryAt = retryable
        ? new Date(now.getTime() + retryDelay)
        : null;
      const generation = run.nextEventSequence;
      resolution = {
        kind: "failed_known",
        providerOperationRef: providerResult.providerOperationRef,
        failureCode: providerResult.failureCode,
        retryable,
        providerMetadata: providerResult.providerMetadata ?? null,
        retryAt,
        outboxIntent: retryable
          ? {
              id: randomUUID(),
              workspaceId: run.workspaceId,
              runId,
              generation,
              dedupeKey: `workflow-run:${run.workspaceId}:${runId}:v${generation}`,
              state: "pending",
              deliveryToken: null,
              deliveryAttempts: 0,
              availableAt: retryAt!,
              claimedAt: null,
              deliveredAt: null,
              createdAt: now,
            }
          : null,
      };
    } else {
      if (!this.artifacts) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
          "Generated Artifact persistence is unavailable.",
        );
      }
      const outputs: Record<string, import("./types").WorkflowRunArtifactReference> = {};
      for (const [outputName, output] of Object.entries(providerResult.outputs).sort(
        ([left], [right]) => compareCodeUnits(left, right),
      )) {
        const digest = bytesDigest(output.bytes);
        let metadata;
        try {
          metadata = await this.artifacts.commitGenerated({
          workspaceId: run.workspaceId,
          creatorPrincipalId: run.startSnapshot.authorization.principalId,
          effectKey: attempt.effectKey,
          outputName,
          content:
            output.kind === "text"
              ? {
                  kind: "text",
                  text: Buffer.from(output.bytes).toString("utf8"),
                  mediaType: output.mediaType,
                  digest,
                  sizeBytes: output.bytes.byteLength,
                }
              : {
                  kind: "image",
                  bytes: output.bytes,
                  mediaType: output.mediaType,
                  digest,
                  sizeBytes: output.bytes.byteLength,
                  width: output.width,
                  height: output.height,
                },
          origin: {
            workflowId: run.workflowId,
            workflowRevisionId: run.workflowRevisionId,
            workflowRevision: run.startSnapshot.workflowRevision,
            definitionDigest: run.startSnapshot.definitionDigest,
            runId: run.id,
            runStartSnapshotDigest: run.startSnapshotDigest,
            stepAttemptId: attempt.id,
            stepId: step.id,
            attempt: attempt.attempt,
            provider: executor.provider,
            operationIdentity: step.operation.identity,
            providerOperation: executor.providerOperation,
            providerOperationRef: providerResult.providerOperationRef,
            model: attempt.model,
            intentDigest: attempt.intentDigest,
            providerMetadata: providerResult.providerMetadata ?? null,
          },
          lineageInputs: lineage.map((item) => ({
            port: item.port,
            kind: item.kind,
            source: item.source,
            contentDigest: item.contentDigest,
            sourceArtifactId: item.artifactId,
          })),
          });
        } catch (error) {
          throw artifactQuotaRunError(error, false) ?? error;
        }
        outputs[outputName] = {
          artifactId: metadata.id,
          digest: metadata.digest,
          kind: metadata.kind,
          mediaType: metadata.mediaType,
          sizeBytes: metadata.sizeBytes,
        };
      }
      const outputArtifacts = Object.entries(outputs);
      if (
        this.usage &&
        outputArtifacts.length === 1
      ) {
        reconciliationAttributionPlan =
          this.usage.planGeneratedArtifactAttribution({
            workspaceId: run.workspaceId,
            principalId: run.startSnapshot.authorization.principalId,
            runId: run.id,
            stepAttemptId: attempt.id,
            effectKey: attempt.effectKey,
            settlementId:
              reconciliationUsagePlan?.settlementId ??
              this.usage.settlementIdFor(
                this.usageInput({
                  run,
                  attempt,
                  metadata: providerResult.providerMetadata ?? null,
                  providerOperationRef: providerResult.providerOperationRef,
                  outcome: "succeeded",
                  endedAt: now,
                }).binding,
              ),
            artifactId: outputArtifacts[0]![1].artifactId,
            outputName: outputArtifacts[0]![0],
            recordedAt: now,
          });
      }
      const completed = {
        ...attempt,
        state: "completed" as const,
        outputs,
        providerOperationRef: providerResult.providerOperationRef,
        providerMetadata: providerResult.providerMetadata ?? null,
      };
      const completedAttempts = [
        ...attempts.filter((candidate) => candidate.state === "completed"),
        completed,
      ].sort(
        (left, right) =>
          run.startSnapshot.definition.steps.findIndex((item) => item.id === left.stepId) -
          run.startSnapshot.definition.steps.findIndex((item) => item.id === right.stepId),
      );
      const final =
        completedAttempts.length === run.startSnapshot.definition.steps.length;
      const finalSnapshot = final
        ? {
            schema: "workflow-run-final-snapshot/v1" as const,
            runId,
            startSnapshotDigest: run.startSnapshotDigest,
            stepAttempts: completedAttempts.map((item) => ({
              stepAttemptId: item.id,
              stepId: item.stepId,
              attempt: item.attempt,
              state: "completed" as const,
              effectKey: item.effectKey,
              outputs: structuredClone(item.outputs ?? {}),
              providerOperationRef: item.providerOperationRef!,
            })),
            outputs: Object.fromEntries(
              Object.entries(run.startSnapshot.definition.outputs).map(([name, output]) => {
                const source = completedAttempts.find(
                  (item) => item.stepId === output.binding.step,
                )?.outputs?.[output.binding.output];
                if (!source) {
                  throw new WorkflowRunError(
                    "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
                    `Workflow output ${name} is unavailable.`,
                  );
                }
                return [name, source];
              }),
            ),
          }
        : null;
      const generation = run.nextEventSequence;
      resolution = {
        kind: "succeeded",
        providerOperationRef: providerResult.providerOperationRef,
        providerMetadata: providerResult.providerMetadata ?? null,
        outputs,
        finalSnapshot,
        finalSnapshotDigest: finalSnapshot ? canonicalDigest(finalSnapshot) : null,
        outboxIntent: finalSnapshot
          ? null
          : {
              id: randomUUID(),
              workspaceId: run.workspaceId,
              runId,
              generation,
              dedupeKey: `workflow-run:${run.workspaceId}:${runId}:v${generation}`,
              state: "pending",
              deliveryToken: null,
              deliveryAttempts: 0,
              availableAt: now,
              claimedAt: null,
              deliveredAt: null,
              createdAt: now,
            },
      };
    }
    const receipt = {
      workspaceId: run.workspaceId,
      principalId,
      keyId,
      authorizationEvidenceRef,
      capability: "workflow_runs.reconcile@1" as const,
      idempotencyKey,
      requestFingerprint,
      runId,
      initialEventCursor: this.cursors.seal({
        workspaceId: run.workspaceId,
        principalId,
        workflowId,
        runId,
        afterSequence: 0,
      }),
      result: null,
      createdAt: now,
    };
    const budgetSettlementPlan = await this.budgetSettlementForUsage({
      plan: reconciliationUsagePlan,
      workspaceId: run.workspaceId,
      settlementId: reconciliationUsagePlan?.settlementId ?? (this.usage
        ? this.usage.settlementIdFor(this.usageInput({
            run,
            attempt,
            metadata: providerResult.providerMetadata ?? null,
            providerOperationRef: providerResult.providerOperationRef,
            outcome: providerResult.kind === "failed_known" ? "failed_known" : "succeeded",
            endedAt: now,
          }).binding)
        : undefined),
      outcome: providerResult.kind === "failed_known" ? "failed_known" : "succeeded",
      runTerminal:
        resolution.kind === "succeeded"
          ? resolution.finalSnapshot !== null
          : !resolution.retryable,
    });
    const quotaTransitionPlans = this.quotas ? await Promise.all([
      this.quotas.planTransition({
        workspaceId: run.workspaceId,
        transitionId: `quota:settle:${attempt.id}:reconciled:v1`,
        subject: { kind: "step_attempt", id: attempt.id },
        outcome: "settle",
        amount: null,
        evidenceRef: providerResult.providerOperationRef ?? attempt.effectKey,
        recordedAt: now,
      }),
      this.quotas.planTransition({
        workspaceId: run.workspaceId,
        transitionId: `quota:release:${run.id}:reconciled:${attempt.id}:v1`,
        subject: { kind: "run", id: run.id },
        outcome: "release",
        amount: null,
        evidenceRef: `reconciliation:${attempt.id}`,
        recordedAt: now,
      }),
    ]) : [];
    const quotaUsageReconciliationPlans =
      await this.usageQuotaReconciliationPlans({
        run,
        attempt,
        usagePlan: reconciliationUsagePlan,
        metadata: providerResult.providerMetadata ?? null,
        recordedAt: now,
      });
    const result = await this.repository.reconcileStepAttempt({
      workspaceId: run.workspaceId,
      workflowId,
      runId,
      principalId,
      keyId,
      authorizationEvidenceRef,
      stepAttemptId: attempt.id,
      requestFingerprint,
      receipt,
      resolution,
      usagePlan: reconciliationUsagePlan,
      usageAttributionPlan: reconciliationAttributionPlan,
      budgetSettlementPlan,
      quotaTransitionPlans,
      quotaUsageReconciliationPlans,
      occurredAt: now,
      eventIds: {
        generated:
          resolution.kind === "succeeded"
            ? Object.keys(resolution.outputs).map(() => randomUUID())
            : [],
        reconciled: randomUUID(),
        attemptCompleted: resolution.kind === "succeeded" ? randomUUID() : null,
        attemptFailed: resolution.kind === "failed_known" ? randomUUID() : null,
        retryScheduled:
          resolution.kind === "failed_known" && resolution.retryable
            ? randomUUID()
            : null,
        runCompleted:
          resolution.kind === "succeeded" && resolution.finalSnapshot
            ? randomUUID()
            : null,
        runFailed:
          resolution.kind === "failed_known" && !resolution.retryable
            ? randomUUID()
            : null,
        runWaiting:
          (resolution.kind === "succeeded" && !resolution.finalSnapshot) ||
          (resolution.kind === "failed_known" && resolution.retryable)
            ? randomUUID()
            : null,
      },
    });
    if (result.kind === "conflict") {
      throw new WorkflowRunError("IDEMPOTENCY_CONFLICT", "The idempotency key is already bound.");
    }
    if (result.kind !== "created" && result.kind !== "replayed") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "The reconciled outcome could not be committed.",
      );
    }
    return mutationReceiptResult(result);
  }

  async listStepAttempts(input: WorkflowRunInspectionActorInput & {
    workspaceId: string;
    workflowId: string;
    runId: string;
  }): Promise<{ items: WorkflowStepAttemptDto[] }> {
    const workflowId = identifier(input.workflowId, "Workflow ID");
    const runId = identifier(input.runId, "Workflow Run ID");
    const run = await this.repository.get({
      workspaceId: input.workspaceId,
      workflowId,
      runId,
    });
    if (!run) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The Workflow Run is unavailable.",
      );
    }
    const viewer = inspectionActor(input);
    if (viewer.enforceCreatorOwnership) {
      requireRunPrincipal(run, viewer.cursorPrincipalId);
    }
    const attempts = await this.repository.listStepAttempts({
      workspaceId: input.workspaceId,
      runId,
    });
    if (!attempts) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "Workflow Step Attempts are unavailable.",
      );
    }
    return { items: attempts.map(attemptDto) };
  }

  async getRunArtifact(input: WorkflowRunInspectionActorInput & {
    workspaceId: string;
    workflowId: string;
    runId: string;
    artifactId: string;
  }) {
    const workflowId = identifier(input.workflowId, "Workflow ID");
    const runId = identifier(input.runId, "Workflow Run ID");
    const artifactId = identifier(input.artifactId, "Artifact ID");
    if (!this.artifacts) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Workflow Run Artifact inspection is unavailable.",
      );
    }
    const run = await this.repository.get({
      workspaceId: input.workspaceId,
      workflowId,
      runId,
    });
    if (!run) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The Workflow Run is unavailable.",
      );
    }
    const viewer = inspectionActor(input);
    if (viewer.enforceCreatorOwnership) {
      requireRunPrincipal(run, viewer.cursorPrincipalId);
    }
    const attempts = await this.repository.listStepAttempts({
      workspaceId: input.workspaceId,
      runId,
    });
    const belongsToRun = (viewer.mayReadInputArtifacts &&
      run.startSnapshot.artifactReferences.some(
        (reference) => reference.artifactId === artifactId,
      )) || attempts?.some((attempt) =>
      Object.values(attempt.outputs ?? {}).some(
        (output) => output.artifactId === artifactId,
      ),
    ) || run.derivation?.reusedOutputs.some((reused) =>
      Object.values(reused.outputs).some(
        (output) => output.artifactId === artifactId,
      ),
    );
    if (!belongsToRun) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The Workflow Run Artifact is unavailable.",
      );
    }
    try {
      return await this.artifacts.getArtifact({
        workspaceId: input.workspaceId,
        artifactId,
      });
    } catch {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The Workflow Run Artifact is unavailable.",
      );
    }
  }

  async listEvents(input: WorkflowRunInspectionActorInput & {
    workspaceId: string;
    workflowId: string;
    runId: string;
    cursor?: string;
  }): Promise<{ items: WorkflowRunEventDto[]; nextCursor: string }> {
    const workflowId = identifier(input.workflowId, "Workflow ID");
    const runId = identifier(input.runId, "Workflow Run ID");
    const viewer = inspectionActor(input);
    const run = await this.repository.get({
      workspaceId: input.workspaceId,
      workflowId,
      runId,
    });
    if (!run) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The Workflow Run is unavailable.",
      );
    }
    if (viewer.enforceCreatorOwnership) {
      requireRunPrincipal(run, viewer.cursorPrincipalId);
    }
    let afterSequence: number;
    try {
      if (!input.cursor) {
        afterSequence = 0;
      } else {
      afterSequence = this.cursors.open({
        cursor: input.cursor,
        workspaceId: input.workspaceId,
        principalId: viewer.cursorPrincipalId,
        workflowId,
        runId,
      });
      }
    } catch {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_INVALID_INPUT",
        "Workflow Run event cursor is invalid or unavailable.",
      );
    }
    const events = await this.repository.listEvents({
      workspaceId: input.workspaceId,
      workflowId,
      runId,
      afterSequence,
      limit: 100,
    });
    if (!events) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The Workflow Run is unavailable.",
      );
    }
    const lastSequence =
      events[events.length - 1]?.sequence ?? afterSequence;
    return {
      items: events.map(eventDto),
      nextCursor: this.cursors.seal({
        workspaceId: input.workspaceId,
        principalId: viewer.cursorPrincipalId,
        workflowId,
        runId,
        afterSequence: lastSequence,
      }),
    };
  }

  async relayNext(): Promise<{ delivered: boolean; runId?: string }> {
    const now = this.clock.now();
    const claimed = await this.repository.claimOutbox({
      now,
      claimExpiresBefore: new Date(now.getTime() - 30_000),
      deliveryToken: randomUUID(),
    });
    if (claimed.kind === "empty") return { delivered: false };
    try {
      await this.queue.schedule({
        workspaceId: claimed.intent.workspaceId,
        runId: claimed.intent.runId,
        dedupeKey: claimed.intent.dedupeKey,
      });
      const marked = await this.repository.markOutboxDelivered({
        intentId: claimed.intent.id,
        deliveryToken: claimed.intent.deliveryToken!,
        deliveredAt: this.clock.now(),
      });
      if (!marked) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_DELIVERY_UNAVAILABLE",
          "Workflow Run delivery ownership was lost.",
        );
      }
      return { delivered: true, runId: claimed.intent.runId };
    } catch (error) {
      await this.repository.releaseOutbox({
        intentId: claimed.intent.id,
        deliveryToken: claimed.intent.deliveryToken!,
        availableAt: this.clock.now(),
      });
      if (error instanceof WorkflowRunError) throw error;
      throw new WorkflowRunError(
        "WORKFLOW_RUN_DELIVERY_UNAVAILABLE",
        "Workflow Run delivery failed.",
      );
    }
  }

  async sweepEligibleQuotaWaits(input: {
    workspaceId: string;
    limit?: number;
  }): Promise<{ eligible: number; enqueued: number }> {
    if (!this.quotas) return { eligible: 0, enqueued: 0 };
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_INVALID_INPUT",
        "Quota Wait sweep limit must be between 1 and 500.",
      );
    }
    const now = this.clock.now();
    const waits = await this.quotas.listEligibleWaits({
      workspaceId: input.workspaceId,
      at: now,
      limit,
    });
    const enqueued = await this.repository.enqueueQuotaWaitResumptions({
      waits,
      enqueuedAt: now,
    });
    return { eligible: waits.length, enqueued };
  }

  async executeOne(input: {
    workspaceId: string;
    runId: string;
    workerId: string;
    leaseMs?: number;
  }): Promise<WorkflowRunDto> {
    const runId = identifier(input.runId, "Workflow Run ID");
    const workerId = identifier(input.workerId, "Worker ID");
    const leaseMs = input.leaseMs ?? 30_000;
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 60_000) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_INVALID_INPUT",
        "Execution lease must be between 1 and 60 seconds.",
      );
    }
    const now = this.clock.now();
    const durableRun = await this.repository.getById({
      workspaceId: input.workspaceId,
      runId,
    });
    if (!durableRun) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The Workflow Run is unavailable.",
      );
    }
    let quotaResumePlan = null;
    let quotaConcurrencyPlan = null;
    let quotaWaitGeneration = 0;
    if (this.quotas) {
      quotaWaitGeneration = durableRun.nextEventSequence;
      const waits = await this.quotas.listWaits({
        workspaceId: input.workspaceId,
        runId,
        state: "waiting",
      });
      if (waits.length > 1) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
          "The Workflow Run has multiple active Quota Waits.",
        );
      }
      const activeWait = waits.sort((left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        left.id.localeCompare(right.id))[0];
      quotaResumePlan = activeWait
        ? await this.quotas.planResumeWait({
            workspaceId: input.workspaceId,
            waitId: activeWait.id,
            actor: { kind: "system" },
            resumeReason: "automatic_capacity_available",
            idempotencyKey: `auto-resume-${activeWait.id}`,
            recordedAt: now,
          })
        : null;
      const heldRunConcurrency = (await this.quotas.listReservations({
        workspaceId: input.workspaceId,
        runId,
        subject: { kind: "run", id: runId },
      })).some((reservation) =>
        reservation.boundary === "run_concurrency" &&
        reservation.state === "held" &&
        reservation.heldAmount !== "0");
      quotaConcurrencyPlan = activeWait?.boundary === "run_concurrency" || heldRunConcurrency
        ? null
        : await this.quotaRunClaim({
            workspaceId: input.workspaceId,
            principalId: durableRun.startSnapshot.authorization.principalId,
            runId,
            boundary: "run_concurrency",
            generation: durableRun.nextEventSequence,
            at: now,
          });
    }
    const acquired = await this.repository.acquireLease({
      workspaceId: input.workspaceId,
      runId,
      workerId,
      now,
      expiresAt: new Date(now.getTime() + leaseMs),
      quotaResumePlan,
      quotaConcurrencyPlan,
      quotaWaitEventId: quotaConcurrencyPlan || quotaResumePlan ? randomUUID() : null,
      quotaWaitOutboxIntent: quotaConcurrencyPlan || quotaResumePlan ? {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        runId,
        generation: quotaWaitGeneration,
        dedupeKey: `workflow-run:${input.workspaceId}:${runId}:v${quotaWaitGeneration}:quota-wait`,
        state: "pending",
        deliveryToken: null,
        deliveryAttempts: 0,
        availableAt: now,
        claimedAt: null,
        deliveredAt: null,
        createdAt: now,
      } : null,
    });
    if (acquired.kind === "completed") return workflowRunDto(acquired.run);
    if (acquired.kind === "busy") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_LEASE_BUSY",
        "Another fenced worker currently owns the Workflow Run.",
      );
    }
    if (acquired.kind === "quota_wait") {
      void emitRunStatusMetric({
        workspaceId: acquired.run.workspaceId,
        canonicalEventId: acquired.wait.id,
        status: "waiting",
        recordedAt: acquired.wait.createdAt,
      });
      void emitQuotaDecisionMetric({
        workspaceId: acquired.run.workspaceId,
        canonicalEventId: acquired.wait.id,
        boundary: acquired.wait.boundary,
        outcome: "wait",
        reasonFamily: "capacity",
        recordedAt: acquired.wait.createdAt,
      });
      return workflowRunDto(acquired.run);
    }
    if (acquired.kind === "unavailable") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The Workflow Run is unavailable.",
      );
    }
    if (durableRun.state === "waiting") {
      void emitQueueWaitMetric({
        workspaceId: acquired.run.workspaceId,
        canonicalEventId: `${acquired.run.id}:${acquired.lease.fence.toString()}`,
        durationMs: Math.max(
          0,
          acquired.lease.acquiredAt.getTime() - durableRun.updatedAt.getTime(),
        ),
        recordedAt: acquired.lease.acquiredAt,
      });
    }
    return this.executeAcquired(acquired.run, acquired.lease);
  }

  private async executeAcquired(
    run: WorkflowRunRecord,
    lease: WorkflowRunExecutionLeaseRecord,
  ): Promise<WorkflowRunDto> {
    if (run.startSnapshot.definition.steps.length > 1) {
      return this.executeGoldenStep(run, lease);
    }
    const step = run.startSnapshot.definition.steps[0];
    let output: Record<string, unknown>;
    try {
      const executor = this.executors.get(
        step.operation.identity,
        step.operation.contractDigest,
      );
      if (!executor) {
        throw new Error("Snapshotted Workflow Operation is not executable.");
      }
      const binding = step.inputs.text;
      const inputName =
        binding?.from === "workflow_input" ? binding.input : undefined;
      const text = run.startSnapshot.inputs.find(
        (candidate) => candidate.name === inputName && candidate.kind === "text",
      )?.value;
      if (typeof text !== "string") {
        throw new Error("Deterministic text input is unavailable.");
      }
      const execution = await this.executeWithLeaseRenewal(lease, () =>
        executor.execute({
          workspaceId: run.workspaceId,
          runId: run.id,
          stepAttemptId: `legacy_${run.id}`,
          attempt: 1,
          effectKey: `workflow-effect:v1:${run.workspaceId}:${run.id}:${step.id}:1`,
          intentDigest: canonicalDigest({ text }),
          snapshot: structuredClone(run.startSnapshot),
          step: structuredClone(step),
          inputs: {
            text: {
              kind: "text",
              contentDigest: bytesDigest(Buffer.from(text, "utf8")),
              artifactId: null,
              textContent: text,
              mediaType: "text/plain; charset=utf-8",
              sizeBytes: Buffer.byteLength(text, "utf8"),
              width: null,
              height: null,
            },
          },
        }),
      );
      if (execution.kind !== "legacy") {
        throw new Error("Legacy executor returned a generated result.");
      }
      output = execution.output;
      canonicalDigest(output);
    } catch {
      const failedAt = this.clock.now();
      const failed = await this.repository.failStep({
        workspaceId: run.workspaceId,
        runId: run.id,
        workerId: lease.workerId,
        token: lease.token,
        fence: lease.fence,
        failureCode: "STEP_EXECUTION_FAILED",
        failedAt,
        runEventId: randomUUID(),
        quotaTransitionPlans: this.quotas ? [await this.quotas.planTransition({
          workspaceId: run.workspaceId,
          transitionId: `quota:release:${run.id}:failed:v1`,
          subject: { kind: "run", id: run.id },
          outcome: "release",
          amount: null,
          evidenceRef: "STEP_EXECUTION_FAILED",
          recordedAt: failedAt,
        })] : [],
      });
      if (failed.kind === "stale_fence") {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_STALE_FENCE",
          "A stale worker cannot fail the Workflow Run.",
        );
      }
      if (failed.kind === "unavailable") {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
          "Workflow Run failure could not be committed.",
        );
      }
      void emitRunStatusMetric({
        workspaceId: failed.run.workspaceId,
        canonicalEventId: failed.run.id,
        status: "failed",
        recordedAt: failed.run.completedAt ?? failedAt,
      });
      return workflowRunDto(failed.run);
    }
    const completedAt = this.clock.now();
    const completed = await this.repository.completeStep({
      workspaceId: run.workspaceId,
      runId: run.id,
      workerId: lease.workerId,
      token: lease.token,
      fence: lease.fence,
      output: structuredClone(output),
      completedAt,
      stepEventId: randomUUID(),
      runEventId: randomUUID(),
      quotaTransitionPlans: this.quotas ? [await this.quotas.planTransition({
        workspaceId: run.workspaceId,
        transitionId: `quota:release:${run.id}:completed:v1`,
        subject: { kind: "run", id: run.id },
        outcome: "release",
        amount: null,
        evidenceRef: `run:${run.id}:completed`,
        recordedAt: completedAt,
      })] : [],
    });
    if (completed.kind === "stale_fence") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_STALE_FENCE",
        "A stale worker cannot complete the Workflow Run.",
      );
    }
    if (completed.kind === "unavailable") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Workflow Run completion could not be committed.",
      );
    }
    void emitRunStatusMetric({
      workspaceId: completed.run.workspaceId,
      canonicalEventId: completed.run.id,
      status: "completed",
      recordedAt: completed.run.completedAt ?? completedAt,
    });
    return workflowRunDto(completed.run);
  }

  private async executeWithLeaseRenewal<T>(
    lease: WorkflowRunExecutionLeaseRecord,
    operation: () => Promise<T>,
  ): Promise<T> {
    const leaseMs = Math.max(
      1_000,
      lease.expiresAt.getTime() - lease.acquiredAt.getTime(),
    );
    const initialRenewalAt = this.clock.now();
    const initialRenewal = await this.repository.renewLease({
      workspaceId: lease.workspaceId,
      runId: lease.runId,
      workerId: lease.workerId,
      token: lease.token,
      fence: lease.fence,
      now: initialRenewalAt,
      expiresAt: new Date(initialRenewalAt.getTime() + leaseMs),
    });
    if (initialRenewal.kind !== "renewed") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_STALE_FENCE",
        "The execution lease could not be renewed before provider contact.",
      );
    }
    const intervalMs = Math.max(250, Math.min(10_000, Math.floor(leaseMs / 3)));
    let renewal: Promise<void> | null = null;
    let lost = false;
    const timer = setInterval(() => {
      if (renewal || lost) return;
      renewal = (async () => {
        const now = this.clock.now();
        const result = await this.repository.renewLease({
          workspaceId: lease.workspaceId,
          runId: lease.runId,
          workerId: lease.workerId,
          token: lease.token,
          fence: lease.fence,
          now,
          expiresAt: new Date(now.getTime() + leaseMs),
        });
        if (result.kind !== "renewed") lost = true;
      })()
        .catch(() => {
          lost = true;
        })
        .finally(() => {
          renewal = null;
        });
    }, intervalMs);
    timer.unref?.();
    try {
      const result = await operation();
      if (renewal) await renewal;
      if (lost) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_STALE_FENCE",
          "The execution lease could not be renewed.",
        );
      }
      return result;
    } finally {
      clearInterval(timer);
    }
  }

  private async executeGoldenStep(
    run: WorkflowRunRecord,
    lease: WorkflowRunExecutionLeaseRecord,
  ): Promise<WorkflowRunDto> {
    if (!this.artifacts) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Generated Artifact persistence is unavailable.",
      );
    }
    const attempts =
      (await this.repository.listStepAttempts({
        workspaceId: run.workspaceId,
        runId: run.id,
      })) ?? [];
    const reusedAttempts: WorkflowStepAttemptRecord[] =
      run.derivation?.reusedOutputs.map((reused) => ({
        id: reused.sourceStepAttemptId,
        workspaceId: run.workspaceId,
        runId: reused.sourceRunId,
        stepId: reused.stepId,
        attempt: reused.sourceAttempt,
        state: "completed",
        operationIdentity:
          run.startSnapshot.definition.steps.find(
            (candidate) => candidate.id === reused.stepId,
          )?.operation.identity ?? "",
        operationContractDigest:
          run.startSnapshot.definition.steps.find(
            (candidate) => candidate.id === reused.stepId,
          )?.operation.contractDigest ?? "",
        provider: "derived",
        providerOperation: "reused",
        model: "reused",
        intentDigest: canonicalDigest(reused.outputs),
        effectKey: reused.sourceEffectKey,
        inputs: [],
        outputs: structuredClone(reused.outputs),
        providerOperationRef: reused.sourceProviderOperationRef,
        outcome: {
          kind: "succeeded",
          providerOperationRef: reused.sourceProviderOperationRef,
        },
        reconciliation: null,
        failureCode: null,
        startedAt: run.acceptedAt,
        completedAt: run.acceptedAt,
      })) ?? [];
    const completedAttempts = [
      ...reusedAttempts,
      ...attempts.filter(
        (attempt) => attempt.state === "completed" && attempt.outputs,
      ),
    ];
    const completedByStep = new Map(
      completedAttempts
        .filter(
          (attempt) => attempt.state === "completed" && attempt.outputs,
        )
        .map((attempt) => [attempt.stepId, attempt]),
    );
    const step = run.startSnapshot.definition.steps.find(
      (candidate) => !completedByStep.has(candidate.id),
    );
    if (!step) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "The Run has no executable step but is not terminal.",
      );
    }
    const providerResolution = run.startSnapshot.providerResolutions?.find(
      (candidate) => candidate.stepId === step.id,
    );
    if (!providerResolution) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
        "Legacy golden Runs without a pinned provider resolution cannot execute.",
      );
    }
    const { stepId: _stepId, ...pinnedResolution } = providerResolution;
    const selectedExecutor = this.executors.getPinned
      ? this.executors.getPinned(
          step.operation.identity,
          step.operation.contractDigest,
          pinnedResolution,
        )
      : this.executors.get(
          step.operation.identity,
          step.operation.contractDigest,
        );
    const executor = matchesPinnedExecutor(
      selectedExecutor,
      step,
      pinnedResolution,
    )
      ? selectedExecutor
      : undefined;
    if (!executor) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
        "A snapshotted golden operation is unavailable.",
      );
    }
    const { resolved, lineage } = await this.resolveStepInputs(
      run,
      step,
      completedByStep,
    );
    const intentDigest = canonicalDigest({
      operationIdentity: step.operation.identity,
      operationContractDigest: step.operation.contractDigest,
      providerResolution,
      config: step.config,
      inputs: Object.fromEntries(
        Object.entries(resolved)
          .sort(([left], [right]) => compareCodeUnits(left, right))
          .map(([port, value]) => [
            port,
            {
              kind: value.kind,
              contentDigest: value.contentDigest,
              artifactId: value.artifactId,
            },
          ]),
      ),
    });
    const previousForStep = attempts
      .filter((attempt) => attempt.stepId === step.id)
      .sort((left, right) => right.attempt - left.attempt)[0];
    const attemptNumber =
      previousForStep?.state === "failed"
        ? previousForStep.attempt + 1
        : previousForStep?.attempt ?? 1;
    const effectKey =
      `workflow-effect:v1:${run.workspaceId}:${run.id}:${step.id}:1`;
    const attemptId = `attempt_${createHash("sha256")
      .update(`${effectKey}:${attemptNumber}`, "utf8")
      .digest("hex")
      .slice(0, 32)}`;
    const now = this.clock.now();
    const candidate: WorkflowStepAttemptRecord = {
      id: attemptId,
      workspaceId: run.workspaceId,
      runId: run.id,
      stepId: step.id,
      attempt: attemptNumber,
      state: "running",
      operationIdentity: step.operation.identity,
      operationContractDigest: step.operation.contractDigest,
      provider: executor.provider,
      providerOperation: executor.providerOperation,
      model: executor.model,
      providerAdapterModule: providerResolution.adapterModule,
      providerAdapterContractDigest:
        providerResolution.adapterContractDigest,
      launchSafety: structuredClone(providerResolution.launchSafety),
      intentDigest,
      effectKey,
      inputs: lineage,
      outputs: null,
      providerOperationRef: null,
      outcome: null,
      providerMetadata: null,
      reconciliation: null,
      failureCode: null,
      startedAt: now,
      completedAt: null,
    };
    const usageQuotaClaims = await this.usageQuotaClaimPlans({
      run,
      attempt: candidate,
      resolution: providerResolution,
      recordedAt: now,
    });
    if (usageQuotaClaims.unavailable) {
      const quotaTransitionPlans = this.quotas ? [await this.quotas.planTransition({
        workspaceId: run.workspaceId,
        transitionId: `quota:release:${run.id}:usage-ceiling-unavailable:${candidate.id}:v1`,
        subject: { kind: "run", id: run.id },
        outcome: "release",
        amount: null,
        evidenceRef: candidate.id,
        recordedAt: now,
      })] : [];
      const failed = await this.repository.failStep({
        workspaceId: run.workspaceId,
        runId: run.id,
        workerId: lease.workerId,
        token: lease.token,
        fence: lease.fence,
        failureCode: USAGE_QUOTA_FAILURE_CODE,
        failedAt: now,
        runEventId: randomUUID(),
        quotaTransitionPlans,
      });
      if (failed.kind !== "completed") {
        throw new WorkflowRunError(
          failed.kind === "stale_fence"
            ? "WORKFLOW_RUN_STALE_FENCE"
            : "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
          "The unbounded provider usage effect could not be blocked durably.",
        );
      }
      return workflowRunDto(failed.run);
    }
    const quotaProviderTransitionKey = `quota:provider_effect:${candidate.id}:v1`;
    const resumedProviderReservation = this.quotas
      ? (await this.quotas.listReservations({
          workspaceId: run.workspaceId,
          runId: run.id,
          subject: { kind: "step_attempt", id: candidate.id },
        })).some((reservation) =>
          reservation.boundary === "provider_effect" &&
          reservation.transitionKey === quotaProviderTransitionKey &&
          reservation.state === "held" &&
          reservation.heldAmount !== "0")
      : false;
    const quotaProviderPlan = this.quotas && !resumedProviderReservation
      ? await this.quotas.planClaim({
          workspaceId: run.workspaceId,
          principalId: run.startSnapshot.authorization.principalId,
          runId: run.id,
          transitionKey: quotaProviderTransitionKey,
          boundary: "provider_effect",
          subject: { kind: "step_attempt", id: candidate.id },
          claims: [{ dimension: "runtime.provider_calls@1", unit: "count", amount: "1" }],
          recordedAt: now,
        })
      : null;
    const quotaWaitReleasePlans = this.quotas ? [
      await this.quotas.planTransition({
        workspaceId: run.workspaceId,
        transitionId: `quota:release:${run.id}:provider-wait:${candidate.id}:v1`,
        subject: { kind: "run", id: run.id },
        outcome: "release",
        amount: null,
        evidenceRef: `provider-quota-wait:${candidate.id}`,
        recordedAt: now,
      }),
    ] : [];
    const prepared = await this.repository.prepareStepAttempt({
      attempt: candidate,
      workerId: lease.workerId,
      token: lease.token,
      fence: lease.fence,
      eventId: randomUUID(),
      budgetAttemptAllocation: this.budgets
        ? {
            schema: "budget-attempt-allocation-input/v1",
            id: `budget_attempt_${canonicalDigest({
              workspaceId: run.workspaceId,
              runId: run.id,
              stepAttemptId: candidate.id,
            }).slice(7, 39)}`,
            workspaceId: run.workspaceId,
            principalId: run.startSnapshot.authorization.principalId,
            runId: run.id,
            stepAttemptId: candidate.id,
            stepId: candidate.stepId,
            attempt: candidate.attempt,
            effectKey: candidate.effectKey,
            credentialEffectRef: credentialEffectRef({
              workspaceId: run.workspaceId,
              effectKey: candidate.effectKey,
              stepAttemptId: candidate.id,
              attempt: candidate.attempt,
            }),
            provider: candidate.provider,
            providerOperation: candidate.providerOperation,
            model: candidate.model,
            recordedAt: now,
          }
        : null,
      quotaClaimPlans: [
        ...usageQuotaClaims.plans,
        ...(quotaProviderPlan ? [quotaProviderPlan] : []),
      ],
      quotaWaitEventId: usageQuotaClaims.plans.length || quotaProviderPlan ? randomUUID() : null,
      quotaWaitOutboxIntent: usageQuotaClaims.plans.length || quotaProviderPlan ? {
        id: randomUUID(),
        workspaceId: run.workspaceId,
        runId: run.id,
        generation: run.nextEventSequence,
        dedupeKey: `workflow-run:${run.workspaceId}:${run.id}:quota-provider:${candidate.id}`,
        state: "pending",
        deliveryToken: null,
        deliveryAttempts: 0,
        availableAt: now,
        claimedAt: null,
        deliveredAt: null,
        createdAt: now,
      } : null,
      quotaWaitReleasePlans,
      quotaPolicyUnavailableEventId: randomUUID(),
    });
    if (prepared.kind === "stale_fence") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_STALE_FENCE",
        "A stale worker cannot launch a provider effect.",
      );
    }
    if (prepared.kind === "conflict") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "The stable Effect Key is bound to another intent.",
      );
    }
    if (prepared.kind === "unavailable") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Workflow Step Attempt preparation could not be committed.",
      );
    }
    if (prepared.kind === "quota_wait") {
      void emitRunStatusMetric({
        workspaceId: prepared.run.workspaceId,
        canonicalEventId: prepared.wait.id,
        status: "waiting",
        recordedAt: prepared.wait.createdAt,
      });
      void emitQuotaDecisionMetric({
        workspaceId: prepared.run.workspaceId,
        canonicalEventId: prepared.wait.id,
        boundary: prepared.wait.boundary,
        outcome: "wait",
        reasonFamily: "capacity",
        recordedAt: prepared.wait.createdAt,
      });
      return workflowRunDto(prepared.run);
    }
    if (prepared.kind === "effect_blocked") {
      void emitQuotaDecisionMetric({
        workspaceId: prepared.run.workspaceId,
        canonicalEventId: candidate.id,
        boundary: prepared.blockedBoundary,
        outcome: "denied",
        reasonFamily: quotaReasonFamily([prepared.reasonCode]),
        recordedAt: now,
      });
      return workflowRunDto(prepared.run);
    }
    const recoveringDurableSuccess =
      prepared.attempt.outcome?.kind === "succeeded";
    const recoveringAmbiguousLaunch =
      prepared.kind === "replayed" &&
      prepared.attempt.outcome === null;
    let execution: Awaited<ReturnType<typeof executor.execute>>;
    try {
      if (recoveringDurableSuccess || recoveringAmbiguousLaunch) {
        if (!executor.reconcile) {
          execution = {
            kind: "outcome_unknown",
            failureCode: "PROVIDER_EFFECT_RECONCILIATION_REQUIRED",
            providerOperationRef: prepared.attempt.providerOperationRef,
          };
        } else {
          execution = parseWorkflowStepExecutionResult(
            await this.executeWithLeaseRenewal(lease, () =>
              executor.reconcile!({
                workspaceId: run.workspaceId,
                runId: run.id,
                stepAttemptId: prepared.attempt.id,
                attempt: prepared.attempt.attempt,
                effectKey: prepared.attempt.effectKey,
                intentDigest: prepared.attempt.intentDigest,
                providerOperationRef: prepared.attempt.providerOperationRef,
                snapshot: structuredClone(run.startSnapshot),
                step: structuredClone(step),
                inputs: structuredClone(resolved),
              }),
            ),
          );
        }
      } else {
        const invocationInputs =
          providerResolution.provider === "gemini"
            ? await this.hydrateStepInputBytes(run.workspaceId, resolved)
            : resolved;
        execution = parseWorkflowStepExecutionResult(
          await this.executeWithLeaseRenewal(lease, () =>
            executor.execute({
              workspaceId: run.workspaceId,
              runId: run.id,
              stepAttemptId: prepared.attempt.id,
              attempt: prepared.attempt.attempt,
              effectKey: prepared.attempt.effectKey,
              intentDigest: prepared.attempt.intentDigest,
              snapshot: structuredClone(run.startSnapshot),
              step: structuredClone(step),
              inputs: structuredClone(invocationInputs),
            }),
          ),
        );
      }
    } catch (error) {
      if (
        error instanceof WorkflowRunError &&
        error.code === "WORKFLOW_RUN_STALE_FENCE"
      ) {
        throw error;
      }
      if (recoveringDurableSuccess || recoveringAmbiguousLaunch) {
        return this.blockGoldenStepAttemptOutcomeUnknown({
          run,
          lease,
          attempt: prepared.attempt,
          failureCode: "PROVIDER_RECONCILIATION_UNAVAILABLE",
          providerOperationRef: prepared.attempt.providerOperationRef,
          providerMetadata: null,
        });
      }
      return this.failGoldenStepAttempt({
        run,
        lease,
        attempt: prepared.attempt,
        failureCode: PROVIDER_FAILURE_CODE,
        providerOperationRef: null,
        retryable: false,
        providerMetadata: null,
      });
    }
    if (recoveringDurableSuccess && execution.kind !== "generated") {
      return this.blockGoldenStepAttemptOutcomeUnknown({
        run,
        lease,
        attempt: prepared.attempt,
        failureCode: "PROVIDER_SUCCESS_OUTPUTS_UNAVAILABLE",
        providerOperationRef: prepared.attempt.providerOperationRef,
        providerMetadata: prepared.attempt.providerMetadata ?? null,
      });
    }
    if (execution.kind === "failed_known") {
      return this.failGoldenStepAttempt({
        run,
        lease,
        attempt: prepared.attempt,
        failureCode: execution.failureCode,
        providerOperationRef: execution.providerOperationRef,
        retryable: execution.retryable,
        providerMetadata: execution.providerMetadata ?? null,
      });
    }
    if (execution.kind === "outcome_unknown") {
      return this.blockGoldenStepAttemptOutcomeUnknown({
        run,
        lease,
        attempt: prepared.attempt,
        failureCode: execution.failureCode,
        providerOperationRef: execution.providerOperationRef,
        providerMetadata: execution.providerMetadata ?? null,
      });
    }
    if (execution.kind !== "generated") {
      return this.failGoldenStepAttempt({
        run,
        lease,
        attempt: prepared.attempt,
        failureCode: PROVIDER_FAILURE_CODE,
        providerOperationRef: null,
        retryable: false,
        providerMetadata: null,
      });
    }
    const providerRecordedAt = this.clock.now();
    const usagePlan = this.usage
      ? recoveringDurableSuccess
        ? await this.usage.planProviderReconciliation(
            this.usageInput({
              run,
              attempt: prepared.attempt,
              metadata: execution.providerMetadata ?? null,
              providerOperationRef: execution.providerOperationRef,
              outcome: "succeeded",
              endedAt: providerRecordedAt,
            }),
          )
        : await this.usage.planProviderOutcome(
          this.usageInput({
            run,
            attempt: prepared.attempt,
            metadata: execution.providerMetadata ?? null,
            providerOperationRef: execution.providerOperationRef,
            outcome: "succeeded",
            endedAt: providerRecordedAt,
          }),
          )
      : null;
    if (!usagePlan && !recoveringDurableSuccess) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Provider usage settlement is unavailable.",
      );
    }
    const providerUsageQuotaReconciliationPlans =
      await this.usageQuotaReconciliationPlans({
        run,
        attempt: prepared.attempt,
        usagePlan,
        metadata: execution.providerMetadata ?? null,
        recordedAt: providerRecordedAt,
      });
    const providerBudgetSettlementPlan = await this.budgetSettlementForUsage({
      plan: usagePlan,
      workspaceId: run.workspaceId,
      settlementId: usagePlan?.settlementId ?? (this.usage
        ? this.usage.settlementIdFor(this.usageInput({
            run,
            attempt: prepared.attempt,
            metadata: execution.providerMetadata ?? null,
            providerOperationRef: execution.providerOperationRef,
            outcome: "succeeded",
            endedAt: providerRecordedAt,
          }).binding)
        : undefined),
      outcome: "succeeded",
      runTerminal:
        completedAttempts.length + 1 ===
        run.startSnapshot.definition.steps.length,
    });
    const providerQuotaTransition = this.quotas
      ? await this.quotas.planTransition({
          workspaceId: run.workspaceId,
          transitionId: `quota:settle:${prepared.attempt.id}:provider-success:v1`,
          subject: { kind: "step_attempt", id: prepared.attempt.id },
          outcome: "settle",
          amount: null,
          evidenceRef: execution.providerOperationRef,
          recordedAt: providerRecordedAt,
        })
      : null;
    const providerRecorded =
      await this.repository.recordStepAttemptProviderSuccess({
        workspaceId: run.workspaceId,
        runId: run.id,
        stepAttemptId: prepared.attempt.id,
        workerId: lease.workerId,
        token: lease.token,
        fence: lease.fence,
        providerOperationRef: execution.providerOperationRef,
        providerMetadata: execution.providerMetadata ?? null,
        usagePlan,
        budgetSettlementPlan: providerBudgetSettlementPlan,
        quotaTransitionPlans: providerQuotaTransition ? [providerQuotaTransition] : [],
        quotaUsageReconciliationPlans: providerUsageQuotaReconciliationPlans,
        recordedAt: providerRecordedAt,
      });
    if (providerRecorded.kind !== "settled") {
      throw new WorkflowRunError(
        providerRecorded.kind === "stale_fence"
          ? "WORKFLOW_RUN_STALE_FENCE"
          : "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Provider success evidence could not be committed.",
      );
    }
    void emitProviderEffectMetric({
      workspaceId: run.workspaceId,
      canonicalEventId: providerRecorded.attempt.id,
      outcome: "succeeded",
      providerFamily: providerFamily(providerRecorded.attempt.provider),
      operationFamily: operationFamily(step.operation.identity),
      recordedAt: providerRecordedAt,
    });
    const durableAttempt = providerRecorded.attempt;
    const outputs: Record<string, import("./types").WorkflowRunArtifactReference> =
      {};
    let usageAttributionPlan: ReturnType<
      UsageSettlementPort["planGeneratedArtifactAttribution"]
    > | null = null;
    try {
      for (const [outputName, output] of Object.entries(
        execution.outputs,
      ).sort(([left], [right]) => compareCodeUnits(left, right))) {
        let content:
          | {
              kind: "text";
              text: string;
              mediaType: string;
              digest: string;
              sizeBytes: number;
            }
          | {
              kind: "image";
              bytes: Uint8Array;
              mediaType: string;
              digest: string;
              sizeBytes: number;
              width: number;
              height: number;
            };
        if (output.kind === "text") {
          const text = Buffer.from(output.bytes).toString("utf8");
          content = {
            kind: "text",
            text,
            mediaType: output.mediaType,
            digest: bytesDigest(output.bytes),
            sizeBytes: output.bytes.byteLength,
          };
        } else {
          content = {
            kind: "image",
            bytes: output.bytes,
            mediaType: output.mediaType,
            digest: bytesDigest(output.bytes),
            sizeBytes: output.bytes.byteLength,
            width: output.width,
            height: output.height,
          };
        }
        const metadata = await this.artifacts.commitGenerated({
          workspaceId: run.workspaceId,
          creatorPrincipalId:
            run.startSnapshot.authorization.principalId,
          effectKey,
          outputName,
          content,
          origin: {
            workflowId: run.workflowId,
            workflowRevisionId: run.workflowRevisionId,
            workflowRevision: run.startSnapshot.workflowRevision,
            definitionDigest: run.startSnapshot.definitionDigest,
            runId: run.id,
            runStartSnapshotDigest: run.startSnapshotDigest,
            stepAttemptId: durableAttempt.id,
            stepId: step.id,
            attempt: durableAttempt.attempt,
            provider: executor.provider,
            operationIdentity: step.operation.identity,
            providerOperation: executor.providerOperation,
            providerOperationRef: execution.providerOperationRef,
            model: durableAttempt.model,
            intentDigest: durableAttempt.intentDigest,
            providerMetadata: execution.providerMetadata ?? null,
          },
          lineageInputs: lineage.map((lineageInput) => ({
            port: lineageInput.port,
            kind: lineageInput.kind,
            source: lineageInput.source,
            contentDigest: lineageInput.contentDigest,
            sourceArtifactId: lineageInput.artifactId,
          })),
        });
        outputs[outputName] = {
          artifactId: metadata.id,
          digest: metadata.digest,
          kind: metadata.kind,
          mediaType: metadata.mediaType,
          sizeBytes: metadata.sizeBytes,
        };
      }
      const outputArtifacts = Object.entries(outputs);
      if (
        this.usage &&
        outputArtifacts.length === 1
      ) {
        const usageBinding = this.usageInput({
          run,
          attempt: prepared.attempt,
          metadata: execution.providerMetadata ?? null,
          providerOperationRef: execution.providerOperationRef,
          outcome: "succeeded",
          endedAt: providerRecordedAt,
        }).binding;
        usageAttributionPlan = this.usage.planGeneratedArtifactAttribution({
          workspaceId: run.workspaceId,
          principalId: run.startSnapshot.authorization.principalId,
          runId: run.id,
          stepAttemptId: prepared.attempt.id,
          effectKey: prepared.attempt.effectKey,
          settlementId:
            usagePlan?.settlementId ??
            this.usage.settlementIdFor(usageBinding),
          artifactId: outputArtifacts[0]![1].artifactId,
          outputName: outputArtifacts[0]![0],
          recordedAt: this.clock.now(),
        });
      }
    } catch (error) {
      const quotaError = artifactQuotaRunError(error, true);
      if (quotaError) throw quotaError;
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        `${ARTIFACT_FAILURE_CODE}: generated Artifact persistence can be resumed with the same Effect Key.`,
      );
    }
    const completedAttempt: WorkflowStepAttemptRecord = {
      ...durableAttempt,
      state: "completed",
      outputs,
      providerOperationRef: execution.providerOperationRef,
      providerMetadata: execution.providerMetadata ?? null,
      outcome: {
        kind: "succeeded",
        providerOperationRef: execution.providerOperationRef,
      },
      completedAt: this.clock.now(),
    };
    const orderedAttempts = [
      ...completedAttempts,
      completedAttempt,
    ].sort(
      (left, right) =>
        run.startSnapshot.definition.steps.findIndex(
          (candidate) => candidate.id === left.stepId,
        ) -
        run.startSnapshot.definition.steps.findIndex(
          (candidate) => candidate.id === right.stepId,
        ),
    );
    const isFinal =
      orderedAttempts.length ===
      run.startSnapshot.definition.steps.length;
    const finalSnapshot = isFinal
      ? {
          schema: "workflow-run-final-snapshot/v1" as const,
          runId: run.id,
          startSnapshotDigest: run.startSnapshotDigest,
          stepAttempts: orderedAttempts.map((attempt) => ({
            stepAttemptId: attempt.id,
            stepId: attempt.stepId,
            attempt: attempt.attempt,
            state: "completed" as const,
            effectKey: attempt.effectKey,
            outputs: structuredClone(attempt.outputs ?? {}),
            providerOperationRef: attempt.providerOperationRef!,
          })),
          outputs: Object.fromEntries(
            Object.entries(run.startSnapshot.definition.outputs).map(
              ([name, output]) => {
                const attempt = orderedAttempts.find(
                  (candidate) =>
                    candidate.stepId === output.binding.step,
                );
                const reference =
                  attempt?.outputs?.[output.binding.output];
                if (!reference) {
                  throw new WorkflowRunError(
                    "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
                    `Workflow output ${name} is unavailable.`,
                  );
                }
                return [name, reference];
              },
            ),
          ),
        }
      : null;
    const settled = await this.repository.settleStepAttempt({
      workspaceId: run.workspaceId,
      runId: run.id,
      stepAttemptId: durableAttempt.id,
      workerId: lease.workerId,
      token: lease.token,
      fence: lease.fence,
      outputs,
      providerOperationRef: execution.providerOperationRef,
      finalSnapshot,
      finalSnapshotDigest: finalSnapshot
        ? canonicalDigest(finalSnapshot)
        : null,
      usageAttributionPlan,
      budgetSettlementPlan: null,
      quotaTransitionPlans: this.quotas ? [
        await this.quotas.planTransition({
          workspaceId: run.workspaceId,
          transitionId: finalSnapshot
            ? `quota:release:${run.id}:completed:v1`
            : `quota:release:${run.id}:step:${durableAttempt.id}:v1`,
          subject: { kind: "run", id: run.id },
          outcome: "release",
          amount: null,
          evidenceRef: finalSnapshot
            ? `final-snapshot:${canonicalDigest(finalSnapshot)}`
            : `step-attempt:${durableAttempt.id}:completed`,
          recordedAt: completedAttempt.completedAt!,
        }),
      ] : [],
      completedAt: completedAttempt.completedAt!,
      eventIds: {
        generated: Object.keys(outputs).map(() => randomUUID()),
        attemptCompleted: randomUUID(),
        runCompleted: finalSnapshot ? randomUUID() : null,
      },
    });
    if (settled.kind === "stale_fence") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_STALE_FENCE",
        "A stale worker cannot settle a provider effect.",
      );
    }
    if (settled.kind === "unavailable") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Workflow Step Attempt settlement could not be committed.",
      );
    }
    if (settled.run.state === "completed") {
      void emitRunStatusMetric({
        workspaceId: settled.run.workspaceId,
        canonicalEventId: settled.run.id,
        status: "completed",
        recordedAt: settled.run.completedAt ?? completedAttempt.completedAt!,
      });
    }
    return workflowRunDto(settled.run);
  }

  private async failGoldenStepAttempt(input: {
    run: WorkflowRunRecord;
    lease: WorkflowRunExecutionLeaseRecord;
    attempt: WorkflowStepAttemptRecord;
    failureCode: string;
    providerOperationRef: string | null;
    retryable: boolean;
    providerMetadata: import("./types").WorkflowStepProviderMetadata | null;
  }): Promise<WorkflowRunDto> {
    const step = input.run.startSnapshot.definition.steps.find(
      (candidate) => candidate.id === input.attempt.stepId,
    )!;
    const canRetry =
      input.retryable &&
      input.attempt.attempt < step.retry.maxAttempts;
    const delay = canRetry
      ? Math.min(
          step.retry.backoff.maxMs,
          Math.round(
            step.retry.backoff.initialMs *
              step.retry.backoff.multiplier **
                Math.max(0, input.attempt.attempt - 1),
          ),
        )
      : 0;
    const failedAt = this.clock.now();
    const retryAt = canRetry
      ? new Date(failedAt.getTime() + delay)
      : null;
    const generation = input.run.nextEventSequence + 1;
    const usagePlan = this.usage
      ? await this.usage.planProviderOutcome(
          this.usageInput({
            run: input.run,
            attempt: input.attempt,
            metadata: input.providerMetadata,
            providerOperationRef: input.providerOperationRef,
            outcome: "failed_known",
            endedAt: failedAt,
          }),
        )
      : null;
    if (!usagePlan) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Provider usage settlement is unavailable.",
      );
    }
    const usageQuotaReconciliationPlans =
      await this.usageQuotaReconciliationPlans({
        run: input.run,
        attempt: input.attempt,
        usagePlan,
        metadata: input.providerMetadata,
        recordedAt: failedAt,
      });
    const budgetSettlementPlan = await this.budgetSettlementForUsage({
      plan: usagePlan,
      outcome: "failed_known",
      runTerminal: !canRetry,
    });
    const quotaTransitionPlans = this.quotas ? await Promise.all([
      this.quotas.planTransition({
        workspaceId: input.run.workspaceId,
        transitionId: `quota:settle:${input.attempt.id}:failed-known:v1`,
        subject: { kind: "step_attempt", id: input.attempt.id },
        outcome: "settle",
        amount: null,
        evidenceRef: input.providerOperationRef ?? input.failureCode,
        recordedAt: failedAt,
      }),
      this.quotas.planTransition({
        workspaceId: input.run.workspaceId,
        transitionId: `quota:release:${input.run.id}:wait-or-failed:${input.attempt.id}:v1`,
        subject: { kind: "run", id: input.run.id },
        outcome: "release",
        amount: null,
        evidenceRef: input.failureCode,
        recordedAt: failedAt,
      }),
    ]) : [];
    const failed = await this.repository.failStepAttempt({
      workspaceId: input.run.workspaceId,
      runId: input.run.id,
      stepAttemptId: input.attempt.id,
      workerId: input.lease.workerId,
      token: input.lease.token,
      fence: input.lease.fence,
      failureCode: input.failureCode,
      providerOperationRef: input.providerOperationRef,
      retryable: input.retryable,
      providerMetadata: input.providerMetadata,
      usagePlan,
      budgetSettlementPlan,
      quotaTransitionPlans,
      quotaUsageReconciliationPlans: usageQuotaReconciliationPlans,
      retryAt,
      retryOutboxIntent: retryAt
        ? {
            id: randomUUID(),
            workspaceId: input.run.workspaceId,
            runId: input.run.id,
            generation,
            dedupeKey: `workflow-run:${input.run.workspaceId}:${input.run.id}:v${generation}`,
            state: "pending",
            deliveryToken: null,
            deliveryAttempts: 0,
            availableAt: retryAt,
            claimedAt: null,
            deliveredAt: null,
            createdAt: failedAt,
          }
        : null,
      failedAt,
      eventIds: {
        attemptFailed: randomUUID(),
        retryScheduled: retryAt ? randomUUID() : null,
        runWaiting: retryAt ? randomUUID() : null,
        runFailed: retryAt ? null : randomUUID(),
      },
    });
    if (failed.kind === "stale_fence") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_STALE_FENCE",
        "A stale worker cannot settle a failed provider effect.",
      );
    }
    if (failed.kind === "unavailable") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Workflow Step Attempt failure could not be committed.",
      );
    }
    void emitProviderEffectMetric({
      workspaceId: input.run.workspaceId,
      canonicalEventId: input.attempt.id,
      outcome: "failed_known",
      providerFamily: providerFamily(input.attempt.provider),
      operationFamily: operationFamily(step.operation.identity),
      recordedAt: failedAt,
    });
    void emitRunStatusMetric({
      workspaceId: failed.run.workspaceId,
      canonicalEventId: `${failed.run.id}:${input.attempt.id}`,
      status: canRetry ? "waiting" : "failed",
      recordedAt: failed.run.completedAt ?? failedAt,
    });
    return workflowRunDto(failed.run);
  }

  private async blockGoldenStepAttemptOutcomeUnknown(input: {
    run: WorkflowRunRecord;
    lease: WorkflowRunExecutionLeaseRecord;
    attempt: WorkflowStepAttemptRecord;
    failureCode: string;
    providerOperationRef: string | null;
    providerMetadata: import("./types").WorkflowStepProviderMetadata | null;
  }): Promise<WorkflowRunDto> {
    const occurredAt = this.clock.now();
    const usagePlan = this.usage
      ? await (input.attempt.outcome?.kind === "succeeded"
        ? this.usage.planProviderReconciliation(
          this.usageInput({
            run: input.run,
            attempt: input.attempt,
            metadata: input.providerMetadata,
            providerOperationRef: input.providerOperationRef,
            outcome: "outcome_unknown",
            endedAt: occurredAt,
          }),
        )
        : this.usage.planProviderOutcome(
          this.usageInput({
            run: input.run,
            attempt: input.attempt,
            metadata: input.providerMetadata,
            providerOperationRef: input.providerOperationRef,
            outcome: "outcome_unknown",
            endedAt: occurredAt,
          }),
        ))
      : null;
    if (!this.usage) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Provider usage settlement is unavailable.",
      );
    }
    const budgetSettlementPlan = await this.budgetSettlementForUsage({
      plan: usagePlan,
      outcome: "outcome_unknown",
      runTerminal: false,
    });
    const quotaUsageReconciliationPlans =
      await this.usageQuotaReconciliationPlans({
        run: input.run,
        attempt: input.attempt,
        usagePlan,
        metadata: input.providerMetadata,
        recordedAt: occurredAt,
      });
    const blocked =
      await this.repository.markStepAttemptOutcomeUnknown({
        workspaceId: input.run.workspaceId,
        runId: input.run.id,
        stepAttemptId: input.attempt.id,
        workerId: input.lease.workerId,
        token: input.lease.token,
        fence: input.lease.fence,
        failureCode: input.failureCode,
      providerOperationRef: input.providerOperationRef,
      providerMetadata: input.providerMetadata,
        usagePlan,
        budgetSettlementPlan,
        quotaTransitionPlans: this.quotas ? [await this.quotas.planTransition({
          workspaceId: input.run.workspaceId,
          transitionId: `quota:release:${input.run.id}:outcome-unknown:${input.attempt.id}:v1`,
          subject: { kind: "run", id: input.run.id },
          outcome: "release",
          amount: null,
          evidenceRef: input.providerOperationRef ?? input.attempt.effectKey,
          recordedAt: occurredAt,
        })] : [],
        quotaUsageReconciliationPlans,
        occurredAt,
        eventIds: {
          attemptOutcomeUnknown: randomUUID(),
          runOutcomeUnknown: randomUUID(),
        },
      });
    if (blocked.kind !== "settled") {
      throw new WorkflowRunError(
        blocked.kind === "stale_fence"
          ? "WORKFLOW_RUN_STALE_FENCE"
          : "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Unknown provider outcome could not be committed.",
      );
    }
    void emitProviderEffectMetric({
      workspaceId: input.run.workspaceId,
      canonicalEventId: input.attempt.id,
      outcome: "outcome_unknown",
      providerFamily: providerFamily(input.attempt.provider),
      operationFamily: operationFamily(input.attempt.providerOperation),
      recordedAt: occurredAt,
    });
    void emitRunStatusMetric({
      workspaceId: blocked.run.workspaceId,
      canonicalEventId: `${blocked.run.id}:${input.attempt.id}`,
      status: "outcome_unknown",
      recordedAt: occurredAt,
    });
    return workflowRunDto(blocked.run);
  }

  private async resolveStepInputs(
    run: WorkflowRunRecord,
    step: WorkflowRunRecord["startSnapshot"]["definition"]["steps"][number],
    completedByStep: Map<string, WorkflowStepAttemptRecord>,
  ): Promise<{
    resolved: Record<string, ResolvedWorkflowStepInput>;
    lineage: WorkflowStepAttemptInput[];
  }> {
    const resolved: Record<string, ResolvedWorkflowStepInput> = {};
    const lineage: WorkflowStepAttemptInput[] = [];
    for (const [port, binding] of Object.entries(step.inputs).sort(
      ([left], [right]) => compareCodeUnits(left, right),
    )) {
      let artifactId: string | null = null;
      let source: WorkflowStepAttemptInput["source"];
      if (binding.from === "workflow_input") {
        const snapshotInput = run.startSnapshot.inputs.find(
          (candidate) => candidate.name === binding.input,
        );
        if (!snapshotInput) {
          throw new WorkflowRunError(
            "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
            `Workflow input ${binding.input} is unavailable.`,
          );
        }
        source = {
          kind: "workflow_input",
          inputName: binding.input,
        };
        if (snapshotInput.kind === "text") {
          const text = snapshotInput.value;
          if (typeof text !== "string") {
            throw new WorkflowRunError(
              "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
              "Snapshotted text input is invalid.",
            );
          }
          const bytes = Buffer.from(text, "utf8");
          resolved[port] = {
            kind: "text",
            contentDigest: bytesDigest(bytes),
            artifactId: null,
            textContent: text,
            mediaType: "text/plain; charset=utf-8",
            sizeBytes: bytes.length,
            width: null,
            height: null,
            source,
          };
        } else {
          artifactId = run.startSnapshot.artifactReferences.find(
            (reference) => reference.inputName === binding.input,
          )?.artifactId ?? null;
        }
      } else {
        const previous = completedByStep.get(binding.step);
        artifactId =
          previous?.outputs?.[binding.output]?.artifactId ?? null;
        source = {
          kind: "step_output",
          runId: previous?.runId ?? run.id,
          stepAttemptId: previous?.id ?? "",
          outputName: binding.output,
        };
      }
      if (artifactId) {
        const found = await this.artifacts!.getArtifact({
          workspaceId: run.workspaceId,
          artifactId,
        });
        resolved[port] = {
          kind: found.artifact.kind,
          contentDigest: found.artifact.digest,
          artifactId,
          textContent: found.textContent,
          mediaType: found.artifact.mediaType,
          sizeBytes: found.artifact.sizeBytes,
          width: found.artifact.width,
          height: found.artifact.height,
          source,
        };
      }
      const value = resolved[port];
      if (!value) {
        throw new WorkflowRunError(
          "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
          `Workflow step input ${port} is unavailable.`,
        );
      }
      lineage.push({
        port,
        kind: value.kind,
        source,
        contentDigest: value.contentDigest,
        artifactId: value.artifactId,
      });
    }
    return { resolved, lineage };
  }

  private async hydrateStepInputBytes(
    workspaceId: string,
    inputs: Record<string, ResolvedWorkflowStepInput>,
  ): Promise<Record<string, ResolvedWorkflowStepInput>> {
    const hydrated = structuredClone(inputs);
    for (const value of Object.values(hydrated)) {
      if (value.kind !== "image" || !value.artifactId) continue;
      if (!this.artifacts?.readArtifactBytes) continue;
      value.bytes = await this.artifacts.readArtifactBytes({
        workspaceId,
        artifactId: value.artifactId,
      });
    }
    return hydrated;
  }
}
