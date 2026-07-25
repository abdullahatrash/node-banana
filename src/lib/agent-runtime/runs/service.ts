import { createHash, randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { WorkflowRunError } from "./errors";
import { GOLDEN_WORKFLOW_DEFINITION_DIGEST } from "./fixtures/golden";
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
  WorkflowRunRepository,
  WorkflowRunRevisionReader,
  WorkflowRunStartSnapshot,
  ResolvedWorkflowStepInput,
  WorkflowStepAttemptDto,
  WorkflowStepAttemptInput,
  WorkflowStepAttemptRecord,
  WorkflowStepExecutorRegistry,
} from "./types";

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
const systemClock: WorkflowRunClock = { now: () => new Date() };

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

export function workflowRunDto(run: WorkflowRunRecord): WorkflowRunDto {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    workflowId: run.workflowId,
    workflowRevisionId: run.workflowRevisionId,
    state: run.state,
    startSnapshotDigest: run.startSnapshotDigest,
    startSnapshot: structuredClone(run.startSnapshot),
    output: structuredClone(run.output),
    finalSnapshot: structuredClone(run.finalSnapshot),
    finalSnapshotDigest: run.finalSnapshotDigest,
    failureCode: run.failureCode,
    acceptedAt: run.acceptedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    updatedAt: run.updatedAt.toISOString(),
  };
}

function eventDto(event: {
  id: string;
  runId: string;
  sequence: number;
  type: WorkflowRunEventDto["type"];
  data: Record<string, unknown>;
  occurredAt: Date;
}): WorkflowRunEventDto {
  return {
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    type: event.type,
    data: structuredClone(event.data),
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

export class WorkflowRunService {
  constructor(
    private readonly repository: WorkflowRunRepository,
    private readonly revisions: WorkflowRunRevisionReader,
    private readonly queue: WorkflowRunQueue,
    private readonly executors: WorkflowStepExecutorRegistry,
    private readonly cursors: WorkflowRunEventCursorCodec,
    private readonly clock: WorkflowRunClock = systemClock,
    private readonly artifacts?: WorkflowRunArtifactPort,
  ) {}

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
        (step, index) =>
          step.operation.identity === GOLDEN_OPERATIONS[index],
      ) &&
      Object.values(revision.definition.inputs).filter(
        (definition) => definition.kind === "text",
      ).length === 1 &&
      Object.values(revision.definition.inputs).filter(
        (definition) => definition.kind === "image",
      ).length === 1;
    if (
      (!isLegacy && !isGolden) ||
      steps.some(
        (step) =>
          !this.executors.get(
            step.operation.identity,
            step.operation.contractDigest,
          ),
      )
    ) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
        "This runtime slice accepts the exact deterministic digest or frozen two-step golden Workflow.",
      );
    }
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

    const snapshot: WorkflowRunStartSnapshot = {
      schema: "workflow-run-start-snapshot/v1",
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
    });
    const now = this.clock.now();
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
      failureCode: null,
      acceptedAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    };
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
        capability,
        idempotencyKey,
        requestFingerprint,
        runId,
        initialEventCursor,
        createdAt: now,
      },
      outboxIntent: {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        runId,
        dedupeKey: `workflow-run:${input.workspaceId}:${runId}:v1`,
        state: "pending",
        deliveryToken: null,
        deliveryAttempts: 0,
        availableAt: now,
        claimedAt: null,
        deliveredAt: null,
        createdAt: now,
      },
    });
    if (result.kind === "conflict") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to another Workflow Run.",
      );
    }
    if (result.kind === "unavailable") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
        "Workflow Run acceptance could not be committed.",
      );
    }
    return acceptance(result.run, result.receipt.initialEventCursor);
  }

  async get(input: {
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
    return workflowRunDto(run);
  }

  async listStepAttempts(input: {
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

  async getRunArtifact(input: {
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
    const attempts = await this.repository.listStepAttempts({
      workspaceId: input.workspaceId,
      runId,
    });
    const belongsToRun = attempts?.some((attempt) =>
      Object.values(attempt.outputs ?? {}).some(
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

  async listEvents(input: {
    workspaceId: string;
    principalId: string;
    workflowId: string;
    runId: string;
    cursor: string;
  }): Promise<{ items: WorkflowRunEventDto[]; nextCursor: string }> {
    const workflowId = identifier(input.workflowId, "Workflow ID");
    const runId = identifier(input.runId, "Workflow Run ID");
    let afterSequence: number;
    try {
      afterSequence = this.cursors.open({
        cursor: input.cursor,
        workspaceId: input.workspaceId,
        principalId: input.principalId,
        workflowId,
        runId,
      });
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
        principalId: input.principalId,
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
    const acquired = await this.repository.acquireLease({
      workspaceId: input.workspaceId,
      runId,
      workerId,
      now,
      expiresAt: new Date(now.getTime() + leaseMs),
    });
    if (acquired.kind === "completed") return workflowRunDto(acquired.run);
    if (acquired.kind === "busy") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_LEASE_BUSY",
        "Another fenced worker currently owns the Workflow Run.",
      );
    }
    if (acquired.kind === "unavailable") {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNAVAILABLE",
        "The Workflow Run is unavailable.",
      );
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
      const execution = await executor.execute({
        runId: run.id,
        stepAttemptId: `legacy_${run.id}`,
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
      });
      if (execution.kind !== "legacy") {
        throw new Error("Legacy executor returned a generated result.");
      }
      output = execution.output;
      canonicalDigest(output);
    } catch {
      const failed = await this.repository.failStep({
        workspaceId: run.workspaceId,
        runId: run.id,
        workerId: lease.workerId,
        token: lease.token,
        fence: lease.fence,
        failureCode: "STEP_EXECUTION_FAILED",
        failedAt: this.clock.now(),
        runEventId: randomUUID(),
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
      return workflowRunDto(failed.run);
    }
    const completed = await this.repository.completeStep({
      workspaceId: run.workspaceId,
      runId: run.id,
      workerId: lease.workerId,
      token: lease.token,
      fence: lease.fence,
      output: structuredClone(output),
      completedAt: this.clock.now(),
      stepEventId: randomUUID(),
      runEventId: randomUUID(),
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
    return workflowRunDto(completed.run);
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
    const completedByStep = new Map(
      attempts
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
    const executor = this.executors.get(
      step.operation.identity,
      step.operation.contractDigest,
    );
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
    const effectKey =
      `workflow-effect:v1:${run.workspaceId}:${run.id}:${step.id}:1`;
    const attemptId = `attempt_${createHash("sha256")
      .update(effectKey, "utf8")
      .digest("hex")
      .slice(0, 32)}`;
    const now = this.clock.now();
    const candidate: WorkflowStepAttemptRecord = {
      id: attemptId,
      workspaceId: run.workspaceId,
      runId: run.id,
      stepId: step.id,
      attempt: 1,
      state: "running",
      operationIdentity: step.operation.identity,
      operationContractDigest: step.operation.contractDigest,
      provider: executor.provider,
      providerOperation: executor.providerOperation,
      model: executor.model,
      intentDigest,
      effectKey,
      inputs: lineage,
      outputs: null,
      failureCode: null,
      startedAt: now,
      completedAt: null,
    };
    const prepared = await this.repository.prepareStepAttempt({
      attempt: candidate,
      workerId: lease.workerId,
      token: lease.token,
      fence: lease.fence,
      eventId: randomUUID(),
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
    let execution: Awaited<ReturnType<typeof executor.execute>>;
    try {
      execution = await executor.execute({
        runId: run.id,
        stepAttemptId: prepared.attempt.id,
        effectKey: prepared.attempt.effectKey,
        intentDigest: prepared.attempt.intentDigest,
        snapshot: structuredClone(run.startSnapshot),
        step: structuredClone(step),
        inputs: structuredClone(resolved),
      });
      if (execution.kind !== "generated") {
        throw new Error(
          "The golden provider adapter returned an unsupported result.",
        );
      }
    } catch {
      return this.failGoldenStepAttempt({
        run,
        lease,
        attempt: prepared.attempt,
        failureCode: PROVIDER_FAILURE_CODE,
      });
    }
    const outputs: Record<string, import("./types").WorkflowRunArtifactReference> =
      {};
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
            stepAttemptId: prepared.attempt.id,
            stepId: step.id,
            attempt: prepared.attempt.attempt,
            provider: executor.provider,
            operationIdentity: step.operation.identity,
            providerOperation: executor.providerOperation,
            providerOperationRef: execution.providerOperationRef,
            model: prepared.attempt.model,
            intentDigest: prepared.attempt.intentDigest,
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
    } catch {
      return this.failGoldenStepAttempt({
        run,
        lease,
        attempt: prepared.attempt,
        failureCode: ARTIFACT_FAILURE_CODE,
      });
    }
    const completedAttempt: WorkflowStepAttemptRecord = {
      ...prepared.attempt,
      state: "completed",
      outputs,
      completedAt: this.clock.now(),
    };
    const orderedAttempts = [
      ...attempts.filter((attempt) => attempt.state === "completed"),
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
      stepAttemptId: prepared.attempt.id,
      workerId: lease.workerId,
      token: lease.token,
      fence: lease.fence,
      outputs,
      finalSnapshot,
      finalSnapshotDigest: finalSnapshot
        ? canonicalDigest(finalSnapshot)
        : null,
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
    return workflowRunDto(settled.run);
  }

  private async failGoldenStepAttempt(input: {
    run: WorkflowRunRecord;
    lease: WorkflowRunExecutionLeaseRecord;
    attempt: WorkflowStepAttemptRecord;
    failureCode: string;
  }): Promise<WorkflowRunDto> {
    const failed = await this.repository.failStepAttempt({
      workspaceId: input.run.workspaceId,
      runId: input.run.id,
      stepAttemptId: input.attempt.id,
      workerId: input.lease.workerId,
      token: input.lease.token,
      fence: input.lease.fence,
      failureCode: input.failureCode,
      failedAt: this.clock.now(),
      eventIds: {
        attemptFailed: randomUUID(),
        runFailed: randomUUID(),
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
    return workflowRunDto(failed.run);
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
}
