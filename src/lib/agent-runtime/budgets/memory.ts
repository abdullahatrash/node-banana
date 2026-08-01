import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { addDecimals, canonicalDecimal, multiplyDecimals } from "../usage/decimal";
import type {
  BudgetAdmissionPlan,
  BudgetAttemptAllocationInput,
  BudgetPolicy,
  BudgetPolicyRevision,
  BudgetRepository,
  BudgetReservation,
  BudgetSettlementPlan,
  CredentialSpendGrantEvidence,
  WorkspacePricingOverride,
} from "./types";

function copy<T>(value: T): T {
  return structuredClone(value);
}

function compareDecimals(left: string, right: string): number {
  const [aw, af = ""] = canonicalDecimal(left).split(".");
  const [bw, bf = ""] = canonicalDecimal(right).split(".");
  const scale = Math.max(af.length, bf.length);
  const ai = BigInt(`${aw}${af.padEnd(scale, "0")}`);
  const bi = BigInt(`${bw}${bf.padEnd(scale, "0")}`);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

function subtractDecimals(left: string, right: string): string {
  if (compareDecimals(left, right) < 0) return "0";
  const [aw, af = ""] = canonicalDecimal(left).split(".");
  const [bw, bf = ""] = canonicalDecimal(right).split(".");
  const scale = Math.max(af.length, bf.length);
  const result = BigInt(`${aw}${af.padEnd(scale, "0")}`) - BigInt(`${bw}${bf.padEnd(scale, "0")}`);
  if (scale === 0) return result.toString();
  const digits = result.toString().padStart(scale + 1, "0");
  return canonicalDecimal(`${digits.slice(0, -scale)}.${digits.slice(-scale)}`);
}

function committedValue(reservation: BudgetReservation): string {
  if (reservation.state === "released") return reservation.settledAmount;
  if (reservation.state === "settled") return reservation.settledAmount;
  return addDecimals(reservation.settledAmount, reservation.heldAmount);
}

function usdCents(amount: string): number | null {
  const value = canonicalDecimal(amount);
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
  const rounded = fraction.slice(2).replace(/0/g, "") ? cents + BigInt(1) : cents;
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null;
}

function pricingIdentity(item: Pick<WorkspacePricingOverride,
  "workspaceId" | "provider" | "providerOperation" | "model" | "serviceTier" | "dimension"
>): string {
  return [item.workspaceId, item.provider, item.providerOperation, item.model, item.serviceTier, item.dimension]
    .join("\u0000");
}

function selectedOverrides(items: WorkspacePricingOverride[]): WorkspacePricingOverride[] {
  const selected = new Map<string, WorkspacePricingOverride>();
  for (const item of [...items].sort((left, right) =>
    right.effectiveFrom.getTime() - left.effectiveFrom.getTime() ||
    right.createdAt.getTime() - left.createdAt.getTime() ||
    right.id.localeCompare(left.id))) {
    const key = pricingIdentity(item);
    if (!selected.has(key)) selected.set(key, item);
  }
  return [...selected.values()];
}

export class InMemoryBudgetRepository implements BudgetRepository<void> {
  readonly policies = new Map<string, BudgetPolicy>();
  readonly revisions = new Map<string, BudgetPolicyRevision>();
  readonly pricingOverrides = new Map<string, WorkspacePricingOverride>();
  readonly reservations = new Map<string, BudgetReservation>();
  readonly admissions = new Map<string, BudgetAdmissionPlan>();
  readonly admissionGrantReservations = new Map<string, { runId: string; grantId: string; reservedCents: number | null }>();
  readonly attemptAllocations = new Map<string, BudgetAttemptAllocationInput & { requestDigest: string; grantId: string | null; grantAmountCents: number | null }>();
  readonly grants = new Map<string, CredentialSpendGrantEvidence & { workspaceId: string; principalId: string }>();
  readonly receipts = new Map<string, { requestDigest: string; resourceId: string }>();
  readonly settlementReceipts = new Map<string, string>();
  readonly settlementHeads = new Map<string, {
    costValuationId: string;
    amount: string | null;
    currency: string | null;
    heldAmount: string | null;
    settledContribution: string;
    releasedContribution: string;
    resolvedHoldContribution: string;
    recordedAt: Date;
  }>();
  readonly suspensions = new Map<string, { suspended: boolean; reason: string; actorUserId: string; recordedAt: Date }>();
  private admissionTail: Promise<void> = Promise.resolve();

  seedGrant(input: CredentialSpendGrantEvidence & { workspaceId: string; principalId: string }): void {
    this.grants.set(input.grantId, copy(input));
  }

  private boundedGrantCommitted(grant: CredentialSpendGrantEvidence): string {
    const runtimeHeldCents = [...this.admissionGrantReservations.values()]
      .filter((item) => item.grantId === grant.grantId)
      .reduce((total, item) => total + (item.reservedCents ?? 0), 0);
    return addDecimals(grant.committed, String(runtimeHeldCents));
  }

  async getAdminReceipt(input: {
    workspaceId: string;
    kind: "policy_revision" | "pricing_override";
    idempotencyKey: string;
  }) {
    const receipt = this.receipts.get(`${input.kind === "policy_revision" ? "policy" : "pricing"}:${input.workspaceId}:${input.idempotencyKey}`);
    return receipt ? copy(receipt) : null;
  }

  async getPolicyRevision(input: { workspaceId: string; revisionId: string }) {
    const revision = this.revisions.get(input.revisionId);
    const policy = revision ? this.policies.get(revision.policyId) : null;
    return revision && policy && revision.workspaceId === input.workspaceId
      ? {
          policy: copy({
            ...policy,
            status: "active" as const,
            currentRevisionId: revision.id,
            updatedAt: revision.createdAt,
          }),
          revision: copy(revision),
        }
      : null;
  }

  async getPricingOverride(input: { workspaceId: string; overrideId: string }) {
    const item = this.pricingOverrides.get(input.overrideId);
    return item?.workspaceId === input.workspaceId
      ? copy({
          ...item,
          status: "active" as const,
          revokedAt: null,
          revokedByUserId: null,
        })
      : null;
  }

  async getEffectivePolicies(input: { workspaceId: string; principalId: string }) {
    return [...this.policies.values()]
      .filter((policy) =>
        policy.workspaceId === input.workspaceId &&
        policy.status === "active" &&
        (policy.principalId === null || policy.principalId === input.principalId))
      .map((policy) => ({ policy: copy(policy), revision: copy(this.revisions.get(policy.currentRevisionId)!) }))
      .sort((a, b) => a.policy.scope.localeCompare(b.policy.scope));
  }

  async listPolicies(workspaceId: string) {
    return [...this.policies.values()]
      .filter((policy) => policy.workspaceId === workspaceId)
      .map((policy) => ({ policy: copy(policy), revision: copy(this.revisions.get(policy.currentRevisionId)!) }));
  }

  async appendPolicyRevision(input: {
    policy: BudgetPolicy;
    revision: BudgetPolicyRevision;
    requestDigest: string;
    idempotencyKey: string;
  }) {
    const receiptKey = `policy:${input.policy.workspaceId}:${input.idempotencyKey}`;
    const receipt = this.receipts.get(receiptKey);
    if (receipt) return receipt.requestDigest === input.requestDigest ? "replayed" as const : "conflict" as const;
    const current = this.policies.get(input.policy.id);
    if (
      current && (
        current.workspaceId !== input.policy.workspaceId ||
        current.principalId !== input.policy.principalId ||
        input.revision.revision !== this.revisions.get(current.currentRevisionId)!.revision + 1
      )
    ) return "conflict" as const;
    if (this.revisions.has(input.revision.id)) return "conflict" as const;
    this.revisions.set(input.revision.id, copy(input.revision));
    this.policies.set(input.policy.id, copy(input.policy));
    this.receipts.set(receiptKey, { requestDigest: input.requestDigest, resourceId: input.revision.id });
    return "created" as const;
  }

  async getCommittedAmount(input: {
    workspaceId: string;
    policyRevisionId: string;
    periodStartsAt: Date;
    periodEndsAt: Date | null;
  }) {
    const revision = this.revisions.get(input.policyRevisionId);
    if (!revision || revision.workspaceId !== input.workspaceId) return "0";
    return [...this.reservations.values()]
      .filter((reservation) =>
        reservation.workspaceId === input.workspaceId &&
        reservation.policyId === revision.policyId &&
        reservation.period.startsAt.getTime() === input.periodStartsAt.getTime() &&
        (reservation.period.endsAt?.getTime() ?? null) === (input.periodEndsAt?.getTime() ?? null))
      .reduce((total, reservation) => addDecimals(total, committedValue(reservation)), "0");
  }

  async listActivePricingOverrides(input: { workspaceId: string; at: Date }) {
    return selectedOverrides([...this.pricingOverrides.values()]
      .filter((item) =>
        item.workspaceId === input.workspaceId &&
        item.status === "active" &&
        item.effectiveFrom <= input.at)
      .map(copy));
  }

  async listPricingOverrides(workspaceId: string) {
    return [...this.pricingOverrides.values()].filter((item) => item.workspaceId === workspaceId).map(copy);
  }

  async appendPricingOverride(input: {
    override: WorkspacePricingOverride;
    requestDigest: string;
    idempotencyKey: string;
  }) {
    const receiptKey = `pricing:${input.override.workspaceId}:${input.idempotencyKey}`;
    const receipt = this.receipts.get(receiptKey);
    if (receipt) return receipt.requestDigest === input.requestDigest ? "replayed" as const : "conflict" as const;
    if (this.pricingOverrides.has(input.override.id)) return "conflict" as const;
    if ([...this.pricingOverrides.values()].some((item) =>
      item.status === "active" && pricingIdentity(item) === pricingIdentity(input.override))) {
      return "conflict" as const;
    }
    this.pricingOverrides.set(input.override.id, copy(input.override));
    this.receipts.set(receiptKey, { requestDigest: input.requestDigest, resourceId: input.override.id });
    return "created" as const;
  }

  async revokePricingOverride(input: {
    workspaceId: string;
    overrideId: string;
    actorUserId: string;
    recordedAt: Date;
  }) {
    const current = this.pricingOverrides.get(input.overrideId);
    if (!current || current.workspaceId !== input.workspaceId) return false;
    if (current.status === "revoked") return true;
    this.pricingOverrides.set(current.id, {
      ...current,
      status: "revoked",
      revokedAt: input.recordedAt,
      revokedByUserId: input.actorUserId,
    });
    return true;
  }

  async getCredentialGrantEvidence(input: {
    workspaceId: string;
    principalId: string;
    credentialSlotIds: string[];
    credentialProfileIds: string[];
  }) {
    return [...this.grants.values()]
      .filter((grant) =>
        grant.workspaceId === input.workspaceId &&
        grant.principalId === input.principalId &&
        (
          input.credentialProfileIds.includes(grant.credentialProfileId) ||
          input.credentialSlotIds.includes(grant.credentialSlotId)
        ))
      .map(({ workspaceId: _workspaceId, principalId: _principalId, ...grant }) => {
        const committed = this.boundedGrantCommitted(grant);
        return copy({
          ...grant,
          committed,
          available: grant.limit === null ? null : subtractDecimals(grant.limit, committed),
        });
      });
  }

  async isSpendSuspended(workspaceId: string) {
    return this.suspensions.get(workspaceId)?.suspended ?? false;
  }

  async setSpendSuspended(input: {
    workspaceId: string;
    suspended: boolean;
    reason: string;
    actorUserId: string;
    recordedAt: Date;
  }) {
    this.suspensions.set(input.workspaceId, copy(input));
  }

  async commitAdmission(plan: BudgetAdmissionPlan) {
    const previous = this.admissionTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.admissionTail = previous.then(() => current);
    await previous;
    try {
    const receiptKey = `admission:${plan.workspaceId}:${plan.runId}`;
    const receipt = this.receipts.get(receiptKey);
    if (receipt) return receipt.requestDigest === plan.requestDigest ? "replayed" as const : "conflict" as const;
    if (await this.isSpendSuspended(plan.workspaceId)) return "unavailable" as const;
    if (plan.reservations.length === 0 || plan.reservations.some((item) => item.workspaceId !== plan.workspaceId || item.runId !== plan.runId)) {
      return "unavailable" as const;
    }
    const activeOverrides = await this.listActivePricingOverrides({
      workspaceId: plan.workspaceId,
      at: new Date(),
    });
    for (const exposure of plan.stepExposures) {
      const applicable = selectedOverrides(activeOverrides.filter((item) =>
        item.provider === exposure.provider &&
        item.providerOperation === exposure.providerOperation &&
        item.model === exposure.model &&
        item.serviceTier === exposure.serviceTier));
      const expectedOverrideIds = exposure.pricingSnapshotIds
        .filter((id) => this.pricingOverrides.has(id))
        .sort();
      if (
        applicable.length > 0 ||
        expectedOverrideIds.length > 0 ||
        exposure.pricingSource === "workspace_override"
      ) {
        const actualIds = applicable.map((item) => item.id).sort();
        if (canonicalDigest(actualIds) !== canonicalDigest(expectedOverrideIds)) {
          return "unavailable" as const;
        }
      }
    }
    for (const reservation of plan.reservations) {
      const policy = this.policies.get(reservation.policyId);
      const revision = this.revisions.get(reservation.policyRevisionId);
      if (
        !policy || !revision || policy.status !== "active" ||
        policy.currentRevisionId !== revision.id ||
        policy.currency !== reservation.currency
      ) return "unavailable" as const;
      const committed = await this.getCommittedAmount({
        workspaceId: plan.workspaceId,
        policyRevisionId: revision.id,
        periodStartsAt: reservation.period.startsAt,
        periodEndsAt: reservation.period.endsAt,
      });
      if (compareDecimals(addDecimals(committed, reservation.reservedAmount), revision.hardLimit) > 0) {
        return "unavailable" as const;
      }
      if (this.reservations.has(reservation.id)) return "conflict" as const;
    }
    const grantReservations: Array<{ runId: string; grantId: string; reservedCents: number | null }> = [];
    for (const grantId of plan.grantIds) {
      const grant = this.grants.get(grantId);
      if (!grant || grant.workspaceId !== plan.workspaceId || grant.principalId !== plan.principalId) return "unavailable" as const;
      let reservedCents: number | null = null;
      if (grant.mode === "bounded") {
        const amounts = plan.stepExposures
          .filter((exposure) => exposure.credentialProfileId === grant.credentialProfileId || exposure.credentialSlotId === grant.credentialSlotId)
          .map((exposure) => exposure.amountPerAttempt !== null && exposure.currency === "USD"
            ? usdCents(multiplyDecimals(exposure.amountPerAttempt, String(exposure.automaticAttempts)))
            : null);
        if (!amounts.length || amounts.some((amount) => amount === null) || grant.limit === null) return "unavailable" as const;
        reservedCents = amounts.reduce<number>((total, amount) => total + amount!, 0);
        if (compareDecimals(addDecimals(this.boundedGrantCommitted(grant), String(reservedCents)), grant.limit) > 0) return "unavailable" as const;
      }
      grantReservations.push({ runId: plan.runId, grantId, reservedCents });
    }
    plan.reservations.forEach((reservation) => this.reservations.set(reservation.id, copy(reservation)));
    this.admissions.set(plan.runId, copy(plan));
    grantReservations.forEach((item) => this.admissionGrantReservations.set(`${item.runId}:${item.grantId}`, item));
    this.receipts.set(receiptKey, { requestDigest: plan.requestDigest, resourceId: plan.runId });
    return "created" as const;
    } finally {
      release();
    }
  }

  async commitAttemptAllocation(input: BudgetAttemptAllocationInput) {
    const requestDigest = canonicalDigest({ ...input, recordedAt: input.recordedAt.toISOString() });
    const existing = this.attemptAllocations.get(input.id);
    if (existing) return existing.requestDigest === requestDigest ? "replayed" as const : "conflict" as const;
    if (await this.isSpendSuspended(input.workspaceId)) return "unavailable" as const;
    const admission = this.admissions.get(input.runId);
    if (!admission || admission.workspaceId !== input.workspaceId || admission.principalId !== input.principalId) return "unavailable" as const;
    const exposure = admission.stepExposures.find((item) => item.stepId === input.stepId);
    if (
      !exposure || input.attempt > exposure.automaticAttempts || input.attempt < 1 ||
      exposure.provider !== input.provider || exposure.providerOperation !== input.providerOperation || exposure.model !== input.model
    ) return "unavailable" as const;
    const grant = exposure.credentialSlotId || exposure.credentialProfileId
      ? [...this.grants.values()].find((item) =>
        admission.grantIds.includes(item.grantId) &&
        (item.credentialSlotId === exposure.credentialSlotId || item.credentialProfileId === exposure.credentialProfileId))
      : null;
    if ((exposure.credentialSlotId || exposure.credentialProfileId) && !grant) return "unavailable" as const;
    let grantAmountCents: number | null = null;
    if (grant?.mode === "bounded") {
      if (exposure.amountPerAttempt === null || exposure.currency !== "USD") return "unavailable" as const;
      grantAmountCents = usdCents(exposure.amountPerAttempt);
      const envelope = this.admissionGrantReservations.get(`${input.runId}:${grant.grantId}`)?.reservedCents;
      if (grantAmountCents === null || envelope === null || envelope === undefined) return "unavailable" as const;
      const allocated = [...this.attemptAllocations.values()]
        .filter((item) => item.runId === input.runId && item.grantId === grant.grantId)
        .reduce((total, item) => total + (item.grantAmountCents ?? 0), 0);
      if (allocated + grantAmountCents > envelope) return "unavailable" as const;
      if (
        grant.limit === null ||
        compareDecimals(this.boundedGrantCommitted(grant), grant.limit) > 0
      ) return "unavailable" as const;
    }
    this.attemptAllocations.set(input.id, { ...copy(input), requestDigest, grantId: grant?.grantId ?? null, grantAmountCents });
    return "created" as const;
  }

  async commitSettlement(plan: BudgetSettlementPlan) {
    const digest = canonicalDigest({ ...plan, recordedAt: plan.recordedAt.toISOString() });
    const receiptKey = `${plan.workspaceId}:${plan.runId}:${plan.costValuationId}`;
    const receipt = this.settlementReceipts.get(receiptKey);
    if (receipt) return receipt === digest ? "replayed" as const : "conflict" as const;
    const headKey = `${plan.workspaceId}:${plan.runId}:${plan.settlementId}`;
    const priorHead = this.settlementHeads.get(headKey);
    if (
      priorHead &&
      (
        plan.recordedAt < priorHead.recordedAt ||
        (
          plan.recordedAt.getTime() === priorHead.recordedAt.getTime() &&
          plan.costValuationId !== priorHead.costValuationId
        )
      )
    ) return "conflict" as const;
    const reservations = [...this.reservations.values()].filter(
      (reservation) => reservation.workspaceId === plan.workspaceId && reservation.runId === plan.runId,
    );
    if (!reservations.length) return "unavailable" as const;
    const currencylessKnownZero = plan.amount !== null &&
      compareDecimals(plan.amount, "0") === 0 &&
      plan.currency === null;
    if (
      plan.outcome !== "outcome_unknown" &&
      plan.amount !== null &&
      plan.currency === null &&
      !currencylessKnownZero
    ) return "unavailable" as const;
    const allocation = [...this.attemptAllocations.values()].find(
      (item) =>
        item.workspaceId === plan.workspaceId &&
        item.runId === plan.runId &&
        item.stepAttemptId === plan.stepAttemptId,
    );
    const admission = this.admissions.get(plan.runId);
    for (const reservation of reservations) {
      if (plan.currency !== null && plan.currency !== reservation.currency) return "unavailable" as const;
      const heldAmount = allocation
        ? admission?.reservationAllocations.find((item) =>
            item.policyRevisionId === reservation.policyRevisionId &&
            item.stepId === allocation.stepId &&
            item.currency === reservation.currency)?.amountPerAttempt ?? null
        : null;
      const withoutPrior = subtractDecimals(
        reservation.settledAmount,
        priorHead?.settledContribution ?? "0",
      );
      const heldWithoutPrior = addDecimals(
        reservation.heldAmount,
        priorHead?.resolvedHoldContribution ?? "0",
      );
      const heldUnknown = plan.outcome === "outcome_unknown" || plan.amount === null;
      const settledAmount = heldUnknown
        ? withoutPrior
        : addDecimals(withoutPrior, plan.amount!);
      const nextHeldAmount = heldUnknown
        ? heldWithoutPrior
        : plan.runTerminal
          ? "0"
          : heldAmount === null
            ? heldWithoutPrior
            : subtractDecimals(heldWithoutPrior, heldAmount);
      const releasedAmount = subtractDecimals(
        reservation.reservedAmount,
        addDecimals(settledAmount, nextHeldAmount),
      );
      this.reservations.set(reservation.id, {
        ...reservation,
        settledAmount,
        releasedAmount,
        heldAmount: nextHeldAmount,
        state: plan.outcome === "outcome_unknown"
          ? "outcome_unknown"
          : plan.amount === null
            ? "held_unknown_cost"
            : plan.runTerminal
              ? "settled"
              : "held",
        updatedAt: plan.recordedAt,
      });
    }
    this.settlementReceipts.set(receiptKey, digest);
    this.settlementHeads.set(headKey, {
      costValuationId: plan.costValuationId,
      amount: plan.amount,
      currency: currencylessKnownZero
        ? reservations[0]!.currency
        : plan.currency,
      heldAmount: allocation
        ? admission?.reservationAllocations.find((item) =>
            item.stepId === allocation.stepId &&
            item.currency === (currencylessKnownZero ? reservations[0]!.currency : plan.currency))?.amountPerAttempt ?? null
        : null,
      settledContribution:
        plan.outcome !== "outcome_unknown" && plan.amount !== null
          ? plan.amount
          : "0",
      releasedContribution: (() => {
        const reservation = reservations[0]!;
        return this.reservations.get(reservation.id)!.releasedAmount;
      })(),
      resolvedHoldContribution: (() => {
        const reservation = reservations[0]!;
        const updated = this.reservations.get(reservation.id)!;
        const priorHeld = addDecimals(
          reservation.heldAmount,
          priorHead?.resolvedHoldContribution ?? "0",
        );
        return subtractDecimals(priorHeld, updated.heldAmount);
      })(),
      recordedAt: plan.recordedAt,
    });
    return "created" as const;
  }

  async listReservations(input: { workspaceId: string; runId?: string; principalId?: string }) {
    return [...this.reservations.values()]
      .filter((item) =>
        item.workspaceId === input.workspaceId &&
        (!input.runId || item.runId === input.runId) &&
        (!input.principalId || item.admittedPrincipalId === input.principalId))
      .map(copy);
  }
}
