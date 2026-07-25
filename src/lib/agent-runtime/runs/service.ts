import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { WorkflowRunError } from "./errors";
import type {
  WorkflowRunAcceptedDto,
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
  WorkflowStepExecutorRegistry,
} from "./types";

const ID = /^[a-zA-Z0-9_-]{1,200}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,200}$/;
const MAX_INPUT_BYTES = 256 * 1024;
const EXECUTABLE_OPERATION = "runtime.digest_text@1";
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
  }): Promise<WorkflowRunAcceptedDto> {
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
    if (revision.definition.steps.length !== 1) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
        "This runtime slice accepts a Workflow Revision with exactly one step.",
      );
    }
    const step = revision.definition.steps[0];
    if (
      step.operation.identity !== EXECUTABLE_OPERATION ||
      !this.executors.get(
        step.operation.identity,
        step.operation.contractDigest,
      ) ||
      Object.values(revision.definition.inputs).some(
        (definition) => definition.kind !== "text",
      ) ||
      Object.keys(step.credentials).length !== 0
    ) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
        "This runtime slice accepts only the exact deterministic runtime.digest_text@1 contract with text inputs and no credentials.",
      );
    }

    const normalizedInputs = Object.entries(revision.definition.inputs)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .flatMap(([name, definition]) => {
        const value = inputs[name];
        if (definition.required && value === undefined) {
          throw new WorkflowRunError(
            "WORKFLOW_RUN_INVALID_INPUT",
            `Required Workflow input ${name} is missing.`,
          );
        }
        if (value !== undefined && typeof value !== "string") {
          throw new WorkflowRunError(
            "WORKFLOW_RUN_INVALID_INPUT",
            `Workflow input ${name} does not match text.`,
          );
        }
        return value === undefined
          ? []
          : [{ name, kind: "text" as const, value }];
      });
    const unexpected = Object.keys(inputs)
      .filter((name) => !(name in revision.definition.inputs))
      .sort(compareCodeUnits);
    if (unexpected.length > 0) {
      throw new WorkflowRunError(
        "WORKFLOW_RUN_INVALID_INPUT",
        `Workflow input ${unexpected[0]} is not declared.`,
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
      operationContracts: [{
        stepId: step.id,
        identity: step.operation.identity,
        contractDigest: step.operation.contractDigest,
      }],
      artifactReferences: [],
      credentialReferences: [],
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
      operationContractDigest: step.operation.contractDigest,
      inputs: normalizedInputs,
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
        capability: "workflow_runs.start@1",
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
      output = await executor.execute({
        runId: run.id,
        snapshot: structuredClone(run.startSnapshot),
        step: structuredClone(step),
      });
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
}
