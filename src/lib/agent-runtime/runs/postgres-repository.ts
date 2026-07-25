import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  agentAuthorizationDecisions,
  contentWorkflowRevisions,
  workflowRunEvents,
  workflowRunExecutionLeases,
  workflowRunMutationReceipts,
  workflowRunOutboxIntents,
  workflowRuns,
} from "@/lib/db/schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  CompleteWorkflowRunStepResult,
  WorkflowRunEventRecord,
  WorkflowRunExecutionLeaseRecord,
  WorkflowRunMutationReceiptRecord,
  WorkflowRunOutboxIntentRecord,
  WorkflowRunRecord,
  WorkflowRunRepository,
  WorkflowRunStartSnapshot,
} from "./types";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

function postgresDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("PostgreSQL returned an invalid timestamp.");
  }
  return date;
}

function receiptLock(input: {
  workspaceId: string;
  principalId: string;
  capability: string;
  idempotencyKey: string;
}): string {
  return JSON.stringify([
    input.workspaceId,
    input.principalId,
    input.capability,
    input.idempotencyKey,
  ]);
}

function mapRun(row: typeof workflowRuns.$inferSelect): WorkflowRunRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workflowId: row.workflowId,
    workflowRevisionId: row.workflowRevisionId,
    state: row.state as WorkflowRunRecord["state"],
    startSnapshotDigest: row.startSnapshotDigest,
    startSnapshot: row.startSnapshot as WorkflowRunStartSnapshot,
    nextEventSequence: row.nextEventSequence,
    output: row.output as Record<string, unknown> | null,
    failureCode: row.failureCode,
    acceptedAt: row.acceptedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

function mapEvent(
  row: typeof workflowRunEvents.$inferSelect,
): WorkflowRunEventRecord {
  return {
    ...row,
    type: row.type as WorkflowRunEventRecord["type"],
    data: row.data as Record<string, unknown>,
  };
}

function mapReceipt(
  row: typeof workflowRunMutationReceipts.$inferSelect,
): WorkflowRunMutationReceiptRecord {
  return {
    ...row,
    capability: "workflow_runs.start@1",
  };
}

function mapOutbox(
  row: typeof workflowRunOutboxIntents.$inferSelect,
): WorkflowRunOutboxIntentRecord {
  return {
    ...row,
    state: row.state as WorkflowRunOutboxIntentRecord["state"],
  };
}

function mapLease(
  row: typeof workflowRunExecutionLeases.$inferSelect,
): WorkflowRunExecutionLeaseRecord {
  return row;
}

function validStartInput(
  input: Parameters<WorkflowRunRepository["start"]>[0],
): boolean {
  const { run, firstEvent, receipt, outboxIntent } = input;
  return (
    run.state === "accepted" &&
    run.nextEventSequence === 2 &&
    run.output === null &&
    run.failureCode === null &&
    run.startedAt === null &&
    run.completedAt === null &&
    run.workspaceId === firstEvent.workspaceId &&
    run.id === firstEvent.runId &&
    firstEvent.sequence === 1 &&
    firstEvent.type === "run.accepted" &&
    run.workspaceId === receipt.workspaceId &&
    run.id === receipt.runId &&
    receipt.capability === "workflow_runs.start@1" &&
    run.startSnapshot.workflowId === run.workflowId &&
    run.startSnapshot.workflowRevisionId === run.workflowRevisionId &&
    run.startSnapshot.authorization.principalId === receipt.principalId &&
    run.workspaceId === outboxIntent.workspaceId &&
    run.id === outboxIntent.runId &&
    outboxIntent.dedupeKey ===
      `workflow-run:${run.workspaceId}:${run.id}:v1` &&
    outboxIntent.state === "pending" &&
    outboxIntent.deliveryToken === null &&
    outboxIntent.deliveryAttempts === 0 &&
    outboxIntent.claimedAt === null &&
    outboxIntent.deliveredAt === null
  );
}

async function findRun(
  database: Db | Tx,
  input: { workspaceId: string; workflowId?: string; runId: string },
): Promise<WorkflowRunRecord | null> {
  const rows = await database
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workspaceId, input.workspaceId),
        eq(workflowRuns.id, input.runId),
        ...(input.workflowId
          ? [eq(workflowRuns.workflowId, input.workflowId)]
          : []),
      ),
    )
    .limit(1);
  return rows[0] ? mapRun(rows[0]) : null;
}

export class DrizzleWorkflowRunRepository implements WorkflowRunRepository {
  constructor(private readonly getDatabase: () => Db) {}

  async start(input: Parameters<WorkflowRunRepository["start"]>[0]) {
    try {
      if (
        !validStartInput(input) ||
        canonicalDigest(input.run.startSnapshot) !==
          input.run.startSnapshotDigest
      ) {
        return { kind: "unavailable" as const };
      }
      return await this.getDatabase().transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${receiptLock(input.receipt)}, 0))`,
        );
        const receipts = await tx
          .select()
          .from(workflowRunMutationReceipts)
          .where(
            and(
              eq(
                workflowRunMutationReceipts.workspaceId,
                input.receipt.workspaceId,
              ),
              eq(
                workflowRunMutationReceipts.principalId,
                input.receipt.principalId,
              ),
              eq(
                workflowRunMutationReceipts.capability,
                input.receipt.capability,
              ),
              eq(
                workflowRunMutationReceipts.idempotencyKey,
                input.receipt.idempotencyKey,
              ),
            ),
          )
          .limit(1)
          .for("update");
        const existingReceipt = receipts[0];
        if (existingReceipt) {
          if (
            existingReceipt.requestFingerprint !==
            input.receipt.requestFingerprint
          ) {
            return { kind: "conflict" as const };
          }
          const existingRun = await findRun(tx, {
            workspaceId: existingReceipt.workspaceId,
            runId: existingReceipt.runId,
          });
          return existingRun
            ? {
                kind: "replayed" as const,
                run: existingRun,
                receipt: mapReceipt(existingReceipt),
              }
            : { kind: "unavailable" as const };
        }

        const revisionRows = await tx
          .select({
            revision: contentWorkflowRevisions.revision,
            definitionDigest: contentWorkflowRevisions.definitionDigest,
            definition: contentWorkflowRevisions.definition,
            operationRegistryDigest:
              contentWorkflowRevisions.operationRegistryDigest,
          })
          .from(contentWorkflowRevisions)
          .where(
            and(
              eq(
                contentWorkflowRevisions.workspaceId,
                input.run.workspaceId,
              ),
              eq(
                contentWorkflowRevisions.workflowId,
                input.run.workflowId,
              ),
              eq(
                contentWorkflowRevisions.id,
                input.run.workflowRevisionId,
              ),
            ),
          )
          .limit(1)
          .for("share");
        const revision = revisionRows[0];
        if (
          !revision ||
          revision.revision !== input.run.startSnapshot.workflowRevision ||
          revision.definitionDigest !==
            input.run.startSnapshot.definitionDigest ||
          revision.operationRegistryDigest !==
            input.run.startSnapshot.operationRegistryDigest ||
          canonicalDigest(revision.definition) !== revision.definitionDigest ||
          canonicalDigest(input.run.startSnapshot.definition) !==
            revision.definitionDigest
        ) {
          return { kind: "unavailable" as const };
        }

        const evidenceRows = await tx
          .select({
            resources: agentAuthorizationDecisions.resources,
          })
          .from(agentAuthorizationDecisions)
          .where(
            and(
              eq(
                agentAuthorizationDecisions.workspaceId,
                input.run.workspaceId,
              ),
              eq(
                agentAuthorizationDecisions.principalId,
                input.receipt.principalId,
              ),
              eq(
                agentAuthorizationDecisions.keyId,
                input.run.startSnapshot.authorization.keyId,
              ),
              eq(
                agentAuthorizationDecisions.operatorTraceRef,
                input.run.startSnapshot.authorization.evidenceRef,
              ),
              eq(
                agentAuthorizationDecisions.capabilityName,
                "workflow_runs.start",
              ),
              eq(agentAuthorizationDecisions.capabilityVersion, 1),
              eq(agentAuthorizationDecisions.outcome, "allowed"),
            ),
          )
          .limit(1)
          .for("share");
        const evidence = evidenceRows[0];
        if (
          !evidence ||
          !evidence.resources.some(
            (resource) =>
              resource.kind === "workflow" &&
              resource.id === input.run.workflowId,
          )
        ) {
          return { kind: "unavailable" as const };
        }

        await tx.insert(workflowRuns).values({
          ...input.run,
          principalId: input.receipt.principalId,
          keyId: input.run.startSnapshot.authorization.keyId,
          authorizationEvidenceRef:
            input.run.startSnapshot.authorization.evidenceRef,
        });
        await tx.insert(workflowRunEvents).values(input.firstEvent);
        await tx.insert(workflowRunMutationReceipts).values(input.receipt);
        await tx.insert(workflowRunOutboxIntents).values(input.outboxIntent);
        return {
          kind: "created" as const,
          run: input.run,
          receipt: input.receipt,
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  get(input: Parameters<WorkflowRunRepository["get"]>[0]) {
    return findRun(this.getDatabase(), input);
  }

  async listEvents(
    input: Parameters<WorkflowRunRepository["listEvents"]>[0],
  ) {
    const run = await findRun(this.getDatabase(), {
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      runId: input.runId,
    });
    if (!run) return null;
    const rows = await this.getDatabase()
      .select()
      .from(workflowRunEvents)
      .where(
        and(
          eq(workflowRunEvents.workspaceId, input.workspaceId),
          eq(workflowRunEvents.runId, input.runId),
          sql`${workflowRunEvents.sequence} > ${input.afterSequence}`,
        ),
      )
      .orderBy(asc(workflowRunEvents.sequence))
      .limit(input.limit);
    return rows.map(mapEvent);
  }

  async claimOutbox(
    input: Parameters<WorkflowRunRepository["claimOutbox"]>[0],
  ) {
    return this.getDatabase().transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(workflowRunOutboxIntents)
        .where(
          and(
            lte(workflowRunOutboxIntents.availableAt, input.now),
            or(
              eq(workflowRunOutboxIntents.state, "pending"),
              and(
                eq(workflowRunOutboxIntents.state, "delivering"),
                lte(
                  workflowRunOutboxIntents.claimedAt,
                  input.claimExpiresBefore,
                ),
              ),
            ),
          ),
        )
        .orderBy(
          asc(workflowRunOutboxIntents.createdAt),
          asc(workflowRunOutboxIntents.id),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      const candidate = candidates[0];
      if (!candidate) return { kind: "empty" as const };
      const claimed = await tx
        .update(workflowRunOutboxIntents)
        .set({
          state: "delivering",
          deliveryToken: input.deliveryToken,
          deliveryAttempts: candidate.deliveryAttempts + 1,
          claimedAt: input.now,
        })
        .where(eq(workflowRunOutboxIntents.id, candidate.id))
        .returning();
      return claimed[0]
        ? { kind: "claimed" as const, intent: mapOutbox(claimed[0]) }
        : { kind: "empty" as const };
    });
  }

  async markOutboxDelivered(
    input: Parameters<WorkflowRunRepository["markOutboxDelivered"]>[0],
  ) {
    try {
      const updated = await this.getDatabase()
        .update(workflowRunOutboxIntents)
        .set({
          state: "delivered",
          deliveryToken: null,
          deliveredAt: input.deliveredAt,
        })
        .where(
          and(
            eq(workflowRunOutboxIntents.id, input.intentId),
            eq(workflowRunOutboxIntents.state, "delivering"),
            eq(workflowRunOutboxIntents.deliveryToken, input.deliveryToken),
          ),
        )
        .returning({ id: workflowRunOutboxIntents.id });
      if (updated[0]) return true;
      const existing = await this.getDatabase()
        .select({ state: workflowRunOutboxIntents.state })
        .from(workflowRunOutboxIntents)
        .where(eq(workflowRunOutboxIntents.id, input.intentId))
        .limit(1);
      return existing[0]?.state === "delivered";
    } catch {
      return false;
    }
  }

  async releaseOutbox(
    input: Parameters<WorkflowRunRepository["releaseOutbox"]>[0],
  ) {
    try {
      await this.getDatabase()
        .update(workflowRunOutboxIntents)
        .set({
          state: "pending",
          deliveryToken: null,
          claimedAt: null,
          availableAt: input.availableAt,
        })
        .where(
          and(
            eq(workflowRunOutboxIntents.id, input.intentId),
            eq(workflowRunOutboxIntents.state, "delivering"),
            eq(workflowRunOutboxIntents.deliveryToken, input.deliveryToken),
          ),
        );
    } catch {
      // A lost release is reclaimed after the short delivery claim expires.
    }
  }

  async acquireLease(
    input: Parameters<WorkflowRunRepository["acquireLease"]>[0],
  ) {
    const requestedLeaseMs =
      input.expiresAt.getTime() - input.now.getTime();
    if (
      !Number.isFinite(requestedLeaseMs) ||
      requestedLeaseMs <= 0 ||
      requestedLeaseMs > 60_000
    ) {
      return { kind: "unavailable" as const };
    }
    try {
      return await this.getDatabase().transaction(async (tx) => {
        const rows = await tx
          .select({
            run: workflowRuns,
            databaseNow: sql<unknown>`clock_timestamp()`,
          })
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.workspaceId, input.workspaceId),
              eq(workflowRuns.id, input.runId),
            ),
          )
          .limit(1)
          .for("update");
        const selected = rows[0];
        if (!selected) return { kind: "unavailable" as const };
        const run = mapRun(selected.run);
        const databaseNow = postgresDate(selected.databaseNow);
        if (run.state === "completed" || run.state === "failed") {
          return { kind: "completed" as const, run };
        }

        const leaseRows = await tx
          .select()
          .from(workflowRunExecutionLeases)
          .where(
            and(
              eq(
                workflowRunExecutionLeases.workspaceId,
                input.workspaceId,
              ),
              eq(workflowRunExecutionLeases.runId, input.runId),
            ),
          )
          .limit(1)
          .for("update");
        const existing = leaseRows[0];
        if (
          existing &&
          existing.releasedAt === null &&
          existing.expiresAt > databaseNow
        ) {
          return existing.workerId === input.workerId
            ? {
                kind: "acquired" as const,
                run,
                lease: mapLease(existing),
              }
            : { kind: "busy" as const };
        }

        const lease: WorkflowRunExecutionLeaseRecord = {
          workspaceId: input.workspaceId,
          runId: input.runId,
          fence: (existing?.fence ?? BigInt(0)) + BigInt(1),
          workerId: input.workerId,
          token: randomUUID(),
          acquiredAt: databaseNow,
          expiresAt: new Date(databaseNow.getTime() + requestedLeaseMs),
          releasedAt: null,
        };
        if (existing) {
          await tx
            .update(workflowRunExecutionLeases)
            .set(lease)
            .where(
              and(
                eq(
                  workflowRunExecutionLeases.workspaceId,
                  input.workspaceId,
                ),
                eq(workflowRunExecutionLeases.runId, input.runId),
              ),
            );
        } else {
          await tx.insert(workflowRunExecutionLeases).values(lease);
        }

        let nextRun = run;
        if (run.state === "accepted") {
          const updated = await tx
            .update(workflowRuns)
            .set({
              state: "running",
              startedAt: databaseNow,
              updatedAt: databaseNow,
            })
            .where(
              and(
                eq(workflowRuns.workspaceId, input.workspaceId),
                eq(workflowRuns.id, input.runId),
                eq(workflowRuns.state, "accepted"),
              ),
            )
            .returning();
          if (!updated[0]) return { kind: "unavailable" as const };
          nextRun = mapRun(updated[0]);
        }
        return { kind: "acquired" as const, run: nextRun, lease };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  completeStep(
    input: Parameters<WorkflowRunRepository["completeStep"]>[0],
  ) {
    return this.finish(input, {
      state: "completed",
      output: input.output,
      failureCode: null,
    });
  }

  failStep(input: Parameters<WorkflowRunRepository["failStep"]>[0]) {
    if (!FAILURE_CODE.test(input.failureCode)) {
      return Promise.resolve({ kind: "unavailable" as const });
    }
    return this.finish(input, {
      state: "failed",
      output: null,
      failureCode: input.failureCode,
    });
  }

  private async finish(
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
  ): Promise<CompleteWorkflowRunStepResult> {
    try {
      return await this.getDatabase().transaction(async (tx) => {
        const runRows = await tx
          .select({
            run: workflowRuns,
            databaseNow: sql<unknown>`clock_timestamp()`,
          })
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.workspaceId, input.workspaceId),
              eq(workflowRuns.id, input.runId),
            ),
          )
          .limit(1)
          .for("update");
        const selected = runRows[0];
        if (!selected) return { kind: "unavailable" as const };
        const currentRun = mapRun(selected.run);
        if (
          currentRun.state === "completed" ||
          currentRun.state === "failed"
        ) {
          return { kind: "completed" as const, run: currentRun };
        }
        if (currentRun.state !== "running") {
          return { kind: "unavailable" as const };
        }

        const leaseRows = await tx
          .select()
          .from(workflowRunExecutionLeases)
          .where(
            and(
              eq(
                workflowRunExecutionLeases.workspaceId,
                input.workspaceId,
              ),
              eq(workflowRunExecutionLeases.runId, input.runId),
            ),
          )
          .limit(1)
          .for("update");
        const lease = leaseRows[0];
        if (
          !lease ||
          lease.releasedAt !== null ||
          lease.workerId !== input.workerId ||
          lease.token !== input.token ||
          lease.fence !== input.fence ||
          lease.expiresAt <= postgresDate(selected.databaseNow)
        ) {
          return { kind: "stale_fence" as const };
        }

        const occurredAt = postgresDate(selected.databaseNow);
        const completionEvents: WorkflowRunEventRecord[] =
          completion.state === "completed"
            ? [
                {
                  id: input.stepEventId!,
                  workspaceId: input.workspaceId,
                  runId: input.runId,
                  sequence: currentRun.nextEventSequence,
                  type: "step.completed",
                  data: {
                    stepId:
                      currentRun.startSnapshot.definition.steps[0]?.id ??
                      "unknown",
                    outputDigest: canonicalDigest(completion.output),
                  },
                  occurredAt,
                },
                {
                  id: input.runEventId,
                  workspaceId: input.workspaceId,
                  runId: input.runId,
                  sequence: currentRun.nextEventSequence + 1,
                  type: "run.completed",
                  data: {},
                  occurredAt,
                },
              ]
            : [
                {
                  id: input.runEventId,
                  workspaceId: input.workspaceId,
                  runId: input.runId,
                  sequence: currentRun.nextEventSequence,
                  type: "run.failed",
                  data: { reasonCode: completion.failureCode },
                  occurredAt,
                },
              ];
        await tx.insert(workflowRunEvents).values(completionEvents);
        const updated = await tx
          .update(workflowRuns)
          .set({
            state: completion.state,
            output: completion.output,
            failureCode: completion.failureCode,
            nextEventSequence:
              currentRun.nextEventSequence + completionEvents.length,
            completedAt: occurredAt,
            updatedAt: occurredAt,
          })
          .where(
            and(
              eq(workflowRuns.workspaceId, input.workspaceId),
              eq(workflowRuns.id, input.runId),
              eq(workflowRuns.state, "running"),
            ),
          )
          .returning();
        if (!updated[0]) throw new Error("Workflow Run transition was lost.");
        const released = await tx
          .update(workflowRunExecutionLeases)
          .set({ releasedAt: occurredAt })
          .where(
            and(
              eq(
                workflowRunExecutionLeases.workspaceId,
                input.workspaceId,
              ),
              eq(workflowRunExecutionLeases.runId, input.runId),
              eq(workflowRunExecutionLeases.workerId, input.workerId),
              eq(workflowRunExecutionLeases.token, input.token),
              eq(workflowRunExecutionLeases.fence, input.fence),
              isNull(workflowRunExecutionLeases.releasedAt),
            ),
          )
          .returning({ runId: workflowRunExecutionLeases.runId });
        if (!released[0]) throw new Error("Workflow Run lease release was lost.");
        return { kind: "completed" as const, run: mapRun(updated[0]) };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }
}
