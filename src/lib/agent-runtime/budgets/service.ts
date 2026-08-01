import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  addDecimals,
  canonicalDecimal,
  multiplyDecimals,
} from "../usage/decimal";
import { budgetPeriodWindow, assertIanaTimezone } from "./period";
import type {
  BudgetAdmissionInput,
  BudgetAdmissionPlan,
  BudgetPolicy,
  BudgetPolicyRevision,
  BudgetRepository,
  BudgetSettlementPlan,
  CreateBudgetPolicyRevisionInput,
  CreatePricingOverrideInput,
  RunAdmissionPreview,
  RunStepExposure,
  WorkspacePricingOverride,
} from "./types";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/;
const DIMENSION = /^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$/;
const CURRENCY = /^[A-Z]{3}$/;

export class BudgetServiceError extends Error {
  constructor(
    readonly code:
      | "BUDGET_INVALID_INPUT"
      | "BUDGET_NOT_ADMISSIBLE"
      | "BUDGET_CONFLICT"
      | "BUDGET_UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

export interface FxRateReader {
  getRate(input: {
    workspaceId: string;
    baseCurrency: string;
    quoteCurrency: string;
    at: Date;
  }): Promise<{ rate: string; snapshotId: string } | null>;
}

const noFx: FxRateReader = {
  async getRate() {
    return null;
  },
};

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${canonicalDigest(value).slice(7, 39)}`;
}

function cleanId(value: string, label: string): string {
  const normalized = value.trim();
  if (!ID.test(normalized)) throw new BudgetServiceError("BUDGET_INVALID_INPUT", `${label} is invalid.`);
  return normalized;
}

function currency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!CURRENCY.test(normalized)) throw new BudgetServiceError("BUDGET_INVALID_INPUT", "Currency must be an ISO 4217 code.");
  return normalized;
}

function compareDecimals(left: string, right: string): number {
  const a = canonicalDecimal(left);
  const b = canonicalDecimal(right);
  const [aw, af = ""] = a.split(".");
  const [bw, bf = ""] = b.split(".");
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
  const coefficient =
    BigInt(`${aw}${af.padEnd(scale, "0")}`) -
    BigInt(`${bw}${bf.padEnd(scale, "0")}`);
  if (scale === 0) return coefficient.toString();
  const digits = coefficient.toString().padStart(scale + 1, "0");
  return canonicalDecimal(`${digits.slice(0, -scale)}.${digits.slice(-scale)}`);
}

function usdCents(amount: string): number | null {
  const [whole, fraction = ""] = canonicalDecimal(amount).split(".");
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

function selectedPricingOverrides(items: WorkspacePricingOverride[]): WorkspacePricingOverride[] {
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

function validateStepExposure(step: RunStepExposure): RunStepExposure {
  if (
    !Number.isSafeInteger(step.automaticAttempts) ||
    step.automaticAttempts < 1 ||
    step.automaticAttempts > 100
  ) {
    throw new BudgetServiceError("BUDGET_INVALID_INPUT", "Automatic attempt bound is invalid.");
  }
  if ((step.amountPerAttempt === null) !== (step.currency === null)) {
    throw new BudgetServiceError("BUDGET_INVALID_INPUT", "Step price and currency certainty disagree.");
  }
  return {
    ...structuredClone(step),
    stepId: cleanId(step.stepId, "Step ID"),
    provider: cleanId(step.provider, "Provider"),
    providerOperation: cleanId(step.providerOperation, "Provider operation"),
    model: cleanId(step.model, "Model"),
    serviceTier: cleanId(step.serviceTier, "Service tier"),
    credentialSlotId: step.credentialSlotId
      ? cleanId(step.credentialSlotId, "Credential Slot ID")
      : null,
    credentialProfileId: step.credentialProfileId
      ? cleanId(step.credentialProfileId, "Credential Profile ID")
      : null,
    amountPerAttempt: step.amountPerAttempt === null
      ? null
      : canonicalDecimal(step.amountPerAttempt),
    currency: step.currency === null ? null : currency(step.currency),
    pricingSnapshotIds: [...new Set(step.pricingSnapshotIds.map((id) => cleanId(id, "Pricing Snapshot ID")))].sort(),
  };
}

export class BudgetService {
  constructor(
    private readonly repository: BudgetRepository,
    private readonly fx: FxRateReader = noFx,
  ) {}

  async createPolicyRevision(input: CreateBudgetPolicyRevisionInput): Promise<{ policy: BudgetPolicy; revision: BudgetPolicyRevision }> {
    const workspaceId = cleanId(input.workspaceId, "Workspace ID");
    const principalId = input.principalId ? cleanId(input.principalId, "Principal ID") : null;
    const normalizedCurrency = currency(input.currency);
    const timezone = assertIanaTimezone(input.timezone);
    const warningThreshold = canonicalDecimal(input.warningThreshold);
    const hardLimit = canonicalDecimal(input.hardLimit);
    if (compareDecimals(hardLimit, "0") <= 0 || compareDecimals(warningThreshold, hardLimit) > 0) {
      throw new BudgetServiceError("BUDGET_INVALID_INPUT", "Budget thresholds are invalid.");
    }
    const allowance = input.unknownPriceTreatment === "fixed_allowance"
      ? canonicalDecimal(input.unknownPriceAllowance ?? "")
      : null;
    if (
      input.unknownPriceTreatment === "deny" && input.unknownPriceAllowance !== null ||
      allowance !== null && compareDecimals(allowance, "0") <= 0
    ) {
      throw new BudgetServiceError("BUDGET_INVALID_INPUT", "Unknown-price treatment is invalid.");
    }
    const idempotencyKey = cleanId(input.idempotencyKey, "Idempotency key");
    const { recordedAt: _recordedAt, ...policyRequest } = input;
    const requestDigest = canonicalDigest(policyRequest);
    const priorReceipt = await this.repository.getAdminReceipt({
      workspaceId,
      kind: "policy_revision",
      idempotencyKey,
    });
    if (priorReceipt) {
      if (priorReceipt.requestDigest !== requestDigest) {
        throw new BudgetServiceError("BUDGET_CONFLICT", "Budget policy idempotency conflict.");
      }
      const persisted = await this.repository.getPolicyRevision({
        workspaceId,
        revisionId: priorReceipt.resourceId,
      });
      if (!persisted) {
        throw new BudgetServiceError("BUDGET_UNAVAILABLE", "Persisted Budget policy revision is unavailable.");
      }
      return persisted;
    }
    const existing = await this.repository.listPolicies(workspaceId);
    const sameScope = existing.find(({ policy }) => policy.principalId === principalId && policy.status === "active");
    const workspacePolicy = existing.find(({ policy }) => policy.principalId === null && policy.status === "active");
    if (
      sameScope && (
        sameScope.policy.currency !== normalizedCurrency ||
        sameScope.policy.period !== input.period ||
        sameScope.policy.timezone !== timezone
      )
    ) {
      throw new BudgetServiceError(
        "BUDGET_INVALID_INPUT",
        "Currency, calendar window, and timezone are stable Budget Policy identity fields.",
      );
    }
    if (principalId) {
      if (!workspacePolicy) {
        throw new BudgetServiceError("BUDGET_INVALID_INPUT", "A principal policy requires an active Workspace policy.");
      }
      const parent = workspacePolicy.revision;
      const narrows =
        normalizedCurrency === workspacePolicy.policy.currency &&
        input.period === workspacePolicy.policy.period &&
        timezone === workspacePolicy.policy.timezone &&
        compareDecimals(hardLimit, parent.hardLimit) <= 0 &&
        compareDecimals(warningThreshold, parent.warningThreshold) <= 0 &&
        (parent.unknownPriceTreatment === "fixed_allowance" || input.unknownPriceTreatment === "deny") &&
        (
          input.unknownPriceTreatment === "deny" ||
          parent.unknownPriceAllowance !== null && allowance !== null &&
          compareDecimals(allowance, parent.unknownPriceAllowance) <= 0
        );
      if (!narrows) {
        throw new BudgetServiceError("BUDGET_INVALID_INPUT", "An Agent Principal policy may only narrow the Workspace policy.");
      }
    }
    const policyId = sameScope?.policy.id ?? stableId("budget_policy", { workspaceId, principalId });
    const revisionNumber = (sameScope?.revision.revision ?? 0) + 1;
    const revisionId = stableId("budget_revision", {
      policyId,
      revisionNumber,
      normalizedCurrency,
      period: input.period,
      timezone,
      warningThreshold,
      hardLimit,
      unknownPriceTreatment: input.unknownPriceTreatment,
      allowance,
    });
    const revision: BudgetPolicyRevision = {
      schema: "budget-policy-revision/v1",
      id: revisionId,
      policyId,
      workspaceId,
      principalId,
      revision: revisionNumber,
      warningThreshold,
      hardLimit,
      unknownPriceTreatment: input.unknownPriceTreatment,
      unknownPriceAllowance: allowance,
      createdByUserId: cleanId(input.actorUserId, "Actor User ID"),
      createdAt: input.recordedAt,
    };
    const policy: BudgetPolicy = {
      schema: "budget-policy/v1",
      id: policyId,
      workspaceId,
      principalId,
      scope: principalId ? "principal" : "workspace",
      currency: normalizedCurrency,
      period: input.period,
      timezone,
      status: "active",
      currentRevisionId: revisionId,
      createdAt: sameScope?.policy.createdAt ?? input.recordedAt,
      updatedAt: input.recordedAt,
    };
    const result = await this.repository.appendPolicyRevision({
      policy,
      revision,
      requestDigest,
      idempotencyKey,
    });
    if (result === "conflict") throw new BudgetServiceError("BUDGET_CONFLICT", "Budget policy idempotency conflict.");
    return { policy, revision };
  }

  async createPricingOverride(input: CreatePricingOverrideInput): Promise<WorkspacePricingOverride> {
    const workspaceId = cleanId(input.workspaceId, "Workspace ID");
    const idempotencyKey = cleanId(input.idempotencyKey, "Idempotency key");
    const { recordedAt: _recordedAt, ...overrideRequest } = input;
    const requestDigest = canonicalDigest({
      ...overrideRequest,
      effectiveFrom: input.effectiveFrom.toISOString(),
    });
    const priorReceipt = await this.repository.getAdminReceipt({
      workspaceId,
      kind: "pricing_override",
      idempotencyKey,
    });
    if (priorReceipt) {
      if (priorReceipt.requestDigest !== requestDigest) {
        throw new BudgetServiceError("BUDGET_CONFLICT", "Pricing override idempotency conflict.");
      }
      const persisted = await this.repository.getPricingOverride({
        workspaceId,
        overrideId: priorReceipt.resourceId,
      });
      if (!persisted) {
        throw new BudgetServiceError("BUDGET_UNAVAILABLE", "Persisted pricing override is unavailable.");
      }
      return persisted;
    }
    const item: WorkspacePricingOverride = {
      schema: "workspace-pricing-override/v1",
      id: stableId("pricing_override", {
        workspaceId: input.workspaceId,
        provider: input.provider,
        operation: input.providerOperation,
        model: input.model,
        tier: input.serviceTier,
        dimension: input.dimension,
        effectiveFrom: input.effectiveFrom.toISOString(),
      }),
      workspaceId,
      provider: cleanId(input.provider, "Provider"),
      providerOperation: cleanId(input.providerOperation, "Provider operation"),
      model: cleanId(input.model, "Model"),
      serviceTier: cleanId(input.serviceTier, "Service tier"),
      dimension: DIMENSION.test(input.dimension) ? input.dimension : (() => { throw new BudgetServiceError("BUDGET_INVALID_INPUT", "Usage dimension is invalid."); })(),
      unit: input.unit,
      price: canonicalDecimal(input.price),
      currency: currency(input.currency),
      perQuantity: canonicalDecimal(input.perQuantity),
      runCeiling: canonicalDecimal(input.runCeiling),
      sourceRef: cleanId(input.sourceRef, "Source reference"),
      effectiveFrom: input.effectiveFrom,
      status: "active",
      createdByUserId: cleanId(input.actorUserId, "Actor User ID"),
      createdAt: input.recordedAt,
      revokedAt: null,
      revokedByUserId: null,
    };
    if (compareDecimals(item.perQuantity, "0") <= 0 || compareDecimals(item.runCeiling, "0") <= 0) {
      throw new BudgetServiceError("BUDGET_INVALID_INPUT", "Pricing quantities must be positive.");
    }
    const overlapping = (await this.repository.listPricingOverrides(workspaceId)).find((candidate) =>
      candidate.status === "active" && pricingIdentity(candidate) === pricingIdentity(item));
    if (overlapping) {
      throw new BudgetServiceError(
        "BUDGET_CONFLICT",
        "An active pricing override already owns this provider pricing selector.",
      );
    }
    const result = await this.repository.appendPricingOverride({
      override: item,
      requestDigest,
      idempotencyKey,
    });
    if (result === "conflict") throw new BudgetServiceError("BUDGET_CONFLICT", "Pricing override idempotency conflict.");
    return item;
  }

  listPolicies(workspaceId: string) {
    return this.repository.listPolicies(cleanId(workspaceId, "Workspace ID"));
  }

  getEffectivePolicies(input: { workspaceId: string; principalId: string }) {
    return this.repository.getEffectivePolicies({
      workspaceId: cleanId(input.workspaceId, "Workspace ID"),
      principalId: cleanId(input.principalId, "Principal ID"),
    });
  }

  listPricingOverrides(workspaceId: string) {
    return this.repository.listPricingOverrides(cleanId(workspaceId, "Workspace ID"));
  }

  async revokePricingOverride(input: {
    workspaceId: string;
    overrideId: string;
    actorUserId: string;
    recordedAt: Date;
  }): Promise<void> {
    const revoked = await this.repository.revokePricingOverride({
      ...input,
      workspaceId: cleanId(input.workspaceId, "Workspace ID"),
      overrideId: cleanId(input.overrideId, "Pricing Override ID"),
      actorUserId: cleanId(input.actorUserId, "Actor User ID"),
    });
    if (!revoked) throw new BudgetServiceError("BUDGET_UNAVAILABLE", "Pricing override is unavailable.");
  }

  listReservations(input: { workspaceId: string; runId?: string; principalId?: string }) {
    return this.repository.listReservations({
      workspaceId: cleanId(input.workspaceId, "Workspace ID"),
      ...(input.runId ? { runId: cleanId(input.runId, "Run ID") } : {}),
      ...(input.principalId ? { principalId: cleanId(input.principalId, "Principal ID") } : {}),
    });
  }

  async setSpendSuspended(input: { workspaceId: string; suspended: boolean; reason: string; actorUserId: string; recordedAt: Date }) {
    const reason = input.reason.trim();
    if (!reason || reason.length > 500) throw new BudgetServiceError("BUDGET_INVALID_INPUT", "Spend-control reason is invalid.");
    await this.repository.setSpendSuspended({
      ...input,
      workspaceId: cleanId(input.workspaceId, "Workspace ID"),
      actorUserId: cleanId(input.actorUserId, "Actor User ID"),
      reason,
    });
  }

  async getSpendControl(workspaceId: string): Promise<{ workspaceId: string; suspended: boolean }> {
    const normalized = cleanId(workspaceId, "Workspace ID");
    return { workspaceId: normalized, suspended: await this.repository.isSpendSuspended(normalized) };
  }

  async previewRun(raw: BudgetAdmissionInput): Promise<RunAdmissionPreview> {
    const input = {
      ...raw,
      workspaceId: cleanId(raw.workspaceId, "Workspace ID"),
      principalId: cleanId(raw.principalId, "Principal ID"),
      workflowId: cleanId(raw.workflowId, "Workflow ID"),
      workflowRevisionId: cleanId(raw.workflowRevisionId, "Workflow Revision ID"),
      stepExposures: raw.stepExposures.map(validateStepExposure),
    };
    const overrides = await this.repository.listActivePricingOverrides({
      workspaceId: input.workspaceId,
      at: input.at,
    });
    input.stepExposures = input.stepExposures.map((step) => {
      const applicable = selectedPricingOverrides(overrides.filter((item) =>
        item.provider === step.provider &&
        item.providerOperation === step.providerOperation &&
        item.model === step.model &&
        item.serviceTier === step.serviceTier
      ));
      if (!applicable.length) return step;
      const currencies = [...new Set(applicable.map((item) => item.currency))];
      if (currencies.length !== 1) {
        return {
          ...step,
          amountPerAttempt: null,
          currency: null,
          pricingSnapshotIds: applicable.map((item) => item.id).sort(),
          pricingSource: "unknown" as const,
        };
      }
      return {
        ...step,
        amountPerAttempt: applicable.reduce(
          (total, item) => addDecimals(total, item.runCeiling),
          "0",
        ),
        currency: currencies[0]!,
        pricingSnapshotIds: applicable.map((item) => item.id).sort(),
        pricingSource: "workspace_override" as const,
      };
    });
    const applicablePolicies = await this.repository.getEffectivePolicies(input);
    const workspacePolicy = applicablePolicies.find(({ policy }) => policy.scope === "workspace");
    const strictest = applicablePolicies.find(({ policy }) => policy.scope === "principal") ?? workspacePolicy;
    const denialReasons: string[] = [];
    const warnings: string[] = [];
    if (!workspacePolicy || !strictest) denialReasons.push("BUDGET_POLICY_UNAVAILABLE");
    if (await this.repository.isSpendSuspended(input.workspaceId)) denialReasons.push("EMERGENCY_SPEND_SUSPENDED");
    const targetCurrency = strictest?.policy.currency ?? null;
    let known = "0";
    let unknownAttempts = 0;
    const fxSnapshotIds: string[] = [];
    const admittedAmountPerAttempt = new Map<string, string>();
    for (const step of input.stepExposures) {
      if (step.amountPerAttempt === null || step.currency === null || !targetCurrency) {
        unknownAttempts += step.automaticAttempts;
        continue;
      }
      let perAttempt = step.amountPerAttempt;
      if (step.currency !== targetCurrency) {
        const rate = await this.fx.getRate({
          workspaceId: input.workspaceId,
          baseCurrency: step.currency,
          quoteCurrency: targetCurrency,
          at: input.at,
        });
        if (!rate) {
          unknownAttempts += step.automaticAttempts;
          continue;
        }
        perAttempt = multiplyDecimals(perAttempt, canonicalDecimal(rate.rate));
        fxSnapshotIds.push(rate.snapshotId);
      }
      admittedAmountPerAttempt.set(step.stepId, perAttempt);
      const amount = multiplyDecimals(perAttempt, String(step.automaticAttempts));
      known = addDecimals(known, amount);
    }
    let ceiling: string | null = targetCurrency ? known : null;
    if (unknownAttempts > 0 && strictest) {
      if (strictest.revision.unknownPriceTreatment === "deny" || strictest.revision.unknownPriceAllowance === null) {
        ceiling = null;
        denialReasons.push("UNKNOWN_PRICING_DENIED");
      } else {
        for (const step of input.stepExposures) {
          if (!admittedAmountPerAttempt.has(step.stepId)) {
            admittedAmountPerAttempt.set(
              step.stepId,
              strictest.revision.unknownPriceAllowance,
            );
          }
        }
        ceiling = addDecimals(
          known,
          multiplyDecimals(strictest.revision.unknownPriceAllowance, String(unknownAttempts)),
        );
        warnings.push("UNKNOWN_PRICING_FIXED_ALLOWANCE");
      }
    }
    const credentialProfileIds = [...new Set(input.stepExposures
      .map((step) => step.credentialProfileId)
      .filter((id): id is string => id !== null))];
    const credentialSlotIds = [...new Set(input.stepExposures
      .map((step) => step.credentialSlotId)
      .filter((id): id is string => id !== null))];
    const grants = await this.repository.getCredentialGrantEvidence({
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      credentialSlotIds,
      credentialProfileIds,
    });
    for (const slotId of credentialSlotIds) {
      if (!grants.some((candidate) => candidate.credentialSlotId === slotId)) {
        denialReasons.push(`CREDENTIAL_SPEND_GRANT_UNAVAILABLE:${slotId}`);
      }
    }
    for (const profileId of credentialProfileIds) {
      const grant = grants.find((candidate) => candidate.credentialProfileId === profileId);
      if (!grant) denialReasons.push(`CREDENTIAL_SPEND_GRANT_UNAVAILABLE:${profileId}`);
    }
    for (const grant of grants.filter((candidate) => candidate.mode === "bounded")) {
      const exposures = input.stepExposures.filter((step) =>
        step.credentialProfileId === grant.credentialProfileId ||
        step.credentialSlotId === grant.credentialSlotId);
      let reservedCents = 0;
      let exposureUnknown = exposures.length === 0 || grant.available === null;
      for (const exposure of exposures) {
        if (exposure.amountPerAttempt === null || exposure.currency !== "USD") {
          exposureUnknown = true;
          break;
        }
        const cents = usdCents(multiplyDecimals(
          exposure.amountPerAttempt,
          String(exposure.automaticAttempts),
        ));
        if (cents === null || !Number.isSafeInteger(reservedCents + cents)) {
          exposureUnknown = true;
          break;
        }
        reservedCents += cents;
      }
      if (exposureUnknown) {
        denialReasons.push(`CREDENTIAL_SPEND_GRANT_EXPOSURE_UNKNOWN:${grant.grantId}`);
      } else if (compareDecimals(String(reservedCents), grant.available!) > 0) {
        denialReasons.push(`CREDENTIAL_SPEND_GRANT_LIMIT_EXCEEDED:${grant.grantId}`);
      }
    }
    const policyViews: RunAdmissionPreview["applicablePolicies"] = [];
    const requiredReservations: RunAdmissionPreview["requiredReservations"] = [];
    if (ceiling !== null && targetCurrency) {
      for (const candidate of applicablePolicies) {
        const period = budgetPeriodWindow(candidate.policy.period, candidate.policy.timezone, input.at);
        const committed = await this.repository.getCommittedAmount({
          workspaceId: input.workspaceId,
          policyRevisionId: candidate.revision.id,
          periodStartsAt: period.startsAt,
          periodEndsAt: period.endsAt,
        });
        const available = subtractDecimals(candidate.revision.hardLimit, committed);
        policyViews.push({ ...candidate, period });
        requiredReservations.push({
          scope: candidate.policy.scope,
          policyId: candidate.policy.id,
          policyRevisionId: candidate.revision.id,
          principalId: candidate.policy.principalId,
          period,
          amount: ceiling,
          currency: targetCurrency,
          committedBefore: committed,
          availableBefore: available,
          stepAllocations: input.stepExposures.map((step) => ({
            stepId: step.stepId,
            amountPerAttempt: admittedAmountPerAttempt.get(step.stepId)!,
            automaticAttempts: step.automaticAttempts,
          })),
        });
        if (compareDecimals(ceiling, available) > 0) denialReasons.push(`BUDGET_LIMIT_EXCEEDED:${candidate.policy.scope}`);
        if (compareDecimals(addDecimals(committed, ceiling), candidate.revision.warningThreshold) >= 0) {
          warnings.push(`BUDGET_WARNING_THRESHOLD:${candidate.policy.scope}`);
        }
      }
    } else {
      for (const candidate of applicablePolicies) {
        policyViews.push({
          ...candidate,
          period: budgetPeriodWindow(candidate.policy.period, candidate.policy.timezone, input.at),
        });
      }
    }
    return {
      schema: "run-admission-preview/v1",
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      workflowId: input.workflowId,
      workflowRevisionId: input.workflowRevisionId,
      evaluatedAt: input.at,
      ceiling: {
        amount: ceiling,
        currency: ceiling === null ? null : targetCurrency,
        certainty: unknownAttempts > 0 ? "unknown" : "conservative",
        fxSnapshotIds: [...new Set(fxSnapshotIds)].sort(),
      },
      applicableCredentialSpendGrants: grants,
      applicablePolicies: policyViews,
      requiredReservations,
      stepExposures: input.stepExposures,
      warnings: [...new Set(warnings)].sort(),
      admissible: denialReasons.length === 0,
      denialReasons: [...new Set(denialReasons)].sort(),
    };
  }

  async planAdmission(input: BudgetAdmissionInput & { runId: string }): Promise<BudgetAdmissionPlan> {
    const preview = await this.previewRun(input);
    if (!preview.admissible || preview.ceiling.amount === null) {
      throw new BudgetServiceError("BUDGET_NOT_ADMISSIBLE", `Run admission denied: ${preview.denialReasons.join(", ") || "unknown ceiling"}.`);
    }
    const pricingSnapshotIds = [...new Set(preview.stepExposures.flatMap((step) => step.pricingSnapshotIds))].sort();
    const reservations = preview.requiredReservations.map((required) => ({
      schema: "budget-reservation/v1" as const,
      id: stableId("budget_reservation", { runId: input.runId, policyRevisionId: required.policyRevisionId }),
      workspaceId: preview.workspaceId,
      admittedPrincipalId: preview.principalId,
      principalId: required.principalId,
      runId: cleanId(input.runId, "Run ID"),
      policyId: required.policyId,
      policyRevisionId: required.policyRevisionId,
      scope: required.scope,
      period: required.period,
      currency: required.currency,
      reservedAmount: required.amount,
      settledAmount: "0",
      releasedAmount: "0",
      heldAmount: required.amount,
      state: "held" as const,
      pricingSnapshotIds,
      createdAt: input.at,
      updatedAt: input.at,
    }));
    const reservationAllocations = preview.requiredReservations.flatMap(
      (reservation) => reservation.stepAllocations.map((allocation) => ({
        policyRevisionId: reservation.policyRevisionId,
        stepId: allocation.stepId,
        amountPerAttempt: allocation.amountPerAttempt,
        currency: reservation.currency,
      })),
    );
    return {
      schema: "budget-admission-plan/v1",
      workspaceId: preview.workspaceId,
      principalId: preview.principalId,
      runId: input.runId,
      requestDigest: canonicalDigest({
        workspaceId: preview.workspaceId,
        principalId: preview.principalId,
        runId: input.runId,
        workflowRevisionId: preview.workflowRevisionId,
        reservations,
        grantIds: preview.applicableCredentialSpendGrants.map((grant) => grant.grantId).sort(),
        fxSnapshotIds: preview.ceiling.fxSnapshotIds,
        stepExposures: preview.stepExposures,
        reservationAllocations,
      }),
      reservations,
      grantIds: preview.applicableCredentialSpendGrants.map((grant) => grant.grantId).sort(),
      fxSnapshotIds: preview.ceiling.fxSnapshotIds,
      stepExposures: preview.stepExposures,
      reservationAllocations,
      createdAt: input.at,
    };
  }

  async commitAdmission(plan: BudgetAdmissionPlan): Promise<void> {
    const result = await this.repository.commitAdmission(plan);
    if (result === "conflict") throw new BudgetServiceError("BUDGET_CONFLICT", "Budget admission conflicts with an existing reservation.");
    if (result === "unavailable") throw new BudgetServiceError("BUDGET_NOT_ADMISSIBLE", "Budget capacity changed before Run acceptance.");
  }

  async planSettlement(input: BudgetSettlementPlan): Promise<BudgetSettlementPlan> {
    const plan = structuredClone(input);
    if (plan.amount === null || plan.currency === null) return plan;
    const reservations = await this.repository.listReservations({
      workspaceId: plan.workspaceId,
      runId: plan.runId,
    });
    const currencies = [...new Set(reservations.map((item) => item.currency))];
    if (currencies.length !== 1) {
      throw new BudgetServiceError("BUDGET_UNAVAILABLE", "Run reservations do not share one settlement currency.");
    }
    const targetCurrency = currencies[0];
    if (!targetCurrency || targetCurrency === plan.currency) return plan;
    const rate = await this.fx.getRate({
      workspaceId: plan.workspaceId,
      baseCurrency: plan.currency,
      quoteCurrency: targetCurrency,
      at: plan.recordedAt,
    });
    if (!rate) {
      return { ...plan, amount: null, currency: null, fxSnapshotId: null };
    }
    return {
      ...plan,
      amount: multiplyDecimals(plan.amount, canonicalDecimal(rate.rate)),
      currency: targetCurrency,
      fxSnapshotId: rate.snapshotId,
    };
  }

  async commitSettlement(plan: BudgetSettlementPlan): Promise<void> {
    const result = await this.repository.commitSettlement(plan);
    if (result === "conflict") throw new BudgetServiceError("BUDGET_CONFLICT", "Budget settlement conflicts with prior evidence.");
    if (result === "unavailable") throw new BudgetServiceError("BUDGET_UNAVAILABLE", "Budget settlement is unavailable.");
  }
}
