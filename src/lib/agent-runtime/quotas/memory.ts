import { addDecimals, canonicalDecimal } from "../usage/decimal";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  MEMORY_TRANSACTION_PARTICIPANT,
  MemoryTransactionCoordinator,
  type MemoryTransactionParticipant,
  type MemoryTransactionToken,
} from "../memory-transaction";
import type {
  QuotaClaimBatchCommitResult,
  QuotaClaimCommitResult,
  QuotaClaimPlan,
  QuotaClaimPlanIdentity,
  QuotaEligibleWaitRef,
  QuotaExhaustionEvidence,
  QuotaPolicy,
  QuotaPolicyAppendInput,
  QuotaPolicyRevision,
  QuotaRepository,
  QuotaReservation,
  QuotaTransitionPlan,
  QuotaUsageReconciliationPlan,
  QuotaWait,
} from "./types";
import { quotaWindow } from "./window";

function copy<T>(value: T): T { return structuredClone(value); }

function restoreMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}

function compare(left: string, right: string): number {
  const [lw, lf = ""] = canonicalDecimal(left).split(".");
  const [rw, rf = ""] = canonicalDecimal(right).split(".");
  const scale = Math.max(lf.length, rf.length);
  const a = BigInt(`${lw}${lf.padEnd(scale, "0")}`);
  const b = BigInt(`${rw}${rf.padEnd(scale, "0")}`);
  return a < b ? -1 : a > b ? 1 : 0;
}

function subtract(left: string, right: string): string {
  if (compare(left, right) <= 0) return "0";
  const [lw, lf = ""] = canonicalDecimal(left).split(".");
  const [rw, rf = ""] = canonicalDecimal(right).split(".");
  const scale = Math.max(lf.length, rf.length);
  const result = BigInt(`${lw}${lf.padEnd(scale, "0")}`) - BigInt(`${rw}${rf.padEnd(scale, "0")}`);
  if (!scale) return result.toString();
  const digits = result.toString().padStart(scale + 1, "0");
  return canonicalDecimal(`${digits.slice(0, -scale)}.${digits.slice(-scale)}`);
}

function sameWindow(left: QuotaReservation["window"], right: QuotaReservation["window"]): boolean {
  return left.startsAt.getTime() === right.startsAt.getTime() &&
    (left.endsAt?.getTime() ?? null) === (right.endsAt?.getTime() ?? null);
}

function samePolicyIdentity(left: QuotaPolicy, right: QuotaPolicy): boolean {
  return left.kind === right.kind && left.boundary === right.boundary && left.dimension === right.dimension &&
    left.unit === right.unit && left.window === right.window && left.timezone === right.timezone &&
    left.reservationRule === right.reservationRule;
}

function sameWaitIntent(wait: QuotaWait, plan: QuotaClaimPlan): boolean {
  return wait.workspaceId === plan.workspaceId &&
    wait.admittedPrincipalId === plan.principalId &&
    wait.runId === plan.runId &&
    wait.transitionKey === plan.transitionKey &&
    wait.boundary === plan.boundary &&
    canonicalDigest(wait.subject) === canonicalDigest(plan.subject) &&
    canonicalDigest(wait.claims) === canonicalDigest(plan.claims);
}

function planIdentity(plan: QuotaClaimPlan): QuotaClaimPlanIdentity {
  return Object.freeze({
    transitionKey: plan.transitionKey,
    boundary: plan.boundary,
    subject: Object.freeze(copy(plan.subject)),
  });
}

interface QuotaMemoryCheckpoint {
  reservations: Map<string, QuotaReservation>;
  waits: Map<string, QuotaWait>;
  claimReceipts: InMemoryQuotaRepository["claimReceipts"];
  transitionReceipts: InMemoryQuotaRepository["transitionReceipts"];
  usageReconciliationReceipts: InMemoryQuotaRepository["usageReconciliationReceipts"];
}

export class InMemoryQuotaRepository
  implements QuotaRepository<MemoryTransactionToken>, MemoryTransactionParticipant
{
  readonly [MEMORY_TRANSACTION_PARTICIPANT] = true as const;
  readonly policies = new Map<string, QuotaPolicy>();
  readonly revisions = new Map<string, QuotaPolicyRevision>();
  readonly reservations = new Map<string, QuotaReservation>();
  readonly waits = new Map<string, QuotaWait>();
  readonly receipts = new Map<string, { requestDigest: string; resourceId: string }>();
  readonly claimReceipts = new Map<string, { requestDigest: string; reservationIds: string[] }>();
  readonly transitionReceipts = new Map<string, { requestDigest: string; newlyEligibleWaits: QuotaEligibleWaitRef[] }>();
  readonly usageReconciliationReceipts = new Map<string, { requestDigest: string; reservationIds: string[] }>();
  readonly suspensions = new Set<string>();
  private readonly pendingSuspensions = new Map<string, boolean>();
  private mutationTail: Promise<void> = Promise.resolve();
  private transactionCoordinator = new MemoryTransactionCoordinator();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  attachMemoryTransactionCoordinator(coordinator: MemoryTransactionCoordinator): void {
    this.transactionCoordinator = coordinator;
  }

  checkpointMemoryState(token: MemoryTransactionToken): QuotaMemoryCheckpoint {
    if (!this.transactionCoordinator.isActive(token)) {
      throw new Error("Quota memory checkpoint requires the active transaction token.");
    }
    return {
      reservations: structuredClone(this.reservations),
      waits: structuredClone(this.waits),
      claimReceipts: structuredClone(this.claimReceipts),
      transitionReceipts: structuredClone(this.transitionReceipts),
      usageReconciliationReceipts: structuredClone(this.usageReconciliationReceipts),
    };
  }

  restoreMemoryState(token: MemoryTransactionToken, checkpoint: unknown): void {
    if (!this.transactionCoordinator.isActive(token)) {
      throw new Error("Quota memory restore requires the active transaction token.");
    }
    const state = checkpoint as QuotaMemoryCheckpoint;
    restoreMap(this.reservations, state.reservations);
    restoreMap(this.waits, state.waits);
    restoreMap(this.claimReceipts, state.claimReceipts);
    restoreMap(this.transitionReceipts, state.transitionReceipts);
    restoreMap(this.usageReconciliationReceipts, state.usageReconciliationReceipts);
  }

  async setSpendSuspended(workspaceId: string, suspended: boolean): Promise<void> {
    this.pendingSuspensions.set(workspaceId, suspended);
    await this.withMutationAuthority(undefined, async () => {
      const pending = this.pendingSuspensions.get(workspaceId);
      if (pending === undefined) return;
      if (pending) this.suspensions.add(workspaceId);
      else this.suspensions.delete(workspaceId);
      if (this.pendingSuspensions.get(workspaceId) === pending) {
        this.pendingSuspensions.delete(workspaceId);
      }
    });
  }

  private spendSuspended(workspaceId: string): boolean {
    return this.pendingSuspensions.get(workspaceId) ?? this.suspensions.has(workspaceId);
  }

  async getAdminReceipt(input: { workspaceId: string; idempotencyKey: string }) {
    return this.withReadAuthority(undefined, () =>
      copy(this.receipts.get(`${input.workspaceId}:${input.idempotencyKey}`) ?? null));
  }

  async getPolicyRevision(input: { workspaceId: string; revisionId: string }) {
    return this.withReadAuthority(undefined, () => {
      const revision = this.revisions.get(input.revisionId);
      const policy = revision ? this.policies.get(revision.policyId) : null;
      return revision && policy && policy.workspaceId === input.workspaceId
        ? { policy: copy(policy), revision: copy(revision) }
        : null;
    });
  }

  async listPolicies(workspaceId: string) {
    return this.withReadAuthority(undefined, () =>
      [...this.policies.values()]
        .filter((policy) => policy.workspaceId === workspaceId)
        .map((policy) => ({ policy: copy(policy), revision: copy(this.revisions.get(policy.currentRevisionId)!) })));
  }

  async appendPolicyRevision(input: QuotaPolicyAppendInput): Promise<
    "created" | "replayed" | "conflict" | "unavailable"
  > {
    return this.withMutationAuthority(undefined, async () => {
      const key = `${input.policy.workspaceId}:${input.idempotencyKey}`;
      const receipt = this.receipts.get(key);
      if (receipt) return receipt.requestDigest === input.requestDigest ? "replayed" as const : "conflict" as const;
      if (
        input.revision.policyId !== input.policy.id || input.revision.workspaceId !== input.policy.workspaceId ||
        input.revision.principalId !== input.policy.principalId || input.policy.currentRevisionId !== input.revision.id
      ) return "conflict" as const;
      if (["concurrency", "rate"].includes(input.policy.kind) && input.revision.exhaustionBehavior !== "wait") {
        return "conflict" as const;
      }
      const related = [...this.policies.values()].filter((policy) =>
        policy.workspaceId === input.policy.workspaceId && policy.status === "active" &&
        samePolicyIdentity(policy, input.policy));
      if (input.policy.principalId) {
        const parent = related.find((policy) => policy.principalId === null);
        const parentRevision = parent ? this.revisions.get(parent.currentRevisionId) : null;
        if (!parentRevision || compare(input.revision.hardLimit, parentRevision.hardLimit) > 0 ||
          compare(input.revision.warningThreshold, parentRevision.warningThreshold) > 0 ||
          (parentRevision.exhaustionBehavior === "deny" && input.revision.exhaustionBehavior === "wait")) return "conflict" as const;
      } else {
        for (const child of related.filter((policy) => policy.principalId !== null)) {
          const childRevision = this.revisions.get(child.currentRevisionId);
          if (!childRevision || compare(childRevision.hardLimit, input.revision.hardLimit) > 0 ||
            compare(childRevision.warningThreshold, input.revision.warningThreshold) > 0 ||
            (input.revision.exhaustionBehavior === "deny" && childRevision.exhaustionBehavior === "wait")) return "conflict" as const;
        }
      }
      const existing = this.policies.get(input.policy.id);
      if (existing && existing.currentRevisionId !== input.revision.id) {
        const current = this.revisions.get(existing.currentRevisionId);
        if (!current || input.revision.revision !== current.revision + 1) return "conflict" as const;
      }
      this.policies.set(input.policy.id, copy(input.policy));
      this.revisions.set(input.revision.id, copy(input.revision));
      this.receipts.set(key, { requestDigest: input.requestDigest, resourceId: input.revision.id });
      return "created" as const;
    });
  }

  async isSpendSuspended(workspaceId: string) {
    return this.withReadAuthority(undefined, () => this.spendSuspended(workspaceId));
  }

  async getCapacityProjection(
    input: { workspaceId: string; policyRevisionId: string; window: QuotaReservation["window"] },
    transaction?: MemoryTransactionToken,
  ) {
    return this.withReadAuthority(transaction, () => this.capacityProjectionUnlocked(input));
  }

  private capacityProjectionUnlocked(input: {
    workspaceId: string;
    policyRevisionId: string;
    window: QuotaReservation["window"];
  }) {
    const policyId = this.revisions.get(input.policyRevisionId)?.policyId;
    const items = [...this.reservations.values()].filter((reservation) =>
      reservation.workspaceId === input.workspaceId &&
      reservation.policyId === policyId &&
      sameWindow(reservation.window, input.window));
    return {
      committed: items.reduce((total, item) => addDecimals(total,
        item.reservationRule === "release_on_terminal"
          ? item.heldAmount
          : item.reservationRule === "release_on_transition"
            ? subtract(addDecimals(item.heldAmount, item.settledAmount), item.releasedAmount)
            : addDecimals(addDecimals(item.heldAmount, item.settledAmount), item.overageAmount)), "0"),
      reservationIds: items.filter((item) => compare(
        item.reservationRule === "release_on_terminal"
          ? item.heldAmount
          : item.reservationRule === "release_on_transition"
            ? subtract(addDecimals(item.heldAmount, item.settledAmount), item.releasedAmount)
            : addDecimals(addDecimals(item.heldAmount, item.settledAmount), item.overageAmount),
        "0",
      ) > 0).map((item) => item.id).sort(),
    };
  }

  async getReservations(input: {
    workspaceId: string;
    subject?: QuotaReservation["subject"];
    runId?: string | null;
    admittedPrincipalId?: string;
    limit?: number;
  }) {
    return this.withReadAuthority(undefined, () => {
      const reservations = [...this.reservations.values()].filter((item) =>
        item.workspaceId === input.workspaceId &&
        (input.runId === undefined || item.runId === input.runId) &&
        (!input.admittedPrincipalId || item.admittedPrincipalId === input.admittedPrincipalId) &&
        (!input.subject || item.subject.kind === input.subject.kind && item.subject.id === input.subject.id))
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
      return (input.limit === undefined ? reservations : reservations.slice(0, input.limit)).map(copy);
    });
  }

  async getWait(
    input: { workspaceId: string; waitId: string },
    transaction?: MemoryTransactionToken,
  ) {
    return this.withReadAuthority(transaction, () => {
      const wait = this.waits.get(input.waitId);
      return wait?.workspaceId === input.workspaceId ? copy(wait) : null;
    });
  }

  async listWaits(input: {
    workspaceId: string;
    runId?: string;
    state?: QuotaWait["state"];
    admittedPrincipalId?: string;
    limit?: number;
  }) {
    return this.withReadAuthority(undefined, () => {
      const waits = [...this.waits.values()].filter((item) =>
        item.workspaceId === input.workspaceId && (!input.runId || item.runId === input.runId) &&
        (!input.admittedPrincipalId || item.admittedPrincipalId === input.admittedPrincipalId) &&
        (!input.state || item.state === input.state))
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
      return (input.limit === undefined ? waits : waits.slice(0, input.limit)).map(copy);
    });
  }

  async listEligibleWaits(input: { workspaceId: string; at: Date; limit: number }) {
    return this.withReadAuthority(undefined, () => this.listEligibleWaitsUnlocked(input));
  }

  private async listEligibleWaitsUnlocked(input: { workspaceId: string; at: Date; limit: number }) {
    const waits = [...this.waits.values()]
      .filter((item) => item.workspaceId === input.workspaceId && item.state === "waiting")
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
    const eligible: QuotaEligibleWaitRef[] = [];
    for (const wait of waits) {
      if (await this.waitIsEligible(wait, input.at)) {
        eligible.push({ waitId: wait.id, workspaceId: wait.workspaceId, runId: wait.runId, eligibleAt: wait.eligibleAt });
      }
      if (eligible.length >= input.limit) break;
    }
    return copy(eligible);
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.mutationTail = previous.then(() => current);
    await previous;
    try {
      return await operation();
    } finally { release(); }
  }

  private async withMutationAuthority<T>(
    transaction: MemoryTransactionToken | undefined,
    operation: (activeToken: MemoryTransactionToken) => Promise<T>,
  ): Promise<T> {
    if (transaction) {
      if (!this.transactionCoordinator.isActive(transaction)) {
        throw new Error("Quota mutation requires the active transaction token.");
      }
      return this.withMutationLock(() => operation(transaction));
    }
    return this.transactionCoordinator.runExclusive((activeToken) =>
      this.withMutationLock(() => operation(activeToken)));
  }

  private async withReadAuthority<T>(
    transaction: MemoryTransactionToken | undefined,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    if (transaction) {
      if (!this.transactionCoordinator.isActive(transaction)) {
        throw new Error("Quota read requires the active transaction token.");
      }
      return operation();
    }
    return this.transactionCoordinator.runExclusive(() => Promise.resolve(operation()));
  }

  async commitClaim(
    plan: QuotaClaimPlan,
    transaction?: MemoryTransactionToken,
  ): Promise<QuotaClaimCommitResult> {
    return this.withMutationAuthority(transaction, (activeToken) =>
      this.commitClaimUnlocked(plan, activeToken));
  }

  async commitClaimsAtomically(
    plans: QuotaClaimPlan[],
    transaction?: MemoryTransactionToken,
  ): Promise<QuotaClaimBatchCommitResult> {
    return this.withMutationAuthority(transaction, async (activeToken) => {
      const reservations = structuredClone(this.reservations);
      const waits = structuredClone(this.waits);
      const claimReceipts = structuredClone(this.claimReceipts);
      const results: Array<Extract<QuotaClaimCommitResult, { kind: "created" | "replayed" }>> = [];
      for (const plan of plans) {
        const result = await this.commitClaimUnlocked(plan, activeToken);
        if (result.kind !== "created" && result.kind !== "replayed") {
          this.reservations.clear();
          for (const [key, value] of reservations) this.reservations.set(key, value);
          this.waits.clear();
          for (const [key, value] of waits) this.waits.set(key, value);
          this.claimReceipts.clear();
          for (const [key, value] of claimReceipts) this.claimReceipts.set(key, value);
          return {
            kind: "blocked",
            blockedPlan: planIdentity(plan),
            result: result as Exclude<QuotaClaimCommitResult, { kind: "created" | "replayed" }>,
          };
        }
        results.push(result);
      }
      return { kind: "committed", results };
    });
  }

  private async commitClaimUnlocked(
    plan: QuotaClaimPlan,
    transaction?: MemoryTransactionToken,
  ): Promise<QuotaClaimCommitResult> {
      const receiptKey = `${plan.workspaceId}:${plan.transitionKey}`;
      const receipt = this.claimReceipts.get(receiptKey);
      if (receipt) {
        if (receipt.requestDigest !== plan.requestDigest) return { kind: "conflict" };
        return { kind: "replayed", reservations: receipt.reservationIds.map((id) => copy(this.reservations.get(id)!)) };
      }
      if (plan.boundary === "provider_effect" && this.spendSuspended(plan.workspaceId)) {
        return { kind: "denied", reasonCodes: ["EMERGENCY_SPEND_SUSPENDED"], evidence: [] };
      }
      const committedAt = this.clock();
      const activePolicies = [...this.policies.values()].filter((policy) =>
        policy.workspaceId === plan.workspaceId && policy.status === "active" &&
        (policy.principalId === null || policy.principalId === plan.principalId));
      for (const claim of plan.claims) {
        const effective = activePolicies.filter((policy) =>
          policy.boundary === plan.boundary && policy.dimension === claim.dimension && policy.unit === claim.unit);
        if (!effective.some((policy) => policy.scope === "workspace")) {
          return { kind: "denied", reasonCodes: ["QUOTA_POLICY_UNAVAILABLE"], evidence: [] };
        }
        if (effective.some((policy) => !plan.reservations.some((reservation) =>
          reservation.policyRevisionId === policy.currentRevisionId &&
          reservation.dimension === claim.dimension && reservation.unit === claim.unit &&
          reservation.reservedAmount === claim.amount))) return { kind: "unavailable" };
      }
      if (plan.resumesWaitId) {
        const wait = this.waits.get(plan.resumesWaitId);
        if (
          !wait || wait.state !== "waiting" || wait.workspaceId !== plan.workspaceId ||
          wait.runId !== plan.runId || wait.transitionKey !== plan.transitionKey ||
          wait.admittedPrincipalId !== plan.principalId
        ) return { kind: "unavailable" };
      }
      const exhaustion: Array<{ reservation: QuotaReservation; evidence: QuotaExhaustionEvidence; behavior: QuotaPolicyRevision["exhaustionBehavior"] }> = [];
      for (const reservation of plan.reservations) {
        const policy = this.policies.get(reservation.policyId);
        const revision = this.revisions.get(reservation.policyRevisionId);
        const expectedWindow = policy
          ? quotaWindow(policy.window, policy.timezone, committedAt)
          : null;
        if (
          !policy || !revision || !expectedWindow || policy.status !== "active" ||
          policy.currentRevisionId !== revision.id || !sameWindow(reservation.window, expectedWindow)
        ) return { kind: "unavailable" };
        const projection = await this.getCapacityProjection(
          { workspaceId: plan.workspaceId, policyRevisionId: revision.id, window: reservation.window },
          transaction,
        );
        if (compare(addDecimals(projection.committed, reservation.reservedAmount), revision.hardLimit) > 0) {
          const available = subtract(revision.hardLimit, projection.committed);
          const eligibleAt = reservation.window.endsAt;
          exhaustion.push({
            reservation,
            behavior: revision.exhaustionBehavior,
            evidence: {
              schema: "quota-exhaustion-evidence/v1",
              policyId: policy.id,
              policyRevisionId: revision.id,
              scope: policy.scope,
              dimension: policy.dimension,
              unit: policy.unit,
              window: copy(reservation.window),
              hardLimit: revision.hardLimit,
              committed: projection.committed,
              requested: reservation.reservedAmount,
              available,
              blockingReservationIds: projection.reservationIds,
              evaluatedAt: plan.createdAt,
              eligibleAt,
              eligibility: eligibleAt
                ? { kind: "window_renewal", eligibleAt }
                : { kind: "capacity_release", requiredAvailable: reservation.reservedAmount },
              evidenceRef: `quota-evidence:${reservation.policyRevisionId}:${plan.waitId}`,
              evidenceVersion: 1,
            },
          });
        }
      }
      if (exhaustion.length) {
        if (exhaustion.some((item) => item.behavior === "deny")) {
          return { kind: "denied", reasonCodes: ["QUOTA_CAPACITY_EXHAUSTED"], evidence: exhaustion.map((item) => item.evidence) };
        }
        if (plan.runId === null) return { kind: "unavailable" };
        const existingWait = [...this.waits.values()].find((wait) =>
          wait.workspaceId === plan.workspaceId && wait.transitionKey === plan.transitionKey);
        if (existingWait) {
          return sameWaitIntent(existingWait, plan)
            ? { kind: "replayed_wait", wait: copy(existingWait) }
            : { kind: "conflict" };
        }
        const evidence = exhaustion.map((item) => item.evidence);
        const dates = evidence.map((item) => item.eligibleAt).filter((item): item is Date => item !== null);
        const wait: QuotaWait = {
          schema: "quota-wait/v1",
          id: plan.waitId,
          workspaceId: plan.workspaceId,
          admittedPrincipalId: plan.principalId,
          runId: plan.runId,
          transitionKey: plan.transitionKey,
          boundary: plan.boundary,
          subject: copy(plan.subject),
          claims: copy(plan.claims),
          reasonCode: "QUOTA_RENEWABLE_CAPACITY_EXHAUSTED",
          evidence,
          eligibleAt: dates.length === evidence.length ? new Date(Math.max(...dates.map((item) => item.getTime()))) : null,
          state: "waiting",
          resumeReason: null,
          resumedBy: null,
          resumeIdempotencyKey: null,
          resolutionReservationIds: [],
          createdAt: plan.createdAt,
          resolvedAt: null,
        };
        this.waits.set(wait.id, wait);
        return { kind: "wait", wait: copy(wait) };
      }
      if (plan.boundary === "provider_effect" && this.spendSuspended(plan.workspaceId)) {
        return { kind: "denied", reasonCodes: ["EMERGENCY_SPEND_SUSPENDED"], evidence: [] };
      }
      for (const reservation of plan.reservations) this.reservations.set(reservation.id, copy(reservation));
      this.claimReceipts.set(receiptKey, { requestDigest: plan.requestDigest, reservationIds: plan.reservations.map((item) => item.id) });
      if (plan.resumesWaitId) {
        const wait = this.waits.get(plan.resumesWaitId);
        if (!wait || wait.state !== "waiting") return { kind: "unavailable" };
        this.waits.set(wait.id, { ...wait, state: "resumed", resumeReason: plan.resumeReason, resumedBy: plan.resumeActor, resumeIdempotencyKey: plan.resumeIdempotencyKey, resolutionReservationIds: plan.reservations.map((item) => item.id), resolvedAt: plan.createdAt });
      }
      return { kind: "created", reservations: plan.reservations.map(copy) };
  }

  async commitTransition(
    plan: QuotaTransitionPlan,
    transaction?: MemoryTransactionToken,
  ) {
    return this.withMutationAuthority(transaction, async () => {
      if (plan.subject.kind === "usage_settlement") return { kind: "unavailable" as const };
      const key = `${plan.workspaceId}:${plan.transitionId}`;
      const prior = this.transitionReceipts.get(key);
      if (prior) return prior.requestDigest === plan.requestDigest
        ? { kind: "replayed" as const, newlyEligibleWaits: copy(prior.newlyEligibleWaits) }
        : { kind: "conflict" as const };
      const reservations = plan.reservationIds.map((id) => this.reservations.get(id));
      if (reservations.some((item) => !item || item.workspaceId !== plan.workspaceId)) return { kind: "unavailable" as const };
      if (plan.outcome === "release" && plan.amount !== null) return { kind: "unavailable" as const };
      const before = new Set((await this.listEligibleWaitsUnlocked({ workspaceId: plan.workspaceId, at: plan.recordedAt, limit: Number.MAX_SAFE_INTEGER })).map((item) => item.waitId));
      for (const reservation of reservations as QuotaReservation[]) {
        if (reservation.subject.kind === "usage_settlement") return { kind: "unavailable" as const };
        if (reservation.subject.kind !== plan.subject.kind || reservation.subject.id !== plan.subject.id) return { kind: "unavailable" as const };
        if (plan.outcome === "release" && reservation.reservationRule === "consume") return { kind: "unavailable" as const };
        if (plan.outcome === "settle" && reservation.reservationRule === "release_on_terminal") return { kind: "unavailable" as const };
        const committed = reservation.reservationRule === "release_on_terminal"
          ? reservation.heldAmount
          : subtract(addDecimals(reservation.heldAmount, reservation.settledAmount), reservation.releasedAmount);
        const transitionAmount = plan.amount ?? (plan.outcome === "settle" ? reservation.heldAmount : committed);
        if (compare(transitionAmount, plan.outcome === "settle" ? reservation.heldAmount : committed) > 0) {
          return { kind: "unavailable" as const };
        }
        const settledAmount = plan.outcome === "settle"
          ? addDecimals(reservation.settledAmount, transitionAmount)
          : reservation.settledAmount;
        const releaseFromHeld = plan.outcome === "release" && compare(reservation.heldAmount, transitionAmount) < 0
          ? reservation.heldAmount
          : plan.outcome === "release" ? transitionAmount : "0";
        const heldAmount = plan.outcome === "settle"
          ? subtract(reservation.heldAmount, transitionAmount)
          : subtract(reservation.heldAmount, releaseFromHeld);
        const releasedAmount = plan.outcome === "release"
          ? addDecimals(
              reservation.releasedAmount,
              reservation.reservationRule === "release_on_terminal"
                ? transitionAmount
                : subtract(transitionAmount, releaseFromHeld),
            )
          : reservation.releasedAmount;
        const remaining = reservation.reservationRule === "release_on_terminal"
          ? heldAmount
          : subtract(addDecimals(heldAmount, settledAmount), releasedAmount);
        this.reservations.set(reservation.id, {
          ...reservation,
          heldAmount,
          settledAmount,
          releasedAmount,
          state: compare(remaining, "0") === 0 ? "released" : compare(heldAmount, "0") > 0 ? "held" : "settled",
          updatedAt: plan.recordedAt,
        });
      }
      const newlyEligibleWaits = (await this.listEligibleWaitsUnlocked({ workspaceId: plan.workspaceId, at: plan.recordedAt, limit: Number.MAX_SAFE_INTEGER }))
        .filter((item) => !before.has(item.waitId));
      this.transitionReceipts.set(key, { requestDigest: plan.requestDigest, newlyEligibleWaits: copy(newlyEligibleWaits) });
      return { kind: "created" as const, newlyEligibleWaits };
    });
  }

  private async waitIsEligible(wait: QuotaWait, at: Date): Promise<boolean> {
    for (const evidence of wait.evidence) {
      const policy = this.policies.get(evidence.policyId);
      const revision = policy ? this.revisions.get(policy.currentRevisionId) : null;
      if (!policy || !revision || policy.status !== "active") return false;
      const projection = this.capacityProjectionUnlocked({
        workspaceId: wait.workspaceId,
        policyRevisionId: revision.id,
        window: quotaWindow(policy.window, policy.timezone, at),
      });
      if (compare(addDecimals(projection.committed, evidence.requested), revision.hardLimit) > 0) return false;
    }
    return wait.evidence.length > 0;
  }

  async commitUsageReconciliation(
    plan: QuotaUsageReconciliationPlan,
    transaction?: MemoryTransactionToken,
  ) {
    return this.withMutationAuthority(transaction, async () => {
      const key = `${plan.workspaceId}:${plan.reconciliationId}`;
      const prior = this.usageReconciliationReceipts.get(key);
      if (prior) {
        return prior.requestDigest === plan.requestDigest
          ? {
              kind: "replayed" as const,
              reservations: prior.reservationIds.map((id) => copy(this.reservations.get(id)!)),
            }
          : { kind: "conflict" as const };
      }
      const expected = [...this.reservations.values()]
        .filter((reservation) =>
          reservation.workspaceId === plan.workspaceId &&
          reservation.subject.kind === "usage_settlement" &&
          reservation.subject.id === plan.subject.id)
        .sort((left, right) => left.id.localeCompare(right.id));
      const expectedIds = expected.map((reservation) => reservation.id);
      const requestedIds = [...plan.reservationIds].sort();
      const ownership = expected[0];
      if (
        canonicalDigest(expectedIds) !== canonicalDigest(requestedIds) ||
        !expected.length ||
        expected.some((reservation) =>
        !reservation ||
        reservation.boundary !== "usage_settlement" ||
        reservation.kind !== "usage" ||
        reservation.dimension !== plan.dimension ||
        reservation.unit !== plan.unit ||
        reservation.reservationRule !== "consume" ||
        reservation.runId === null ||
        reservation.runId !== ownership?.runId ||
        reservation.admittedPrincipalId !== ownership?.admittedPrincipalId ||
        reservation.transitionKey !== ownership?.transitionKey)
      ) {
        return { kind: "unavailable" as const };
      }
      if (plan.actualAmount !== null && expected.some((reservation) => reservation.state !== "held")) {
        return { kind: "unavailable" as const };
      }
      const updated = expected.map((reservation) => {
        if (plan.actualAmount === null) return reservation;
        const settledAmount = compare(plan.actualAmount, reservation.reservedAmount) >= 0
          ? reservation.reservedAmount
          : plan.actualAmount;
        const next: QuotaReservation = {
          ...reservation,
          heldAmount: "0",
          settledAmount,
          releasedAmount: subtract(reservation.reservedAmount, settledAmount),
          overageAmount: subtract(plan.actualAmount, reservation.reservedAmount),
          state: compare(plan.actualAmount, "0") === 0 ? "released" : "settled",
          updatedAt: plan.recordedAt,
        };
        this.reservations.set(next.id, copy(next));
        return next;
      });
      this.usageReconciliationReceipts.set(key, {
        requestDigest: plan.requestDigest,
        reservationIds: expectedIds,
      });
      return { kind: "created" as const, reservations: updated.map(copy) };
    });
  }
}
