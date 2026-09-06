import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { workflowRunReceiptResult } from "./types";
import type {
  UsageAttributionAppendPlan,
  UsageCommitWriter,
  UsageLedgerAppendPlan,
} from "../usage/types";
import type { BudgetCommitWriter } from "../budgets/types";
import type {
  QuotaClaimCommitResult,
  QuotaCommitWriter,
  QuotaEligibleWaitRef,
  QuotaTransitionPlan,
  QuotaUsageReconciliationPlan,
  QuotaWait,
} from "../quotas/types";
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
import {
  MemoryTransactionCoordinator,
  isMemoryTransactionParticipant,
  type MemoryTransactionParticipant,
  type MemoryTransactionToken,
} from "../memory-transaction";

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

function quotaWaitEventData(wait: QuotaWait): Record<string, unknown> {
  return {
    schema: wait.schema,
    waitId: wait.id,
    boundary: wait.boundary,
    subject: clone(wait.subject),
    claims: clone(wait.claims),
    reasonCode: wait.reasonCode,
    evidence: wait.evidence.map((item) => ({
      ...clone(item),
      window: {
        ...clone(item.window),
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
        : clone(item.eligibility),
    })),
    eligibleAt: wait.eligibleAt?.toISOString() ?? null,
    createdAt: wait.createdAt.toISOString(),
  };
}

export class InMemoryWorkflowRunRepository implements WorkflowRunRepository {
  private readonly memoryCoordinator = new MemoryTransactionCoordinator();
  private readonly accountingParticipants: MemoryTransactionParticipant[];
  private resumeQuotaWaitTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly usageWriter?: UsageCommitWriter<MemoryTransactionToken>,
    private readonly budgetWriter?: BudgetCommitWriter<MemoryTransactionToken>,
    private readonly quotaWriter?: QuotaCommitWriter<MemoryTransactionToken>,
  ) {
    const writers: unknown[] = [usageWriter, budgetWriter, quotaWriter].filter(
      (writer) => writer !== undefined,
    );
    if (writers.some((writer) => !isMemoryTransactionParticipant(writer))) {
      throw new TypeError(
        "In-memory Run accounting writers must participate in memory transactions.",
      );
    }
    this.accountingParticipants = writers.filter(isMemoryTransactionParticipant);
    for (const participant of this.accountingParticipants) {
      participant.attachMemoryTransactionCoordinator(this.memoryCoordinator);
    }
  }
  readonly runs = new Map<string, WorkflowRunRecord>();
  readonly events = new Map<string, WorkflowRunEventRecord[]>();
  readonly receipts = new Map<string, WorkflowRunMutationReceiptRecord>();
  readonly spendQuoteRedemptions = new Map<string, { runId: string; principalId: string; redeemedAt: Date }>();
  readonly outbox = new Map<string, WorkflowRunOutboxIntentRecord>();
  readonly leases = new Map<string, WorkflowRunExecutionLeaseRecord>();
  readonly stepAttempts = new Map<string, WorkflowStepAttemptRecord>();
  readonly fences = new Map<string, bigint>();
  failNextStart = false;
  failNextFinish = false;
  failNextMarkOutboxDelivered = false;

  private applyQuotaWaitOutboxUpdates(
    updates: Array<{ wait: QuotaEligibleWaitRef; recordedAt: Date }>,
  ): void {
    for (const { wait, recordedAt } of updates) {
      const run = this.runs.get(compound(wait.workspaceId, wait.runId));
      if (!run) continue;
      const id = `quota_resume_${wait.waitId}`;
      const existing = [...this.outbox.values()].find(
        (item) => item.dedupeKey === `quota-wait-resume:${wait.waitId}`,
      );
      if (existing) {
        this.outbox.set(existing.id, immutable(clone({
          ...existing,
          state: "pending" as const,
          deliveryToken: null,
          claimedAt: null,
          deliveredAt: null,
          availableAt: wait.eligibleAt ?? recordedAt,
        })));
        continue;
      }
      this.outbox.set(id, immutable({
        id,
        workspaceId: wait.workspaceId,
        runId: wait.runId,
        generation: run.nextEventSequence,
        dedupeKey: `quota-wait-resume:${wait.waitId}`,
        state: "pending",
        deliveryToken: null,
        deliveryAttempts: 0,
        availableAt: wait.eligibleAt ?? recordedAt,
        claimedAt: null,
        deliveredAt: null,
        createdAt: recordedAt,
      }));
    }
  }

  private async commitQuotaClaim(
    plan: import("../quotas/types").QuotaClaimPlan | null | undefined,
    input: { workspaceId: string; runId: string },
  ): Promise<QuotaClaimCommitResult | null> {
    if (!plan) return null;
    if (
      !this.quotaWriter ||
      plan.workspaceId !== input.workspaceId ||
      plan.runId !== input.runId
    ) return { kind: "unavailable" };
    return this.quotaWriter.commitClaim(plan);
  }

  private async commitQuotaClaimsAtomically(
    plans: import("../quotas/types").QuotaClaimPlan[],
    input: { workspaceId: string; runId: string },
  ) {
    if (
      !this.quotaWriter ||
      plans.some((plan) => plan.workspaceId !== input.workspaceId || plan.runId !== input.runId)
    ) return null;
    return this.quotaWriter.commitClaimsAtomically(plans);
  }

  private async commitQuotaTransitions(
    plans: QuotaTransitionPlan[] | undefined,
    input: { workspaceId: string },
    token?: MemoryTransactionToken,
    stagedOutboxUpdates?: Array<{ wait: QuotaEligibleWaitRef; recordedAt: Date }>,
  ): Promise<boolean> {
    if (!plans?.length) return true;
    if (
      !this.quotaWriter ||
      plans.some((plan) => plan.workspaceId !== input.workspaceId)
    ) return false;
    for (const plan of plans) {
      const result = await this.quotaWriter.commitTransition(plan, token);
      if (result.kind !== "created" && result.kind !== "replayed") return false;
      const updates = result.newlyEligibleWaits.map((wait) => ({
        wait,
        recordedAt: plan.recordedAt,
      }));
      if (stagedOutboxUpdates) stagedOutboxUpdates.push(...updates);
      else this.applyQuotaWaitOutboxUpdates(updates);
    }
    return true;
  }

  private async commitQuotaUsageReconciliations(
    plans: QuotaUsageReconciliationPlan[] | undefined,
    input: { workspaceId: string },
    token?: MemoryTransactionToken,
  ): Promise<boolean> {
    if (!plans?.length) return true;
    if (!this.quotaWriter || plans.some((plan) => plan.workspaceId !== input.workspaceId)) {
      return false;
    }
    for (const plan of plans) {
      const result = await this.quotaWriter.commitUsageReconciliation(plan, token);
      if (result.kind !== "created" && result.kind !== "replayed") return false;
    }
    return true;
  }

  private async appendUsage(
    plan: UsageLedgerAppendPlan | null | undefined,
    attempt: WorkflowStepAttemptRecord,
  ): Promise<boolean> {
    if (!plan) return true;
    if (
      !this.usageWriter ||
      plan.records.length === 0 ||
      plan.records.some(
        (record) =>
          record.settlementId !== plan.settlementId ||
          record.binding.workspaceId !== attempt.workspaceId ||
          record.binding.runId !== attempt.runId ||
          record.binding.stepAttemptId !== attempt.id ||
          record.binding.effectKey !== attempt.effectKey,
      )
    ) return false;
    return (await this.usageWriter.appendPlan(plan)) !== "conflict";
  }

  private async appendUsageAttribution(
    plan: UsageAttributionAppendPlan | null | undefined,
    attempt: WorkflowStepAttemptRecord,
  ): Promise<boolean> {
    if (!plan) return true;
    if (
      !this.usageWriter ||
      plan.event.workspaceId !== attempt.workspaceId ||
      plan.event.runId !== attempt.runId ||
      plan.event.stepAttemptId !== attempt.id ||
      plan.event.effectKey !== attempt.effectKey
    ) return false;
    const result = await this.usageWriter.appendAttributionPlan(plan);
    return result === "created" || result === "replayed";
  }

  private async appendBudgetSettlement(
    plan: import("../budgets/types").BudgetSettlementPlan | null | undefined,
    attempt: WorkflowStepAttemptRecord,
    token?: MemoryTransactionToken,
  ): Promise<boolean> {
    if (!plan) return true;
    if (
      !this.budgetWriter ||
      plan.workspaceId !== attempt.workspaceId ||
      plan.runId !== attempt.runId ||
      plan.stepAttemptId !== attempt.id
    ) return false;
    const result = await this.budgetWriter.commitSettlement(plan, token);
    return result === "created" || result === "replayed";
  }

  private async appendBudgetAttemptAllocation(
    input: import("../budgets/types").BudgetAttemptAllocationInput | null | undefined,
  ): Promise<boolean> {
    if (!input) return true;
    if (!this.budgetWriter) return false;
    const result = await this.budgetWriter.commitAttemptAllocation(input);
    return result === "created" || result === "replayed";
  }

  private async appendUsageBundle(
    usagePlan: UsageLedgerAppendPlan | null | undefined,
    attributionPlan: UsageAttributionAppendPlan | null | undefined,
    attempt: WorkflowStepAttemptRecord,
    token?: MemoryTransactionToken,
  ): Promise<boolean> {
    if (!usagePlan && !attributionPlan) return true;
    if (!this.usageWriter) return false;
    if (
      usagePlan?.records.some(
        (record) =>
          record.binding.workspaceId !== attempt.workspaceId ||
          record.binding.runId !== attempt.runId ||
          record.binding.stepAttemptId !== attempt.id ||
          record.binding.effectKey !== attempt.effectKey,
      ) ||
      (attributionPlan && (
        attributionPlan.event.workspaceId !== attempt.workspaceId ||
        attributionPlan.event.runId !== attempt.runId ||
        attributionPlan.event.stepAttemptId !== attempt.id ||
        attributionPlan.event.effectKey !== attempt.effectKey
      ))
    ) return false;
    const result = await this.usageWriter.appendBundle({ usagePlan, attributionPlan }, token);
    return result === "created" || result === "replayed";
  }

  private async commitProviderAccounting(input: {
    attempt: WorkflowStepAttemptRecord;
    usagePlan?: UsageLedgerAppendPlan | null;
    attributionPlan?: UsageAttributionAppendPlan | null;
    budgetSettlementPlan?: import("../budgets/types").BudgetSettlementPlan | null;
    quotaUsageReconciliationPlans?: QuotaUsageReconciliationPlan[];
    quotaTransitionPlans?: QuotaTransitionPlan[];
    workspaceId: string;
  }): Promise<boolean> {
    const requiredWriters = [
      input.usagePlan || input.attributionPlan ? this.usageWriter : undefined,
      input.budgetSettlementPlan ? this.budgetWriter : undefined,
      input.quotaUsageReconciliationPlans?.length || input.quotaTransitionPlans?.length
        ? this.quotaWriter
        : undefined,
    ].filter((writer) => writer !== undefined);
    if (requiredWriters.some((writer) => !isMemoryTransactionParticipant(writer))) {
      return false;
    }
    const stagedOutboxUpdates: Array<{ wait: QuotaEligibleWaitRef; recordedAt: Date }> = [];
    const committed = await this.memoryCoordinator.runExclusive(async (token) => {
      const checkpoints = this.accountingParticipants.map((participant) => ({
        participant,
        state: participant.checkpointMemoryState(token),
      }));
      try {
        const committed =
          await this.appendUsageBundle(
            input.usagePlan,
            input.attributionPlan,
            input.attempt,
            token,
          ) &&
          await this.appendBudgetSettlement(
            input.budgetSettlementPlan,
            input.attempt,
            token,
          ) &&
          await this.commitQuotaUsageReconciliations(
            input.quotaUsageReconciliationPlans,
            input,
            token,
          ) &&
          await this.commitQuotaTransitions(
            input.quotaTransitionPlans,
            input,
            token,
            stagedOutboxUpdates,
          );
        if (!committed) {
          for (const checkpoint of checkpoints.toReversed()) {
            checkpoint.participant.restoreMemoryState(token, checkpoint.state);
          }
        }
        return committed;
      } catch (error) {
        for (const checkpoint of checkpoints.toReversed()) {
          checkpoint.participant.restoreMemoryState(token, checkpoint.state);
        }
        throw error;
      }
    });
    if (committed) this.applyQuotaWaitOutboxUpdates(stagedOutboxUpdates);
    return committed;
  }

  async getMutationReceipt(
    input: Parameters<WorkflowRunRepository["getMutationReceipt"]>[0],
  ) {
    const receipt = this.receipts.get(
      compound(
        input.workspaceId,
        input.principalId,
        input.capability,
        input.idempotencyKey,
      ),
    );
    const run = receipt
      ? this.runs.get(compound(receipt.workspaceId, receipt.runId))
      : null;
    return receipt && run
      ? { receipt: clone(receipt), run: clone(run) }
      : null;
  }

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
    if (input.acceptedSpendQuote) {
      if (
        !input.acceptedSpendQuoteRef ||
        this.spendQuoteRedemptions.has(input.acceptedSpendQuote.quoteId) ||
        canonicalDigest(input.run.startSnapshot.acceptedSpendQuote) !== canonicalDigest(input.acceptedSpendQuote) ||
        input.acceptedSpendQuote.targetWorkspaceId !== input.run.workspaceId ||
        input.acceptedSpendQuote.delegatedPrincipalId !== input.receipt.principalId ||
        input.acceptedSpendQuote.delegatedKeyId !== input.receipt.keyId ||
        input.acceptedSpendQuote.workflowId !== input.run.workflowId ||
        input.acceptedSpendQuote.workflowRevisionId !== input.run.workflowRevisionId ||
        input.acceptedSpendQuote.expiresAt <= input.run.acceptedAt.toISOString()
      ) return { kind: "unavailable" as const };
    } else if (input.acceptedSpendQuoteRef) return { kind: "unavailable" as const };
    if (input.budgetAdmissionPlan) {
      if (
        !this.budgetWriter ||
        input.budgetAdmissionPlan.workspaceId !== input.run.workspaceId ||
        input.budgetAdmissionPlan.principalId !== input.receipt.principalId ||
        input.budgetAdmissionPlan.runId !== input.run.id
      ) return { kind: "unavailable" as const };
      const budgetResult = await this.budgetWriter.commitAdmission(input.budgetAdmissionPlan);
      if (budgetResult !== "created" && budgetResult !== "replayed") {
        return { kind: "unavailable" as const };
      }
    }
    const quotaResult = await this.commitQuotaClaim(input.quotaAdmissionPlan, {
      workspaceId: input.run.workspaceId,
      runId: input.run.id,
    });
    if (quotaResult?.kind === "denied") {
      return quotaResult.reasonCodes.includes("EMERGENCY_SPEND_SUSPENDED")
        ? { kind: "unavailable" as const }
        : {
            kind: "quota_denied" as const,
            reasonCodes: quotaResult.reasonCodes,
            evidence: clone(quotaResult.evidence),
          };
    }
    if (
      quotaResult &&
      quotaResult.kind !== "created" &&
      quotaResult.kind !== "replayed" &&
      quotaResult.kind !== "wait" &&
      quotaResult.kind !== "replayed_wait"
    ) return { kind: "unavailable" as const };
    const quotaWait =
      quotaResult?.kind === "wait" || quotaResult?.kind === "replayed_wait"
        ? quotaResult.wait
        : null;
    if (quotaWait && !input.quotaWaitEventId) {
      return { kind: "unavailable" as const };
    }
    const run = immutable(clone(quotaWait ? {
      ...input.run,
      state: "waiting" as const,
      nextEventSequence: input.run.nextEventSequence + 1,
      resumeAt: quotaWait.eligibleAt,
      failureCode: "QUOTA_WAIT",
      updatedAt: quotaWait.createdAt,
    } : input.run));
    const event = immutable(clone(input.firstEvent));
    const receipt = immutable(clone(input.receipt));
    if (input.acceptedSpendQuote) this.spendQuoteRedemptions.set(input.acceptedSpendQuote.quoteId, { runId: run.id, principalId: input.receipt.principalId, redeemedAt: input.run.acceptedAt });
    this.runs.set(compound(run.workspaceId, run.id), run);
    this.events.set(compound(run.workspaceId, run.id), quotaWait ? [
      event,
      immutable({
        id: input.quotaWaitEventId!,
        workspaceId: run.workspaceId,
        runId: run.id,
        sequence: input.run.nextEventSequence,
        type: "run.waiting" as const,
        data: quotaWaitEventData(quotaWait),
        occurredAt: quotaWait.createdAt,
      }),
    ] : [event]);
    this.receipts.set(receiptKey, receipt);
    if (!quotaWait || quotaWait.eligibleAt) {
      const intent = immutable(clone({
        ...input.outboxIntent,
        generation: quotaWait ? input.run.nextEventSequence : input.outboxIntent.generation,
        dedupeKey: quotaWait
          ? `workflow-run:${run.workspaceId}:${run.id}:v${input.run.nextEventSequence}:quota-wait`
          : input.outboxIntent.dedupeKey,
        availableAt: quotaWait?.eligibleAt ?? input.outboxIntent.availableAt,
      }));
      this.outbox.set(intent.id, intent);
    }
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

  async getById(input: Parameters<WorkflowRunRepository["getById"]>[0]) {
    return clone(this.runs.get(compound(input.workspaceId, input.runId)) ?? null);
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
    if (this.failNextMarkOutboxDelivered) {
      this.failNextMarkOutboxDelivered = false;
      return false;
    }
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

  async enqueueQuotaWaitResumptions(
    input: Parameters<WorkflowRunRepository["enqueueQuotaWaitResumptions"]>[0],
  ) {
    let created = 0;
    for (const wait of input.waits) {
      const run = this.runs.get(compound(wait.workspaceId, wait.runId));
      const id = `quota_resume_${wait.waitId}`;
      if (!run) continue;
      const existing = [...this.outbox.values()].find(
        (item) => item.dedupeKey === `quota-wait-resume:${wait.waitId}`,
      );
      if (existing) {
        this.outbox.set(existing.id, immutable(clone({
          ...existing,
          state: "pending" as const,
          deliveryToken: null,
          claimedAt: null,
          deliveredAt: null,
          availableAt: wait.eligibleAt ?? input.enqueuedAt,
        })));
        continue;
      }
      this.outbox.set(id, immutable({
        id,
        workspaceId: wait.workspaceId,
        runId: wait.runId,
        generation: run.nextEventSequence,
        dedupeKey: `quota-wait-resume:${wait.waitId}`,
        state: "pending",
        deliveryToken: null,
        deliveryAttempts: 0,
        availableAt: wait.eligibleAt ?? input.enqueuedAt,
        claimedAt: null,
        deliveredAt: null,
        createdAt: input.enqueuedAt,
      }));
      created += 1;
    }
    return created;
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
    if (run.state === "outcome_unknown") return { kind: "unavailable" };
    if (
      ((run.state === "accepted" || run.state === "waiting") && input.quotaResumePlan) ||
      ((run.state === "accepted" || run.state === "waiting" || run.state === "running") && input.quotaConcurrencyPlan) ||
      (run.state === "waiting" && run.failureCode === "QUOTA_WAIT")
    ) {
      let quotaResult: QuotaClaimCommitResult | null;
      if (input.quotaResumePlan && input.quotaConcurrencyPlan) {
        const batch = await this.commitQuotaClaimsAtomically(
          [input.quotaConcurrencyPlan, input.quotaResumePlan],
          {
            workspaceId: run.workspaceId,
            runId: run.id,
          },
        );
        if (!batch) return { kind: "unavailable" };
        if (batch.kind === "blocked") {
          const waitId = input.quotaResumePlan.resumesWaitId;
          const wait = waitId
            ? await this.quotaWriter?.getWait({ workspaceId: run.workspaceId, waitId })
            : null;
          return wait?.state === "waiting"
            ? { kind: "quota_wait", run: clone(run), wait: clone(wait) }
            : { kind: "unavailable" };
        }
        quotaResult = batch.results.at(-1) ?? null;
      } else {
        quotaResult = await this.commitQuotaClaim(input.quotaResumePlan, {
          workspaceId: run.workspaceId,
          runId: run.id,
        });
        if (
          (!quotaResult || quotaResult.kind === "created" || quotaResult.kind === "replayed") &&
          input.quotaConcurrencyPlan
        ) {
          quotaResult = await this.commitQuotaClaim(input.quotaConcurrencyPlan, {
            workspaceId: run.workspaceId,
            runId: run.id,
          });
        }
      }
      if (quotaResult?.kind === "wait" || quotaResult?.kind === "replayed_wait") {
        if (!input.quotaWaitEventId) return { kind: "unavailable" };
        const wait = quotaResult.wait;
        if (
          quotaResult.kind === "replayed_wait" &&
          run.state === "waiting" &&
          run.failureCode === "QUOTA_WAIT" &&
          (this.events.get(key) ?? []).some((event) => event.data.waitId === wait.id)
        ) return { kind: "quota_wait", run: clone(run), wait: clone(wait) };
        const waitingRun = immutable(clone({
          ...run,
          state: "waiting" as const,
          resumeAt: wait.eligibleAt,
          failureCode: "QUOTA_WAIT",
          nextEventSequence: run.nextEventSequence + 1,
          updatedAt: wait.createdAt,
        }));
        this.runs.set(key, waitingRun);
        this.events.set(key, [
          ...(this.events.get(key) ?? []),
          immutable({
            id: input.quotaWaitEventId,
            workspaceId: run.workspaceId,
            runId: run.id,
            sequence: run.nextEventSequence,
            type: "run.waiting" as const,
            data: quotaWaitEventData(wait),
            occurredAt: wait.createdAt,
          }),
        ]);
        if (wait.eligibleAt && input.quotaWaitOutboxIntent) {
          this.outbox.set(input.quotaWaitOutboxIntent.id, immutable(clone({
            ...input.quotaWaitOutboxIntent,
            availableAt: wait.eligibleAt,
          })));
        }
        return { kind: "quota_wait", run: clone(waitingRun), wait: clone(wait) };
      }
      if (
        !quotaResult ||
        (quotaResult.kind !== "created" && quotaResult.kind !== "replayed")
      ) return { kind: "busy" };
    }
    if (
      run.state === "waiting" &&
      run.resumeAt !== null &&
      run.resumeAt > input.now
    ) {
      return { kind: "busy" };
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

    const shouldResume = run.state === "waiting";
    const nextRun =
      run.state === "accepted" || shouldResume
        ? immutable(
            clone({
              ...run,
              state: "running" as const,
              startedAt: run.startedAt ?? input.now,
              resumeAt: null,
              failureCode: shouldResume ? null : run.failureCode,
              nextEventSequence:
                run.nextEventSequence + (shouldResume ? 1 : 0),
              updatedAt: input.now,
            }),
          )
        : run;
    if (run.state === "accepted" || shouldResume) {
      this.runs.set(key, nextRun);
    }
    if (shouldResume) {
      this.events.set(key, [
        ...(this.events.get(key) ?? []),
        immutable({
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
          occurredAt: input.now,
        }),
      ]);
    }
    return {
      kind: "acquired",
      run: clone(nextRun),
      lease: clone(lease),
    };
  }

  async renewLease(
    input: Parameters<WorkflowRunRepository["renewLease"]>[0],
  ): Promise<
    | { kind: "renewed"; lease: WorkflowRunExecutionLeaseRecord }
    | { kind: "stale_fence" | "unavailable" }
  > {
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
      lease.expiresAt <= input.now ||
      input.expiresAt <= input.now
    ) {
      return { kind: "stale_fence" };
    }
    const renewed = immutable(clone({ ...lease, expiresAt: input.expiresAt }));
    this.leases.set(key, renewed);
    return { kind: "renewed", lease: clone(renewed) };
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
    if (!(await this.commitQuotaTransitions(input.quotaTransitionPlans, input))) {
      return { kind: "unavailable" };
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
    if (existing) {
      const found = existing;
      if (
        found.id !== input.attempt.id ||
        found.effectKey !== input.attempt.effectKey ||
        found.intentDigest !== input.attempt.intentDigest ||
        found.operationContractDigest !==
          input.attempt.operationContractDigest
      ) {
        return { kind: "conflict" };
      }
      if (!(await this.appendBudgetAttemptAllocation(input.budgetAttemptAllocation))) {
        return { kind: "unavailable" };
      }
      return {
        kind: "replayed",
        run: clone(run),
        attempt: clone(found),
      };
    }
    if (
      effectOwner &&
      (effectOwner.runId !== input.attempt.runId ||
        effectOwner.stepId !== input.attempt.stepId ||
        effectOwner.intentDigest !== input.attempt.intentDigest ||
        effectOwner.operationContractDigest !==
          input.attempt.operationContractDigest)
    ) {
      return { kind: "conflict" };
    }
    const quotaPlans = input.quotaClaimPlans ?? [];
    const quotaBatch = quotaPlans.length
      ? await this.commitQuotaClaimsAtomically(quotaPlans, {
          workspaceId: run.workspaceId,
          runId: run.id,
        })
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
        ? await this.commitQuotaClaim(waitPlan, {
            workspaceId: run.workspaceId,
            runId: run.id,
          })
        : { kind: "unavailable" };
    }
    if (quotaResult?.kind === "wait" || quotaResult?.kind === "replayed_wait") {
      if (!input.quotaWaitEventId) return { kind: "unavailable" };
      const wait = quotaResult.wait;
      if (!(await this.commitQuotaTransitions(input.quotaWaitReleasePlans, {
        workspaceId: run.workspaceId,
      }))) return { kind: "unavailable" };
      const waitingRun = immutable(clone({
        ...run,
        state: "waiting" as const,
        resumeAt: wait.eligibleAt,
        failureCode: "QUOTA_WAIT",
        nextEventSequence: run.nextEventSequence + 1,
        updatedAt: wait.createdAt,
      }));
      this.runs.set(key, waitingRun);
      this.leases.set(key, immutable(clone({
        ...lease,
        releasedAt: wait.createdAt,
      })));
      this.events.set(key, [
        ...(this.events.get(key) ?? []),
        immutable({
          id: input.quotaWaitEventId,
          workspaceId: run.workspaceId,
          runId: run.id,
          sequence: run.nextEventSequence,
          type: "run.waiting" as const,
          data: quotaWaitEventData(wait),
          occurredAt: wait.createdAt,
        }),
      ]);
      if (wait.eligibleAt && input.quotaWaitOutboxIntent) {
        this.outbox.set(input.quotaWaitOutboxIntent.id, immutable(clone({
          ...input.quotaWaitOutboxIntent,
          availableAt: wait.eligibleAt,
        })));
      }
      return { kind: "quota_wait", run: clone(waitingRun), wait: clone(wait) };
    }
    if (quotaResult?.kind === "denied") {
      if (blockedBoundary !== "provider_effect" && blockedBoundary !== "usage_settlement") {
        return { kind: "unavailable" };
      }
      const missingUsagePolicy =
        quotaResult.reasonCodes.includes("QUOTA_POLICY_UNAVAILABLE") &&
        blockedBoundary === "usage_settlement";
      if (missingUsagePolicy) {
        if (!input.quotaPolicyUnavailableEventId) return { kind: "unavailable" };
        const failedAt = input.attempt.startedAt;
        const failedRun = immutable(clone({
          ...run,
          state: "failed" as const,
          output: null,
          finalSnapshot: null,
          finalSnapshotDigest: null,
          failureCode: "QUOTA_USAGE_CEILING_UNAVAILABLE",
          resumeAt: null,
          nextEventSequence: run.nextEventSequence + 1,
          completedAt: failedAt,
          updatedAt: failedAt,
        }));
        this.runs.set(key, failedRun);
        this.events.set(key, [
          ...(this.events.get(key) ?? []),
          immutable({
            id: input.quotaPolicyUnavailableEventId,
            workspaceId: run.workspaceId,
            runId: run.id,
            sequence: run.nextEventSequence,
            type: "run.failed" as const,
            data: {
              reasonCode: "QUOTA_USAGE_CEILING_UNAVAILABLE",
              quotaBoundary: "usage_settlement",
            },
            occurredAt: failedAt,
          }),
        ]);
        this.leases.set(key, immutable(clone({ ...lease, releasedAt: failedAt })));
        return {
          kind: "effect_blocked",
          run: clone(failedRun),
          reasonCode: "QUOTA_POLICY_UNAVAILABLE",
          blockedBoundary: "usage_settlement",
        };
      }
      this.leases.set(key, immutable(clone({ ...lease, releasedAt: input.attempt.startedAt })));
      if (input.quotaWaitOutboxIntent) {
        const dedupeKey = `spend-suspension-retry:${run.id}:${run.nextEventSequence}`;
        const existing = [...this.outbox.values()].find((item) => item.dedupeKey === dedupeKey);
        const intent = existing ?? input.quotaWaitOutboxIntent;
        this.outbox.set(intent.id, immutable(clone({
          ...intent,
          dedupeKey,
          state: "pending" as const,
          deliveryToken: null,
          claimedAt: null,
          deliveredAt: null,
          availableAt: new Date(input.attempt.startedAt.getTime() + 30_000),
        })));
      }
      return {
        kind: "effect_blocked",
        run: clone(run),
        reasonCode: quotaResult.reasonCodes[0] ?? "QUOTA_POLICY_UNAVAILABLE",
        blockedBoundary,
      };
    }
    if (
      quotaResult &&
      quotaResult.kind !== "created" &&
      quotaResult.kind !== "replayed"
    ) return { kind: "unavailable" };
    if (!(await this.appendBudgetAttemptAllocation(input.budgetAttemptAllocation))) {
      return { kind: "unavailable" };
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
      if (
        !(await this.appendUsageAttribution(
          input.usageAttributionPlan,
          attempt,
        ))
      ) {
        return { kind: "unavailable" };
      }
      if (!(await this.appendBudgetSettlement(input.budgetSettlementPlan, attempt))) {
        return { kind: "unavailable" };
      }
      if (!(await this.commitQuotaTransitions(input.quotaTransitionPlans, input))) {
        return { kind: "unavailable" };
      }
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
    if (
      !(await this.appendUsageAttribution(
        input.usageAttributionPlan,
        attempt,
      ))
    ) {
      return { kind: "unavailable" };
    }
    if (!(await this.appendBudgetSettlement(input.budgetSettlementPlan, attempt))) {
      return { kind: "unavailable" };
    }
    if (!(await this.commitQuotaTransitions(input.quotaTransitionPlans, input))) {
      return { kind: "unavailable" };
    }
    const completedAttempt = immutable(
      clone({
        ...attempt,
        state: "completed" as const,
        outputs: input.outputs,
        providerOperationRef: input.providerOperationRef,
        outcome: {
          kind: "succeeded" as const,
          providerOperationRef: input.providerOperationRef,
        },
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

  async recordStepAttemptProviderSuccess(
    input: Parameters<
      WorkflowRunRepository["recordStepAttemptProviderSuccess"]
    >[0],
  ): Promise<SettleWorkflowStepAttemptResult> {
    const key = compound(input.workspaceId, input.runId);
    const run = this.runs.get(key);
    const lease = this.leases.get(key);
    const entry = [...this.stepAttempts.entries()].find(
      ([, attempt]) =>
        attempt.workspaceId === input.workspaceId &&
        attempt.runId === input.runId &&
        attempt.id === input.stepAttemptId,
    );
    if (!run || run.state !== "running" || !lease || !entry) {
      return { kind: "unavailable" };
    }
    if (
      lease.releasedAt !== null ||
      lease.workerId !== input.workerId ||
      lease.token !== input.token ||
      lease.fence !== input.fence ||
      lease.expiresAt <= input.recordedAt
    ) {
      return { kind: "stale_fence" };
    }
    const [attemptKey, attempt] = entry;
    if (
      attempt.state !== "running" ||
      (attempt.outcome !== null &&
        (attempt.outcome.kind !== "succeeded" ||
          attempt.providerOperationRef !== input.providerOperationRef))
    ) {
      return { kind: "unavailable" };
    }
    if (attempt.outcome?.kind === "succeeded") {
      if (!(await this.commitProviderAccounting({
        ...input,
        attempt,
      }))) {
        return { kind: "unavailable" };
      }
      return { kind: "settled", run: clone(run), attempt: clone(attempt) };
    }
    if (!input.usagePlan) return { kind: "unavailable" };
    if (!(await this.commitProviderAccounting({
      ...input,
      attempt,
    }))) {
      return { kind: "unavailable" };
    }
    const recorded = immutable(
      clone({
        ...attempt,
        providerOperationRef: input.providerOperationRef,
        outcome: {
          kind: "succeeded" as const,
          providerOperationRef: input.providerOperationRef,
        },
        providerMetadata: structuredClone(input.providerMetadata ?? null),
      }),
    );
    this.stepAttempts.set(attemptKey, recorded);
    return {
      kind: "settled",
      run: clone(run),
      attempt: clone(recorded),
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
      (run.state === "failed" || run.state === "waiting") &&
      attempt.failureCode === input.failureCode &&
      run.failureCode === input.failureCode
    ) {
      if (!(await this.commitProviderAccounting({
        ...input,
        attempt,
      }))) {
        return { kind: "unavailable" };
      }
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
    if (!(await this.commitProviderAccounting({
      ...input,
      attempt,
    }))) {
      return { kind: "unavailable" };
    }
    const failedAttempt = immutable(
      clone({
        ...attempt,
        state: "failed" as const,
        outputs: null,
        providerOperationRef: input.providerOperationRef,
        outcome: {
          kind: "failed_known" as const,
          failureCode: input.failureCode,
          retryable: input.retryable,
        },
        failureCode: input.failureCode,
        providerMetadata: structuredClone(input.providerMetadata ?? null),
        completedAt: input.failedAt,
      }),
    );
    const shouldRetry =
      input.retryable &&
      input.retryAt !== null &&
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
        occurredAt: input.failedAt,
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
                retryAt: input.retryAt!.toISOString(),
              },
              occurredAt: input.failedAt,
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
                resumeAt: input.retryAt!.toISOString(),
              },
              occurredAt: input.failedAt,
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
              occurredAt: input.failedAt,
            },
          ]),
    ];
    const failedRun = immutable(
      clone({
        ...run,
        state: shouldRetry ? ("waiting" as const) : ("failed" as const),
        output: null,
        finalSnapshot: null,
        finalSnapshotDigest: null,
        failureCode: input.failureCode,
        resumeAt: shouldRetry ? input.retryAt : null,
        nextEventSequence: run.nextEventSequence + events.length,
        completedAt: shouldRetry ? null : input.failedAt,
        updatedAt: input.failedAt,
      }),
    );
    this.stepAttempts.set(attemptKey, failedAttempt);
    this.runs.set(key, failedRun);
    this.events.set(key, [
      ...(this.events.get(key) ?? []),
      ...events.map((event) => immutable(event)),
    ]);
    if (shouldRetry) {
      this.outbox.set(
        input.retryOutboxIntent!.id,
        immutable(clone(input.retryOutboxIntent!)),
      );
    }
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

  async markStepAttemptOutcomeUnknown(
    input: Parameters<
      WorkflowRunRepository["markStepAttemptOutcomeUnknown"]
    >[0],
  ): Promise<SettleWorkflowStepAttemptResult> {
    if (!FAILURE_CODE.test(input.failureCode)) return { kind: "unavailable" };
    const key = compound(input.workspaceId, input.runId);
    const run = this.runs.get(key);
    const lease = this.leases.get(key);
    const entry = [...this.stepAttempts.entries()].find(
      ([, attempt]) =>
        attempt.workspaceId === input.workspaceId &&
        attempt.runId === input.runId &&
        attempt.id === input.stepAttemptId,
    );
    if (!run || !lease || !entry) return { kind: "unavailable" };
    const [attemptKey, attempt] = entry;
    if (
      run.state !== "running" ||
      attempt.state !== "running" ||
      lease.releasedAt !== null ||
      lease.workerId !== input.workerId ||
      lease.token !== input.token ||
      lease.fence !== input.fence ||
      lease.expiresAt <= input.occurredAt
    ) {
      return { kind: "stale_fence" };
    }
    if (!input.usagePlan && attempt.outcome?.kind !== "succeeded") {
      return { kind: "unavailable" };
    }
    if (!(await this.commitProviderAccounting({
      ...input,
      attempt,
    }))) {
      return { kind: "unavailable" };
    }
    const unknownAttempt = immutable(
      clone({
        ...attempt,
        state: "outcome_unknown" as const,
        providerOperationRef: input.providerOperationRef,
        outcome: {
          kind: "outcome_unknown" as const,
          failureCode: input.failureCode,
          priorSucceededProviderOperationRef:
            attempt.outcome?.kind === "succeeded"
              ? attempt.outcome.providerOperationRef
              : null,
        },
        failureCode: input.failureCode,
        providerMetadata: structuredClone(input.providerMetadata ?? null),
        completedAt: null,
      }),
    );
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
        occurredAt: input.occurredAt,
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
        occurredAt: input.occurredAt,
      },
    ];
    const unknownRun = immutable(
      clone({
        ...run,
        state: "outcome_unknown" as const,
        failureCode: input.failureCode,
        resumeAt: null,
        nextEventSequence: run.nextEventSequence + events.length,
        updatedAt: input.occurredAt,
      }),
    );
    this.stepAttempts.set(attemptKey, unknownAttempt);
    this.runs.set(key, unknownRun);
    this.events.set(key, [
      ...(this.events.get(key) ?? []),
      ...events.map((event) => immutable(event)),
    ]);
    this.leases.set(
      key,
      immutable(clone({ ...lease, releasedAt: input.occurredAt })),
    );
    return {
      kind: "settled",
      run: clone(unknownRun),
      attempt: clone(unknownAttempt),
    };
  }

  async deriveRun(
    input: Parameters<WorkflowRunRepository["deriveRun"]>[0],
  ) {
    const receiptKey = compound(
      input.receipt.workspaceId,
      input.receipt.principalId,
      input.receipt.capability,
      input.receipt.idempotencyKey,
    );
    const existing = this.receipts.get(receiptKey);
    if (existing) {
      if (existing.requestFingerprint !== input.receipt.requestFingerprint) {
        return { kind: "conflict" as const };
      }
      const run = this.runs.get(compound(existing.workspaceId, existing.runId));
      return run
        ? { kind: "replayed" as const, run: clone(run), receipt: clone(existing) }
        : { kind: "unavailable" as const };
    }
    let run = immutable(clone(input.run));
    if (input.budgetAdmissionPlan) {
      if (
        !this.budgetWriter ||
        input.budgetAdmissionPlan.workspaceId !== run.workspaceId ||
        input.budgetAdmissionPlan.principalId !== input.receipt.principalId ||
        input.budgetAdmissionPlan.runId !== run.id
      ) return { kind: "unavailable" as const };
      const budgetResult = await this.budgetWriter.commitAdmission(input.budgetAdmissionPlan);
      if (budgetResult !== "created" && budgetResult !== "replayed") {
        return { kind: "unavailable" as const };
      }
    }
    const quotaResult = await this.commitQuotaClaim(input.quotaAdmissionPlan, {
      workspaceId: run.workspaceId,
      runId: run.id,
    });
    if (quotaResult?.kind === "denied") {
      return quotaResult.reasonCodes.includes("EMERGENCY_SPEND_SUSPENDED")
        ? { kind: "unavailable" as const }
        : {
            kind: "quota_denied" as const,
            reasonCodes: quotaResult.reasonCodes,
            evidence: clone(quotaResult.evidence),
          };
    }
    if (
      quotaResult && quotaResult.kind !== "created" && quotaResult.kind !== "replayed" &&
      quotaResult.kind !== "wait" && quotaResult.kind !== "replayed_wait"
    ) return { kind: "unavailable" as const };
    const wait = quotaResult?.kind === "wait" || quotaResult?.kind === "replayed_wait"
      ? quotaResult.wait
      : null;
    if (wait && !input.quotaWaitEventId) return { kind: "unavailable" as const };
    if (wait) {
      run = immutable(clone({
        ...run,
        state: "waiting" as const,
        nextEventSequence: run.nextEventSequence + 1,
        resumeAt: wait.eligibleAt,
        failureCode: "QUOTA_WAIT",
        updatedAt: wait.createdAt,
      }));
    }
    this.runs.set(compound(run.workspaceId, run.id), run);
    this.events.set(
      compound(run.workspaceId, run.id),
      [
        ...input.events.map((event) => immutable(clone(event))),
        ...(wait ? [immutable({
          id: input.quotaWaitEventId!,
          workspaceId: run.workspaceId,
          runId: run.id,
          sequence: input.run.nextEventSequence,
          type: "run.waiting" as const,
          data: quotaWaitEventData(wait),
          occurredAt: wait.createdAt,
        })] : []),
      ],
    );
    const receipt = immutable(
      clone({
        ...input.receipt,
        result: workflowRunReceiptResult(
          run,
          input.receipt.initialEventCursor,
        ),
      }),
    );
    this.receipts.set(receiptKey, receipt);
    if (!wait || wait.eligibleAt) {
      this.outbox.set(input.outboxIntent.id, immutable(clone({
        ...input.outboxIntent,
        generation: wait ? input.run.nextEventSequence : input.outboxIntent.generation,
        dedupeKey: wait
          ? `workflow-run:${run.workspaceId}:${run.id}:v${input.run.nextEventSequence}:quota-wait`
          : input.outboxIntent.dedupeKey,
        availableAt: wait?.eligibleAt ?? input.outboxIntent.availableAt,
      })));
    }
    return {
      kind: "created" as const,
      run: clone(run),
      receipt: clone(receipt),
    };
  }

  async resumeRun(
    input: Parameters<WorkflowRunRepository["resumeRun"]>[0],
  ) {
    const receiptKey = compound(
      input.workspaceId,
      input.principalId,
      input.receipt.capability,
      input.idempotencyKey,
    );
    const existing = this.receipts.get(receiptKey);
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        return { kind: "conflict" as const };
      }
      const run = this.runs.get(compound(input.workspaceId, existing.runId));
      return run
        ? { kind: "replayed" as const, run: clone(run), receipt: clone(existing) }
        : { kind: "unavailable" as const };
    }
    const key = compound(input.workspaceId, input.runId);
    const run = this.runs.get(key);
    const waitEvent = (this.events.get(key) ?? []).find(
      (event) =>
        event.sequence === input.waitEventSequence &&
        event.type === "run.waiting",
    );
    if (
      !run ||
      run.workflowId !== input.workflowId ||
      run.state !== "waiting" ||
      run.nextEventSequence !== input.waitEventSequence + 1 ||
      !waitEvent ||
      (run.resumeAt !== null && run.resumeAt > input.resumedAt)
    ) {
      return { kind: "unavailable" as const };
    }
    if (run.failureCode === "QUOTA_WAIT") {
      const quotaResult = await this.commitQuotaClaim(input.quotaResumePlan, {
        workspaceId: run.workspaceId,
        runId: run.id,
      });
      if (
        !quotaResult ||
        (quotaResult.kind !== "created" && quotaResult.kind !== "replayed")
      ) return { kind: "unavailable" as const };
    }
    const resumed = immutable(
      clone({
        ...run,
        state: run.startedAt === null ? "accepted" as const : "running" as const,
        resumeAt: null,
        failureCode: null,
        nextEventSequence: run.nextEventSequence + 1,
        updatedAt: input.resumedAt,
      }),
    );
    this.runs.set(key, resumed);
    this.events.set(key, [
      ...(this.events.get(key) ?? []),
      immutable({
        id: input.eventId,
        workspaceId: input.workspaceId,
        runId: input.runId,
        sequence: run.nextEventSequence,
        type: "run.resumed",
        data: input.quotaResumePlan ? {
          waitId: input.quotaResumePlan.resumesWaitId,
          reason: input.quotaResumePlan.resumeReason,
          reservationIds: input.quotaResumePlan.reservations.map((item) => item.id),
        } : {},
        occurredAt: input.resumedAt,
      }),
    ]);
    const receipt = immutable(
      clone({
        ...input.receipt,
        result: workflowRunReceiptResult(
          resumed,
          input.receipt.initialEventCursor,
        ),
      }),
    );
    this.receipts.set(receiptKey, receipt);
    this.outbox.set(
      input.outboxIntent.id,
      immutable(clone(input.outboxIntent)),
    );
    return {
      kind: "created" as const,
      run: clone(resumed),
      receipt: clone(receipt),
    };
  }

  async resumeQuotaWait(
    input: Parameters<WorkflowRunRepository["resumeQuotaWait"]>[0],
  ) {
    const previous = this.resumeQuotaWaitTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.resumeQuotaWaitTail = previous.then(() => current);
    await previous;
    try {
    const key = compound(input.workspaceId, input.runId);
    const run = this.runs.get(key);
    const waitEvent = (this.events.get(key) ?? []).find(
      (event) => event.sequence === input.waitEventSequence &&
        event.type === "run.waiting" &&
        event.data.waitId === input.quotaResumePlan.resumesWaitId,
    );
    if (!run || run.workflowId !== input.workflowId || !waitEvent) {
      return { kind: "unavailable" as const };
    }
    if (run.state !== "waiting" || run.failureCode !== "QUOTA_WAIT") {
      const waitId = input.quotaResumePlan.resumesWaitId;
      const winningWait = waitId && this.quotaWriter
        ? await this.quotaWriter.getWait({ workspaceId: input.workspaceId, waitId })
        : null;
      return winningWait?.state === "resumed" &&
        sameQuotaResumeActor(winningWait.resumedBy, input.quotaResumePlan.resumeActor) &&
        winningWait.resumeIdempotencyKey !== null &&
        winningWait.resumeIdempotencyKey === input.quotaResumePlan.resumeIdempotencyKey
        ? { kind: "replayed" as const, run: clone(run) }
        : { kind: "unavailable" as const };
    }
    const quotaResult = await this.commitQuotaClaim(input.quotaResumePlan, {
      workspaceId: run.workspaceId,
      runId: run.id,
    });
    if (
      !quotaResult ||
      (quotaResult.kind !== "created" && quotaResult.kind !== "replayed")
    ) return { kind: "unavailable" as const };
    const resumed = immutable(clone({
      ...run,
      state: run.startedAt === null ? "accepted" as const : "running" as const,
      resumeAt: null,
      failureCode: null,
      nextEventSequence: run.nextEventSequence + 1,
      updatedAt: input.resumedAt,
    }));
    this.runs.set(key, resumed);
    this.events.set(key, [...(this.events.get(key) ?? []), immutable({
      id: input.eventId,
      workspaceId: input.workspaceId,
      runId: input.runId,
      sequence: run.nextEventSequence,
      type: "run.resumed" as const,
      data: {
        automatic: false,
        waitId: input.quotaResumePlan.resumesWaitId,
        reason: input.quotaResumePlan.resumeReason,
        actor: input.quotaResumePlan.resumeActor,
        reservationIds: input.quotaResumePlan.reservations.map((item) => item.id),
      },
      occurredAt: input.resumedAt,
    })]);
    if (![...this.outbox.values()].some((item) => item.dedupeKey === input.outboxIntent.dedupeKey)) {
      this.outbox.set(input.outboxIntent.id, immutable(clone(input.outboxIntent)));
    }
    return { kind: quotaResult.kind === "replayed" ? "replayed" as const : "resumed" as const, run: clone(resumed) };
    } finally {
      release();
    }
  }

  async reconcileStepAttempt(
    input: Parameters<WorkflowRunRepository["reconcileStepAttempt"]>[0],
  ) {
    const receiptKey = compound(
      input.workspaceId,
      input.principalId,
      "workflow_runs.reconcile@1",
      input.receipt.idempotencyKey,
    );
    const existing = this.receipts.get(receiptKey);
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        return { kind: "conflict" as const };
      }
      const replay = this.runs.get(compound(input.workspaceId, existing.runId));
      return replay
        ? { kind: "replayed" as const, run: clone(replay), receipt: clone(existing) }
        : { kind: "unavailable" as const };
    }
    const key = compound(input.workspaceId, input.runId);
    const run = this.runs.get(key);
    const entry = [...this.stepAttempts.entries()].find(
      ([, attempt]) =>
        attempt.workspaceId === input.workspaceId &&
        attempt.runId === input.runId &&
        attempt.id === input.stepAttemptId,
    );
    if (
      !run ||
      run.workflowId !== input.workflowId ||
      run.state !== "outcome_unknown" ||
      !entry ||
      entry[1].state !== "outcome_unknown"
    ) {
      return { kind: "unavailable" as const };
    }
    const [attemptKey, attempt] = entry;
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
    let sequence = run.nextEventSequence;
    const events: WorkflowRunEventRecord[] = [];
    let nextAttempt: WorkflowStepAttemptRecord;
    let nextRun: WorkflowRunRecord;
    if (input.resolution.kind === "succeeded") {
      for (const [index, [outputName, output]] of Object.entries(
        input.resolution.outputs,
      ).sort(([left], [right]) => compareCodeUnits(left, right)).entries()) {
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
          occurredAt: input.occurredAt,
        });
      }
      events.push(
        {
          id: input.eventIds.reconciled,
          workspaceId: input.workspaceId,
          runId: input.runId,
          sequence: sequence++,
          type: "step.attempt.reconciled",
          data: { stepAttemptId: attempt.id, resolution: "succeeded" },
          occurredAt: input.occurredAt,
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
            outputArtifactIds: Object.values(
              input.resolution.outputs,
            ).map((output) => output.artifactId),
          },
          occurredAt: input.occurredAt,
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
          : { reasonCode: "RECONCILED_NEXT_STEP", resumeAt: input.occurredAt.toISOString() },
        occurredAt: input.occurredAt,
      });
      nextAttempt = immutable(clone({
        ...attempt,
        state: "completed" as const,
        outputs: input.resolution.outputs,
        providerOperationRef: input.resolution.providerOperationRef,
        outcome: {
          kind: "succeeded" as const,
          providerOperationRef: input.resolution.providerOperationRef,
        },
        reconciliation: {
          reference: input.resolution.providerOperationRef,
          resolution: "succeeded" as const,
          reconciledAt: input.occurredAt.toISOString(),
        },
        providerMetadata: structuredClone(input.resolution.providerMetadata),
        failureCode: null,
        completedAt: input.occurredAt,
      }));
      nextRun = immutable(clone({
        ...run,
        state: final ? ("completed" as const) : ("waiting" as const),
        output: input.resolution.finalSnapshot?.outputs ?? null,
        finalSnapshot: input.resolution.finalSnapshot,
        finalSnapshotDigest: input.resolution.finalSnapshotDigest,
        failureCode: final ? null : "RECONCILED_NEXT_STEP",
        resumeAt: final ? null : input.occurredAt,
        completedAt: final ? input.occurredAt : null,
        nextEventSequence: sequence,
        updatedAt: input.occurredAt,
      }));
    } else {
      events.push(
        {
          id: input.eventIds.reconciled,
          workspaceId: input.workspaceId,
          runId: input.runId,
          sequence: sequence++,
          type: "step.attempt.reconciled",
          data: { stepAttemptId: attempt.id, resolution: "failed_known" },
          occurredAt: input.occurredAt,
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
          occurredAt: input.occurredAt,
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
            occurredAt: input.occurredAt,
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
            occurredAt: input.occurredAt,
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
          occurredAt: input.occurredAt,
        });
      }
      nextAttempt = immutable(clone({
        ...attempt,
        state: "failed" as const,
        providerOperationRef: input.resolution.providerOperationRef,
        outcome: {
          kind: "failed_known" as const,
          failureCode: input.resolution.failureCode,
          retryable: input.resolution.retryable,
        },
        reconciliation: {
          reference: input.resolution.providerOperationRef ?? attempt.effectKey,
          resolution: "failed_known" as const,
          reconciledAt: input.occurredAt.toISOString(),
        },
        providerMetadata: structuredClone(input.resolution.providerMetadata),
        failureCode: input.resolution.failureCode,
        completedAt: input.occurredAt,
      }));
      nextRun = immutable(clone({
        ...run,
        state: input.resolution.retryable
          ? ("waiting" as const)
          : ("failed" as const),
        failureCode: input.resolution.failureCode,
        resumeAt: input.resolution.retryAt,
        completedAt: input.resolution.retryable
          ? null
          : input.occurredAt,
        nextEventSequence: sequence,
        updatedAt: input.occurredAt,
      }));
    }
    if (!(await this.commitProviderAccounting({
      ...input,
      attempt,
      attributionPlan: input.usageAttributionPlan,
    }))) {
      return { kind: "unavailable" as const };
    }
    if (input.resolution.outboxIntent) {
      this.outbox.set(
        input.resolution.outboxIntent.id,
        immutable(clone(input.resolution.outboxIntent)),
      );
    }
    this.stepAttempts.set(attemptKey, nextAttempt);
    this.runs.set(key, nextRun);
    this.events.set(key, [
      ...(this.events.get(key) ?? []),
      ...events.map((event) => immutable(event)),
    ]);
    const receipt = immutable(
      clone({
        ...input.receipt,
        result: workflowRunReceiptResult(
          nextRun,
          input.receipt.initialEventCursor,
        ),
      }),
    );
    this.receipts.set(receiptKey, receipt);
    return {
      kind: "created" as const,
      run: clone(nextRun),
      receipt: clone(receipt),
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
