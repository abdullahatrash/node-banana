import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  AcquireWorkflowRunLeaseResult,
  CompleteWorkflowRunStepResult,
  WorkflowRunEventRecord,
  WorkflowRunExecutionLeaseRecord,
  WorkflowRunMutationReceiptRecord,
  WorkflowRunOutboxIntentRecord,
  WorkflowRunQueue,
  WorkflowRunRecord,
  WorkflowRunRepository,
  WorkflowRunRevisionReader,
} from "./types";

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
