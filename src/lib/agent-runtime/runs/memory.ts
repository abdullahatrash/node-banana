import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  AcquireWorkflowRunLeaseResult,
  CompleteWorkflowRunStepResult,
  PrepareWorkflowStepAttemptResult,
  SettleWorkflowStepAttemptResult,
  WorkflowRunEventRecord,
  WorkflowRunExecutionLeaseRecord,
  WorkflowRunMutationReceiptRecord,
  WorkflowRunOutboxIntentRecord,
  WorkflowRunQueue,
  WorkflowRunRecord,
  WorkflowRunRepository,
  WorkflowRunRevisionReader,
  WorkflowStepAttemptRecord,
} from "./types";

const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

function compound(...parts: string[]): string {
  return parts.join("\u0000");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryWorkflowRunRepository
  implements WorkflowRunRepository
{
  readonly runs = new Map<string, WorkflowRunRecord>();
  readonly events = new Map<string, WorkflowRunEventRecord[]>();
  readonly receipts = new Map<string, WorkflowRunMutationReceiptRecord>();
  readonly outbox = new Map<string, WorkflowRunOutboxIntentRecord>();
  readonly leases = new Map<string, WorkflowRunExecutionLeaseRecord>();
  readonly stepAttempts = new Map<string, WorkflowStepAttemptRecord>();
  readonly fences = new Map<string, bigint>();
  failNextStart = false;
  failNextFinish = false;

  async start(input: Parameters<WorkflowRunRepository["start"]>[0]) {
    const receiptKey = compound(
      input.receipt.workspaceId,
      input.receipt.principalId,
      input.receipt.capability,
      input.receipt.idempotencyKey,
    );
    const existingReceipt = this.receipts.get(receiptKey);
    if (existingReceipt) {
      if (
        existingReceipt.requestFingerprint !== input.receipt.requestFingerprint
      ) {
        return { kind: "conflict" as const };
      }
      const existingRun = this.runs.get(
        compound(existingReceipt.workspaceId, existingReceipt.runId),
      );
      return existingRun
        ? {
            kind: "replayed" as const,
            run: clone(existingRun),
            receipt: clone(existingReceipt),
          }
        : { kind: "unavailable" as const };
    }
    if (this.failNextStart) {
      this.failNextStart = false;
      return { kind: "unavailable" as const };
    }
    const run = immutable(clone(input.run));
    const event = immutable(clone(input.firstEvent));
    const receipt = immutable(clone(input.receipt));
    const intent = immutable(clone(input.outboxIntent));
    this.runs.set(compound(run.workspaceId, run.id), run);
    this.events.set(compound(run.workspaceId, run.id), [event]);
    this.receipts.set(receiptKey, receipt);
    this.outbox.set(intent.id, intent);
    return {
      kind: "created" as const,
      run: clone(run),
      receipt: clone(receipt),
    };
  }

  async get(input: Parameters<WorkflowRunRepository["get"]>[0]) {
    const run = this.runs.get(compound(input.workspaceId, input.runId));
    return run && run.workflowId === input.workflowId ? clone(run) : null;
  }

  async listEvents(
    input: Parameters<WorkflowRunRepository["listEvents"]>[0],
  ) {
    const run = this.runs.get(compound(input.workspaceId, input.runId));
    if (!run || run.workflowId !== input.workflowId) return null;
    return clone(
      (this.events.get(compound(input.workspaceId, input.runId)) ?? [])
        .filter((event) => event.sequence > input.afterSequence)
        .slice(0, input.limit),
    );
  }

  async claimOutbox(
    input: Parameters<WorkflowRunRepository["claimOutbox"]>[0],
  ) {
    const candidate = [...this.outbox.values()]
      .filter(
        (intent) =>
          intent.availableAt <= input.now &&
          (intent.state === "pending" ||
            (intent.state === "delivering" &&
              intent.claimedAt !== null &&
              intent.claimedAt <= input.claimExpiresBefore)),
      )
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          compareCodeUnits(left.id, right.id),
      )[0];
    if (!candidate) return { kind: "empty" as const };
    const claimed = immutable(
      clone({
        ...candidate,
        state: "delivering" as const,
        deliveryToken: input.deliveryToken,
        deliveryAttempts: candidate.deliveryAttempts + 1,
        claimedAt: input.now,
      }),
    );
    this.outbox.set(candidate.id, claimed);
    return { kind: "claimed" as const, intent: clone(claimed) };
  }

  async markOutboxDelivered(
    input: Parameters<WorkflowRunRepository["markOutboxDelivered"]>[0],
  ) {
    const intent = this.outbox.get(input.intentId);
    if (
      !intent ||
      intent.state === "delivered" ||
      intent.state !== "delivering" ||
      intent.deliveryToken !== input.deliveryToken
    ) {
      return intent?.state === "delivered";
    }
    this.outbox.set(
      intent.id,
      immutable(
        clone({
          ...intent,
          state: "delivered" as const,
          deliveryToken: null,
          deliveredAt: input.deliveredAt,
        }),
      ),
    );
    return true;
  }

  async releaseOutbox(
    input: Parameters<WorkflowRunRepository["releaseOutbox"]>[0],
  ) {
    const intent = this.outbox.get(input.intentId);
    if (
      !intent ||
      intent.state !== "delivering" ||
      intent.deliveryToken !== input.deliveryToken
    ) {
      return;
    }
    this.outbox.set(
      intent.id,
      immutable(
        clone({
          ...intent,
          state: "pending" as const,
          deliveryToken: null,
          claimedAt: null,
          availableAt: input.availableAt,
        }),
      ),
    );
  }

  async acquireLease(
    input: Parameters<WorkflowRunRepository["acquireLease"]>[0],
  ): Promise<AcquireWorkflowRunLeaseResult> {
    const key = compound(input.workspaceId, input.runId);
    const run = this.runs.get(key);
    if (!run) return { kind: "unavailable" };
    if (run.state === "completed" || run.state === "failed") {
      return { kind: "completed", run: clone(run) };
    }
    const existing = this.leases.get(key);
    if (
      existing &&
      existing.releasedAt === null &&
      existing.expiresAt > input.now
    ) {
      if (existing.workerId === input.workerId) {
        return {
          kind: "acquired",
          run: clone(run),
          lease: clone(existing),
        };
      }
      return { kind: "busy" };
    }
    const fence = (this.fences.get(key) ?? BigInt(0)) + BigInt(1);
    const lease = immutable<WorkflowRunExecutionLeaseRecord>({
      workspaceId: input.workspaceId,
      runId: input.runId,
      fence,
      workerId: input.workerId,
      token: randomUUID(),
      acquiredAt: input.now,
      expiresAt: input.expiresAt,
      releasedAt: null,
    });
    this.fences.set(key, fence);
    this.leases.set(key, lease);

    const nextRun =
      run.state === "accepted"
        ? immutable(
            clone({
              ...run,
              state: "running" as const,
              startedAt: input.now,
              updatedAt: input.now,
            }),
          )
        : run;
    if (run.state === "accepted") {
      this.runs.set(key, nextRun);
    }
    return {
      kind: "acquired",
      run: clone(nextRun),
      lease: clone(lease),
    };
  }

  async completeStep(
    input: Parameters<WorkflowRunRepository["completeStep"]>[0],
  ): Promise<CompleteWorkflowRunStepResult> {
    return this.finish(input, {
      state: "completed",
      output: input.output,
      failureCode: null,
    });
  }

  async failStep(
    input: Parameters<WorkflowRunRepository["failStep"]>[0],
  ): Promise<CompleteWorkflowRunStepResult> {
    return this.finish(input, {
      state: "failed",
      output: null,
      failureCode: input.failureCode,
    });
  }

  private finish(
    input: {
      workspaceId: string;
      runId: string;
      workerId: string;
      token: string;
      fence: bigint;
      completedAt?: Date;
      failedAt?: Date;
      stepEventId?: string;
      runEventId: string;
    },
    completion: {
      state: "completed" | "failed";
      output: Record<string, unknown> | null;
      failureCode: string | null;
    },
  ): CompleteWorkflowRunStepResult {
    const at = input.completedAt ?? input.failedAt;
    if (!at) return { kind: "unavailable" };
    const key = compound(input.workspaceId, input.runId);
    const run = this.runs.get(key);
    const lease = this.leases.get(key);
    if (this.failNextFinish) {
      this.failNextFinish = false;
      return { kind: "unavailable" };
    }
    if (!run || run.state !== "running") return { kind: "unavailable" };
    if (
      !lease ||
      lease.releasedAt !== null ||
      lease.workerId !== input.workerId ||
      lease.token !== input.token ||
      lease.fence !== input.fence ||
      lease.expiresAt <= at
    ) {
      return { kind: "stale_fence" };
    }
    const nextRun = immutable(
      clone({
        ...run,
        state: completion.state,
        output: completion.output,
        failureCode: completion.failureCode,
        completedAt: at,
        updatedAt: at,
      }),
    );
    const completionEvents: WorkflowRunEventRecord[] =
      completion.state === "completed"
        ? [
            {
              id: input.stepEventId!,
              workspaceId: input.workspaceId,
              runId: input.runId,
              sequence: run.nextEventSequence,
              type: "step.completed",
              data: {
                stepId: run.startSnapshot.definition.steps[0].id,
                outputDigest: canonicalDigest(completion.output),
              },
              occurredAt: at,
            },
            {
              id: input.runEventId,
              workspaceId: input.workspaceId,
              runId: input.runId,
              sequence: run.nextEventSequence + 1,
              type: "run.completed",
              data: {},
              occurredAt: at,
            },
          ]
        : [
            {
              id: input.runEventId,
              workspaceId: input.workspaceId,
              runId: input.runId,
              sequence: run.nextEventSequence,
              type: "run.failed",
              data: { reasonCode: completion.failureCode },
              occurredAt: at,
            },
          ];
    const nextSequence =
      run.nextEventSequence + completionEvents.length;
    const finalRun = immutable(
      clone({ ...nextRun, nextEventSequence: nextSequence }),
    );
    const released = immutable(
      clone({
        ...lease,
        releasedAt: at,
      }),
    );
    this.runs.set(key, finalRun);
    this.events.set(key, [
      ...(this.events.get(key) ?? []),
      ...completionEvents.map((event) => immutable(event)),
    ]);
    this.leases.set(key, released);
    return { kind: "completed", run: clone(finalRun) };
  }

  async listStepAttempts(
    input: Parameters<WorkflowRunRepository["listStepAttempts"]>[0],
  ): Promise<WorkflowStepAttemptRecord[] | null> {
    const runKey = compound(input.workspaceId, input.runId);
    if (!this.runs.has(runKey)) return null;
    return [...this.stepAttempts.values()]
      .filter(
        (attempt) =>
          attempt.workspaceId === input.workspaceId &&
          attempt.runId === input.runId,
      )
      .sort(
        (left, right) =>
          left.startedAt.getTime() - right.startedAt.getTime() ||
          left.stepId.localeCompare(right.stepId) ||
          left.attempt - right.attempt,
      )
      .map(clone);
  }

  async prepareStepAttempt(
    input: Parameters<WorkflowRunRepository["prepareStepAttempt"]>[0],
  ): Promise<PrepareWorkflowStepAttemptResult> {
    const key = compound(input.attempt.workspaceId, input.attempt.runId);
    const run = this.runs.get(key);
    const lease = this.leases.get(key);
    if (!run || run.state !== "running" || !lease) {
      return { kind: "unavailable" };
    }
    if (
      lease.releasedAt !== null ||
      lease.workerId !== input.workerId ||
      lease.token !== input.token ||
      lease.fence !== input.fence ||
      lease.expiresAt <= input.attempt.startedAt
    ) {
      return { kind: "stale_fence" };
    }
    const attemptKey = compound(
      input.attempt.workspaceId,
      input.attempt.runId,
      input.attempt.stepId,
      String(input.attempt.attempt),
    );
    const existing = this.stepAttempts.get(attemptKey);
    const effectOwner = [...this.stepAttempts.values()].find(
      (attempt) =>
        attempt.workspaceId === input.attempt.workspaceId &&
        attempt.effectKey === input.attempt.effectKey,
    );
    if (existing || effectOwner) {
      const found = existing ?? effectOwner!;
      if (
        found.id !== input.attempt.id ||
        found.effectKey !== input.attempt.effectKey ||
        found.intentDigest !== input.attempt.intentDigest ||
        found.operationContractDigest !==
          input.attempt.operationContractDigest
      ) {
        return { kind: "conflict" };
      }
      return {
        kind: "replayed",
        run: clone(run),
        attempt: clone(found),
      };
    }
    const attempt = immutable(clone(input.attempt));
    const event: WorkflowRunEventRecord = immutable({
      id: input.eventId,
      workspaceId: run.workspaceId,
      runId: run.id,
      sequence: run.nextEventSequence,
      type: "step.attempt.started",
      data: {
        stepAttemptId: attempt.id,
        stepId: attempt.stepId,
        attempt: attempt.attempt,
        effectKey: attempt.effectKey,
        operationIdentity: attempt.operationIdentity,
        intentDigest: attempt.intentDigest,
      },
      occurredAt: attempt.startedAt,
    });
    const nextRun = immutable(
      clone({
        ...run,
        nextEventSequence: run.nextEventSequence + 1,
        updatedAt: attempt.startedAt,
      }),
    );
    this.stepAttempts.set(attemptKey, attempt);
    this.runs.set(key, nextRun);
    this.events.set(key, [...(this.events.get(key) ?? []), event]);
    return {
      kind: "created",
      run: clone(nextRun),
      attempt: clone(attempt),
    };
  }

  async settleStepAttempt(
    input: Parameters<WorkflowRunRepository["settleStepAttempt"]>[0],
  ): Promise<SettleWorkflowStepAttemptResult> {
    const key = compound(input.workspaceId, input.runId);
    const run = this.runs.get(key);
    const lease = this.leases.get(key);
    if (!run || run.state !== "running" || !lease) {
      return { kind: "unavailable" };
    }
    if (
      lease.releasedAt !== null ||
      lease.workerId !== input.workerId ||
      lease.token !== input.token ||
      lease.fence !== input.fence ||
      lease.expiresAt <= input.completedAt
    ) {
      return { kind: "stale_fence" };
    }
    const entry = [...this.stepAttempts.entries()].find(
      ([, attempt]) =>
        attempt.workspaceId === input.workspaceId &&
        attempt.runId === input.runId &&
        attempt.id === input.stepAttemptId,
    );
    if (!entry) return { kind: "unavailable" };
    const [attemptKey, attempt] = entry;
    if (attempt.state === "completed") {
      return {
        kind: "settled",
        run: clone(run),
        attempt: clone(attempt),
      };
    }
    if (attempt.state !== "running") return { kind: "unavailable" };
    if (
      Boolean(input.finalSnapshot) !== Boolean(input.finalSnapshotDigest) ||
      (input.finalSnapshot &&
        canonicalDigest(input.finalSnapshot) !== input.finalSnapshotDigest)
    ) {
      return { kind: "unavailable" };
    }
    const completedAttempt = immutable(
      clone({
        ...attempt,
        state: "completed" as const,
        outputs: input.outputs,
        completedAt: input.completedAt,
      }),
    );
    let sequence = run.nextEventSequence;
    const generatedEvents = Object.entries(input.outputs)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([outputName, output], index) => ({
        id: input.eventIds.generated[index]!,
        workspaceId: input.workspaceId,
        runId: input.runId,
        sequence: sequence++,
        type: "artifact.generated" as const,
        data: {
          stepAttemptId: attempt.id,
          stepId: attempt.stepId,
          outputName,
          artifactId: output.artifactId,
          digest: output.digest,
        },
        occurredAt: input.completedAt,
      }));
    const events: WorkflowRunEventRecord[] = [
      ...generatedEvents,
      {
        id: input.eventIds.attemptCompleted,
        workspaceId: input.workspaceId,
        runId: input.runId,
        sequence: sequence++,
        type: "step.attempt.completed",
        data: {
          stepAttemptId: attempt.id,
          stepId: attempt.stepId,
          attempt: attempt.attempt,
          effectKey: attempt.effectKey,
          outputArtifactIds: Object.values(input.outputs).map(
            (output) => output.artifactId,
          ),
        },
        occurredAt: input.completedAt,
      },
    ];
    if (input.finalSnapshot) {
      events.push({
        id: input.eventIds.runCompleted!,
        workspaceId: input.workspaceId,
        runId: input.runId,
        sequence: sequence++,
        type: "run.completed",
        data: {
          finalSnapshotDigest: input.finalSnapshotDigest,
          outputArtifactIds: Object.values(
            input.finalSnapshot.outputs,
          ).map((output) => output.artifactId),
        },
        occurredAt: input.completedAt,
      });
    }
    const nextRun = immutable(
      clone({
        ...run,
        state: input.finalSnapshot ? ("completed" as const) : run.state,
        output: input.finalSnapshot
          ? structuredClone(input.finalSnapshot.outputs)
          : run.output,
        finalSnapshot: input.finalSnapshot,
        finalSnapshotDigest: input.finalSnapshotDigest,
        nextEventSequence: sequence,
        completedAt: input.finalSnapshot ? input.completedAt : null,
        updatedAt: input.completedAt,
      }),
    );
    this.stepAttempts.set(attemptKey, completedAttempt);
    this.runs.set(key, nextRun);
    this.events.set(key, [
      ...(this.events.get(key) ?? []),
      ...events.map((event) => immutable(event)),
    ]);
    this.leases.set(
      key,
      immutable(clone({ ...lease, releasedAt: input.completedAt })),
    );
    return {
      kind: "settled",
      run: clone(nextRun),
      attempt: clone(completedAttempt),
    };
  }

  async failStepAttempt(
    input: Parameters<WorkflowRunRepository["failStepAttempt"]>[0],
  ): Promise<SettleWorkflowStepAttemptResult> {
    if (!FAILURE_CODE.test(input.failureCode)) {
      return { kind: "unavailable" };
    }
    const key = compound(input.workspaceId, input.runId);
    const run = this.runs.get(key);
    const entry = [...this.stepAttempts.entries()].find(
      ([, attempt]) =>
        attempt.workspaceId === input.workspaceId &&
        attempt.runId === input.runId &&
        attempt.id === input.stepAttemptId,
    );
    if (!run || !entry) return { kind: "unavailable" };
    const [attemptKey, attempt] = entry;
    if (
      attempt.state === "failed" &&
      run.state === "failed" &&
      attempt.failureCode === input.failureCode &&
      run.failureCode === input.failureCode
    ) {
      return {
        kind: "settled",
        run: clone(run),
        attempt: clone(attempt),
      };
    }
    const lease = this.leases.get(key);
    if (
      run.state !== "running" ||
      attempt.state !== "running" ||
      !lease
    ) {
      return { kind: "unavailable" };
    }
    if (
      lease.releasedAt !== null ||
      lease.workerId !== input.workerId ||
      lease.token !== input.token ||
      lease.fence !== input.fence ||
      lease.expiresAt <= input.failedAt
    ) {
      return { kind: "stale_fence" };
    }
    const failedAttempt = immutable(
      clone({
        ...attempt,
        state: "failed" as const,
        outputs: null,
        failureCode: input.failureCode,
        completedAt: input.failedAt,
      }),
    );
    const events: WorkflowRunEventRecord[] = [
      {
        id: input.eventIds.attemptFailed,
        workspaceId: input.workspaceId,
        runId: input.runId,
        sequence: run.nextEventSequence,
        type: "step.attempt.failed",
        data: {
          stepAttemptId: attempt.id,
          stepId: attempt.stepId,
          attempt: attempt.attempt,
          effectKey: attempt.effectKey,
          reasonCode: input.failureCode,
        },
        occurredAt: input.failedAt,
      },
      {
        id: input.eventIds.runFailed,
        workspaceId: input.workspaceId,
        runId: input.runId,
        sequence: run.nextEventSequence + 1,
        type: "run.failed",
        data: {
          stepAttemptId: attempt.id,
          reasonCode: input.failureCode,
        },
        occurredAt: input.failedAt,
      },
    ];
    const failedRun = immutable(
      clone({
        ...run,
        state: "failed" as const,
        output: null,
        finalSnapshot: null,
        finalSnapshotDigest: null,
        failureCode: input.failureCode,
        nextEventSequence: run.nextEventSequence + events.length,
        completedAt: input.failedAt,
        updatedAt: input.failedAt,
      }),
    );
    this.stepAttempts.set(attemptKey, failedAttempt);
    this.runs.set(key, failedRun);
    this.events.set(key, [
      ...(this.events.get(key) ?? []),
      ...events.map((event) => immutable(event)),
    ]);
    this.leases.set(
      key,
      immutable(clone({ ...lease, releasedAt: input.failedAt })),
    );
    return {
      kind: "settled",
      run: clone(failedRun),
      attempt: clone(failedAttempt),
    };
  }
}

export class InMemoryWorkflowRunRevisionReader
  implements WorkflowRunRevisionReader
{
  readonly revisions = new Map<
    string,
    Awaited<ReturnType<WorkflowRunRevisionReader["getRevision"]>>
  >();

  put(
    workspaceId: string,
    revision: NonNullable<
      Awaited<ReturnType<WorkflowRunRevisionReader["getRevision"]>>
    >,
  ): void {
    this.revisions.set(compound(workspaceId, revision.id), clone(revision));
  }

  async getRevision(
    input: Parameters<WorkflowRunRevisionReader["getRevision"]>[0],
  ) {
    const found = this.revisions.get(compound(input.workspaceId, input.revisionId));
    return found?.workflowId === input.workflowId ? clone(found) : null;
  }
}

export class InMemoryWorkflowRunQueue implements WorkflowRunQueue {
  readonly scheduled = new Map<string, { workspaceId: string; runId: string }>();
  failNext = false;

  async schedule(input: Parameters<WorkflowRunQueue["schedule"]>[0]) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("queue unavailable");
    }
    this.scheduled.set(input.dedupeKey, {
      workspaceId: input.workspaceId,
      runId: input.runId,
    });
  }
}
