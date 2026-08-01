import { describe, expect, it } from "vitest";
import { credentialEffectRef } from "@/lib/credential-vault/effect-ref";
import { budgetPeriodWindow } from "../period";
import { InMemoryBudgetRepository } from "../memory";
import { BudgetService } from "../service";
import type { BudgetAdmissionInput, RunStepExposure } from "../types";

const now = new Date("2026-03-08T06:30:00.000Z");

const knownStep: RunStepExposure = {
  stepId: "generate_copy",
  provider: "gemini",
  providerOperation: "generativelanguage.v1beta.models.generateContent",
  model: "gemini-2.5-flash",
  serviceTier: "default",
  automaticAttempts: 2,
  credentialSlotId: "slot_1",
  credentialProfileId: "profile_1",
  amountPerAttempt: "1.25",
  currency: "USD",
  pricingSnapshotIds: ["pricing_1"],
  pricingSource: "builtin_catalog",
};

function proposal(overrides: Partial<BudgetAdmissionInput> = {}): BudgetAdmissionInput {
  return {
    workspaceId: "workspace_1",
    principalId: "principal_1",
    workflowId: "workflow_1",
    workflowRevisionId: "revision_1",
    stepExposures: [knownStep],
    at: now,
    ...overrides,
  };
}

async function configured(options: {
  hardLimit?: string;
  unknown?: "deny" | "fixed_allowance";
  allowance?: string | null;
  grantLimit?: string;
  grantCommitted?: string;
  grantAvailable?: string;
} = {}) {
  const repository = new InMemoryBudgetRepository();
  repository.seedGrant({
    workspaceId: "workspace_1",
    principalId: "principal_1",
    grantId: "grant_1",
    credentialSlotId: "slot_1",
    credentialProfileId: "profile_1",
    mode: "bounded",
    limit: options.grantLimit ?? "10000",
    committed: options.grantCommitted ?? "0",
    available: options.grantAvailable ?? "10000",
  });
  const service = new BudgetService(repository);
  await service.createPolicyRevision({
    workspaceId: "workspace_1",
    principalId: null,
    currency: "USD",
    period: "calendar_day",
    timezone: "America/New_York",
    warningThreshold: options.hardLimit === "3" ? "2.5" : "8",
    hardLimit: options.hardLimit ?? "10",
    unknownPriceTreatment: options.unknown ?? "deny",
    unknownPriceAllowance: options.allowance ?? null,
    actorUserId: "user_1",
    idempotencyKey: "workspace_policy_1",
    recordedAt: now,
  });
  return { repository, service };
}

function attemptAllocation(input: {
  id: string;
  runId: string;
  stepAttemptId: string;
  stepId: string;
  effectKey: string;
}) {
  return {
    schema: "budget-attempt-allocation-input/v1" as const,
    workspaceId: "workspace_1",
    principalId: "principal_1",
    attempt: 1,
    credentialEffectRef: credentialEffectRef({
      workspaceId: "workspace_1",
      effectKey: input.effectKey,
      stepAttemptId: input.stepAttemptId,
      attempt: 1,
    }),
    provider: knownStep.provider,
    providerOperation: knownStep.providerOperation,
    model: knownStep.model,
    recordedAt: new Date(now.getTime() + 1_000),
    ...input,
  };
}

describe("budget calendar periods", () => {
  it("uses independent zoned boundaries across DST transitions", () => {
    const spring = budgetPeriodWindow(
      "calendar_day",
      "America/New_York",
      new Date("2026-03-08T12:00:00.000Z"),
    );
    expect(spring.startsAt.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(spring.endsAt?.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(spring.endsAt!.getTime() - spring.startsAt.getTime()).toBe(23 * 60 * 60 * 1000);

    const autumn = budgetPeriodWindow(
      "calendar_day",
      "America/New_York",
      new Date("2026-11-01T12:00:00.000Z"),
    );
    expect(autumn.startsAt.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(autumn.endsAt?.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(autumn.endsAt!.getTime() - autumn.startsAt.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it("rejects malformed IANA timezones", () => {
    expect(() => budgetPeriodWindow("calendar_day", "Mars/Olympus", now)).toThrow(/IANA/);
  });
});

describe("BudgetService", () => {
  it("returns persisted resources on idempotent administration retries", async () => {
    const { service } = await configured();
    const request = {
      workspaceId: "workspace_1",
      principalId: null,
      currency: "USD",
      period: "calendar_day" as const,
      timezone: "America/New_York",
      warningThreshold: "7",
      hardLimit: "9",
      unknownPriceTreatment: "deny" as const,
      unknownPriceAllowance: null,
      actorUserId: "user_1",
      idempotencyKey: "workspace_policy_revision_2",
    };
    const created = await service.createPolicyRevision({ ...request, recordedAt: now });
    const replayed = await service.createPolicyRevision({
      ...request,
      recordedAt: new Date(now.getTime() + 60_000),
    });
    expect(replayed).toEqual(created);
    expect(replayed.revision.revision).toBe(2);
  });

  it("previews without binding and atomically admits only one stale concurrent proposal", async () => {
    const { repository, service } = await configured({ hardLimit: "3" });
    const preview = await service.previewRun(proposal());
    expect(preview).toMatchObject({
      admissible: true,
      ceiling: { amount: "2.5", currency: "USD", certainty: "conservative" },
    });
    expect(repository.reservations.size).toBe(0);

    const [first, second] = await Promise.all([
      service.planAdmission({ ...proposal(), runId: "run_1" }),
      service.planAdmission({ ...proposal(), runId: "run_2" }),
    ]);
    const results = await Promise.all([
      repository.commitAdmission(first),
      repository.commitAdmission(second),
    ]);
    expect(results.sort()).toEqual(["created", "unavailable"]);
    expect(repository.reservations.size).toBe(1);
  });

  it("keeps bounded grant capacity consistent between preview and admission", async () => {
    const exhausted = await configured({
      grantLimit: "259",
      grantCommitted: "10",
      grantAvailable: "249",
    });
    const denied = await exhausted.service.previewRun(proposal());
    expect(denied).toMatchObject({
      admissible: false,
      denialReasons: ["CREDENTIAL_SPEND_GRANT_LIMIT_EXCEEDED:grant_1"],
    });
    await expect(exhausted.service.planAdmission({
      ...proposal(),
      runId: "run_exhausted_grant",
    })).rejects.toMatchObject({ code: "BUDGET_NOT_ADMISSIBLE" });

    const nearLimit = await configured({
      grantLimit: "260",
      grantCommitted: "10",
      grantAvailable: "250",
    });
    const admitted = await nearLimit.service.previewRun(proposal());
    expect(admitted.admissible).toBe(true);
    const plan = await nearLimit.service.planAdmission({
      ...proposal(),
      runId: "run_near_grant_limit",
    });
    await expect(nearLimit.repository.commitAdmission(plan)).resolves.toBe("created");
  });

  it("includes active admission envelopes in bounded-grant preview evidence", async () => {
    const { repository, service } = await configured({
      grantLimit: "499",
      grantAvailable: "499",
    });
    const first = await service.planAdmission({
      ...proposal(),
      runId: "run_active_grant_1",
    });
    const staleSecond = await service.planAdmission({
      ...proposal(),
      runId: "run_active_grant_2",
    });
    await expect(repository.commitAdmission(first)).resolves.toBe("created");

    const preview = await service.previewRun(proposal());
    expect(preview.applicableCredentialSpendGrants).toEqual([
      expect.objectContaining({
        grantId: "grant_1",
        limit: "499",
        committed: "250",
        available: "249",
      }),
    ]);
    expect(preview).toMatchObject({
      admissible: false,
      denialReasons: ["CREDENTIAL_SPEND_GRANT_LIMIT_EXCEEDED:grant_1"],
    });
    await expect(repository.commitAdmission(staleSecond)).resolves.toBe("unavailable");
  });

  it("requires an Agent policy to narrow the stable Workspace policy", async () => {
    const { service } = await configured();
    await expect(service.createPolicyRevision({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      currency: "USD",
      period: "calendar_day",
      timezone: "America/New_York",
      warningThreshold: "9",
      hardLimit: "11",
      unknownPriceTreatment: "deny",
      unknownPriceAllowance: null,
      actorUserId: "user_1",
      idempotencyKey: "principal_policy_broad",
      recordedAt: now,
    })).rejects.toMatchObject({ code: "BUDGET_INVALID_INPUT" });

    await expect(service.createPolicyRevision({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      currency: "USD",
      period: "calendar_day",
      timezone: "America/New_York",
      warningThreshold: "5",
      hardLimit: "6",
      unknownPriceTreatment: "deny",
      unknownPriceAllowance: null,
      actorUserId: "user_1",
      idempotencyKey: "principal_policy_narrow",
      recordedAt: now,
    })).resolves.toBeTruthy();
  });

  it("never treats unknown price or missing FX as zero", async () => {
    const denied = await configured();
    const unknown = await denied.service.previewRun(proposal({
      stepExposures: [{ ...knownStep, amountPerAttempt: null, currency: null }],
    }));
    expect(unknown).toMatchObject({
      admissible: false,
      ceiling: { amount: null, currency: null, certainty: "unknown" },
      denialReasons: expect.arrayContaining([
        "CREDENTIAL_SPEND_GRANT_EXPOSURE_UNKNOWN:grant_1",
        "UNKNOWN_PRICING_DENIED",
      ]),
    });

    const allowed = await configured({ unknown: "fixed_allowance", allowance: "4" });
    const fixed = await allowed.service.previewRun(proposal({
      stepExposures: [{ ...knownStep, amountPerAttempt: null, currency: null }],
    }));
    expect(fixed).toMatchObject({
      admissible: false,
      ceiling: { amount: "8", currency: "USD", certainty: "unknown" },
      warnings: expect.arrayContaining(["UNKNOWN_PRICING_FIXED_ALLOWANCE"]),
      denialReasons: ["CREDENTIAL_SPEND_GRANT_EXPOSURE_UNKNOWN:grant_1"],
    });

    const missingFx = await denied.service.previewRun(proposal({
      stepExposures: [{ ...knownStep, amountPerAttempt: "1", currency: "EUR" }],
    }));
    expect(missingFx.ceiling.amount).toBeNull();
    expect(missingFx.denialReasons).toContain("UNKNOWN_PRICING_DENIED");
    expect(missingFx.denialReasons).toContain(
      "CREDENTIAL_SPEND_GRANT_EXPOSURE_UNKNOWN:grant_1",
    );
  });

  it("uses active Workspace pricing overrides and pins FX evidence", async () => {
    const repository = new InMemoryBudgetRepository();
    repository.seedGrant({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      grantId: "grant_1",
      credentialSlotId: "slot_1",
      credentialProfileId: "profile_1",
      mode: "bounded",
      limit: "10000",
      committed: "0",
      available: "10000",
    });
    const service = new BudgetService(repository, {
      async getRate() {
        return { rate: "2", snapshotId: "fx_eur_usd_1" };
      },
    });
    await service.createPolicyRevision({
      workspaceId: "workspace_1",
      principalId: null,
      currency: "USD",
      period: "calendar_day",
      timezone: "UTC",
      warningThreshold: "90",
      hardLimit: "100",
      unknownPriceTreatment: "deny",
      unknownPriceAllowance: null,
      actorUserId: "user_1",
      idempotencyKey: "policy_1",
      recordedAt: now,
    });
    const override = await service.createPricingOverride({
      workspaceId: "workspace_1",
      provider: knownStep.provider,
      providerOperation: knownStep.providerOperation,
      model: knownStep.model,
      serviceTier: knownStep.serviceTier,
      dimension: "runtime.provider_operation@1",
      unit: "count",
      price: "1.5",
      currency: "EUR",
      perQuantity: "1",
      runCeiling: "1.5",
      sourceRef: "pricing_contract_1",
      effectiveFrom: now,
      actorUserId: "user_1",
      idempotencyKey: "override_1",
      recordedAt: now,
    });
    const preview = await service.previewRun(proposal());
    expect(preview.ceiling).toEqual({
      amount: "6",
      currency: "USD",
      certainty: "conservative",
      fxSnapshotIds: ["fx_eur_usd_1"],
    });
    expect(preview.admissible).toBe(false);
    expect(preview.denialReasons).toContain(
      "CREDENTIAL_SPEND_GRANT_EXPOSURE_UNKNOWN:grant_1",
    );
    expect(preview.stepExposures[0]).toMatchObject({
      amountPerAttempt: "1.5",
      currency: "EUR",
      pricingSnapshotIds: [override.id],
      pricingSource: "workspace_override",
    });
  });

  it("selects one deterministic override per pricing dimension and rejects active overlap", async () => {
    const { repository, service } = await configured();
    const base = {
      workspaceId: "workspace_1",
      provider: knownStep.provider,
      providerOperation: knownStep.providerOperation,
      model: knownStep.model,
      serviceTier: knownStep.serviceTier,
      dimension: "runtime.provider_operation@1",
      unit: "count" as const,
      price: "1",
      currency: "USD",
      perQuantity: "1",
      runCeiling: "1",
      sourceRef: "pricing_contract",
      effectiveFrom: now,
      actorUserId: "user_1",
      recordedAt: now,
    };
    const first = await service.createPricingOverride({
      ...base,
      idempotencyKey: "override_first",
    });
    await expect(service.createPricingOverride({
      ...base,
      runCeiling: "9",
      idempotencyKey: "override_overlap",
      recordedAt: new Date(now.getTime() + 1_000),
    })).rejects.toMatchObject({ code: "BUDGET_CONFLICT" });

    // Simulate legacy overlapping rows predating the active-selector constraint.
    repository.pricingOverrides.set("pricing_override_legacy_newer", {
      ...first,
      id: "pricing_override_legacy_newer",
      price: "2",
      runCeiling: "2",
      effectiveFrom: new Date(now.getTime() + 1_000),
      createdAt: new Date(now.getTime() + 1_000),
    });
    const preview = await service.previewRun(proposal({
      at: new Date(now.getTime() + 2_000),
    }));
    expect(preview.stepExposures[0]).toMatchObject({
      amountPerAttempt: "2",
      pricingSnapshotIds: ["pricing_override_legacy_newer"],
    });
  });

  it("rejects a stale admission after the applicable pricing override changes", async () => {
    const { service } = await configured();
    const overrideInput = {
      workspaceId: "workspace_1",
      provider: knownStep.provider,
      providerOperation: knownStep.providerOperation,
      model: knownStep.model,
      serviceTier: knownStep.serviceTier,
      dimension: "runtime.provider_operation@1",
      unit: "count" as const,
      price: "1",
      currency: "USD",
      perQuantity: "1",
      runCeiling: "1",
      sourceRef: "pricing_contract",
      effectiveFrom: now,
      actorUserId: "user_1",
      recordedAt: now,
    };
    const first = await service.createPricingOverride({
      ...overrideInput,
      idempotencyKey: "override_before_preview",
    });
    const plan = await service.planAdmission({ ...proposal(), runId: "run_stale_pricing" });
    await service.revokePricingOverride({
      workspaceId: "workspace_1",
      overrideId: first.id,
      actorUserId: "user_1",
      recordedAt: new Date(now.getTime() + 1_000),
    });
    await service.createPricingOverride({
      ...overrideInput,
      runCeiling: "2",
      effectiveFrom: new Date(now.getTime() + 1_000),
      recordedAt: new Date(now.getTime() + 1_000),
      idempotencyKey: "override_after_preview",
    });
    await expect(service.commitAdmission(plan)).rejects.toMatchObject({
      code: "BUDGET_NOT_ADMISSIBLE",
    });
  });

  it("retains outcome-unknown exposure and releases only after known reconciliation", async () => {
    const { repository, service } = await configured();
    const plan = await service.planAdmission({ ...proposal(), runId: "run_1" });
    await service.commitAdmission(plan);
    await service.commitSettlement({
      schema: "budget-settlement-plan/v1",
      workspaceId: "workspace_1",
      runId: "run_1",
      stepAttemptId: "attempt_1",
      settlementId: "settlement_1",
      costValuationId: "valuation_unknown",
      outcome: "outcome_unknown",
      amount: null,
      currency: null,
      fxSnapshotId: null,
      runTerminal: false,
      recordedAt: new Date("2026-03-08T06:31:00.000Z"),
    });
    expect([...repository.reservations.values()][0]).toMatchObject({
      state: "outcome_unknown",
      reservedAmount: "2.5",
      releasedAmount: "0",
    });

    await service.commitSettlement({
      schema: "budget-settlement-plan/v1",
      workspaceId: "workspace_1",
      runId: "run_1",
      stepAttemptId: "attempt_1",
      settlementId: "settlement_1",
      costValuationId: "valuation_exact",
      outcome: "succeeded",
      amount: "1.25",
      currency: "USD",
      fxSnapshotId: null,
      runTerminal: true,
      recordedAt: new Date("2026-03-08T06:32:00.000Z"),
    });
    expect([...repository.reservations.values()][0]).toMatchObject({
      state: "settled",
      settledAmount: "1.25",
      releasedAmount: "1.25",
    });
  });

  it("releases only a known child attempt's unused hold before a two-step Run terminates", async () => {
    const { repository, service } = await configured();
    const steps = [
      { ...knownStep, stepId: "step_1", automaticAttempts: 1 },
      { ...knownStep, stepId: "step_2", automaticAttempts: 1 },
    ];
    await service.commitAdmission(await service.planAdmission({
      ...proposal({ stepExposures: steps }),
      runId: "run_two_step_known",
    }));
    await expect(repository.commitAttemptAllocation({
      schema: "budget-attempt-allocation-input/v1",
      id: "allocation_two_step_known_1",
      workspaceId: "workspace_1",
      principalId: "principal_1",
      runId: "run_two_step_known",
      stepAttemptId: "attempt_two_step_known_1",
      stepId: "step_1",
      attempt: 1,
      effectKey: "effect_two_step_known_1",
      credentialEffectRef: credentialEffectRef({
        workspaceId: "workspace_1",
        effectKey: "effect_two_step_known_1",
        stepAttemptId: "attempt_two_step_known_1",
        attempt: 1,
      }),
      provider: knownStep.provider,
      providerOperation: knownStep.providerOperation,
      model: knownStep.model,
      recordedAt: new Date(now.getTime() + 1_000),
    })).resolves.toBe("created");

    await service.commitSettlement({
      schema: "budget-settlement-plan/v1",
      workspaceId: "workspace_1",
      runId: "run_two_step_known",
      stepAttemptId: "attempt_two_step_known_1",
      settlementId: "settlement_two_step_known_1",
      costValuationId: "valuation_two_step_known_1",
      outcome: "succeeded",
      amount: "0.5",
      currency: "USD",
      fxSnapshotId: null,
      runTerminal: false,
      recordedAt: new Date(now.getTime() + 2_000),
    });

    const reservation = [...repository.reservations.values()][0]!;
    expect(reservation).toMatchObject({
      state: "held",
      reservedAmount: "2.5",
      settledAmount: "0.5",
      releasedAmount: "0.75",
    });
    await expect(repository.getCommittedAmount({
      workspaceId: reservation.workspaceId,
      policyRevisionId: reservation.policyRevisionId,
      periodStartsAt: reservation.period.startsAt,
      periodEndsAt: reservation.period.endsAt,
    })).resolves.toBe("1.75");
  });

  it("retains an unknown child attempt's hold in a two-step Run", async () => {
    const { repository, service } = await configured();
    const steps = [
      { ...knownStep, stepId: "step_1", automaticAttempts: 1 },
      { ...knownStep, stepId: "step_2", automaticAttempts: 1 },
    ];
    await service.commitAdmission(await service.planAdmission({
      ...proposal({ stepExposures: steps }),
      runId: "run_two_step_unknown",
    }));
    await expect(repository.commitAttemptAllocation({
      schema: "budget-attempt-allocation-input/v1",
      id: "allocation_two_step_unknown_1",
      workspaceId: "workspace_1",
      principalId: "principal_1",
      runId: "run_two_step_unknown",
      stepAttemptId: "attempt_two_step_unknown_1",
      stepId: "step_1",
      attempt: 1,
      effectKey: "effect_two_step_unknown_1",
      credentialEffectRef: credentialEffectRef({
        workspaceId: "workspace_1",
        effectKey: "effect_two_step_unknown_1",
        stepAttemptId: "attempt_two_step_unknown_1",
        attempt: 1,
      }),
      provider: knownStep.provider,
      providerOperation: knownStep.providerOperation,
      model: knownStep.model,
      recordedAt: new Date(now.getTime() + 1_000),
    })).resolves.toBe("created");

    await service.commitSettlement({
      schema: "budget-settlement-plan/v1",
      workspaceId: "workspace_1",
      runId: "run_two_step_unknown",
      stepAttemptId: "attempt_two_step_unknown_1",
      settlementId: "settlement_two_step_unknown_1",
      costValuationId: "valuation_two_step_unknown_1",
      outcome: "outcome_unknown",
      amount: null,
      currency: null,
      fxSnapshotId: null,
      runTerminal: false,
      recordedAt: new Date(now.getTime() + 2_000),
    });

    const reservation = [...repository.reservations.values()][0]!;
    expect(reservation).toMatchObject({
      state: "outcome_unknown",
      reservedAmount: "2.5",
      settledAmount: "0",
      releasedAmount: "0",
    });
    await expect(repository.getCommittedAmount({
      workspaceId: reservation.workspaceId,
      policyRevisionId: reservation.policyRevisionId,
      periodStartsAt: reservation.period.startsAt,
      periodEndsAt: reservation.period.endsAt,
    })).resolves.toBe("2.5");
  });

  it("adds an over-ceiling known actual to the remaining unresolved child hold", async () => {
    const { repository, service } = await configured();
    const steps = [
      { ...knownStep, stepId: "step_1", automaticAttempts: 1 },
      { ...knownStep, stepId: "step_2", automaticAttempts: 1 },
    ];
    await service.commitAdmission(await service.planAdmission({
      ...proposal({ stepExposures: steps }),
      runId: "run_overage",
    }));
    await repository.commitAttemptAllocation(attemptAllocation({
      id: "allocation_overage_1",
      runId: "run_overage",
      stepAttemptId: "attempt_overage_1",
      stepId: "step_1",
      effectKey: "effect_overage_1",
    }));
    await service.commitSettlement({
      schema: "budget-settlement-plan/v1",
      workspaceId: "workspace_1",
      runId: "run_overage",
      stepAttemptId: "attempt_overage_1",
      settlementId: "settlement_overage_1",
      costValuationId: "valuation_overage_1",
      outcome: "succeeded",
      amount: "2",
      currency: "USD",
      fxSnapshotId: null,
      runTerminal: false,
      recordedAt: new Date(now.getTime() + 2_000),
    });
    const reservation = [...repository.reservations.values()][0]!;
    expect(reservation).toMatchObject({ settledAmount: "2", heldAmount: "1.25" });
    await expect(repository.getCommittedAmount({
      workspaceId: reservation.workspaceId,
      policyRevisionId: reservation.policyRevisionId,
      periodStartsAt: reservation.period.startsAt,
      periodEndsAt: reservation.period.endsAt,
    })).resolves.toBe("3.25");
  });

  it("replaces an unknown estimated head by contribution state, not its raw amount", async () => {
    const { repository, service } = await configured({ hardLimit: "20" });
    const steps = [
      { ...knownStep, stepId: "step_1", automaticAttempts: 1 },
      { ...knownStep, stepId: "step_2", automaticAttempts: 1 },
    ];
    await service.commitAdmission(await service.planAdmission({
      ...proposal({ stepExposures: steps }),
      runId: "run_unknown_correction",
    }));
    for (const [index, stepId] of ["step_1", "step_2"].entries()) {
      await repository.commitAttemptAllocation(attemptAllocation({
        id: `allocation_unknown_correction_${index + 1}`,
        runId: "run_unknown_correction",
        stepAttemptId: `attempt_unknown_correction_${index + 1}`,
        stepId,
        effectKey: `effect_unknown_correction_${index + 1}`,
      }));
    }
    const base = {
      schema: "budget-settlement-plan/v1" as const,
      workspaceId: "workspace_1",
      runId: "run_unknown_correction",
      currency: "USD",
      fxSnapshotId: null,
      runTerminal: false,
    };
    await service.commitSettlement({ ...base, stepAttemptId: "attempt_unknown_correction_1", settlementId: "settlement_known_other", costValuationId: "valuation_known_other", outcome: "succeeded", amount: "5", recordedAt: new Date(now.getTime() + 2_000) });
    await service.commitSettlement({ ...base, stepAttemptId: "attempt_unknown_correction_2", settlementId: "settlement_corrected_unknown", costValuationId: "valuation_unknown_estimate", outcome: "outcome_unknown", amount: "3", recordedAt: new Date(now.getTime() + 3_000) });
    await service.commitSettlement({ ...base, stepAttemptId: "attempt_unknown_correction_2", settlementId: "settlement_corrected_unknown", costValuationId: "valuation_known_correction", outcome: "succeeded", amount: "4", recordedAt: new Date(now.getTime() + 4_000) });
    expect([...repository.reservations.values()][0]).toMatchObject({
      settledAmount: "9",
      heldAmount: "0",
    });
  });

  it("recomputes released capacity after an earlier child settlement is corrected", async () => {
    const { repository, service } = await configured({ hardLimit: "20" });
    const steps = [
      { ...knownStep, stepId: "step_1", amountPerAttempt: "10", automaticAttempts: 1 },
      { ...knownStep, stepId: "step_2", amountPerAttempt: "10", automaticAttempts: 1 },
    ];
    await service.commitAdmission(await service.planAdmission({
      ...proposal({ stepExposures: steps }),
      runId: "run_release_correction",
    }));
    for (const [index, stepId] of ["step_1", "step_2"].entries()) {
      await repository.commitAttemptAllocation(attemptAllocation({
        id: `allocation_release_correction_${index + 1}`,
        runId: "run_release_correction",
        stepAttemptId: `attempt_release_correction_${index + 1}`,
        stepId,
        effectKey: `effect_release_correction_${index + 1}`,
      }));
    }
    const base = {
      schema: "budget-settlement-plan/v1" as const,
      workspaceId: "workspace_1",
      runId: "run_release_correction",
      currency: "USD",
      fxSnapshotId: null,
    };
    await service.commitSettlement({ ...base, stepAttemptId: "attempt_release_correction_1", settlementId: "settlement_release_correction_1", costValuationId: "valuation_release_original", outcome: "succeeded", amount: "5", runTerminal: false, recordedAt: new Date(now.getTime() + 2_000) });
    await service.commitSettlement({ ...base, stepAttemptId: "attempt_release_correction_2", settlementId: "settlement_release_correction_2", costValuationId: "valuation_release_terminal", outcome: "succeeded", amount: "15", runTerminal: true, recordedAt: new Date(now.getTime() + 3_000) });
    expect([...repository.reservations.values()][0]).toMatchObject({
      settledAmount: "20",
      heldAmount: "0",
      releasedAmount: "0",
    });
    await service.commitSettlement({ ...base, stepAttemptId: "attempt_release_correction_1", settlementId: "settlement_release_correction_1", costValuationId: "valuation_release_corrected", outcome: "succeeded", amount: "0", runTerminal: false, recordedAt: new Date(now.getTime() + 4_000) });
    expect([...repository.reservations.values()][0]).toMatchObject({
      settledAmount: "15",
      heldAmount: "0",
      releasedAmount: "5",
    });
  });

  it.each([
    {
      name: "pinned FX",
      step: { ...knownStep, credentialSlotId: null, credentialProfileId: null, amountPerAttempt: "1", currency: "EUR" },
      unknown: "deny" as const,
      allowance: null,
      expectedHold: "2",
      expectedRelease: "1",
    },
    {
      name: "fixed allowance",
      step: { ...knownStep, credentialSlotId: null, credentialProfileId: null, amountPerAttempt: null, currency: null },
      unknown: "fixed_allowance" as const,
      allowance: "4",
      expectedHold: "4",
      expectedRelease: "3",
    },
  ])("persists the $name child hold in reservation currency", async ({ name, step, unknown, allowance, expectedHold, expectedRelease }) => {
    const configuredValue = await configured({ hardLimit: "20", unknown, allowance });
    const service = new BudgetService(configuredValue.repository, {
      async getRate() { return { rate: "2", snapshotId: "fx_eur_usd" }; },
    });
    const steps = [
      { ...step, stepId: "step_1", automaticAttempts: 1 },
      { ...step, stepId: "step_2", automaticAttempts: 1 },
    ];
    const runId = `run_${name.replaceAll(" ", "_")}`;
    const plan = await service.planAdmission({ ...proposal({ stepExposures: steps }), runId });
    expect(plan.reservationAllocations[0]).toMatchObject({
      stepId: "step_1",
      amountPerAttempt: expectedHold,
      currency: "USD",
    });
    await service.commitAdmission(plan);
    await configuredValue.repository.commitAttemptAllocation(attemptAllocation({
      id: `allocation_${runId}`,
      runId,
      stepAttemptId: `attempt_${runId}`,
      stepId: "step_1",
      effectKey: `effect_${runId}`,
    }));
    await service.commitSettlement({
      schema: "budget-settlement-plan/v1",
      workspaceId: "workspace_1",
      runId,
      stepAttemptId: `attempt_${runId}`,
      settlementId: `settlement_${runId}`,
      costValuationId: `valuation_${runId}`,
      outcome: "succeeded",
      amount: "1",
      currency: "USD",
      fxSnapshotId: null,
      runTerminal: false,
      recordedAt: new Date(now.getTime() + 2_000),
    });
    expect([...configuredValue.repository.reservations.values()][0]).toMatchObject({
      heldAmount: expectedHold,
      releasedAmount: expectedRelease,
    });
  });

  it("rechecks global bounded-grant capacity at provider allocation without adding its own envelope twice", async () => {
    const { repository, service } = await configured({ grantLimit: "250" });
    const steps = [
      { ...knownStep, stepId: "step_1", automaticAttempts: 1 },
      { ...knownStep, stepId: "step_2", automaticAttempts: 1 },
    ];
    await service.commitAdmission(await service.planAdmission({
      ...proposal({ stepExposures: steps }),
      runId: "run_grant_launch",
    }));
    const allocation = {
      schema: "budget-attempt-allocation-input/v1" as const,
      id: "allocation_grant_launch_1",
      workspaceId: "workspace_1",
      principalId: "principal_1",
      runId: "run_grant_launch",
      stepAttemptId: "attempt_grant_launch_1",
      stepId: "step_1",
      attempt: 1,
      effectKey: "effect_grant_launch_1",
      credentialEffectRef: credentialEffectRef({
        workspaceId: "workspace_1",
        effectKey: "effect_grant_launch_1",
        stepAttemptId: "attempt_grant_launch_1",
        attempt: 1,
      }),
      provider: knownStep.provider,
      providerOperation: knownStep.providerOperation,
      model: knownStep.model,
      recordedAt: new Date(now.getTime() + 1_000),
    };
    await expect(repository.commitAttemptAllocation(allocation)).resolves.toBe("created");
    expect(repository.attemptAllocations.get(allocation.id)).toMatchObject({
      effectKey: "effect_grant_launch_1",
      credentialEffectRef: allocation.credentialEffectRef,
    });
    expect(allocation.credentialEffectRef).toMatch(
      /^credential-effect:v1:sha256:[a-f0-9]{64}$/,
    );
    expect(allocation.credentialEffectRef).not.toBe(allocation.effectKey);

    const second = {
      ...allocation,
      id: "allocation_grant_launch_2",
      stepAttemptId: "attempt_grant_launch_2",
      stepId: "step_2",
      effectKey: "effect_grant_launch_2",
      credentialEffectRef: credentialEffectRef({
        workspaceId: "workspace_1",
        effectKey: "effect_grant_launch_2",
        stepAttemptId: "attempt_grant_launch_2",
        attempt: 1,
      }),
    };
    repository.grants.set("grant_1", {
      ...repository.grants.get("grant_1")!,
      committed: "51",
    });
    await expect(repository.commitAttemptAllocation(second)).resolves.toBe("unavailable");
  });

  it("retains the reservation when a known outcome still has unknown cost", async () => {
    const { repository, service } = await configured();
    await service.commitAdmission(await service.planAdmission({ ...proposal(), runId: "run_unknown_cost" }));
    await service.commitSettlement({
      schema: "budget-settlement-plan/v1",
      workspaceId: "workspace_1",
      runId: "run_unknown_cost",
      stepAttemptId: "attempt_1",
      settlementId: "settlement_unknown_cost",
      costValuationId: "valuation_unknown_cost",
      outcome: "succeeded",
      amount: null,
      currency: null,
      fxSnapshotId: null,
      runTerminal: true,
      recordedAt: new Date(now.getTime() + 60_000),
    });
    expect([...repository.reservations.values()][0]).toMatchObject({
      state: "held_unknown_cost",
      settledAmount: "0",
      releasedAmount: "0",
    });
  });

  it("replaces a superseded settlement contribution instead of double counting", async () => {
    const { repository, service } = await configured();
    await service.commitAdmission(await service.planAdmission({ ...proposal(), runId: "run_corrected" }));
    const settlement = {
      schema: "budget-settlement-plan/v1" as const,
      workspaceId: "workspace_1",
      runId: "run_corrected",
      stepAttemptId: "attempt_1",
      settlementId: "settlement_corrected",
      outcome: "succeeded" as const,
      currency: "USD",
      fxSnapshotId: null,
      runTerminal: true,
    };
    await service.commitSettlement({
      ...settlement,
      costValuationId: "valuation_1",
      amount: "1",
      recordedAt: new Date(now.getTime() + 1_000),
    });
    await service.commitSettlement({
      ...settlement,
      costValuationId: "valuation_2",
      amount: "1.2",
      recordedAt: new Date(now.getTime() + 2_000),
    });
    expect([...repository.reservations.values()][0]).toMatchObject({
      settledAmount: "1.2",
      releasedAmount: "1.3",
    });
    await service.commitSettlement({
      ...settlement,
      costValuationId: "valuation_3",
      amount: "0.8",
      recordedAt: new Date(now.getTime() + 3_000),
    });
    expect([...repository.reservations.values()][0]).toMatchObject({
      settledAmount: "0.8",
      releasedAmount: "1.7",
    });
  });

  it("treats an effect-not-created zero with no currency as known zero", async () => {
    const { repository, service } = await configured();
    await service.commitAdmission(await service.planAdmission({ ...proposal(), runId: "run_zero" }));
    await service.commitSettlement({
      schema: "budget-settlement-plan/v1",
      workspaceId: "workspace_1",
      runId: "run_zero",
      stepAttemptId: "attempt_1",
      settlementId: "settlement_zero",
      costValuationId: "valuation_zero",
      outcome: "failed_known",
      amount: "0",
      currency: null,
      fxSnapshotId: null,
      runTerminal: true,
      recordedAt: new Date(now.getTime() + 1_000),
    });
    expect([...repository.reservations.values()][0]).toMatchObject({
      state: "settled",
      settledAmount: "0",
      releasedAmount: "2.5",
    });
  });

  it("counts prior policy revisions against the stable policy period", async () => {
    const { service } = await configured();
    await service.commitAdmission(await service.planAdmission({ ...proposal(), runId: "run_old_revision" }));
    await service.createPolicyRevision({
      workspaceId: "workspace_1",
      principalId: null,
      currency: "USD",
      period: "calendar_day",
      timezone: "America/New_York",
      warningThreshold: "2",
      hardLimit: "3",
      unknownPriceTreatment: "deny",
      unknownPriceAllowance: null,
      actorUserId: "user_1",
      idempotencyKey: "workspace_policy_narrowed",
      recordedAt: new Date(now.getTime() + 1_000),
    });
    const preview = await service.previewRun(proposal({
      at: new Date(now.getTime() + 2_000),
    }));
    expect(preview.admissible).toBe(false);
    expect(preview.denialReasons).toContain("BUDGET_LIMIT_EXCEEDED:workspace");
  });

  it("re-evaluates emergency suspension after a non-binding preview", async () => {
    const { service } = await configured();
    expect((await service.previewRun(proposal())).admissible).toBe(true);
    await service.setSpendSuspended({
      workspaceId: "workspace_1",
      suspended: true,
      reason: "incident response",
      actorUserId: "user_1",
      recordedAt: new Date("2026-03-08T06:31:00.000Z"),
    });
    await expect(service.planAdmission({ ...proposal(), runId: "run_1" })).rejects.toMatchObject({
      code: "BUDGET_NOT_ADMISSIBLE",
    });
  });
});
