import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { addDecimals, canonicalDecimal } from "../usage/decimal";
import { assertIanaTimezone } from "../budgets/period";
import { quotaWindow } from "./window";
import type {
  CreateQuotaPolicyRevisionInput,
  EffectiveQuotaCapacity,
  QuotaClaim,
  QuotaClaimCommitResult,
  QuotaClaimInput,
  QuotaClaimPlan,
  QuotaClaimPreview,
  QuotaExhaustionEvidence,
  QuotaPolicy,
  QuotaPolicyRevision,
  QuotaRepository,
  QuotaResumeActor,
  QuotaReservation,
  QuotaReservationRequirement,
  QuotaTransitionInput,
  QuotaTransitionCommitResult,
  QuotaTransitionPlan,
  QuotaUsageReconciliationInput,
  QuotaUsageReconciliationPlan,
} from "./types";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/;
const DIMENSION = /^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$/;

export class QuotaServiceError extends Error {
  constructor(
    readonly code:
      | "QUOTA_INVALID_INPUT"
      | "QUOTA_POLICY_UNAVAILABLE"
      | "QUOTA_CONFLICT"
      | "QUOTA_PERSISTENCE_UNAVAILABLE"
      | "QUOTA_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "QuotaServiceError";
  }
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${canonicalDigest(value).slice(7, 39)}`;
}

function cleanId(value: string, label: string): string {
  const normalized = value.trim();
  if (!ID.test(normalized)) throw new QuotaServiceError("QUOTA_INVALID_INPUT", `${label} is invalid.`);
  return normalized;
}

function amount(value: string, label = "Quota amount"): string {
  try {
    return canonicalDecimal(value);
  } catch {
    throw new QuotaServiceError("QUOTA_INVALID_INPUT", `${label} is invalid.`);
  }
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

function identity(policy: Pick<QuotaPolicy,
  "kind" | "boundary" | "dimension" | "unit" | "window" | "timezone" | "reservationRule"
>): string {
  return [policy.kind, policy.boundary, policy.dimension, policy.unit, policy.window, policy.timezone, policy.reservationRule]
    .join("\u0000");
}

function coherentPolicy(input: Pick<CreateQuotaPolicyRevisionInput,
  "kind" | "boundary" | "window" | "reservationRule" | "unit"
>): boolean {
  if (input.kind === "admission") {
    return input.boundary === "run_admission" && input.window !== "concurrent" && input.reservationRule === "consume";
  }
  if (input.kind === "concurrency") {
    return input.boundary === "run_concurrency" && input.window === "concurrent" &&
      input.reservationRule === "release_on_terminal" && input.unit === "count";
  }
  if (input.kind === "rate") {
    return input.boundary === "provider_effect" &&
      !["concurrent", "lifetime"].includes(input.window) && input.reservationRule === "consume";
  }
  if (input.kind === "storage") {
    return input.boundary === "artifact_storage" && ["concurrent", "lifetime"].includes(input.window) &&
      input.reservationRule === "release_on_transition" && input.unit === "byte";
  }
  return input.boundary === "usage_settlement" && input.window !== "concurrent" && input.reservationRule === "consume";
}

function claimKey(claim: Pick<QuotaClaim, "dimension" | "unit">): string {
  return `${claim.dimension}\u0000${claim.unit}`;
}

function evidence(
  requirement: QuotaReservationRequirement,
  evaluatedAt: Date,
): QuotaExhaustionEvidence {
  const eligibleAt = requirement.window.endsAt;
  const eligibility = eligibleAt
    ? { kind: "window_renewal" as const, eligibleAt }
    : { kind: "capacity_release" as const, requiredAvailable: requirement.amount };
  const value = {
    policyRevisionId: requirement.policyRevisionId,
    windowStartsAt: requirement.window.startsAt.toISOString(),
    committed: requirement.committedBefore,
    requested: requirement.amount,
    evaluatedAt: evaluatedAt.toISOString(),
  };
  return {
    schema: "quota-exhaustion-evidence/v1",
    policyId: requirement.policyId,
    policyRevisionId: requirement.policyRevisionId,
    scope: requirement.scope,
    dimension: requirement.dimension,
    unit: requirement.unit,
    window: structuredClone(requirement.window),
    hardLimit: requirement.hardLimit,
    committed: requirement.committedBefore,
    requested: requirement.amount,
    available: requirement.availableBefore,
    blockingReservationIds: [...requirement.blockingReservationIds],
    evaluatedAt,
    eligibleAt,
    eligibility,
    evidenceRef: `quota-evidence:${canonicalDigest(value).slice(7)}`,
    evidenceVersion: 1,
  };
}

function validateClaim(claim: QuotaClaim): QuotaClaim {
  if (!DIMENSION.test(claim.dimension)) {
    throw new QuotaServiceError("QUOTA_INVALID_INPUT", "Quota Usage Dimension is invalid.");
  }
  const normalized = amount(claim.amount);
  if (compare(normalized, "0") <= 0) {
    throw new QuotaServiceError("QUOTA_INVALID_INPUT", "Quota claim must be positive.");
  }
  return { ...claim, amount: normalized };
}

export class QuotaService {
  constructor(private readonly repository: QuotaRepository) {}

  async createPolicyRevision(input: CreateQuotaPolicyRevisionInput): Promise<{
    policy: QuotaPolicy;
    revision: QuotaPolicyRevision;
  }> {
    const workspaceId = cleanId(input.workspaceId, "Workspace ID");
    const principalId = input.principalId ? cleanId(input.principalId, "Principal ID") : null;
    const dimension = input.dimension.trim();
    if (!DIMENSION.test(dimension)) throw new QuotaServiceError("QUOTA_INVALID_INPUT", "Quota Usage Dimension is invalid.");
    const timezone = assertIanaTimezone(input.timezone);
    const warningThreshold = amount(input.warningThreshold, "Quota warning threshold");
    const hardLimit = amount(input.hardLimit, "Quota hard limit");
    if (compare(hardLimit, "0") <= 0 || compare(warningThreshold, hardLimit) > 0) {
      throw new QuotaServiceError("QUOTA_INVALID_INPUT", "Quota thresholds are invalid.");
    }
    if (!coherentPolicy(input)) {
      throw new QuotaServiceError("QUOTA_INVALID_INPUT", "Quota kind, boundary, window, unit, and reservation rule are incoherent.");
    }
    const renewableWaitKind = input.kind === "concurrency" || input.kind === "rate";
    if (renewableWaitKind && input.exhaustionBehavior !== "wait") {
      throw new QuotaServiceError("QUOTA_INVALID_INPUT", "Renewable Concurrency and Rate quota exhaustion must enter Quota Wait.");
    }
    if (!renewableWaitKind && input.exhaustionBehavior !== "deny") {
      throw new QuotaServiceError("QUOTA_INVALID_INPUT", "Only renewable Concurrency and Rate quota exhaustion may enter Quota Wait.");
    }
    const idempotencyKey = cleanId(input.idempotencyKey, "Idempotency key");
    const { recordedAt: _recordedAt, ...request } = input;
    const requestDigest = canonicalDigest(request);
    const priorReceipt = await this.repository.getAdminReceipt({ workspaceId, idempotencyKey });
    if (priorReceipt) {
      if (priorReceipt.requestDigest !== requestDigest) throw new QuotaServiceError("QUOTA_CONFLICT", "Quota policy idempotency conflict.");
      const persisted = await this.repository.getPolicyRevision({ workspaceId, revisionId: priorReceipt.resourceId });
      if (!persisted) throw new QuotaServiceError("QUOTA_UNAVAILABLE", "Persisted Quota policy revision is unavailable.");
      return persisted;
    }
    const all = await this.repository.listPolicies(workspaceId);
    const requestedIdentity = identity({ ...input, dimension, timezone });
    const sameScope = all.find(({ policy }) =>
      policy.principalId === principalId && identity(policy) === requestedIdentity && policy.status === "active");
    const workspaceParent = all.find(({ policy }) =>
      policy.principalId === null && identity(policy) === requestedIdentity && policy.status === "active");
    if (principalId) {
      if (!workspaceParent) throw new QuotaServiceError("QUOTA_INVALID_INPUT", "An Agent quota requires a matching Workspace quota.");
      const narrows =
        compare(hardLimit, workspaceParent.revision.hardLimit) <= 0 &&
        compare(warningThreshold, workspaceParent.revision.warningThreshold) <= 0 &&
        !(workspaceParent.revision.exhaustionBehavior === "deny" && input.exhaustionBehavior === "wait");
      if (!narrows) throw new QuotaServiceError("QUOTA_INVALID_INPUT", "An Agent quota may only narrow its Workspace quota.");
    } else {
      const children = all.filter(({ policy }) =>
        policy.principalId !== null && identity(policy) === requestedIdentity && policy.status === "active");
      const containsChildren = children.every(({ revision }) =>
        compare(revision.hardLimit, hardLimit) <= 0 &&
        compare(revision.warningThreshold, warningThreshold) <= 0 &&
        !(input.exhaustionBehavior === "deny" && revision.exhaustionBehavior === "wait"));
      if (!containsChildren) {
        throw new QuotaServiceError(
          "QUOTA_INVALID_INPUT",
          "A Workspace quota revision must continue to contain every matching Agent quota.",
        );
      }
    }
    const policyId = sameScope?.policy.id ?? stableId("quota_policy", {
      workspaceId,
      principalId,
      identity: requestedIdentity,
    });
    const revisionNumber = (sameScope?.revision.revision ?? 0) + 1;
    const revisionId = stableId("quota_revision", { policyId, revision: revisionNumber, requestDigest });
    const policy: QuotaPolicy = {
      schema: "quota-policy/v1",
      id: policyId,
      workspaceId,
      principalId,
      scope: principalId ? "principal" : "workspace",
      kind: input.kind,
      boundary: input.boundary,
      dimension,
      unit: input.unit,
      window: input.window,
      timezone,
      reservationRule: input.reservationRule,
      status: "active",
      currentRevisionId: revisionId,
      createdAt: sameScope?.policy.createdAt ?? input.recordedAt,
      updatedAt: input.recordedAt,
    };
    const revision: QuotaPolicyRevision = {
      schema: "quota-policy-revision/v1",
      id: revisionId,
      policyId,
      workspaceId,
      principalId,
      revision: revisionNumber,
      warningThreshold,
      hardLimit,
      exhaustionBehavior: input.exhaustionBehavior,
      createdByUserId: cleanId(input.actorUserId, "Actor user ID"),
      createdAt: input.recordedAt,
    };
    const result = await this.repository.appendPolicyRevision({ policy, revision, requestDigest, idempotencyKey });
    if (result === "conflict") throw new QuotaServiceError("QUOTA_CONFLICT", "Quota policy revision conflicts with current state.");
    if (result === "unavailable") {
      throw new QuotaServiceError(
        "QUOTA_PERSISTENCE_UNAVAILABLE",
        "Quota policy persistence is temporarily unavailable.",
      );
    }
    if (result === "replayed") {
      const persisted = await this.repository.getPolicyRevision({
        workspaceId,
        revisionId,
      });
      if (!persisted) {
        throw new QuotaServiceError(
          "QUOTA_PERSISTENCE_UNAVAILABLE",
          "Replayed Quota policy revision is temporarily unavailable.",
        );
      }
      return persisted;
    }
    return { policy, revision };
  }

  async getEffectiveCapacity(input: {
    workspaceId: string;
    principalId: string;
    at: Date;
    boundary?: QuotaPolicy["boundary"];
    dimension?: string;
  }): Promise<EffectiveQuotaCapacity[]> {
    const policies = await this.repository.listPolicies(cleanId(input.workspaceId, "Workspace ID"));
    const applicable = policies.filter(({ policy }) =>
      policy.status === "active" &&
      (policy.principalId === null || policy.principalId === input.principalId) &&
      (!input.boundary || policy.boundary === input.boundary) &&
      (!input.dimension || policy.dimension === input.dimension));
    return Promise.all(applicable.map(async ({ policy, revision }) => {
      const window = quotaWindow(policy.window, policy.timezone, input.at);
      const projection = await this.repository.getCapacityProjection({
        workspaceId: policy.workspaceId,
        policyRevisionId: revision.id,
        window,
      });
      return {
        schema: "effective-quota-capacity/v1" as const,
        policy,
        revision,
        window,
        committed: projection.committed,
        available: subtract(revision.hardLimit, projection.committed),
        blockingReservationIds: projection.reservationIds,
        warning: compare(projection.committed, revision.warningThreshold) >= 0,
        exhausted: compare(projection.committed, revision.hardLimit) >= 0,
        evaluatedAt: input.at,
      };
    }));
  }

  async previewClaim(input: QuotaClaimInput): Promise<QuotaClaimPreview> {
    const normalized = this.normalizeClaimInput(input);
    const policies = await this.repository.listPolicies(normalized.workspaceId);
    const applicablePolicies: QuotaClaimPreview["applicablePolicies"] = [];
    const requiredReservations: QuotaReservationRequirement[] = [];
    const denialReasons: QuotaClaimPreview["denialReasons"] = [];
    const warnings: string[] = [];
    const suspended = normalized.boundary === "provider_effect" &&
      await this.repository.isSpendSuspended(normalized.workspaceId);
    if (suspended) denialReasons.push("EMERGENCY_SPEND_SUSPENDED");
    for (const claim of normalized.claims) {
      const matching = policies.filter(({ policy }) =>
        policy.status === "active" && policy.boundary === normalized.boundary &&
        policy.dimension === claim.dimension && policy.unit === claim.unit &&
        (policy.principalId === null || policy.principalId === normalized.principalId));
      if (!matching.some(({ policy }) => policy.scope === "workspace")) {
        denialReasons.push("QUOTA_POLICY_UNAVAILABLE");
        continue;
      }
      for (const candidate of matching) {
        applicablePolicies.push(candidate);
        const window = quotaWindow(candidate.policy.window, candidate.policy.timezone, normalized.recordedAt);
        const projection = await this.repository.getCapacityProjection({
          workspaceId: normalized.workspaceId,
          policyRevisionId: candidate.revision.id,
          window,
        });
        const available = subtract(candidate.revision.hardLimit, projection.committed);
        requiredReservations.push({
          scope: candidate.policy.scope,
          policyId: candidate.policy.id,
          policyRevisionId: candidate.revision.id,
          principalId: candidate.policy.principalId,
          kind: candidate.policy.kind,
          boundary: candidate.policy.boundary,
          dimension: candidate.policy.dimension,
          unit: candidate.policy.unit,
          window,
          reservationRule: candidate.policy.reservationRule,
          exhaustionBehavior: candidate.revision.exhaustionBehavior,
          amount: claim.amount,
          hardLimit: candidate.revision.hardLimit,
          committedBefore: projection.committed,
          availableBefore: available,
          blockingReservationIds: projection.reservationIds,
        });
        if (compare(addDecimals(projection.committed, claim.amount), candidate.revision.warningThreshold) >= 0) {
          warnings.push(`QUOTA_WARNING_THRESHOLD:${candidate.policy.id}`);
        }
      }
    }
    const exhaustionEvidence = requiredReservations
      .filter((requirement) => compare(requirement.amount, requirement.availableBefore) > 0)
      .map((requirement) => evidence(requirement, normalized.recordedAt));
    if (exhaustionEvidence.length) denialReasons.push("QUOTA_CAPACITY_EXHAUSTED");
    const exhaustedRequirements = requiredReservations.filter((requirement) =>
      compare(requirement.amount, requirement.availableBefore) > 0);
    const decision = denialReasons.some((reason) => reason !== "QUOTA_CAPACITY_EXHAUSTED") ||
      exhaustedRequirements.some((requirement) => requirement.exhaustionBehavior === "deny")
      ? "deny"
      : exhaustedRequirements.length
        ? "wait"
        : "admit";
    return {
      schema: "quota-claim-preview/v1",
      workspaceId: normalized.workspaceId,
      principalId: normalized.principalId,
      runId: normalized.runId,
      transitionKey: normalized.transitionKey,
      boundary: normalized.boundary,
      subject: normalized.subject,
      claims: normalized.claims,
      applicablePolicies,
      requiredReservations,
      decision,
      exhaustionEvidence,
      denialReasons: [...new Set(denialReasons)],
      warnings: [...new Set(warnings)].sort(),
      evaluatedAt: normalized.recordedAt,
    };
  }

  async planClaim(input: QuotaClaimInput): Promise<QuotaClaimPlan> {
    const preview = await this.previewClaim(input);
    const reservations: QuotaReservation[] = preview.requiredReservations.map((required) => ({
      schema: "quota-reservation/v1",
      id: stableId("quota_reservation", {
        workspaceId: preview.workspaceId,
        transitionKey: preview.transitionKey,
        policyRevisionId: required.policyRevisionId,
      }),
      workspaceId: preview.workspaceId,
      admittedPrincipalId: preview.principalId,
      principalId: required.principalId,
      runId: preview.runId,
      transitionKey: preview.transitionKey,
      boundary: preview.boundary,
      subject: preview.subject,
      policyId: required.policyId,
      policyRevisionId: required.policyRevisionId,
      scope: required.scope,
      kind: required.kind,
      dimension: required.dimension,
      unit: required.unit,
      window: required.window,
      reservationRule: required.reservationRule,
      reservedAmount: required.amount,
      heldAmount: required.amount,
      settledAmount: "0",
      releasedAmount: "0",
      overageAmount: "0",
      state: "held",
      createdAt: preview.evaluatedAt,
      updatedAt: preview.evaluatedAt,
    }));
    const waitId = stableId("quota_wait", {
      workspaceId: preview.workspaceId,
      runId: preview.runId,
      transitionKey: preview.transitionKey,
    });
    const base = {
      workspaceId: preview.workspaceId,
      principalId: preview.principalId,
      runId: preview.runId,
      transitionKey: preview.transitionKey,
      boundary: preview.boundary,
      subject: preview.subject,
      claims: preview.claims,
      policyRevisionIds: reservations.map((item) => item.policyRevisionId).sort(),
      reservations,
      waitId,
      resumesWaitId: null,
      resumeReason: null,
      resumeActor: null,
      resumeIdempotencyKey: null,
      createdAt: preview.evaluatedAt,
    };
    return {
      schema: "quota-claim-plan/v1",
      ...base,
      requestDigest: canonicalDigest({ ...base, createdAt: base.createdAt.toISOString() }),
    };
  }

  async commitClaim(plan: QuotaClaimPlan): Promise<QuotaClaimCommitResult> {
    return this.repository.commitClaim(plan);
  }

  async planResumeWait(input: {
    workspaceId: string;
    waitId: string;
    actor: QuotaResumeActor;
    resumeReason: string;
    idempotencyKey: string;
    recordedAt: Date;
  }): Promise<QuotaClaimPlan> {
    const wait = await this.repository.getWait({ workspaceId: input.workspaceId, waitId: input.waitId });
    if (!wait || wait.state !== "waiting") throw new QuotaServiceError("QUOTA_UNAVAILABLE", "Quota Wait is not resumable.");
    const plan = await this.planClaim({
      workspaceId: wait.workspaceId,
      principalId: wait.admittedPrincipalId,
      runId: wait.runId,
      transitionKey: wait.transitionKey,
      boundary: wait.boundary,
      subject: wait.subject,
      claims: wait.claims,
      recordedAt: input.recordedAt,
    });
    const resumeActor: QuotaResumeActor = input.actor.kind === "human"
      ? { kind: "human", userId: cleanId(input.actor.userId, "Resume actor User ID") }
      : input.actor.kind === "principal"
        ? { kind: "principal", principalId: cleanId(input.actor.principalId, "Resume actor Principal ID") }
        : { kind: "system" };
    const resumed = {
      ...plan,
      resumesWaitId: wait.id,
      resumeReason: cleanId(input.resumeReason, "Resume reason"),
      resumeActor,
      resumeIdempotencyKey: cleanId(input.idempotencyKey, "Idempotency key"),
    };
    return {
      ...resumed,
      requestDigest: canonicalDigest({ ...resumed, createdAt: resumed.createdAt.toISOString() }),
    };
  }

  async planTransition(input: QuotaTransitionInput): Promise<QuotaTransitionPlan> {
    const normalizedAmount = input.amount === null ? null : amount(input.amount);
    if (input.subject.kind === "usage_settlement") {
      throw new QuotaServiceError(
        "QUOTA_INVALID_INPUT",
        "Usage Settlement reservations require typed usage reconciliation.",
      );
    }
    if (input.outcome === "release" && normalizedAmount !== null) {
      throw new QuotaServiceError("QUOTA_INVALID_INPUT", "Quota releases are canonical full releases and cannot be partial.");
    }
    const reservations = await this.repository.getReservations({
      workspaceId: cleanId(input.workspaceId, "Workspace ID"),
      subject: { kind: input.subject.kind, id: cleanId(input.subject.id, "Quota subject ID") },
    });
    const base = {
      workspaceId: input.workspaceId,
      transitionId: cleanId(input.transitionId, "Transition ID"),
      subject: input.subject,
      outcome: input.outcome,
      amount: normalizedAmount,
      evidenceRef: cleanId(input.evidenceRef, "Evidence reference"),
      reservationIds: reservations.filter((item) =>
        input.outcome === "release"
          ? item.reservationRule !== "consume" && item.state !== "released"
          : item.reservationRule !== "release_on_terminal" && item.state === "held")
        .map((item) => item.id).sort(),
      recordedAt: input.recordedAt,
    };
    return {
      schema: "quota-transition-plan/v1",
      ...base,
      requestDigest: canonicalDigest({ ...base, recordedAt: base.recordedAt.toISOString() }),
    };
  }

  async commitTransition(plan: QuotaTransitionPlan): Promise<QuotaTransitionCommitResult> {
    const result = await this.repository.commitTransition(plan);
    if (result.kind === "conflict") throw new QuotaServiceError("QUOTA_CONFLICT", "Quota transition conflicts with prior evidence.");
    if (result.kind === "unavailable") throw new QuotaServiceError("QUOTA_UNAVAILABLE", "Quota transition is unavailable.");
    return result;
  }

  async planUsageReconciliation(
    input: QuotaUsageReconciliationInput,
  ): Promise<QuotaUsageReconciliationPlan> {
    const workspaceId = cleanId(input.workspaceId, "Workspace ID");
    const reconciliationId = cleanId(input.reconciliationId, "Usage reconciliation ID");
    const subject = {
      kind: "usage_settlement" as const,
      id: cleanId(input.subject.id, "Usage Settlement subject ID"),
    };
    if (!DIMENSION.test(input.dimension)) {
      throw new QuotaServiceError("QUOTA_INVALID_INPUT", "Quota Usage Dimension is invalid.");
    }
    const actualAmount = input.actualAmount === null
      ? null
      : amount(input.actualAmount, "Actual usage amount");
    const reservations = await this.repository.getReservations({ workspaceId, subject });
    const ownership = reservations[0];
    if (!reservations.length || reservations.some((reservation) =>
      reservation.boundary !== "usage_settlement" ||
      reservation.kind !== "usage" ||
      reservation.dimension !== input.dimension ||
      reservation.unit !== input.unit ||
      reservation.reservationRule !== "consume" ||
      reservation.runId === null ||
      reservation.runId !== ownership?.runId ||
      reservation.admittedPrincipalId !== ownership?.admittedPrincipalId ||
      reservation.transitionKey !== ownership?.transitionKey)) {
      throw new QuotaServiceError(
        "QUOTA_UNAVAILABLE",
        "The exact Usage Settlement quota reservations are unavailable.",
      );
    }
    const base = {
      workspaceId,
      reconciliationId,
      subject,
      dimension: input.dimension,
      unit: input.unit,
      actualAmount,
      evidenceRef: cleanId(input.evidenceRef, "Usage evidence reference"),
      reservationIds: reservations.map((reservation) => reservation.id).sort(),
      recordedAt: input.recordedAt,
    };
    return {
      schema: "quota-usage-reconciliation-plan/v1",
      ...base,
      requestDigest: canonicalDigest({ ...base, recordedAt: base.recordedAt.toISOString() }),
    };
  }

  commitUsageReconciliation(plan: QuotaUsageReconciliationPlan) {
    return this.repository.commitUsageReconciliation(plan);
  }

  listPolicies(workspaceId: string) {
    return this.repository.listPolicies(cleanId(workspaceId, "Workspace ID"));
  }

  listReservations(input: {
    workspaceId: string;
    runId?: string | null;
    subject?: QuotaReservation["subject"];
    admittedPrincipalId?: string;
    limit?: number;
  }) {
    return this.repository.getReservations(input);
  }

  getWait(input: { workspaceId: string; waitId: string }) {
    return this.repository.getWait(input);
  }

  listWaits(input: Parameters<QuotaRepository["listWaits"]>[0]) {
    return this.repository.listWaits(input);
  }

  listEligibleWaits(input: Parameters<QuotaRepository["listEligibleWaits"]>[0]) {
    return this.repository.listEligibleWaits(input);
  }

  private normalizeClaimInput(input: QuotaClaimInput): QuotaClaimInput {
    const claims = input.claims.map(validateClaim);
    if (!claims.length || new Set(claims.map(claimKey)).size !== claims.length) {
      throw new QuotaServiceError("QUOTA_INVALID_INPUT", "Quota claims must be non-empty and unique by dimension and unit.");
    }
    if (
      (input.boundary === "usage_settlement") !== (input.subject.kind === "usage_settlement") ||
      (input.boundary === "usage_settlement" && claims.length !== 1)
    ) {
      throw new QuotaServiceError(
        "QUOTA_INVALID_INPUT",
        "A Usage Settlement quota claim requires one exact Usage Dimension.",
      );
    }
    const runId = input.runId === null ? null : cleanId(input.runId, "Run ID");
    if (input.subject.kind !== "artifact" && runId === null) {
      throw new QuotaServiceError(
        "QUOTA_INVALID_INPUT",
        "Run, Step Attempt, and Usage Settlement quota subjects require Run ownership.",
      );
    }
    return {
      ...structuredClone(input),
      workspaceId: cleanId(input.workspaceId, "Workspace ID"),
      principalId: cleanId(input.principalId, "Principal ID"),
      runId,
      transitionKey: cleanId(input.transitionKey, "Transition key"),
      subject: { ...input.subject, id: cleanId(input.subject.id, "Quota subject ID") },
      claims,
    };
  }
}
