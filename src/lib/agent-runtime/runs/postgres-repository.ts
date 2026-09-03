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
  contentWorkflows,
  contentWorkflowRevisions,
  workflowRunEvents,
  workflowRunExecutionLeases,
  workflowRunMutationReceipts,
  workflowRunOutboxIntents,
  workflowRuns,
  workflowStepAttempts,
  runtimeQuotaWaits,
  runtimeWorkflowRunSpendQuoteRedemptions,
} from "@/lib/db/schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  appendContractEvidenceVersion,
  projectRunContractEvidence,
} from "../contract-evidence";
import type {
  UsageAttributionAppendPlan,
  UsageCommitWriter,
  UsageLedgerAppendPlan,
} from "../usage/types";
import type { BudgetCommitWriter } from "../budgets/types";
import type {
  QuotaClaimPlan,
  QuotaClaimCommitResult,
  QuotaCommitWriter,
  QuotaExhaustionEvidence,
  QuotaTransitionPlan,
  QuotaUsageReconciliationPlan,
  QuotaWait,
} from "../quotas/types";
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
import { WorkflowRunSpendQuoteCodec, workflowRunQuoteCeilingDigest, type WorkflowRunAcceptedSpendQuote } from "./spend-quote";

function sameQuotaResumeActor(
  left: QuotaWait["resumedBy"],
  right: QuotaWait["resumedBy"],
): boolean {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === "human" && right.kind === "human") {
    return left.userId === right.userId;
  }
  if (left.kind === "principal" && right.kind === "principal") {
    return left.principalId === right.principalId;
  }
  return left.kind === "system" && right.kind === "system";
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

class QuotaAdmissionDenied extends Error {
  constructor(
    readonly reasonCodes: Array<"QUOTA_POLICY_UNAVAILABLE" | "QUOTA_CAPACITY_EXHAUSTED" | "EMERGENCY_SPEND_SUSPENDED">,
    readonly evidence: QuotaExhaustionEvidence[],
  ) {
    super("Run quota admission denied.");
  }
}

const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

function quotaWaitEventData(wait: QuotaWait): Record<string, unknown> {
  return {
    schema: wait.schema,
    waitId: wait.id,
    boundary: wait.boundary,
    subject: wait.subject,
    claims: wait.claims,
    reasonCode: wait.reasonCode,
    evidence: wait.evidence.map((item) => ({
      ...item,
      window: {
        ...item.window,
        startsAt: item.window.startsAt.toISOString(),
        endsAt: item.window.endsAt?.toISOString() ?? null,
      },
      evaluatedAt: item.evaluatedAt.toISOString(),
      eligibleAt: item.eligibleAt?.toISOString() ?? null,
      eligibility: item.eligibility.kind === "window_renewal"
        ? { kind: item.eligibility.kind, eligibleAt: item.eligibility.eligibleAt.toISOString() }
        : item.eligibility,
    })),
    eligibleAt: wait.eligibleAt?.toISOString() ?? null,
    createdAt: wait.createdAt.toISOString(),
  };
}

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

function quoteMatchesAdmission(input: {
  quote: WorkflowRunAcceptedSpendQuote;
  run: WorkflowRunRecord;
  receipt: WorkflowRunMutationReceiptRecord;
  budgetAdmissionPlan: import("../budgets/types").BudgetAdmissionPlan | null | undefined;
}): boolean {
  const plan = input.budgetAdmissionPlan;
  if (!plan || !input.run.startSnapshot.acceptedSpendQuote) return false;
  const providerModels = plan.stepExposures.map((exposure) => ({
    provider: exposure.provider,
    model: exposure.model,
    pricePerAttempt: exposure.amountPerAttempt ?? "",
    automaticAttempts: exposure.automaticAttempts,
    pricingSnapshotIds: [...exposure.pricingSnapshotIds].sort(),
  }));
  const pricingSnapshotIds = [...new Set(providerModels.flatMap((item) => item.pricingSnapshotIds))].sort();
  return canonicalDigest(input.quote) === canonicalDigest(input.run.startSnapshot.acceptedSpendQuote) &&
    input.quote.targetWorkspaceId === input.run.workspaceId &&
    input.quote.delegatedPrincipalId === input.receipt.principalId &&
    input.quote.delegatedKeyId === input.receipt.keyId &&
    input.quote.workflowId === input.run.workflowId &&
    input.quote.workflowRevisionId === input.run.workflowRevisionId &&
    input.quote.expiresAt > input.run.acceptedAt.toISOString() &&
    input.quote.quotedAt <= input.run.acceptedAt.toISOString() &&
    input.quote.pricingSnapshotIds.length === pricingSnapshotIds.length &&
    input.quote.pricingSnapshotIds.every((id, index) => id === pricingSnapshotIds[index]) &&
    plan.reservations.length > 0 &&
    plan.reservations.every((reservation) => reservation.currency === input.quote.currency && reservation.reservedAmount === input.quote.amount) &&
    input.quote.ceiling.maximumAmount === input.quote.amount &&
    input.quote.ceiling.currency === input.quote.currency &&
    input.quote.ceiling.maximumProviderAttempts === providerModels.reduce((total, model) => total + model.automaticAttempts, 0) &&
    workflowRunQuoteCeilingDigest({ amount: input.quote.amount, currency: input.quote.currency, providerModels, pricingSnapshotIds, ceiling: input.quote.ceiling }) === input.quote.ceilingDigest;
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

async function appendRunContractEvidence(
  tx: Tx,
  input: { workspaceId: string; runId: string },
): Promise<void> {
  const [row] = await tx.select().from(workflowRuns).where(and(
    eq(workflowRuns.workspaceId, input.workspaceId),
    eq(workflowRuns.id, input.runId),
  )).limit(1);
  if (!row) throw new Error("Workflow Run Contract Evidence source is unavailable.");
  const run = mapRun(row);
  await appendContractEvidenceVersion(tx, {
    workspaceId: row.workspaceId,
    resourceKind: "run",
    resourceId: row.id,
    canonicalSource: row,
    projectionKind: "run_summary",
    projection: projectRunContractEvidence({
      ...run,
      sourceRunId: row.sourceRunId,
      rootRunId: row.rootRunId,
      derivationDepth: row.derivationDepth,
    }),
    createdAt: row.updatedAt,
  });
}

export class DrizzleWorkflowRunRepository implements WorkflowRunRepository {
  constructor(
    private readonly getDatabase: () => Db,
    private readonly usageWriter?: UsageCommitWriter<Tx>,
    private readonly budgetWriter?: BudgetCommitWriter<Tx>,
    private readonly quotaWriter?: QuotaCommitWriter<Tx>,
    private readonly spendQuotes: WorkflowRunSpendQuoteCodec = new WorkflowRunSpendQuoteCodec(null),
  ) {}

  private async commitQuotaClaim(tx: Tx, plan: QuotaClaimPlan | null | undefined) {
    if (!plan) return null;
    if (!this.quotaWriter) throw new Error("Quota writer is unavailable.");
    return this.quotaWriter.commitClaim(plan, tx);
  }

  private async commitQuotaClaimsAtomically(tx: Tx, plans: QuotaClaimPlan[]) {
    if (!this.quotaWriter) throw new Error("Quota writer is unavailable.");
    return this.quotaWriter.commitClaimsAtomically(plans, tx);
  }

  private async commitQuotaTransitions(tx: Tx, plans: QuotaTransitionPlan[] | undefined) {
    if (!plans?.length) return;
    if (!this.quotaWriter) throw new Error("Quota writer is unavailable.");
    for (const plan of plans) {
      const result = await this.quotaWriter.commitTransition(plan, tx);
      if (result.kind !== "created" && result.kind !== "replayed") {
        throw new Error("Quota transition could not be committed.");
      }
      for (const wait of result.newlyEligibleWaits) {
        const runs = await tx.select({ nextEventSequence: workflowRuns.nextEventSequence })
          .from(workflowRuns)
          .where(and(
            eq(workflowRuns.workspaceId, wait.workspaceId),
            eq(workflowRuns.id, wait.runId),
          )).limit(1);
        if (!runs[0]) continue;
        await tx.insert(workflowRunOutboxIntents).values({
          id: randomUUID(),
          workspaceId: wait.workspaceId,
          runId: wait.runId,
          generation: runs[0].nextEventSequence,
          dedupeKey: `quota-wait-resume:${wait.waitId}`,
          state: "pending",
          deliveryToken: null,
          deliveryAttempts: 0,
          availableAt: wait.eligibleAt ?? plan.recordedAt,
          claimedAt: null,
          deliveredAt: null,
          createdAt: plan.recordedAt,
        }).onConflictDoUpdate({
          target: workflowRunOutboxIntents.dedupeKey,
          set: {
            state: "pending",
            deliveryToken: null,
            claimedAt: null,
            deliveredAt: null,
            availableAt: wait.eligibleAt ?? plan.recordedAt,
          },
        });
      }
    }
  }

  private async commitQuotaUsageReconciliations(
    tx: Tx,
    plans: QuotaUsageReconciliationPlan[] | undefined,
  ) {
    if (!plans?.length) return;
    if (!this.quotaWriter) throw new Error("Quota writer is unavailable.");
    for (const plan of plans) {
      const result = await this.quotaWriter.commitUsageReconciliation(plan, tx);
      if (result.kind !== "created" && result.kind !== "replayed") {
        throw new Error("Quota Usage reconciliation could not be committed.");
      }
    }
  }

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

  private async appendBudgetSettlement(
    tx: Tx,
    plan: import("../budgets/types").BudgetSettlementPlan | null | undefined,
    attempt: WorkflowStepAttemptRecord,
  ): Promise<void> {
    if (!plan) return;
    if (
      !this.budgetWriter ||
      plan.workspaceId !== attempt.workspaceId ||
      plan.runId !== attempt.runId ||
      plan.stepAttemptId !== attempt.id
    ) {
      throw new Error("Budget settlement plan does not match the Step Attempt.");
    }
    const result = await this.budgetWriter.commitSettlement(plan, tx);
    if (result !== "created" && result !== "replayed") {
      throw new Error("Budget settlement append failed.");
    }
  }

  private async appendBudgetAttemptAllocation(
    tx: Tx,
    input: import("../budgets/types").BudgetAttemptAllocationInput | null | undefined,
    attempt: WorkflowStepAttemptRecord,
  ): Promise<void> {
    if (!input) return;
    if (
      !this.budgetWriter || input.workspaceId !== attempt.workspaceId ||
      input.runId !== attempt.runId || input.stepAttemptId !== attempt.id ||
      input.stepId !== attempt.stepId || input.attempt !== attempt.attempt ||
      input.effectKey !== attempt.effectKey || input.provider !== attempt.provider ||
      input.providerOperation !== attempt.providerOperation || input.model !== attempt.model
    ) {
      throw new Error("Budget Attempt allocation does not match the Step Attempt.");
    }
    const result = await this.budgetWriter.commitAttemptAllocation(input, tx);
    if (result !== "created" && result !== "replayed") {
      throw new Error("Budget Attempt allocation is unavailable.");
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

        const quote = input.acceptedSpendQuoteRef ? this.spendQuotes.open(input.acceptedSpendQuoteRef) : null;
        if (
          Boolean(input.acceptedSpendQuoteRef) !== Boolean(input.acceptedSpendQuote) ||
          (input.acceptedSpendQuote && (!quote || !quoteMatchesAdmission({ quote, run: input.run, receipt: input.receipt, budgetAdmissionPlan: input.budgetAdmissionPlan })))
        ) return { kind: "unavailable" as const };
        if (quote) {
          const redeemed = await tx.select({ runId: runtimeWorkflowRunSpendQuoteRedemptions.runId })
            .from(runtimeWorkflowRunSpendQuoteRedemptions)
            .where(eq(runtimeWorkflowRunSpendQuoteRedemptions.quoteId, quote.quoteId))
            .limit(1)
            .for("update");
          if (redeemed[0]) return { kind: "unavailable" as const };
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
        if (quote) {
          const [workflow] = await tx.select({ id: contentWorkflows.id, currentRevision: contentWorkflows.currentRevision, updatedAt: contentWorkflows.updatedAt })
            .from(contentWorkflows)
            .where(and(eq(contentWorkflows.workspaceId, input.run.workspaceId), eq(contentWorkflows.id, input.run.workflowId)))
            .limit(1)
            .for("share");
          if (!workflow || canonicalDigest(workflow) !== quote.targetStateDigest) return { kind: "unavailable" as const };
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
        if (quote) await tx.insert(runtimeWorkflowRunSpendQuoteRedemptions).values({
          quoteId: quote.quoteId,
          workspaceId: input.run.workspaceId,
          runId: input.run.id,
          principalId: input.receipt.principalId,
          keyId: input.receipt.keyId,
          amount: quote.amount,
          currency: quote.currency,
          pricingSnapshotIds: quote.pricingSnapshotIds,
          targetStateDigest: quote.targetStateDigest,
          ceilingDigest: quote.ceilingDigest,
          quote,
          redeemedAt: input.run.acceptedAt,
        });
        await appendRunContractEvidence(tx, {
          workspaceId: input.run.workspaceId,
          runId: input.run.id,
        });
        const quotaResult = await this.commitQuotaClaim(tx, input.quotaAdmissionPlan);
        if (quotaResult?.kind === "denied") {
          if (quotaResult.reasonCodes.includes("EMERGENCY_SPEND_SUSPENDED")) {
            throw new Error("Spend suspension cannot be represented as quota admission denial.");
          }
          throw new QuotaAdmissionDenied(quotaResult.reasonCodes, quotaResult.evidence);
        }
        if (
          quotaResult && quotaResult.kind !== "created" && quotaResult.kind !== "replayed" &&
          quotaResult.kind !== "wait" && quotaResult.kind !== "replayed_wait"
        ) throw new Error("Quota admission could not be committed.");
        if (input.budgetAdmissionPlan) {
          if (
            !this.budgetWriter ||
            input.budgetAdmissionPlan.workspaceId !== input.run.workspaceId ||
            input.budgetAdmissionPlan.principalId !== input.receipt.principalId ||
            input.budgetAdmissionPlan.runId !== input.run.id
          ) throw new Error("Budget admission plan does not match the Run.");
          const budgetResult = await this.budgetWriter.commitAdmission(
            input.budgetAdmissionPlan,
            tx,
          );
          if (budgetResult !== "created" && budgetResult !== "replayed") {
            throw new Error("Budget admission was not available at Durable Acceptance.");
          }
        }
        const wait = quotaResult?.kind === "wait" || quotaResult?.kind === "replayed_wait"
          ? quotaResult.wait
          : null;
        if (wait && !input.quotaWaitEventId) throw new Error("Quota Wait event is unavailable.");
        const persistedRun: WorkflowRunRecord = wait ? {
          ...input.run,
          state: "waiting",
          nextEventSequence: input.run.nextEventSequence + 1,
          resumeAt: wait.eligibleAt,
          failureCode: "QUOTA_WAIT",
          updatedAt: wait.createdAt,
        } : input.run;
        if (wait) {
          const updated = await tx.update(workflowRuns).set({
            state: persistedRun.state,
            nextEventSequence: persistedRun.nextEventSequence,
            resumeAt: persistedRun.resumeAt,
            failureCode: persistedRun.failureCode,
            updatedAt: persistedRun.updatedAt,
          }).where(and(
            eq(workflowRuns.workspaceId, input.run.workspaceId),
            eq(workflowRuns.id, input.run.id),
            eq(workflowRuns.state, "accepted"),
          )).returning({ id: workflowRuns.id });
          if (!updated[0]) throw new Error("Quota Wait acceptance transition was lost.");
          await appendRunContractEvidence(tx, {
            workspaceId: input.run.workspaceId,
            runId: input.run.id,
          });
        }
        await tx.insert(workflowRunEvents).values(input.firstEvent);
        if (wait) {
          await tx.insert(workflowRunEvents).values({
            id: input.quotaWaitEventId!,
            workspaceId: input.run.workspaceId,
            runId: input.run.id,
            sequence: input.run.nextEventSequence,
            type: "run.waiting",
            data: quotaWaitEventData(wait),
            occurredAt: wait.createdAt,
          });
        }
        await tx.insert(workflowRunMutationReceipts).values(input.receipt);
        if (!wait || wait.eligibleAt) {
          await tx.insert(workflowRunOutboxIntents).values({
            ...input.outboxIntent,
            generation: wait ? input.run.nextEventSequence : input.outboxIntent.generation,
            dedupeKey: wait
              ? `workflow-run:${input.run.workspaceId}:${input.run.id}:v${input.run.nextEventSequence}:quota-wait`
              : input.outboxIntent.dedupeKey,
            availableAt: wait?.eligibleAt ?? input.outboxIntent.availableAt,
          });
        }
        return {
          kind: "created" as const,
          run: persistedRun,
          receipt: input.receipt,
        };
      });
    } catch (error) {
      if (error instanceof QuotaAdmissionDenied) {
        return {
          kind: "quota_denied" as const,
          reasonCodes: error.reasonCodes,
          evidence: error.evidence,
        };
      }
      return { kind: "unavailable" as const };
    }
  }

  get(input: Parameters<WorkflowRunRepository["get"]>[0]) {
    return findRun(this.getDatabase(), input);
  }

  async getById(input: Parameters<WorkflowRunRepository["getById"]>[0]) {
    const rows = await this.getDatabase()
      .select()
      .from(workflowRuns)
      .where(and(
        eq(workflowRuns.workspaceId, input.workspaceId),
        eq(workflowRuns.id, input.runId),
      ))
      .limit(1);
    return rows[0] ? mapRun(rows[0]) : null;
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

  async enqueueQuotaWaitResumptions(
    input: Parameters<WorkflowRunRepository["enqueueQuotaWaitResumptions"]>[0],
  ) {
    return this.getDatabase().transaction(async (tx) => {
      let created = 0;
      for (const wait of input.waits) {
        const runs = await tx.select({ nextEventSequence: workflowRuns.nextEventSequence })
          .from(workflowRuns)
          .where(and(
            eq(workflowRuns.workspaceId, wait.workspaceId),
            eq(workflowRuns.id, wait.runId),
          )).limit(1);
        if (!runs[0]) continue;
        const inserted = await tx.insert(workflowRunOutboxIntents).values({
          id: randomUUID(),
          workspaceId: wait.workspaceId,
          runId: wait.runId,
          generation: runs[0].nextEventSequence,
          dedupeKey: `quota-wait-resume:${wait.waitId}`,
          state: "pending",
          deliveryToken: null,
          deliveryAttempts: 0,
          availableAt: wait.eligibleAt ?? input.enqueuedAt,
          claimedAt: null,
          deliveredAt: null,
          createdAt: input.enqueuedAt,
        }).onConflictDoUpdate({
          target: workflowRunOutboxIntents.dedupeKey,
          set: {
            state: "pending",
            deliveryToken: null,
            claimedAt: null,
            deliveredAt: null,
            availableAt: wait.eligibleAt ?? input.enqueuedAt,
          },
        })
          .returning({ id: workflowRunOutboxIntents.id });
        created += inserted.length;
      }
      return created;
    });
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
        if (
          ((run.state === "accepted" || run.state === "waiting") && input.quotaResumePlan) ||
          ((run.state === "accepted" || run.state === "waiting" || run.state === "running") && input.quotaConcurrencyPlan) ||
          (run.state === "waiting" && run.failureCode === "QUOTA_WAIT")
        ) {
          let quotaResult;
          if (input.quotaResumePlan && input.quotaConcurrencyPlan) {
            const batch = await this.commitQuotaClaimsAtomically(
              tx,
              [input.quotaConcurrencyPlan, input.quotaResumePlan],
            );
            if (batch.kind === "blocked") {
              const waitId = input.quotaResumePlan.resumesWaitId;
              const wait = waitId && this.quotaWriter
                ? await this.quotaWriter.getWait(
                    { workspaceId: run.workspaceId, waitId },
                    tx,
                  )
                : null;
              return wait?.state === "waiting"
                ? { kind: "quota_wait" as const, run, wait }
                : { kind: "unavailable" as const };
            }
            quotaResult = batch.results.at(-1) ?? null;
          } else {
            quotaResult = await this.commitQuotaClaim(tx, input.quotaResumePlan);
            if (
              (!quotaResult || quotaResult.kind === "created" || quotaResult.kind === "replayed") &&
              input.quotaConcurrencyPlan
            ) {
              quotaResult = await this.commitQuotaClaim(tx, input.quotaConcurrencyPlan);
            }
          }
          if (quotaResult?.kind === "wait" || quotaResult?.kind === "replayed_wait") {
            if (!input.quotaWaitEventId) throw new Error("Quota Wait event is unavailable.");
            const wait = quotaResult.wait;
            if (
              quotaResult.kind === "replayed_wait" &&
              run.state === "waiting" &&
              run.failureCode === "QUOTA_WAIT"
            ) return { kind: "quota_wait" as const, run, wait };
            const updated = await tx.update(workflowRuns).set({
              state: "waiting",
              resumeAt: wait.eligibleAt,
              failureCode: "QUOTA_WAIT",
              nextEventSequence: run.nextEventSequence + 1,
              updatedAt: wait.createdAt,
            }).where(and(
              eq(workflowRuns.workspaceId, run.workspaceId),
              eq(workflowRuns.id, run.id),
              eq(workflowRuns.nextEventSequence, run.nextEventSequence),
            )).returning();
            if (!updated[0]) throw new Error("Quota Wait lost Run serialization.");
            await appendRunContractEvidence(tx, {
              workspaceId: run.workspaceId,
              runId: run.id,
            });
            await tx.insert(workflowRunEvents).values({
              id: input.quotaWaitEventId,
              workspaceId: run.workspaceId,
              runId: run.id,
              sequence: run.nextEventSequence,
              type: "run.waiting",
              data: quotaWaitEventData(wait),
              occurredAt: wait.createdAt,
            });
            if (wait.eligibleAt && input.quotaWaitOutboxIntent) {
              await tx.insert(workflowRunOutboxIntents).values({
                ...input.quotaWaitOutboxIntent,
                generation: run.nextEventSequence,
                availableAt: wait.eligibleAt,
              }).onConflictDoNothing({ target: workflowRunOutboxIntents.dedupeKey });
            }
            return { kind: "quota_wait" as const, run: mapRun(updated[0]), wait };
          }
          if (
            !quotaResult ||
            (quotaResult.kind !== "created" && quotaResult.kind !== "replayed")
          ) return { kind: "busy" as const };
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
              data: input.quotaResumePlan ? {
                automatic: true,
                waitId: input.quotaResumePlan.resumesWaitId,
                reason: input.quotaResumePlan.resumeReason,
                actor: input.quotaResumePlan.resumeActor,
                reservationIds: input.quotaResumePlan.reservations.map((item) => item.id),
              } : { automatic: true },
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
          await appendRunContractEvidence(tx, {
            workspaceId: run.workspaceId,
            runId: run.id,
          });
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
      quotaTransitionPlans?: QuotaTransitionPlan[];
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
        await this.commitQuotaTransitions(tx, input.quotaTransitionPlans);
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
        await appendRunContractEvidence(tx, {
          workspaceId: input.workspaceId,
          runId: input.runId,
        });
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
          await this.appendBudgetAttemptAllocation(
            tx,
            input.budgetAttemptAllocation,
            existing,
          );
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

        const quotaPlans = input.quotaClaimPlans ?? [];
        const quotaBatch = quotaPlans.length
          ? await this.commitQuotaClaimsAtomically(tx, quotaPlans)
          : null;
        const blockedBoundary = quotaBatch?.kind === "blocked"
          ? quotaBatch.blockedPlan.boundary
          : null;
        let quotaResult: QuotaClaimCommitResult | null =
          quotaBatch?.kind === "blocked" ? quotaBatch.result : null;
        if (quotaResult?.kind === "wait" || quotaResult?.kind === "replayed_wait") {
          const blockedWait = quotaResult.wait;
          const waitPlan = quotaPlans.find(
            (plan) => plan.transitionKey === blockedWait.transitionKey,
          );
          quotaResult = waitPlan
            ? await this.commitQuotaClaim(tx, waitPlan)
            : { kind: "unavailable" };
        }
        if (quotaResult?.kind === "wait" || quotaResult?.kind === "replayed_wait") {
          if (!input.quotaWaitEventId) throw new Error("Quota Wait event is unavailable.");
          const wait = quotaResult.wait;
          await this.commitQuotaTransitions(tx, input.quotaWaitReleasePlans);
          const updated = await tx.update(workflowRuns).set({
            state: "waiting",
            resumeAt: wait.eligibleAt,
            failureCode: "QUOTA_WAIT",
            nextEventSequence: run.nextEventSequence + 1,
            updatedAt: wait.createdAt,
          }).where(and(
            eq(workflowRuns.workspaceId, run.workspaceId),
            eq(workflowRuns.id, run.id),
            eq(workflowRuns.state, "running"),
            eq(workflowRuns.nextEventSequence, run.nextEventSequence),
          )).returning();
          if (!updated[0]) throw new Error("Quota Wait lost Run serialization.");
          await appendRunContractEvidence(tx, {
            workspaceId: run.workspaceId,
            runId: run.id,
          });
          await tx.insert(workflowRunEvents).values({
            id: input.quotaWaitEventId,
            workspaceId: run.workspaceId,
            runId: run.id,
            sequence: run.nextEventSequence,
            type: "run.waiting",
            data: quotaWaitEventData(wait),
            occurredAt: wait.createdAt,
          });
          await tx.update(workflowRunExecutionLeases).set({ releasedAt: wait.createdAt }).where(and(
            eq(workflowRunExecutionLeases.workspaceId, run.workspaceId),
            eq(workflowRunExecutionLeases.runId, run.id),
            eq(workflowRunExecutionLeases.fence, input.fence),
            isNull(workflowRunExecutionLeases.releasedAt),
          ));
          if (wait.eligibleAt && input.quotaWaitOutboxIntent) {
            await tx.insert(workflowRunOutboxIntents).values({
              ...input.quotaWaitOutboxIntent,
              generation: run.nextEventSequence,
              availableAt: wait.eligibleAt,
            }).onConflictDoNothing({ target: workflowRunOutboxIntents.dedupeKey });
          }
          return { kind: "quota_wait" as const, run: mapRun(updated[0]), wait };
        }
        if (quotaResult?.kind === "denied") {
          if (blockedBoundary !== "provider_effect" && blockedBoundary !== "usage_settlement") {
            throw new Error("Provider quota claim returned an invalid blocked boundary.");
          }
          const missingUsagePolicy =
            quotaResult.reasonCodes.includes("QUOTA_POLICY_UNAVAILABLE") &&
            blockedBoundary === "usage_settlement";
          if (missingUsagePolicy) {
            if (!input.quotaPolicyUnavailableEventId) {
              throw new Error("Usage quota policy failure event is unavailable.");
            }
            const failedRows = await tx.update(workflowRuns).set({
              state: "failed",
              output: null,
              finalSnapshot: null,
              finalSnapshotDigest: null,
              failureCode: "QUOTA_USAGE_CEILING_UNAVAILABLE",
              resumeAt: null,
              nextEventSequence: run.nextEventSequence + 1,
              completedAt: databaseNow,
              updatedAt: databaseNow,
            }).where(and(
              eq(workflowRuns.workspaceId, run.workspaceId),
              eq(workflowRuns.id, run.id),
              eq(workflowRuns.state, "running"),
              eq(workflowRuns.nextEventSequence, run.nextEventSequence),
            )).returning();
            if (!failedRows[0]) throw new Error("Usage quota failure lost Run serialization.");
            await appendRunContractEvidence(tx, {
              workspaceId: run.workspaceId,
              runId: run.id,
            });
            await tx.insert(workflowRunEvents).values({
              id: input.quotaPolicyUnavailableEventId,
              workspaceId: run.workspaceId,
              runId: run.id,
              sequence: run.nextEventSequence,
              type: "run.failed",
              data: {
                reasonCode: "QUOTA_USAGE_CEILING_UNAVAILABLE",
                quotaBoundary: "usage_settlement",
              },
              occurredAt: databaseNow,
            });
            await tx.update(workflowRunExecutionLeases).set({ releasedAt: databaseNow }).where(and(
              eq(workflowRunExecutionLeases.workspaceId, run.workspaceId),
              eq(workflowRunExecutionLeases.runId, run.id),
              eq(workflowRunExecutionLeases.fence, input.fence),
              isNull(workflowRunExecutionLeases.releasedAt),
            ));
            return {
              kind: "effect_blocked" as const,
              run: mapRun(failedRows[0]),
              reasonCode: "QUOTA_POLICY_UNAVAILABLE" as const,
              blockedBoundary: "usage_settlement" as const,
            };
          }
          await tx.update(workflowRunExecutionLeases).set({ releasedAt: databaseNow }).where(and(
            eq(workflowRunExecutionLeases.workspaceId, run.workspaceId),
            eq(workflowRunExecutionLeases.runId, run.id),
            eq(workflowRunExecutionLeases.fence, input.fence),
            isNull(workflowRunExecutionLeases.releasedAt),
          ));
          if (input.quotaWaitOutboxIntent) {
            await tx.insert(workflowRunOutboxIntents).values({
              ...input.quotaWaitOutboxIntent,
              generation: run.nextEventSequence,
              dedupeKey: `spend-suspension-retry:${run.id}:${run.nextEventSequence}`,
              availableAt: new Date(databaseNow.getTime() + 30_000),
              createdAt: databaseNow,
            }).onConflictDoUpdate({
              target: workflowRunOutboxIntents.dedupeKey,
              set: {
                state: "pending",
                deliveryToken: null,
                claimedAt: null,
                deliveredAt: null,
                availableAt: new Date(databaseNow.getTime() + 30_000),
              },
            });
          }
          return {
            kind: "effect_blocked" as const,
            run,
            reasonCode: quotaResult.reasonCodes[0] ?? "QUOTA_POLICY_UNAVAILABLE" as const,
            blockedBoundary,
          };
        }
        if (
          quotaResult && quotaResult.kind !== "created" && quotaResult.kind !== "replayed"
        ) throw new Error("Provider quota claim could not be committed.");

        const attempt: WorkflowStepAttemptRecord = {
          ...input.attempt,
          inputs: structuredClone(input.attempt.inputs),
          startedAt: databaseNow,
        };
        await tx.insert(workflowStepAttempts).values(attempt);
        await this.appendBudgetAttemptAllocation(
          tx,
          input.budgetAttemptAllocation,
          attempt,
        );
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
        await appendRunContractEvidence(tx, {
          workspaceId: run.workspaceId,
          runId: run.id,
        });
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
          await this.appendBudgetSettlement(tx, input.budgetSettlementPlan, attempt);
          await this.commitQuotaTransitions(tx, input.quotaTransitionPlans);
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
        await this.appendBudgetSettlement(tx, input.budgetSettlementPlan, attempt);
        await this.commitQuotaTransitions(tx, input.quotaTransitionPlans);
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
        await appendRunContractEvidence(tx, {
          workspaceId: input.workspaceId,
          runId: input.runId,
        });

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
          await this.commitQuotaUsageReconciliations(tx, input.quotaUsageReconciliationPlans);
          await this.appendBudgetSettlement(tx, input.budgetSettlementPlan, attempt);
          await this.commitQuotaTransitions(tx, input.quotaTransitionPlans);
          return { kind: "settled" as const, run, attempt };
        }
        if (!input.usagePlan) return { kind: "unavailable" as const };
        await this.appendUsage(tx, input.usagePlan, attempt);
        await this.commitQuotaUsageReconciliations(tx, input.quotaUsageReconciliationPlans);
        await this.appendBudgetSettlement(tx, input.budgetSettlementPlan, attempt);
        await this.commitQuotaTransitions(tx, input.quotaTransitionPlans);
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
          await this.commitQuotaUsageReconciliations(tx, input.quotaUsageReconciliationPlans);
          await this.appendBudgetSettlement(tx, input.budgetSettlementPlan, attempt);
          await this.commitQuotaTransitions(tx, input.quotaTransitionPlans);
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
        await this.commitQuotaUsageReconciliations(tx, input.quotaUsageReconciliationPlans);
        await this.appendBudgetSettlement(tx, input.budgetSettlementPlan, attempt);
        await this.commitQuotaTransitions(tx, input.quotaTransitionPlans);
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
        await appendRunContractEvidence(tx, {
          workspaceId: input.workspaceId,
          runId: input.runId,
        });

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
        await this.commitQuotaUsageReconciliations(tx, input.quotaUsageReconciliationPlans);
        await this.appendBudgetSettlement(tx, input.budgetSettlementPlan, attempt);
        await this.commitQuotaTransitions(tx, input.quotaTransitionPlans);
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
        await appendRunContractEvidence(tx, {
          workspaceId: input.workspaceId,
          runId: input.runId,
        });
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
              eq(workflowRunMutationReceipts.capability, "workflow_runs.resume@1"),
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
        await appendRunContractEvidence(tx, {
          workspaceId: input.run.workspaceId,
          runId: input.run.id,
        });
        const quotaResult = await this.commitQuotaClaim(tx, input.quotaAdmissionPlan);
        if (quotaResult?.kind === "denied") {
          if (quotaResult.reasonCodes.includes("EMERGENCY_SPEND_SUSPENDED")) {
            throw new Error("Spend suspension cannot be represented as derived quota admission denial.");
          }
          throw new QuotaAdmissionDenied(quotaResult.reasonCodes, quotaResult.evidence);
        }
        if (
          quotaResult && quotaResult.kind !== "created" && quotaResult.kind !== "replayed" &&
          quotaResult.kind !== "wait" && quotaResult.kind !== "replayed_wait"
        ) throw new Error("Derived Run quota admission could not be committed.");
        if (input.budgetAdmissionPlan) {
          if (
            !this.budgetWriter ||
            input.budgetAdmissionPlan.workspaceId !== input.run.workspaceId ||
            input.budgetAdmissionPlan.principalId !== input.receipt.principalId ||
            input.budgetAdmissionPlan.runId !== input.run.id
          ) throw new Error("Budget admission plan does not match the derived Run.");
          const budgetResult = await this.budgetWriter.commitAdmission(
            input.budgetAdmissionPlan,
            tx,
          );
          if (budgetResult !== "created" && budgetResult !== "replayed") {
            throw new Error("Budget admission was unavailable for the derived Run.");
          }
        }
        const wait = quotaResult?.kind === "wait" || quotaResult?.kind === "replayed_wait"
          ? quotaResult.wait
          : null;
        if (wait && !input.quotaWaitEventId) throw new Error("Derived Run Quota Wait event is unavailable.");
        let persistedRun = input.run;
        if (wait) {
          const updated = await tx.update(workflowRuns).set({
            state: "waiting",
            nextEventSequence: input.run.nextEventSequence + 1,
            resumeAt: wait.eligibleAt,
            failureCode: "QUOTA_WAIT",
            updatedAt: wait.createdAt,
          }).where(and(
            eq(workflowRuns.workspaceId, input.run.workspaceId),
            eq(workflowRuns.id, input.run.id),
            eq(workflowRuns.state, "accepted"),
          )).returning();
          if (!updated[0]) throw new Error("Derived Run Quota Wait transition was lost.");
          persistedRun = mapRun(updated[0]);
          await appendRunContractEvidence(tx, {
            workspaceId: input.run.workspaceId,
            runId: input.run.id,
          });
        }
        await tx.insert(workflowRunEvents).values([
          ...input.events,
          ...(wait ? [{
            id: input.quotaWaitEventId!,
            workspaceId: input.run.workspaceId,
            runId: input.run.id,
            sequence: input.run.nextEventSequence,
            type: "run.waiting" as const,
            data: quotaWaitEventData(wait),
            occurredAt: wait.createdAt,
          }] : []),
        ]);
        const receipt = {
          ...input.receipt,
          result: workflowRunReceiptResult(
            persistedRun,
            input.receipt.initialEventCursor,
          ),
        };
        await tx.insert(workflowRunMutationReceipts).values(receipt);
        if (!wait || wait.eligibleAt) {
          await tx.insert(workflowRunOutboxIntents).values({
            ...input.outboxIntent,
            generation: wait ? input.run.nextEventSequence : input.outboxIntent.generation,
            dedupeKey: wait
              ? `workflow-run:${input.run.workspaceId}:${input.run.id}:v${input.run.nextEventSequence}:quota-wait`
              : input.outboxIntent.dedupeKey,
            availableAt: wait?.eligibleAt ?? input.outboxIntent.availableAt,
          });
        }
        return {
          kind: "created" as const,
          run: persistedRun,
          receipt,
        };
      });
    } catch (error) {
      if (error instanceof QuotaAdmissionDenied) {
        return {
          kind: "quota_denied" as const,
          reasonCodes: error.reasonCodes,
          evidence: error.evidence,
        };
      }
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
              eq(workflowRunMutationReceipts.capability, input.receipt.capability),
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
        if (run.failureCode === "QUOTA_WAIT") {
          const quotaResult = await this.commitQuotaClaim(tx, input.quotaResumePlan);
          if (
            !quotaResult ||
            (quotaResult.kind !== "created" && quotaResult.kind !== "replayed")
          ) return { kind: "unavailable" as const };
        }
        await tx.insert(workflowRunEvents).values({
          id: input.eventId,
          workspaceId: input.workspaceId,
          runId: input.runId,
          sequence: run.nextEventSequence,
          type: "run.resumed",
          data: input.quotaResumePlan ? {
            automatic: false,
            waitId: input.quotaResumePlan.resumesWaitId,
            reason: input.quotaResumePlan.resumeReason,
            reservationIds: input.quotaResumePlan.reservations.map((item) => item.id),
          } : { automatic: false },
          occurredAt: databaseNow,
        });
        const updated = await tx
          .update(workflowRuns)
          .set({
            state: run.startedAt === null ? "accepted" : "running",
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
        await appendRunContractEvidence(tx, {
          workspaceId: input.workspaceId,
          runId: input.runId,
        });
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

  async resumeQuotaWait(
    input: Parameters<WorkflowRunRepository["resumeQuotaWait"]>[0],
  ) {
    try {
      return await this.getDatabase().transaction(async (tx) => {
        const rows = await tx.select({
          run: workflowRuns,
          databaseNow: sql<unknown>`clock_timestamp()`,
        }).from(workflowRuns).where(and(
          eq(workflowRuns.workspaceId, input.workspaceId),
          eq(workflowRuns.workflowId, input.workflowId),
          eq(workflowRuns.id, input.runId),
        )).limit(1).for("update");
        if (!rows[0]) return { kind: "unavailable" as const };
        const run = mapRun(rows[0].run);
        const waitEvents = await tx.select({ data: workflowRunEvents.data })
          .from(workflowRunEvents).where(and(
            eq(workflowRunEvents.workspaceId, input.workspaceId),
            eq(workflowRunEvents.runId, input.runId),
            eq(workflowRunEvents.sequence, input.waitEventSequence),
            eq(workflowRunEvents.type, "run.waiting"),
          )).limit(1).for("share");
        if (
          !waitEvents[0] ||
          waitEvents[0].data.waitId !== input.quotaResumePlan.resumesWaitId
        ) return { kind: "unavailable" as const };
        const waitId = input.quotaResumePlan.resumesWaitId;
        const [winningWaitRow] = waitId
          ? await tx.select({ wait: runtimeQuotaWaits.wait })
              .from(runtimeQuotaWaits)
              .where(and(
                eq(runtimeQuotaWaits.workspaceId, input.workspaceId),
                eq(runtimeQuotaWaits.id, waitId),
                eq(runtimeQuotaWaits.runId, input.runId),
              ))
              .limit(1)
              .for("update")
          : [];
        if (run.state !== "waiting" || run.failureCode !== "QUOTA_WAIT") {
          const winningWait = winningWaitRow?.wait;
          return winningWait?.state === "resumed" &&
            sameQuotaResumeActor(winningWait.resumedBy, input.quotaResumePlan.resumeActor) &&
            winningWait.resumeIdempotencyKey !== null &&
            winningWait.resumeIdempotencyKey === input.quotaResumePlan.resumeIdempotencyKey
            ? { kind: "replayed" as const, run }
            : { kind: "unavailable" as const };
        }
        if (!winningWaitRow) return { kind: "unavailable" as const };
        const quotaResult = await this.commitQuotaClaim(tx, input.quotaResumePlan);
        if (
          !quotaResult ||
          (quotaResult.kind !== "created" && quotaResult.kind !== "replayed")
        ) return { kind: "unavailable" as const };
        const databaseNow = postgresDate(rows[0].databaseNow);
        await tx.insert(workflowRunEvents).values({
          id: input.eventId,
          workspaceId: input.workspaceId,
          runId: input.runId,
          sequence: run.nextEventSequence,
          type: "run.resumed",
          data: {
            automatic: false,
            waitId: input.quotaResumePlan.resumesWaitId,
            reason: input.quotaResumePlan.resumeReason,
            actor: input.quotaResumePlan.resumeActor,
            reservationIds: input.quotaResumePlan.reservations.map((item) => item.id),
          },
          occurredAt: databaseNow,
        });
        const updated = await tx.update(workflowRuns).set({
          state: run.startedAt === null ? "accepted" : "running",
          resumeAt: null,
          failureCode: null,
          nextEventSequence: run.nextEventSequence + 1,
          updatedAt: databaseNow,
        }).where(and(
          eq(workflowRuns.workspaceId, input.workspaceId),
          eq(workflowRuns.id, input.runId),
          eq(workflowRuns.state, "waiting"),
          eq(workflowRuns.nextEventSequence, run.nextEventSequence),
        )).returning();
        if (!updated[0]) throw new Error("Quota Wait resume lost Run serialization.");
        await appendRunContractEvidence(tx, {
          workspaceId: input.workspaceId,
          runId: input.runId,
        });
        await tx.insert(workflowRunOutboxIntents).values({
          ...input.outboxIntent,
          generation: run.nextEventSequence,
          availableAt: databaseNow,
          createdAt: databaseNow,
        }).onConflictDoNothing({ target: workflowRunOutboxIntents.dedupeKey });
        return {
          kind: quotaResult.kind === "replayed" ? "replayed" as const : "resumed" as const,
          run: mapRun(updated[0]),
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
        await this.commitQuotaUsageReconciliations(tx, input.quotaUsageReconciliationPlans);
        await this.appendBudgetSettlement(tx, input.budgetSettlementPlan, attempt);
        await this.commitQuotaTransitions(tx, input.quotaTransitionPlans);
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
        await appendRunContractEvidence(tx, {
          workspaceId: input.workspaceId,
          runId: input.runId,
        });
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
