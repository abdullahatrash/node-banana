import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
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
  workflowStepAttempts,
} from "@/lib/db/schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  UsageAttributionAppendPlan,
  UsageCommitWriter,
  UsageLedgerAppendPlan,
} from "../usage/types";
import { workflowRunReceiptResult } from "./types";
import type {
  CompleteWorkflowRunStepResult,
  PrepareWorkflowStepAttemptResult,
  SettleWorkflowStepAttemptResult,
  WorkflowRunEventRecord,
  WorkflowRunExecutionLeaseRecord,
  WorkflowRunFinalSnapshot,
  WorkflowRunMutationReceiptRecord,
  WorkflowRunOutboxIntentRecord,
  WorkflowRunRecord,
  WorkflowRunRepository,
  WorkflowRunStartSnapshot,
  WorkflowStepAttemptRecord,
} from "./types";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function postgresDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("PostgreSQL returned an invalid timestamp.");
  }
  return date;
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  try {
    return canonicalDigest(left) === canonicalDigest(right);
  } catch {
    return false;
  }
}

function validPreparedAttempt(
  attempt: WorkflowStepAttemptRecord,
  run: WorkflowRunRecord,
): boolean {
  const step = run.startSnapshot.definition.steps.find(
    (candidate) => candidate.id === attempt.stepId,
  );
  return (
    attempt.workspaceId === run.workspaceId &&
    attempt.runId === run.id &&
    Number.isInteger(attempt.attempt) &&
    attempt.attempt > 0 &&
    attempt.state === "running" &&
    attempt.outputs === null &&
    attempt.failureCode === null &&
    attempt.completedAt === null &&
    Boolean(step) &&
    step!.operation.identity === attempt.operationIdentity &&
    step!.operation.contractDigest === attempt.operationContractDigest
  );
}

function sameAttemptIntent(
  existing: WorkflowStepAttemptRecord,
  candidate: WorkflowStepAttemptRecord,
): boolean {
  return (
    existing.id === candidate.id &&
    existing.workspaceId === candidate.workspaceId &&
    existing.runId === candidate.runId &&
    existing.stepId === candidate.stepId &&
    existing.attempt === candidate.attempt &&
    existing.operationIdentity === candidate.operationIdentity &&
    existing.operationContractDigest ===
      candidate.operationContractDigest &&
    existing.provider === candidate.provider &&
    existing.providerOperation === candidate.providerOperation &&
    existing.model === candidate.model &&
    existing.intentDigest === candidate.intentDigest &&
    existing.effectKey === candidate.effectKey &&
    sameCanonicalValue(existing.inputs, candidate.inputs)
  );
}

function validFinalSnapshot(
  snapshot: WorkflowRunFinalSnapshot | null,
  digest: string | null,
  run: WorkflowRunRecord,
  attempt: WorkflowStepAttemptRecord,
  outputs: WorkflowStepAttemptRecord["outputs"],
  providerOperationRef: string,
  persistedAttempts: WorkflowStepAttemptRecord[],
): boolean {
  if (Boolean(snapshot) !== Boolean(digest)) return false;
  if (!snapshot) return true;
  if (
    snapshot.runId !== run.id ||
    snapshot.startSnapshotDigest !== run.startSnapshotDigest ||
    canonicalDigest(snapshot) !== digest
  ) {
    return false;
  }
  if (
    snapshot.stepAttempts.length !==
    run.startSnapshot.definition.steps.length
  ) {
    return false;
  }
  const effectiveAttempts = persistedAttempts.map((candidate) =>
    candidate.id === attempt.id
      ? {
          ...candidate,
          state: "completed" as const,
          outputs,
          providerOperationRef,
        }
      : candidate,
  );
  for (
    let index = 0;
    index < run.startSnapshot.definition.steps.length;
    index += 1
  ) {
    const workflowStep = run.startSnapshot.definition.steps[index]!;
    const snapshottedAttempt = snapshot.stepAttempts[index];
    if (
      !snapshottedAttempt ||
      snapshottedAttempt.stepId !== workflowStep.id ||
      snapshottedAttempt.state !== "completed"
    ) {
      return false;
    }
    const persisted = effectiveAttempts.find(
      (candidate) =>
        candidate.id === snapshottedAttempt.stepAttemptId &&
        candidate.stepId === workflowStep.id,
    );
    if (
      !persisted ||
      persisted.state !== "completed" ||
      persisted.attempt !== snapshottedAttempt.attempt ||
      persisted.effectKey !== snapshottedAttempt.effectKey ||
      persisted.providerOperationRef !==
        snapshottedAttempt.providerOperationRef ||
      !sameCanonicalValue(
        persisted.outputs,
        snapshottedAttempt.outputs,
      )
    ) {
      return false;
    }
  }
  const declaredOutputNames = Object.keys(
    run.startSnapshot.definition.outputs,
  ).sort(compareCodeUnits);
  const snapshotOutputNames = Object.keys(snapshot.outputs).sort(
    compareCodeUnits,
  );
  if (
    !sameCanonicalValue(declaredOutputNames, snapshotOutputNames)
  ) {
    return false;
  }
  return declaredOutputNames.every((outputName) => {
    const binding =
      run.startSnapshot.definition.outputs[outputName]!.binding;
    const sourceAttempt = snapshot.stepAttempts.find(
      (candidate) => candidate.stepId === binding.step,
    );
    return (
      Boolean(sourceAttempt) &&
      sameCanonicalValue(
        sourceAttempt!.outputs[binding.output],
        snapshot.outputs[outputName],
      )
    );
  });
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
    finalSnapshot:
      row.finalSnapshot as WorkflowRunFinalSnapshot | null,
    finalSnapshotDigest: row.finalSnapshotDigest,
    derivation: row.derivation,
    resumeAt: row.resumeAt,
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
    capability:
      row.capability as WorkflowRunMutationReceiptRecord["capability"],
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

function mapStepAttempt(
  row: typeof workflowStepAttempts.$inferSelect,
): WorkflowStepAttemptRecord {
  return {
    ...row,
    providerAdapterModule: row.providerAdapterModule ?? undefined,
    providerAdapterContractDigest:
      row.providerAdapterContractDigest ?? undefined,
    launchSafety: row.launchSafety ?? undefined,
    providerMetadata: row.providerMetadata ?? undefined,
    state: row.state as WorkflowStepAttemptRecord["state"],
    inputs: row.inputs as WorkflowStepAttemptRecord["inputs"],
    outputs:
      row.outputs as WorkflowStepAttemptRecord["outputs"],
  };
}

function capabilityVersion(
  capability: WorkflowRunMutationReceiptRecord["capability"],
): 1 | 2 {
  return capability === "workflow_runs.start@2" ? 2 : 1;
}

function validStartInput(
  input: Parameters<WorkflowRunRepository["start"]>[0],
): boolean {
  const { run, firstEvent, receipt, outboxIntent } = input;
  return (
    run.state === "accepted" &&
    run.nextEventSequence === 2 &&
    run.output === null &&
    run.finalSnapshot === null &&
    run.finalSnapshotDigest === null &&
    run.derivation === null &&
    run.resumeAt === null &&
    run.failureCode === null &&
    run.startedAt === null &&
    run.completedAt === null &&
    run.workspaceId === firstEvent.workspaceId &&
    run.id === firstEvent.runId &&
    firstEvent.sequence === 1 &&
    firstEvent.type === "run.accepted" &&
    run.workspaceId === receipt.workspaceId &&
    run.id === receipt.runId &&
    (receipt.capability === "workflow_runs.start@1" ||
      receipt.capability === "workflow_runs.start@2") &&
    receipt.result === null &&
    run.startSnapshot.workflowId === run.workflowId &&
    run.startSnapshot.workflowRevisionId === run.workflowRevisionId &&
    run.startSnapshot.authorization.principalId === receipt.principalId &&
    run.workspaceId === outboxIntent.workspaceId &&
    run.id === outboxIntent.runId &&
    outboxIntent.dedupeKey ===
      `workflow-run:${run.workspaceId}:${run.id}:v1` &&
    outboxIntent.generation === 1 &&
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
  constructor(
    private readonly getDatabase: () => Db,
    private readonly usageWriter?: UsageCommitWriter<Tx>,
  ) {}

  private async appendUsage(
    tx: Tx,
    plan: UsageLedgerAppendPlan | null | undefined,
    attempt: WorkflowStepAttemptRecord,
  ): Promise<void> {
    if (!plan) return;
    const records = plan.records;
    if (
      !this.usageWriter ||
      records.length === 0 ||
      records.some(
        (record) =>
          record.settlementId !== plan.settlementId ||
          record.binding.workspaceId !== attempt.workspaceId ||
          record.binding.runId !== attempt.runId ||
          record.binding.stepAttemptId !== attempt.id ||
          record.binding.effectKey !== attempt.effectKey,
      )
    ) {
      throw new Error("Usage append plan is unavailable or does not match the Step Attempt.");
    }
    const result = await this.usageWriter.appendPlan(plan, tx);
    if (result === "conflict") throw new Error("Usage append plan conflicts.");
  }

  private async appendUsageAttribution(
    tx: Tx,
    plan: UsageAttributionAppendPlan | null | undefined,
    attempt: WorkflowStepAttemptRecord,
  ): Promise<void> {
    if (!plan) return;
    if (
      !this.usageWriter ||
      plan.event.workspaceId !== attempt.workspaceId ||
      plan.event.runId !== attempt.runId ||
      plan.event.stepAttemptId !== attempt.id ||
      plan.event.effectKey !== attempt.effectKey
    ) {
      throw new Error("Usage attribution plan does not match the Step Attempt.");
    }
    const result = await this.usageWriter.appendAttributionPlan(plan, tx);
    if (result !== "created" && result !== "replayed") {
      throw new Error("Usage attribution append failed.");
    }
  }

  async getMutationReceipt(
    input: Parameters<WorkflowRunRepository["getMutationReceipt"]>[0],
  ) {
    const database = this.getDatabase();
    const rows = await database
      .select()
      .from(workflowRunMutationReceipts)
      .where(
        and(
          eq(workflowRunMutationReceipts.workspaceId, input.workspaceId),
          eq(workflowRunMutationReceipts.principalId, input.principalId),
          eq(workflowRunMutationReceipts.capability, input.capability),
          eq(workflowRunMutationReceipts.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    const receipt = rows[0] ? mapReceipt(rows[0]) : null;
    const run = receipt
      ? await findRun(database, {
          workspaceId: receipt.workspaceId,
          runId: receipt.runId,
        })
      : null;
    return receipt && run ? { receipt, run } : null;
  }

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
              eq(
                agentAuthorizationDecisions.capabilityVersion,
                capabilityVersion(input.receipt.capability),
              ),
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
        if (run.state === "outcome_unknown") {
          return { kind: "unavailable" as const };
        }
        if (
          run.state === "waiting" &&
          run.resumeAt !== null &&
          run.resumeAt > databaseNow
        ) {
          return { kind: "busy" as const };
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
        if (run.state === "accepted" || run.state === "waiting") {
          const shouldResume = run.state === "waiting";
          if (shouldResume) {
            await tx.insert(workflowRunEvents).values({
              id: randomUUID(),
              workspaceId: run.workspaceId,
              runId: run.id,
              sequence: run.nextEventSequence,
              type: "run.resumed",
              data: { automatic: true },
              occurredAt: databaseNow,
            });
          }
          const updated = await tx
            .update(workflowRuns)
            .set({
              state: "running",
              startedAt: run.startedAt ?? databaseNow,
              resumeAt: null,
              failureCode: shouldResume ? null : run.failureCode,
              nextEventSequence:
                run.nextEventSequence + (shouldResume ? 1 : 0),
              updatedAt: databaseNow,
            })
            .where(
              and(
                eq(workflowRuns.workspaceId, input.workspaceId),
                eq(workflowRuns.id, input.runId),
                eq(workflowRuns.state, run.state),
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

  async renewLease(
    input: Parameters<WorkflowRunRepository["renewLease"]>[0],
  ): Promise<
    | { kind: "renewed"; lease: WorkflowRunExecutionLeaseRecord }
    | { kind: "stale_fence" | "unavailable" }
  > {
    const requestedLeaseMs =
      input.expiresAt.getTime() - input.now.getTime();
    if (requestedLeaseMs <= 0 || requestedLeaseMs > 60_000) {
      return { kind: "unavailable" };
    }
    try {
      return await this.getDatabase().transaction(async (tx) => {
        const rows = await tx
          .select({
            lease: workflowRunExecutionLeases,
            databaseNow: sql<unknown>`clock_timestamp()`,
          })
          .from(workflowRunExecutionLeases)
          .where(
            and(
              eq(workflowRunExecutionLeases.workspaceId, input.workspaceId),
              eq(workflowRunExecutionLeases.runId, input.runId),
            ),
          )
          .limit(1)
          .for("update");
        const selected = rows[0];
        if (!selected) return { kind: "unavailable" as const };
        const databaseNow = postgresDate(selected.databaseNow);
        const lease = selected.lease;
        if (
          lease.releasedAt !== null ||
          lease.workerId !== input.workerId ||
          lease.token !== input.token ||
          lease.fence !== input.fence ||
          lease.expiresAt <= databaseNow
        ) {
          return { kind: "stale_fence" as const };
        }
        const expiresAt = new Date(databaseNow.getTime() + requestedLeaseMs);
        const updated = await tx
          .update(workflowRunExecutionLeases)
          .set({ expiresAt })
          .where(
            and(
              eq(workflowRunExecutionLeases.workspaceId, input.workspaceId),
              eq(workflowRunExecutionLeases.runId, input.runId),
              eq(workflowRunExecutionLeases.workerId, input.workerId),
              eq(workflowRunExecutionLeases.token, input.token),
              eq(workflowRunExecutionLeases.fence, input.fence),
              isNull(workflowRunExecutionLeases.releasedAt),
            ),
          )
          .returning();
        return updated[0]
          ? { kind: "renewed" as const, lease: mapLease(updated[0]) }
          : { kind: "stale_fence" as const };
      });
    } catch {
      return { kind: "unavailable" };
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

  async listStepAttempts(
    input: Parameters<WorkflowRunRepository["listStepAttempts"]>[0],
  ): Promise<WorkflowStepAttemptRecord[] | null> {
    const database = this.getDatabase();
    const run = await findRun(database, input);
    if (!run) return null;
    const rows = await database
      .select()
      .from(workflowStepAttempts)
      .where(
        and(
          eq(workflowStepAttempts.workspaceId, input.workspaceId),
          eq(workflowStepAttempts.runId, input.runId),
        ),
      )
      .orderBy(
        asc(workflowStepAttempts.startedAt),
        asc(workflowStepAttempts.stepId),
        asc(workflowStepAttempts.attempt),
      );
    return rows.map(mapStepAttempt);
  }

  async prepareStepAttempt(
    input: Parameters<WorkflowRunRepository["prepareStepAttempt"]>[0],
  ): Promise<PrepareWorkflowStepAttemptResult> {
    try {
      return await this.getDatabase().transaction(async (tx) => {
        const selectedRuns = await tx
          .select({
            run: workflowRuns,
            databaseNow: sql<unknown>`clock_timestamp()`,
          })
          .from(workflowRuns)
          .where(
            and(
              eq(
                workflowRuns.workspaceId,
                input.attempt.workspaceId,
              ),
              eq(workflowRuns.id, input.attempt.runId),
            ),
          )
          .limit(1)
          .for("update");
        const selected = selectedRuns[0];
        if (!selected) return { kind: "unavailable" as const };
        const run = mapRun(selected.run);
        if (
          run.state !== "running" ||
          !validPreparedAttempt(input.attempt, run)
        ) {
          return { kind: "unavailable" as const };
        }
        const databaseNow = postgresDate(selected.databaseNow);
        const leaseRows = await tx
          .select()
          .from(workflowRunExecutionLeases)
          .where(
            and(
              eq(
                workflowRunExecutionLeases.workspaceId,
                input.attempt.workspaceId,
              ),
              eq(
                workflowRunExecutionLeases.runId,
                input.attempt.runId,
              ),
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
          lease.expiresAt <= databaseNow
        ) {
          return { kind: "stale_fence" as const };
        }

        const existingRows = await tx
          .select()
          .from(workflowStepAttempts)
          .where(
            and(
              eq(
                workflowStepAttempts.workspaceId,
                input.attempt.workspaceId,
              ),
              eq(
                workflowStepAttempts.runId,
                input.attempt.runId,
              ),
              eq(
                workflowStepAttempts.stepId,
                input.attempt.stepId,
              ),
              eq(
                workflowStepAttempts.attempt,
                input.attempt.attempt,
              ),
            ),
          )
          .limit(2)
          .for("update");
        if (existingRows.length > 0) {
          const existing = existingRows.map(mapStepAttempt).find(
            (attempt) => sameAttemptIntent(attempt, input.attempt),
          );
          if (!existing || existingRows.length > 1) {
            return { kind: "conflict" as const };
          }
          return {
            kind: "replayed" as const,
            run,
            attempt: existing,
          };
        }
        const effectOwners = await tx
          .select()
          .from(workflowStepAttempts)
          .where(
            and(
              eq(
                workflowStepAttempts.workspaceId,
                input.attempt.workspaceId,
              ),
              eq(
                workflowStepAttempts.effectKey,
                input.attempt.effectKey,
              ),
            ),
          )
          .for("update");
        if (
          effectOwners.map(mapStepAttempt).some(
            (owner) =>
              owner.runId !== input.attempt.runId ||
              owner.stepId !== input.attempt.stepId ||
              owner.intentDigest !== input.attempt.intentDigest ||
              owner.operationContractDigest !==
                input.attempt.operationContractDigest,
          )
        ) {
          return { kind: "conflict" as const };
        }

        const attempt: WorkflowStepAttemptRecord = {
          ...input.attempt,
          inputs: structuredClone(input.attempt.inputs),
          startedAt: databaseNow,
        };
        await tx.insert(workflowStepAttempts).values(attempt);
        const event: WorkflowRunEventRecord = {
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
          occurredAt: databaseNow,
        };
        await tx.insert(workflowRunEvents).values(event);
        const updatedRuns = await tx
          .update(workflowRuns)
          .set({
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: databaseNow,
          })
          .where(
            and(
              eq(workflowRuns.workspaceId, run.workspaceId),
              eq(workflowRuns.id, run.id),
              eq(workflowRuns.state, "running"),
              eq(
                workflowRuns.nextEventSequence,
                run.nextEventSequence,
              ),
            ),
          )
          .returning();
        if (!updatedRuns[0]) {
          throw new Error("Workflow Step Attempt preparation was lost.");
        }
        return {
          kind: "created" as const,
          run: mapRun(updatedRuns[0]),
          attempt,
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async settleStepAttempt(
    input: Parameters<WorkflowRunRepository["settleStepAttempt"]>[0],
  ): Promise<SettleWorkflowStepAttemptResult> {
    try {
      return await this.getDatabase().transaction(async (tx) => {
        const selectedRuns = await tx
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
        const selected = selectedRuns[0];
        if (!selected) return { kind: "unavailable" as const };
        const run = mapRun(selected.run);

        const attemptRows = await tx
          .select()
          .from(workflowStepAttempts)
          .where(
            and(
              eq(
                workflowStepAttempts.workspaceId,
                input.workspaceId,
              ),
              eq(workflowStepAttempts.runId, input.runId),
              eq(workflowStepAttempts.id, input.stepAttemptId),
            ),
          )
          .limit(1)
          .for("update");
        const selectedAttempt = attemptRows[0];
        if (!selectedAttempt) {
          return { kind: "unavailable" as const };
        }
        const attempt = mapStepAttempt(selectedAttempt);

        if (attempt.state === "completed") {
          if (
            !sameCanonicalValue(attempt.outputs, input.outputs) ||
            (input.finalSnapshotDigest !== null &&
              run.finalSnapshotDigest !== input.finalSnapshotDigest)
          ) {
            return { kind: "unavailable" as const };
          }
          await this.appendUsageAttribution(tx, input.usageAttributionPlan, attempt);
          return {
            kind: "settled" as const,
            run,
            attempt,
          };
        }
        const persistedAttempts = input.finalSnapshot
          ? (
              await tx
                .select()
                .from(workflowStepAttempts)
                .where(
                  and(
                    eq(
                      workflowStepAttempts.workspaceId,
                      input.workspaceId,
                    ),
                    eq(
                      workflowStepAttempts.runId,
                      input.runId,
                    ),
                  ),
                )
                .for("update")
            ).map(mapStepAttempt)
          : [attempt];
        if (input.finalSnapshot && run.derivation?.reusedOutputs.length) {
          const reusedIds = run.derivation.reusedOutputs.map(
            (reused) => reused.sourceStepAttemptId,
          );
          const reusedRows = await tx
            .select()
            .from(workflowStepAttempts)
            .where(
              and(
                eq(workflowStepAttempts.workspaceId, input.workspaceId),
                inArray(workflowStepAttempts.id, reusedIds),
              ),
            )
            .for("update");
          persistedAttempts.push(...reusedRows.map(mapStepAttempt));
        }
        if (
          run.state !== "running" ||
          attempt.state !== "running" ||
          !validFinalSnapshot(
            input.finalSnapshot,
            input.finalSnapshotDigest,
            run,
            attempt,
            input.outputs,
            input.providerOperationRef,
            persistedAttempts,
          )
        ) {
          return { kind: "unavailable" as const };
        }

        const outputEntries = Object.entries(input.outputs).sort(
          ([left], [right]) => compareCodeUnits(left, right),
        );
        if (
          input.eventIds.generated.length !== outputEntries.length ||
          Boolean(input.eventIds.runCompleted) !==
            Boolean(input.finalSnapshot)
        ) {
          return { kind: "unavailable" as const };
        }

        const databaseNow = postgresDate(selected.databaseNow);
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
          lease.expiresAt <= databaseNow
        ) {
          return { kind: "stale_fence" as const };
        }

        await this.appendUsageAttribution(tx, input.usageAttributionPlan, attempt);
        const updatedAttempts = await tx
          .update(workflowStepAttempts)
          .set({
            state: "completed",
            outputs: structuredClone(input.outputs),
            providerOperationRef: input.providerOperationRef,
            outcome: {
              kind: "succeeded",
              providerOperationRef: input.providerOperationRef,
            },
            failureCode: null,
            completedAt: databaseNow,
          })
          .where(
            and(
              eq(
                workflowStepAttempts.workspaceId,
                input.workspaceId,
              ),
              eq(workflowStepAttempts.runId, input.runId),
              eq(workflowStepAttempts.id, input.stepAttemptId),
              eq(workflowStepAttempts.state, "running"),
            ),
          )
          .returning();
        if (!updatedAttempts[0]) {
          throw new Error("Workflow Step Attempt settlement was lost.");
        }

        let sequence = run.nextEventSequence;
        const generatedEvents: WorkflowRunEventRecord[] =
          outputEntries.map(([outputName, output], index) => ({
            id: input.eventIds.generated[index]!,
            workspaceId: input.workspaceId,
            runId: input.runId,
            sequence: sequence++,
            type: "artifact.generated",
            data: {
              stepAttemptId: attempt.id,
              stepId: attempt.stepId,
              outputName,
              artifactId: output.artifactId,
              digest: output.digest,
            },
            occurredAt: databaseNow,
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
              outputArtifactIds: outputEntries.map(
                ([, output]) => output.artifactId,
              ),
            },
            occurredAt: databaseNow,
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
              outputArtifactIds: Object.entries(
                input.finalSnapshot.outputs,
              )
                .sort(([left], [right]) =>
                  compareCodeUnits(left, right),
                )
                .map(([, output]) => output.artifactId),
            },
            occurredAt: databaseNow,
          });
        }
        await tx.insert(workflowRunEvents).values(events);

        const updatedRuns = await tx
          .update(workflowRuns)
          .set({
            state: input.finalSnapshot ? "completed" : "running",
            output: input.finalSnapshot
              ? structuredClone(input.finalSnapshot.outputs)
              : null,
            finalSnapshot: input.finalSnapshot
              ? structuredClone(input.finalSnapshot)
              : null,
            finalSnapshotDigest: input.finalSnapshotDigest,
            failureCode: null,
            nextEventSequence: sequence,
            completedAt: input.finalSnapshot ? databaseNow : null,
            updatedAt: databaseNow,
          })
          .where(
            and(
              eq(workflowRuns.workspaceId, input.workspaceId),
              eq(workflowRuns.id, input.runId),
              eq(workflowRuns.state, "running"),
              eq(
                workflowRuns.nextEventSequence,
                run.nextEventSequence,
              ),
            ),
          )
          .returning();
        if (!updatedRuns[0]) {
          throw new Error("Workflow Run settlement was lost.");
        }

        const released = await tx
          .update(workflowRunExecutionLeases)
          .set({ releasedAt: databaseNow })
          .where(
            and(
              eq(
                workflowRunExecutionLeases.workspaceId,
                input.workspaceId,
              ),
              eq(workflowRunExecutionLeases.runId, input.runId),
              eq(
                workflowRunExecutionLeases.workerId,
                input.workerId,
              ),
              eq(
                workflowRunExecutionLeases.token,
                input.token,
              ),
              eq(workflowRunExecutionLeases.fence, input.fence),
              isNull(workflowRunExecutionLeases.releasedAt),
            ),
          )
          .returning({ runId: workflowRunExecutionLeases.runId });
        if (!released[0]) {
          throw new Error("Workflow Run lease release was lost.");
        }
        return {
          kind: "settled" as const,
          run: mapRun(updatedRuns[0]),
          attempt: mapStepAttempt(updatedAttempts[0]),
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async recordStepAttemptProviderSuccess(
    input: Parameters<
      WorkflowRunRepository["recordStepAttemptProviderSuccess"]
    >[0],
  ): Promise<SettleWorkflowStepAttemptResult> {
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
        const run = mapRun(selected.run);
        const databaseNow = postgresDate(selected.databaseNow);
        const leaseRows = await tx
          .select()
          .from(workflowRunExecutionLeases)
          .where(
            and(
              eq(workflowRunExecutionLeases.workspaceId, input.workspaceId),
              eq(workflowRunExecutionLeases.runId, input.runId),
            ),
          )
          .limit(1)
          .for("update");
        const lease = leaseRows[0];
        if (
          run.state !== "running" ||
          !lease ||
          lease.releasedAt !== null ||
          lease.workerId !== input.workerId ||
          lease.token !== input.token ||
          lease.fence !== input.fence ||
          lease.expiresAt <= databaseNow
        ) {
          return { kind: "stale_fence" as const };
        }
        const attemptRows = await tx
          .select()
          .from(workflowStepAttempts)
          .where(
            and(
              eq(workflowStepAttempts.workspaceId, input.workspaceId),
              eq(workflowStepAttempts.runId, input.runId),
              eq(workflowStepAttempts.id, input.stepAttemptId),
            ),
          )
          .limit(1)
          .for("update");
        const attempt = attemptRows[0] ? mapStepAttempt(attemptRows[0]) : null;
        if (
          !attempt ||
          attempt.state !== "running" ||
          (attempt.outcome !== null &&
            (attempt.outcome.kind !== "succeeded" ||
              attempt.providerOperationRef !== input.providerOperationRef))
        ) {
          return { kind: "unavailable" as const };
        }
        if (attempt.outcome?.kind === "succeeded") {
          await this.appendUsage(tx, input.usagePlan, attempt);
          return { kind: "settled" as const, run, attempt };
        }
        if (!input.usagePlan) return { kind: "unavailable" as const };
        await this.appendUsage(tx, input.usagePlan, attempt);
        const updated = await tx
          .update(workflowStepAttempts)
          .set({
            providerOperationRef: input.providerOperationRef,
            providerMetadata: input.providerMetadata ?? null,
            outcome: {
              kind: "succeeded",
              providerOperationRef: input.providerOperationRef,
            },
          })
          .where(
            and(
              eq(workflowStepAttempts.workspaceId, input.workspaceId),
              eq(workflowStepAttempts.runId, input.runId),
              eq(workflowStepAttempts.id, input.stepAttemptId),
              eq(workflowStepAttempts.state, "running"),
              isNull(workflowStepAttempts.outcome),
            ),
          )
          .returning();
        if (!updated[0]) throw new Error("Provider success evidence was lost.");
        return {
          kind: "settled" as const,
          run,
          attempt: mapStepAttempt(updated[0]),
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async failStepAttempt(
    input: Parameters<WorkflowRunRepository["failStepAttempt"]>[0],
  ): Promise<SettleWorkflowStepAttemptResult> {
    if (!FAILURE_CODE.test(input.failureCode)) {
      return { kind: "unavailable" as const };
    }
    try {
      return await this.getDatabase().transaction(async (tx) => {
        const selectedRuns = await tx
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
        const selected = selectedRuns[0];
        if (!selected) return { kind: "unavailable" as const };
        const run = mapRun(selected.run);

        const attemptRows = await tx
          .select()
          .from(workflowStepAttempts)
          .where(
            and(
              eq(
                workflowStepAttempts.workspaceId,
                input.workspaceId,
              ),
              eq(workflowStepAttempts.runId, input.runId),
              eq(workflowStepAttempts.id, input.stepAttemptId),
            ),
          )
          .limit(1)
          .for("update");
        const selectedAttempt = attemptRows[0];
        if (!selectedAttempt) {
          return { kind: "unavailable" as const };
        }
        const attempt = mapStepAttempt(selectedAttempt);
        if (
          attempt.state === "failed" &&
          (run.state === "failed" || run.state === "waiting") &&
          attempt.failureCode === input.failureCode &&
          run.failureCode === input.failureCode
        ) {
          await this.appendUsage(tx, input.usagePlan, attempt);
          return {
            kind: "settled" as const,
            run,
            attempt,
          };
        }
        if (
          run.state !== "running" ||
          attempt.state !== "running"
        ) {
          return { kind: "unavailable" as const };
        }

        const databaseNow = postgresDate(selected.databaseNow);
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
          lease.expiresAt <= databaseNow
        ) {
          return { kind: "stale_fence" as const };
        }

        await this.appendUsage(tx, input.usagePlan, attempt);
        const updatedAttempts = await tx
          .update(workflowStepAttempts)
          .set({
            state: "failed",
            outputs: null,
            providerOperationRef: input.providerOperationRef,
            outcome: {
              kind: "failed_known",
              failureCode: input.failureCode,
              retryable: input.retryable,
            },
            failureCode: input.failureCode,
            providerMetadata: input.providerMetadata ?? null,
            completedAt: databaseNow,
          })
          .where(
            and(
              eq(
                workflowStepAttempts.workspaceId,
                input.workspaceId,
              ),
              eq(workflowStepAttempts.runId, input.runId),
              eq(workflowStepAttempts.id, input.stepAttemptId),
              eq(workflowStepAttempts.state, "running"),
            ),
          )
          .returning();
        if (!updatedAttempts[0]) {
          throw new Error("Workflow Step Attempt failure was lost.");
        }

        const retryAt = input.retryAt
          ? new Date(
              databaseNow.getTime() +
                Math.max(
                  0,
                  input.retryAt.getTime() - input.failedAt.getTime(),
                ),
            )
          : null;
        const shouldRetry =
          input.retryable &&
          retryAt !== null &&
          input.retryOutboxIntent !== null;
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
            occurredAt: databaseNow,
          },
          ...(shouldRetry
            ? [
                {
                  id: input.eventIds.retryScheduled!,
                  workspaceId: input.workspaceId,
                  runId: input.runId,
                  sequence: run.nextEventSequence + 1,
                  type: "step.retry.scheduled" as const,
                  data: {
                    stepAttemptId: attempt.id,
                    stepId: attempt.stepId,
                    attempt: attempt.attempt,
                    nextAttempt: attempt.attempt + 1,
                    effectKey: attempt.effectKey,
                    retryAt: retryAt!.toISOString(),
                  },
                  occurredAt: databaseNow,
                },
                {
                  id: input.eventIds.runWaiting!,
                  workspaceId: input.workspaceId,
                  runId: input.runId,
                  sequence: run.nextEventSequence + 2,
                  type: "run.waiting" as const,
                  data: {
                    stepAttemptId: attempt.id,
                    reasonCode: input.failureCode,
                    resumeAt: retryAt!.toISOString(),
                  },
                  occurredAt: databaseNow,
                },
              ]
            : [
                {
                  id: input.eventIds.runFailed!,
                  workspaceId: input.workspaceId,
                  runId: input.runId,
                  sequence: run.nextEventSequence + 1,
                  type: "run.failed" as const,
                  data: {
                    stepAttemptId: attempt.id,
                    reasonCode: input.failureCode,
                  },
                  occurredAt: databaseNow,
                },
              ]),
        ];
        await tx.insert(workflowRunEvents).values(events);
        if (shouldRetry) {
          await tx.insert(workflowRunOutboxIntents).values({
            ...input.retryOutboxIntent!,
            availableAt: retryAt!,
            createdAt: databaseNow,
          });
        }
        const updatedRuns = await tx
          .update(workflowRuns)
          .set({
            state: shouldRetry ? "waiting" : "failed",
            output: null,
            finalSnapshot: null,
            finalSnapshotDigest: null,
            failureCode: input.failureCode,
            resumeAt: shouldRetry ? retryAt : null,
            nextEventSequence: run.nextEventSequence + events.length,
            completedAt: shouldRetry ? null : databaseNow,
            updatedAt: databaseNow,
          })
          .where(
            and(
              eq(workflowRuns.workspaceId, input.workspaceId),
              eq(workflowRuns.id, input.runId),
              eq(workflowRuns.state, "running"),
              eq(
                workflowRuns.nextEventSequence,
                run.nextEventSequence,
              ),
            ),
          )
          .returning();
        if (!updatedRuns[0]) {
          throw new Error("Workflow Run failure settlement was lost.");
        }

        const released = await tx
          .update(workflowRunExecutionLeases)
          .set({ releasedAt: databaseNow })
          .where(
            and(
              eq(
                workflowRunExecutionLeases.workspaceId,
                input.workspaceId,
              ),
              eq(workflowRunExecutionLeases.runId, input.runId),
              eq(
                workflowRunExecutionLeases.workerId,
                input.workerId,
              ),
              eq(
                workflowRunExecutionLeases.token,
                input.token,
              ),
              eq(workflowRunExecutionLeases.fence, input.fence),
              isNull(workflowRunExecutionLeases.releasedAt),
            ),
          )
          .returning({ runId: workflowRunExecutionLeases.runId });
        if (!released[0]) {
          throw new Error("Workflow Run lease release was lost.");
        }
        return {
          kind: "settled" as const,
          run: mapRun(updatedRuns[0]),
          attempt: mapStepAttempt(updatedAttempts[0]),
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async markStepAttemptOutcomeUnknown(
    input: Parameters<
      WorkflowRunRepository["markStepAttemptOutcomeUnknown"]
    >[0],
  ): Promise<SettleWorkflowStepAttemptResult> {
    if (!FAILURE_CODE.test(input.failureCode)) return { kind: "unavailable" };
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
        const attempts = await tx
          .select()
          .from(workflowStepAttempts)
          .where(
            and(
              eq(workflowStepAttempts.workspaceId, input.workspaceId),
              eq(workflowStepAttempts.runId, input.runId),
              eq(workflowStepAttempts.id, input.stepAttemptId),
            ),
          )
          .limit(1)
          .for("update");
        const attempt = attempts[0] ? mapStepAttempt(attempts[0]) : null;
        const leases = await tx
          .select()
          .from(workflowRunExecutionLeases)
          .where(
            and(
              eq(workflowRunExecutionLeases.workspaceId, input.workspaceId),
              eq(workflowRunExecutionLeases.runId, input.runId),
            ),
          )
          .limit(1)
          .for("update");
        const lease = leases[0];
        if (
          !attempt ||
          run.state !== "running" ||
          attempt.state !== "running"
        ) {
          return { kind: "unavailable" as const };
        }
        if (!input.usagePlan && attempt.outcome?.kind !== "succeeded") {
          return { kind: "unavailable" as const };
        }
        if (
          !lease ||
          lease.releasedAt !== null ||
          lease.workerId !== input.workerId ||
          lease.token !== input.token ||
          lease.fence !== input.fence ||
          lease.expiresAt <= databaseNow
        ) {
          return { kind: "stale_fence" as const };
        }
        await this.appendUsage(tx, input.usagePlan, attempt);
        const updatedAttempts = await tx
          .update(workflowStepAttempts)
          .set({
            state: "outcome_unknown",
            providerOperationRef: input.providerOperationRef,
            outcome: {
              kind: "outcome_unknown",
              failureCode: input.failureCode,
              priorSucceededProviderOperationRef:
                attempt.outcome?.kind === "succeeded"
                  ? attempt.outcome.providerOperationRef
                  : null,
            },
            failureCode: input.failureCode,
            providerMetadata: input.providerMetadata ?? null,
          })
          .where(eq(workflowStepAttempts.id, input.stepAttemptId))
          .returning();
        const events: WorkflowRunEventRecord[] = [
          {
            id: input.eventIds.attemptOutcomeUnknown,
            workspaceId: input.workspaceId,
            runId: input.runId,
            sequence: run.nextEventSequence,
            type: "step.attempt.outcome_unknown",
            data: {
              stepAttemptId: attempt.id,
              stepId: attempt.stepId,
              attempt: attempt.attempt,
              effectKey: attempt.effectKey,
              reasonCode: input.failureCode,
            },
            occurredAt: databaseNow,
          },
          {
            id: input.eventIds.runOutcomeUnknown,
            workspaceId: input.workspaceId,
            runId: input.runId,
            sequence: run.nextEventSequence + 1,
            type: "run.outcome_unknown",
            data: {
              stepAttemptId: attempt.id,
              reasonCode: input.failureCode,
            },
            occurredAt: databaseNow,
          },
        ];
        await tx.insert(workflowRunEvents).values(events);
        const updatedRuns = await tx
          .update(workflowRuns)
          .set({
            state: "outcome_unknown",
            failureCode: input.failureCode,
            resumeAt: null,
            nextEventSequence: run.nextEventSequence + events.length,
            updatedAt: databaseNow,
          })
          .where(
            and(
              eq(workflowRuns.workspaceId, input.workspaceId),
              eq(workflowRuns.id, input.runId),
              eq(workflowRuns.state, "running"),
            ),
          )
          .returning();
        await tx
          .update(workflowRunExecutionLeases)
          .set({ releasedAt: databaseNow })
          .where(
            and(
              eq(workflowRunExecutionLeases.workspaceId, input.workspaceId),
              eq(workflowRunExecutionLeases.runId, input.runId),
              eq(workflowRunExecutionLeases.token, input.token),
              eq(workflowRunExecutionLeases.fence, input.fence),
            ),
          );
        if (!updatedAttempts[0] || !updatedRuns[0]) {
          throw new Error("Unknown outcome transition was lost.");
        }
        return {
          kind: "settled" as const,
          run: mapRun(updatedRuns[0]),
          attempt: mapStepAttempt(updatedAttempts[0]),
        };
      });
    } catch {
      return { kind: "unavailable" };
    }
  }

  async deriveRun(
    input: Parameters<WorkflowRunRepository["deriveRun"]>[0],
  ) {
    try {
      return await this.getDatabase().transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${receiptLock(input.receipt)}, 0))`,
        );
        const existingRows = await tx
          .select()
          .from(workflowRunMutationReceipts)
          .where(
            and(
              eq(workflowRunMutationReceipts.workspaceId, input.receipt.workspaceId),
              eq(workflowRunMutationReceipts.principalId, input.receipt.principalId),
              eq(workflowRunMutationReceipts.capability, input.receipt.capability),
              eq(workflowRunMutationReceipts.idempotencyKey, input.receipt.idempotencyKey),
            ),
          )
          .limit(1)
          .for("update");
        const existing = existingRows[0];
        if (existing) {
          if (existing.requestFingerprint !== input.receipt.requestFingerprint) {
            return { kind: "conflict" as const };
          }
          const run = await findRun(tx, {
            workspaceId: input.receipt.workspaceId,
            runId: existing.runId,
          });
          return run
            ? { kind: "replayed" as const, run, receipt: mapReceipt(existing) }
            : { kind: "unavailable" as const };
        }
        const sourceRows = input.run.derivation
          ? await tx
              .select()
              .from(workflowRuns)
              .where(
                and(
                  eq(workflowRuns.workspaceId, input.run.workspaceId),
                  eq(
                    workflowRuns.id,
                    input.run.derivation.sourceRunId,
                  ),
                ),
              )
              .limit(1)
              .for("share")
          : [];
        const sourceRow = sourceRows[0];
        const source = sourceRow ? mapRun(sourceRow) : null;
        const derivation = input.run.derivation;
        const expectedSnapshot = source
          ? {
              ...source.startSnapshot,
              authorization: input.run.startSnapshot.authorization,
            }
          : null;
        if (
          !source ||
          !derivation ||
          source.state !== "failed" ||
          input.run.workflowId !== source.workflowId ||
          input.run.workflowRevisionId !== source.workflowRevisionId ||
          derivation.sourceRunId !== source.id ||
          derivation.sourceStartSnapshotDigest !== source.startSnapshotDigest ||
          derivation.rootRunId !== (source.derivation?.rootRunId ?? source.id) ||
          !source.startSnapshot.definition.steps.some(
            (step) => step.id === derivation.retryFromStepId,
          ) ||
          !expectedSnapshot ||
          !sameCanonicalValue(input.run.startSnapshot, expectedSnapshot)
        ) {
          return { kind: "unavailable" as const };
        }
        for (const reused of derivation.reusedOutputs) {
          if (reused.sourceRunId === source.id) {
            const rows = await tx
              .select()
              .from(workflowStepAttempts)
              .where(
                and(
                  eq(workflowStepAttempts.workspaceId, input.run.workspaceId),
                  eq(workflowStepAttempts.runId, source.id),
                  eq(workflowStepAttempts.id, reused.sourceStepAttemptId),
                ),
              )
              .limit(1)
              .for("share");
            const attempt = rows[0] ? mapStepAttempt(rows[0]) : null;
            if (
              !attempt ||
              attempt.state !== "completed" ||
              attempt.stepId !== reused.stepId ||
              attempt.attempt !== reused.sourceAttempt ||
              attempt.effectKey !== reused.sourceEffectKey ||
              attempt.providerOperationRef !==
                reused.sourceProviderOperationRef ||
              !sameCanonicalValue(attempt.outputs, reused.outputs)
            ) {
              return { kind: "unavailable" as const };
            }
          } else if (
            !source.derivation?.reusedOutputs.some((inherited) =>
              sameCanonicalValue(inherited, reused),
            )
          ) {
            return { kind: "unavailable" as const };
          }
        }
        const evidenceRows = await tx
          .select({ resources: agentAuthorizationDecisions.resources })
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
                "workflow_runs.retry",
              ),
              eq(agentAuthorizationDecisions.capabilityVersion, 1),
              eq(agentAuthorizationDecisions.outcome, "allowed"),
            ),
          )
          .limit(1)
          .for("share");
        const evidence = evidenceRows[0];
        const requiredArtifacts = input.run.startSnapshot.artifactReferences.map(
          (reference) => reference.artifactId,
        );
        if (
          !evidence ||
          !evidence.resources.some(
            (resource) =>
              resource.kind === "workflow" &&
              resource.id === input.run.workflowId,
          ) ||
          requiredArtifacts.some(
            (artifactId) =>
              !evidence.resources.some(
                (resource) =>
                  resource.kind === "artifact" &&
                  resource.id === artifactId,
              ),
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
          sourceRunId: input.run.derivation!.sourceRunId,
          rootRunId: input.run.derivation!.rootRunId,
          derivationDepth: sourceRow!.derivationDepth + 1,
        });
        await tx.insert(workflowRunEvents).values(input.events);
        const receipt = {
          ...input.receipt,
          result: workflowRunReceiptResult(
            input.run,
            input.receipt.initialEventCursor,
          ),
        };
        await tx.insert(workflowRunMutationReceipts).values(receipt);
        await tx.insert(workflowRunOutboxIntents).values(input.outboxIntent);
        return {
          kind: "created" as const,
          run: input.run,
          receipt,
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async resumeRun(
    input: Parameters<WorkflowRunRepository["resumeRun"]>[0],
  ) {
    try {
      return await this.getDatabase().transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${receiptLock(input.receipt)}, 0))`,
        );
        const receipts = await tx
          .select()
          .from(workflowRunMutationReceipts)
          .where(
            and(
              eq(workflowRunMutationReceipts.workspaceId, input.workspaceId),
              eq(workflowRunMutationReceipts.principalId, input.principalId),
              eq(workflowRunMutationReceipts.capability, "workflow_runs.resume@1"),
              eq(workflowRunMutationReceipts.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1)
          .for("update");
        const existing = receipts[0];
        if (existing) {
          if (existing.requestFingerprint !== input.requestFingerprint) {
            return { kind: "conflict" as const };
          }
          const run = await findRun(tx, {
            workspaceId: input.workspaceId,
            runId: existing.runId,
          });
          return run
            ? { kind: "replayed" as const, run, receipt: mapReceipt(existing) }
            : { kind: "unavailable" as const };
        }
        const rows = await tx
          .select({
            run: workflowRuns,
            databaseNow: sql<unknown>`clock_timestamp()`,
          })
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.workspaceId, input.workspaceId),
              eq(workflowRuns.workflowId, input.workflowId),
              eq(workflowRuns.id, input.runId),
            ),
          )
          .limit(1)
          .for("update");
        const selected = rows[0];
        if (!selected) return { kind: "unavailable" as const };
        const run = mapRun(selected.run);
        const databaseNow = postgresDate(selected.databaseNow);
        const waitEvents = await tx
          .select({ id: workflowRunEvents.id })
          .from(workflowRunEvents)
          .where(
            and(
              eq(workflowRunEvents.workspaceId, input.workspaceId),
              eq(workflowRunEvents.runId, input.runId),
              eq(workflowRunEvents.sequence, input.waitEventSequence),
              eq(workflowRunEvents.type, "run.waiting"),
            ),
          )
          .limit(1)
          .for("share");
        const evidenceRows = await tx
          .select({ resources: agentAuthorizationDecisions.resources })
          .from(agentAuthorizationDecisions)
          .where(
            and(
              eq(agentAuthorizationDecisions.workspaceId, input.workspaceId),
              eq(agentAuthorizationDecisions.principalId, input.principalId),
              eq(agentAuthorizationDecisions.keyId, input.keyId),
              eq(
                agentAuthorizationDecisions.operatorTraceRef,
                input.authorizationEvidenceRef,
              ),
              eq(
                agentAuthorizationDecisions.capabilityName,
                "workflow_runs.resume",
              ),
              eq(agentAuthorizationDecisions.capabilityVersion, 1),
              eq(agentAuthorizationDecisions.outcome, "allowed"),
            ),
          )
          .limit(1)
          .for("share");
        const evidence = evidenceRows[0];
        if (
          run.state !== "waiting" ||
          run.nextEventSequence !== input.waitEventSequence + 1 ||
          !waitEvents[0] ||
          (run.resumeAt !== null && run.resumeAt > databaseNow) ||
          !evidence?.resources.some(
            (resource) =>
              resource.kind === "workflow" &&
              resource.id === input.workflowId,
          )
        ) {
          return { kind: "unavailable" as const };
        }
        await tx.insert(workflowRunEvents).values({
          id: input.eventId,
          workspaceId: input.workspaceId,
          runId: input.runId,
          sequence: run.nextEventSequence,
          type: "run.resumed",
          data: { automatic: false },
          occurredAt: databaseNow,
        });
        const updated = await tx
          .update(workflowRuns)
          .set({
            state: "running",
            resumeAt: null,
            failureCode: null,
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: databaseNow,
          })
          .where(
            and(
              eq(workflowRuns.workspaceId, input.workspaceId),
              eq(workflowRuns.id, input.runId),
              eq(workflowRuns.state, "waiting"),
            ),
          )
          .returning();
        await tx.insert(workflowRunOutboxIntents).values({
          ...input.outboxIntent,
          availableAt: databaseNow,
          createdAt: databaseNow,
        });
        if (!updated[0]) throw new Error("Workflow Run resume was lost.");
        const resumed = mapRun(updated[0]);
        const receipt = {
          ...input.receipt,
          result: workflowRunReceiptResult(
            resumed,
            input.receipt.initialEventCursor,
          ),
          createdAt: databaseNow,
        };
        await tx.insert(workflowRunMutationReceipts).values(receipt);
        return {
          kind: "created" as const,
          run: resumed,
          receipt,
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }

  async reconcileStepAttempt(
    input: Parameters<WorkflowRunRepository["reconcileStepAttempt"]>[0],
  ) {
    try {
      return await this.getDatabase().transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${receiptLock(input.receipt)}, 0))`,
        );
        const receiptRows = await tx
          .select()
          .from(workflowRunMutationReceipts)
          .where(
            and(
              eq(workflowRunMutationReceipts.workspaceId, input.workspaceId),
              eq(workflowRunMutationReceipts.principalId, input.principalId),
              eq(workflowRunMutationReceipts.capability, "workflow_runs.reconcile@1"),
              eq(workflowRunMutationReceipts.idempotencyKey, input.receipt.idempotencyKey),
            ),
          )
          .limit(1)
          .for("update");
        const existing = receiptRows[0];
        if (existing) {
          if (existing.requestFingerprint !== input.requestFingerprint) {
            return { kind: "conflict" as const };
          }
          const replay = await findRun(tx, {
            workspaceId: input.workspaceId,
            runId: existing.runId,
          });
          return replay
            ? { kind: "replayed" as const, run: replay, receipt: mapReceipt(existing) }
            : { kind: "unavailable" as const };
        }
        const runRows = await tx
          .select({
            run: workflowRuns,
            databaseNow: sql<unknown>`clock_timestamp()`,
          })
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.workspaceId, input.workspaceId),
              eq(workflowRuns.workflowId, input.workflowId),
              eq(workflowRuns.id, input.runId),
            ),
          )
          .limit(1)
          .for("update");
        const selected = runRows[0];
        if (!selected) return { kind: "unavailable" as const };
        const run = mapRun(selected.run);
        const databaseNow = postgresDate(selected.databaseNow);
        const evidenceRows = await tx
          .select({ resources: agentAuthorizationDecisions.resources })
          .from(agentAuthorizationDecisions)
          .where(
            and(
              eq(agentAuthorizationDecisions.workspaceId, input.workspaceId),
              eq(agentAuthorizationDecisions.principalId, input.principalId),
              eq(agentAuthorizationDecisions.keyId, input.keyId),
              eq(
                agentAuthorizationDecisions.operatorTraceRef,
                input.authorizationEvidenceRef,
              ),
              eq(
                agentAuthorizationDecisions.capabilityName,
                "workflow_runs.reconcile",
              ),
              eq(agentAuthorizationDecisions.capabilityVersion, 1),
              eq(agentAuthorizationDecisions.outcome, "allowed"),
            ),
          )
          .limit(1)
          .for("share");
        const evidence = evidenceRows[0];
        if (
          !evidence?.resources.some(
            (resource) =>
              resource.kind === "workflow" &&
              resource.id === input.workflowId,
          )
        ) {
          return { kind: "unavailable" as const };
        }
        const attemptRows = await tx
          .select()
          .from(workflowStepAttempts)
          .where(
            and(
              eq(workflowStepAttempts.workspaceId, input.workspaceId),
              eq(workflowStepAttempts.runId, input.runId),
              eq(workflowStepAttempts.id, input.stepAttemptId),
            ),
          )
          .limit(1)
          .for("update");
        const attempt = attemptRows[0] ? mapStepAttempt(attemptRows[0]) : null;
        if (
          run.state !== "outcome_unknown" ||
          !attempt ||
          attempt.state !== "outcome_unknown"
        ) {
          return { kind: "unavailable" as const };
        }
        const priorSucceededProviderOperationRef =
          attempt.outcome?.kind === "outcome_unknown"
            ? attempt.outcome.priorSucceededProviderOperationRef
            : null;
        if (
          priorSucceededProviderOperationRef !== null &&
          (input.resolution.kind !== "succeeded" ||
            input.resolution.providerOperationRef !==
              priorSucceededProviderOperationRef)
        ) {
          return { kind: "unavailable" as const };
        }
        await this.appendUsage(tx, input.usagePlan, attempt);
        await this.appendUsageAttribution(tx, input.usageAttributionPlan, attempt);
        let sequence = run.nextEventSequence;
        const events: WorkflowRunEventRecord[] = [];
        if (input.resolution.kind === "succeeded") {
          const entries = Object.entries(input.resolution.outputs).sort(
            ([left], [right]) => compareCodeUnits(left, right),
          );
          entries.forEach(([outputName, output], index) => {
            events.push({
              id: input.eventIds.generated[index]!,
              workspaceId: input.workspaceId,
              runId: input.runId,
              sequence: sequence++,
              type: "artifact.generated",
              data: {
                stepAttemptId: attempt.id,
                stepId: attempt.stepId,
                outputName,
                artifactId: output.artifactId,
                digest: output.digest,
              },
              occurredAt: databaseNow,
            });
          });
          events.push(
            {
              id: input.eventIds.reconciled,
              workspaceId: input.workspaceId,
              runId: input.runId,
              sequence: sequence++,
              type: "step.attempt.reconciled",
              data: { stepAttemptId: attempt.id, resolution: "succeeded" },
              occurredAt: databaseNow,
            },
            {
              id: input.eventIds.attemptCompleted!,
              workspaceId: input.workspaceId,
              runId: input.runId,
              sequence: sequence++,
              type: "step.attempt.completed",
              data: {
                stepAttemptId: attempt.id,
                stepId: attempt.stepId,
                attempt: attempt.attempt,
                effectKey: attempt.effectKey,
                outputArtifactIds: entries.map(
                  ([, output]) => output.artifactId,
                ),
              },
              occurredAt: databaseNow,
            },
          );
          const final = input.resolution.finalSnapshot !== null;
          events.push({
            id: final ? input.eventIds.runCompleted! : input.eventIds.runWaiting!,
            workspaceId: input.workspaceId,
            runId: input.runId,
            sequence: sequence++,
            type: final ? "run.completed" : "run.waiting",
            data: final
              ? { finalSnapshotDigest: input.resolution.finalSnapshotDigest }
              : { reasonCode: "RECONCILED_NEXT_STEP", resumeAt: databaseNow.toISOString() },
            occurredAt: databaseNow,
          });
          await tx
            .update(workflowStepAttempts)
            .set({
              state: "completed",
              outputs: input.resolution.outputs,
              providerOperationRef: input.resolution.providerOperationRef,
              outcome: {
                kind: "succeeded",
                providerOperationRef: input.resolution.providerOperationRef,
              },
              reconciliation: {
                reference: input.resolution.providerOperationRef,
                resolution: "succeeded",
                reconciledAt: databaseNow.toISOString(),
              },
              providerMetadata: input.resolution.providerMetadata,
              failureCode: null,
              completedAt: databaseNow,
            })
            .where(eq(workflowStepAttempts.id, attempt.id));
          if (input.resolution.outboxIntent) {
            await tx.insert(workflowRunOutboxIntents).values({
              ...input.resolution.outboxIntent,
              availableAt: databaseNow,
              createdAt: databaseNow,
            });
          }
          await tx.insert(workflowRunEvents).values(events);
          await tx
            .update(workflowRuns)
            .set({
              state: final ? "completed" : "waiting",
              output: input.resolution.finalSnapshot?.outputs ?? null,
              finalSnapshot: input.resolution.finalSnapshot,
              finalSnapshotDigest: input.resolution.finalSnapshotDigest,
              failureCode: final ? null : "RECONCILED_NEXT_STEP",
              resumeAt: final ? null : databaseNow,
              completedAt: final ? databaseNow : null,
              nextEventSequence: sequence,
              updatedAt: databaseNow,
            })
            .where(
              and(
                eq(workflowRuns.workspaceId, input.workspaceId),
                eq(workflowRuns.id, run.id),
                eq(workflowRuns.state, "outcome_unknown"),
              ),
            );
        } else {
          events.push(
            {
              id: input.eventIds.reconciled,
              workspaceId: input.workspaceId,
              runId: input.runId,
              sequence: sequence++,
              type: "step.attempt.reconciled",
              data: { stepAttemptId: attempt.id, resolution: "failed_known" },
              occurredAt: databaseNow,
            },
            {
              id: input.eventIds.attemptFailed!,
              workspaceId: input.workspaceId,
              runId: input.runId,
              sequence: sequence++,
              type: "step.attempt.failed",
              data: {
                stepAttemptId: attempt.id,
                stepId: attempt.stepId,
                attempt: attempt.attempt,
                effectKey: attempt.effectKey,
                reasonCode: input.resolution.failureCode,
              },
              occurredAt: databaseNow,
            },
          );
          if (input.resolution.retryable) {
            events.push(
              {
                id: input.eventIds.retryScheduled!,
                workspaceId: input.workspaceId,
                runId: input.runId,
                sequence: sequence++,
                type: "step.retry.scheduled",
                data: {
                  stepAttemptId: attempt.id,
                  stepId: attempt.stepId,
                  attempt: attempt.attempt,
                  nextAttempt: attempt.attempt + 1,
                  retryAt: input.resolution.retryAt!.toISOString(),
                  effectKey: attempt.effectKey,
                },
                occurredAt: databaseNow,
              },
              {
                id: input.eventIds.runWaiting!,
                workspaceId: input.workspaceId,
                runId: input.runId,
                sequence: sequence++,
                type: "run.waiting",
                data: {
                  reasonCode: input.resolution.failureCode,
                  resumeAt: input.resolution.retryAt!.toISOString(),
                },
                occurredAt: databaseNow,
              },
            );
          } else {
            events.push({
              id: input.eventIds.runFailed!,
              workspaceId: input.workspaceId,
              runId: input.runId,
              sequence: sequence++,
              type: "run.failed",
              data: {
                stepAttemptId: attempt.id,
                reasonCode: input.resolution.failureCode,
              },
              occurredAt: databaseNow,
            });
          }
          await tx
            .update(workflowStepAttempts)
            .set({
              state: "failed",
              providerOperationRef: input.resolution.providerOperationRef,
              outcome: {
                kind: "failed_known",
                failureCode: input.resolution.failureCode,
                retryable: input.resolution.retryable,
              },
              reconciliation: {
                reference: input.resolution.providerOperationRef ?? attempt.effectKey,
                resolution: "failed_known",
                reconciledAt: databaseNow.toISOString(),
              },
              providerMetadata: input.resolution.providerMetadata,
              failureCode: input.resolution.failureCode,
              completedAt: databaseNow,
            })
            .where(eq(workflowStepAttempts.id, attempt.id));
          if (input.resolution.outboxIntent) {
            await tx.insert(workflowRunOutboxIntents).values({
              ...input.resolution.outboxIntent,
              availableAt: input.resolution.retryAt!,
              createdAt: databaseNow,
            });
          }
          await tx.insert(workflowRunEvents).values(events);
          await tx
            .update(workflowRuns)
            .set({
              state: input.resolution.retryable ? "waiting" : "failed",
              failureCode: input.resolution.failureCode,
              resumeAt: input.resolution.retryAt,
              completedAt: input.resolution.retryable ? null : databaseNow,
              nextEventSequence: sequence,
              updatedAt: databaseNow,
            })
            .where(
              and(
                eq(workflowRuns.workspaceId, input.workspaceId),
                eq(workflowRuns.id, run.id),
                eq(workflowRuns.state, "outcome_unknown"),
              ),
            );
        }
        const updated = await findRun(tx, {
          workspaceId: input.workspaceId,
          runId: input.runId,
        });
        if (!updated) throw new Error("Reconciliation was lost.");
        const receipt = {
          ...input.receipt,
          result: workflowRunReceiptResult(
            updated,
            input.receipt.initialEventCursor,
          ),
          createdAt: databaseNow,
        };
        await tx.insert(workflowRunMutationReceipts).values(receipt);
        return {
          kind: "created" as const,
          run: updated,
          receipt,
        };
      });
    } catch {
      return { kind: "unavailable" as const };
    }
  }
}
