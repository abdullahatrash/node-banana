import { describe, expect, it } from "vitest";
import { InMemoryUsageRepository } from "../memory";
import { UsageLedgerService } from "../service";
import { addDecimals, canonicalDecimal, multiplyDecimals } from "../decimal";
import type { SettleProviderUsageInput } from "../types";

const binding = {
  workspaceId: "workspace_1",
  principalId: "principal_1",
  workflowId: "workflow_1",
  runId: "run_1",
  stepAttemptId: "attempt_1",
  stepId: "step_1",
  attempt: 1,
  provider: "gemini",
  providerOperation: "generativelanguage.v1beta.models.generateContent",
  providerOperationRef: "provider_1",
  model: "gemini-2.5-flash",
  effectKey: "effect_1",
} as const;

const metadata = {
  evidence: {
    providerRequestId: "request_1",
    httpStatus: 200,
    providerCode: null,
    operatorTraceRef: "trace_1",
    effectDisposition: "accepted" as const,
  },
  usage: [
    {
      dimension: "gemini.tokens.input@1",
      unit: "count" as const,
      source: "reported" as const,
      quantity: "1000",
    },
    {
      dimension: "gemini.tokens.output@1",
      unit: "count" as const,
      source: "reported" as const,
      quantity: "200",
    },
  ],
  retryAfterMs: null,
  pollAfterMs: null,
};

function settlement(overrides: Partial<SettleProviderUsageInput> = {}): SettleProviderUsageInput {
  return {
    binding,
    interval: {
      startedAt: new Date("2026-08-01T10:00:00.000Z"),
      endedAt: new Date("2026-08-01T10:00:01.000Z"),
    },
    metadata,
    outcome: "succeeded",
    lineageArtifactIds: ["artifact_input"],
    recordedAt: new Date("2026-08-01T10:00:01.000Z"),
    ...overrides,
  };
}

describe("exact decimals", () => {
  it("canonicalizes and calculates without floating point", () => {
    expect(canonicalDecimal("1.2300")).toBe("1.23");
    expect(addDecimals("0.1", "0.2")).toBe("0.3");
    expect(multiplyDecimals("1000", "0.0000003")).toBe("0.0003");
    expect(() => canonicalDecimal("1e-3")).toThrow();
    expect(() => canonicalDecimal("-1")).toThrow();
  });
});

describe("UsageLedgerService", () => {
  it("settles immutable usage and values it from the versioned catalog", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    const first = await service.settleProviderOutcome(settlement());
    const replay = await service.settleProviderOutcome(
      settlement({
        recordedAt: new Date("2026-08-01T10:00:05.000Z"),
      }),
    );

    expect(replay).toEqual(first);
    expect(repository.usageRecords.size).toBe(2);
    expect(repository.valuations.size).toBe(1);
    const valuation = [...repository.valuations.values()][0]!;
    expect(valuation).toMatchObject({
      basis: "runtime_calculated",
      pricingSource: "builtin_catalog",
      amount: "0.0008",
      currency: "USD",
    });
    expect(repository.meteringEvents.size).toBe(2);
  });

  it("conflicts when a settlement replay changes its evidence interval", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    await service.settleProviderOutcome(settlement());
    await expect(service.settleProviderOutcome(settlement({
      interval: {
        startedAt: new Date("2026-08-01T10:00:00.000Z"),
        endedAt: new Date("2026-08-01T10:00:05.000Z"),
      },
    }))).rejects.toMatchObject({ code: "USAGE_CONFLICT" });
  });

  it("preserves unknown instead of pricing it as zero", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    await service.settleProviderOutcome(
      settlement({
        metadata: {
          ...metadata,
          usage: [
            {
              dimension: "gemini.tokens.input@1",
              unit: "count",
              source: "unknown",
              quantity: null,
            },
          ],
        },
      }),
    );
    const valuation = [...repository.valuations.values()][0]!;
    expect(valuation).toMatchObject({ basis: "unknown", pricingSource: "unknown", amount: null, currency: null });
    const summary = await service.getSummary(binding.workspaceId);
    expect(summary.unknownValuationCount).toBe(1);
    expect(summary.complete).toBe(false);
    expect(summary.costSubtotals).toEqual([]);
  });

  it("rejects contradictory unknown and known quantity evidence", async () => {
    const service = new UsageLedgerService(new InMemoryUsageRepository());
    await expect(service.settleProviderOutcome(settlement({
      metadata: {
        ...metadata,
        usage: [{
          dimension: "gemini.tokens.input@1",
          unit: "count",
          source: "unknown",
          quantity: "1",
        }] as never,
      },
    }))).rejects.toMatchObject({ code: "USAGE_INVALID_INPUT" });
  });

  it("uses provider-reported exact cost before workspace and built-in pricing", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    await service.settleProviderOutcome(
      settlement({ providerReportedCost: { amount: "1.2500", currency: "usd", evidenceRef: "invoice_1" } }),
    );
    expect([...repository.valuations.values()][0]).toMatchObject({
      basis: "provider_reported",
      pricingSource: "provider_reported",
      amount: "1.25",
      currency: "USD",
      providerCostEvidenceRef: expect.stringMatching(/^evidence:sha256:[a-f0-9]{64}$/),
      pricingSnapshotIds: [],
    });
  });

  it("preserves provider-reported cost authority across later usage corrections", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    await service.settleProviderOutcome(settlement({
      providerReportedCost: { amount: "1.25", currency: "USD", evidenceRef: "https://provider.invalid/signed?token=secret" },
    }));
    await service.reconcileProviderOutcome(settlement({
      metadata: {
        ...metadata,
        usage: metadata.usage.map((item) => item.dimension === "gemini.tokens.input@1"
          ? { ...item, quantity: "1001" }
          : item),
      },
      recordedAt: new Date("2026-08-01T10:02:00.000Z"),
    }));
    const valuations = await service.listCostValuations(binding.workspaceId);
    const head = valuations.find((candidate) =>
      !valuations.some((value) => value.supersedesCostValuationId === candidate.id));
    expect(head).toMatchObject({
      basis: "provider_reported",
      amount: "1.25",
      currency: "USD",
      providerCostEvidenceRef: expect.stringMatching(/^evidence:sha256:[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(head)).not.toContain("signed");
    expect(JSON.stringify(head)).not.toContain("secret");
  });

  it("records unknown cost when exact decimal division is not representable", async () => {
    const repository = new InMemoryUsageRepository();
    repository.pricingSnapshots.set("override_thirds", {
      schema: "pricing-snapshot/v1",
      id: "override_thirds",
      workspaceId: binding.workspaceId,
      source: "workspace_override",
      provider: binding.provider,
      providerOperation: binding.providerOperation,
      model: binding.model,
      dimension: "gemini.tokens.input@1",
      unit: "count",
      price: "1",
      currency: "USD",
      perQuantity: "3",
      version: "workspace-thirds-v1",
      sourceUrl: null,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: null,
      recordedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    const service = new UsageLedgerService(repository);
    await expect(service.settleProviderOutcome(settlement({
      metadata: {
        ...metadata,
        usage: [{ dimension: "gemini.tokens.input@1", unit: "count", source: "reported", quantity: "1" }],
      },
    }))).resolves.toBeTruthy();
    expect([...repository.valuations.values()][0]).toMatchObject({
      basis: "unknown",
      pricingSource: "unknown",
      amount: null,
      currency: null,
    });
  });

  it("prefers a Workspace override snapshot to the built-in catalog", async () => {
    const repository = new InMemoryUsageRepository();
    repository.pricingSnapshots.set("override_input", {
      schema: "pricing-snapshot/v1",
      id: "override_input",
      workspaceId: binding.workspaceId,
      source: "workspace_override",
      provider: binding.provider,
      providerOperation: binding.providerOperation,
      model: binding.model,
      dimension: "gemini.tokens.input@1",
      unit: "count",
      price: "0.001",
      currency: "USD",
      perQuantity: "1",
      version: "workspace-price-v1",
      sourceUrl: null,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: null,
      recordedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    repository.pricingSnapshots.set("override_output", {
      ...repository.pricingSnapshots.get("override_input")!,
      id: "override_output",
      dimension: "gemini.tokens.output@1",
      price: "0.002",
    });
    const service = new UsageLedgerService(repository);
    await service.settleProviderOutcome(settlement());
    expect([...repository.valuations.values()][0]).toMatchObject({
      basis: "runtime_calculated",
      pricingSource: "workspace_override",
      amount: "1.4",
      currency: "USD",
      pricingSnapshotIds: ["override_input", "override_output"],
    });
  });

  it("overlays a partial Workspace override on the built-in catalog", async () => {
    const repository = new InMemoryUsageRepository();
    repository.pricingSnapshots.set("override_input", {
      schema: "pricing-snapshot/v1",
      id: "override_input",
      workspaceId: binding.workspaceId,
      source: "workspace_override",
      provider: binding.provider,
      providerOperation: binding.providerOperation,
      model: binding.model,
      dimension: "gemini.tokens.input@1",
      unit: "count",
      price: "0.001",
      currency: "USD",
      perQuantity: "1",
      version: "workspace-price-v1",
      sourceUrl: null,
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: null,
      recordedAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    const service = new UsageLedgerService(repository);
    await service.settleProviderOutcome(settlement());
    expect([...repository.valuations.values()][0]).toMatchObject({
      basis: "runtime_calculated",
      pricingSource: "mixed",
      amount: "1.0005",
      currency: "USD",
      pricingSnapshotIds: expect.arrayContaining(["override_input"]),
    });
  });

  it("records applicable provider consumption as unknown when meters are absent", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    await service.settleProviderOutcome(settlement({ metadata: null, outcome: "outcome_unknown" }));
    expect([...repository.usageRecords.values()][0]).toMatchObject({
      dimension: "runtime.provider_operation@1",
      unit: "count",
      source: "unknown",
      quantity: null,
      evidence: { effectDisposition: "unknown" },
    });
    const summary = await service.getSummary(binding.workspaceId);
    expect(summary.quantityTotals).toContainEqual({
      dimension: "runtime.provider_operation@1",
      unit: "count",
      source: "unknown",
      quantity: null,
      unknownCount: 1,
    });
  });

  it("appends corrections and keeps the superseded evidence retrievable", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    const { settlementId } = await service.settleProviderOutcome(
      settlement({
        metadata: {
          ...metadata,
          usage: [{ dimension: "gemini.tokens.input@1", unit: "count", source: "unknown", quantity: null }],
        },
      }),
    );
    await service.correctUsage({
      workspaceId: binding.workspaceId,
      settlementId,
      reason: "provider_reconciliation",
      usage: [{ dimension: "gemini.tokens.input@1", unit: "count", source: "reported", quantity: "20" }],
      evidence: metadata.evidence,
      recordedAt: new Date("2026-08-01T10:01:00.000Z"),
    });
    expect(repository.usageRecords.size).toBe(2);
    expect(repository.valuations.size).toBe(2);
    const records = await service.listUsageRecords(binding.workspaceId);
    expect(records.find((record) => record.source === "reported")?.supersedesUsageRecordId).toBeTruthy();
    const summary = await service.getSummary(binding.workspaceId);
    expect(summary.complete).toBe(true);
    expect(summary.unknownValuationCount).toBe(0);
  });

  it("carries unchanged dimensions into a partial correction valuation", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    const { settlementId } = await service.settleProviderOutcome(settlement());
    await service.correctUsage({
      workspaceId: binding.workspaceId,
      settlementId,
      reason: "provider_reconciliation",
      usage: [{ dimension: "gemini.tokens.input@1", unit: "count", source: "reported", quantity: "2000" }],
      evidence: metadata.evidence,
      recordedAt: new Date("2026-08-01T10:01:00.000Z"),
    });
    const heads = (await service.listUsageRecords(binding.workspaceId)).filter((candidate, _index, all) =>
      !all.some((record) => record.supersedesUsageRecordId === candidate.id));
    expect(heads).toHaveLength(2);
    expect(heads.map((record) => [record.dimension, record.quantity])).toEqual(expect.arrayContaining([
      ["gemini.tokens.input@1", "2000"],
      ["gemini.tokens.output@1", "200"],
    ]));
    const valuations = await service.listCostValuations(binding.workspaceId);
    const valuationHead = valuations.find((candidate) =>
      !valuations.some((value) => value.supersedesCostValuationId === candidate.id));
    expect(valuationHead).toMatchObject({ amount: "0.0011", pricingSource: "builtin_catalog" });
  });

  it("supersedes catalog cost with later provider-reported cost even when quantities match", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    await service.settleProviderOutcome(settlement());
    await service.reconcileProviderOutcome(settlement({
      providerReportedCost: { amount: "0.75", currency: "USD", evidenceRef: "invoice_final" },
      recordedAt: new Date("2026-08-01T10:02:00.000Z"),
    }));
    const valuations = await service.listCostValuations(binding.workspaceId);
    const head = valuations.find((candidate) =>
      !valuations.some((value) => value.supersedesCostValuationId === candidate.id));
    expect(head).toMatchObject({
      basis: "provider_reported",
      amount: "0.75",
      providerCostEvidenceRef: expect.stringMatching(/^evidence:sha256:[a-f0-9]{64}$/),
    });
  });

  it("retires the generic missing-meter placeholder when detailed dimensions arrive", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    await service.settleProviderOutcome(settlement({ metadata: null, outcome: "outcome_unknown" }));
    await service.reconcileProviderOutcome(settlement({
      recordedAt: new Date("2026-08-01T10:02:00.000Z"),
    }));
    const summary = await service.getSummary(binding.workspaceId);
    expect(summary.complete).toBe(true);
    expect(summary.quantityTotals.some((item) => item.dimension === "runtime.provider_operation@1")).toBe(false);
    const before = repository.usageRecords.size;
    await service.reconcileProviderOutcome(settlement({
      recordedAt: new Date("2026-08-01T10:03:00.000Z"),
    }));
    expect(repository.usageRecords.size).toBe(before);
  });

  it("keeps missing-meter placeholders for unrelated settlements", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    await service.settleProviderOutcome(settlement({ metadata: null, outcome: "outcome_unknown" }));
    await service.settleProviderOutcome(settlement({
      binding: {
        ...binding,
        runId: "run_2",
        stepAttemptId: "attempt_2",
        stepId: "step_2",
        effectKey: "effect_2",
        providerOperationRef: "provider_2",
      },
      recordedAt: new Date("2026-08-01T10:00:02.000Z"),
    }));
    const summary = await service.getSummary(binding.workspaceId);
    expect(summary.quantityTotals).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "runtime.provider_operation@1", unknownCount: 1 }),
      expect.objectContaining({ dimension: "gemini.tokens.input@1", quantity: "1000" }),
    ]));
    expect(summary.complete).toBe(false);
  });

  it("records a resolved provider reference even when reconciliation has no meter metadata", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    await service.settleProviderOutcome(settlement({
      binding: { ...binding, providerOperationRef: null },
      metadata: null,
      outcome: "outcome_unknown",
    }));
    await service.reconcileProviderOutcome(settlement({
      binding: { ...binding, providerOperationRef: "provider_resolved" },
      metadata: null,
      outcome: "succeeded",
      recordedAt: new Date("2026-08-01T10:02:00.000Z"),
    }));
    const records = await service.listUsageRecords(binding.workspaceId);
    const head = records.find((candidate) =>
      !records.some((record) => record.supersedesUsageRecordId === candidate.id));
    expect(head?.binding.providerOperationRef).toBe("provider_resolved");
    expect(head?.outcome).toBe("succeeded");
    expect([...repository.meteringEvents.values()]).toContainEqual(
      expect.objectContaining({
        type: "usage.corrected",
        details: expect.objectContaining({ outcome: "succeeded" }),
      }),
    );
  });

  it("never rewrites a resolved provider operation reference through correction", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    const { settlementId } = await service.settleProviderOutcome(settlement());

    await expect(service.correctUsage({
      workspaceId: binding.workspaceId,
      settlementId,
      reason: "provider_reconciliation",
      usage: metadata.usage,
      evidence: metadata.evidence,
      binding: { ...binding, providerOperationRef: "provider_rewritten" },
      recordedAt: new Date("2026-08-01T10:02:00.000Z"),
    })).rejects.toMatchObject({ code: "USAGE_INVALID_INPUT" });

    const records = await service.listUsageRecords(binding.workspaceId);
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.binding.providerOperationRef === "provider_1")).toBe(true);
  });

  it("never rewrites a resolved reference when an obsolete null placeholder remains", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    const { settlementId } = await service.settleProviderOutcome(settlement({
      binding: { ...binding, providerOperationRef: null },
      metadata: null,
      outcome: "outcome_unknown",
    }));
    await service.reconcileProviderOutcome(settlement({
      binding: { ...binding, providerOperationRef: "provider_resolved" },
      recordedAt: new Date("2026-08-01T10:01:00.000Z"),
    }));

    await expect(service.correctUsage({
      workspaceId: binding.workspaceId,
      settlementId,
      reason: "provider_reconciliation",
      usage: metadata.usage,
      evidence: metadata.evidence,
      binding: { ...binding, providerOperationRef: "provider_rewritten" },
      recordedAt: new Date("2026-08-01T10:02:00.000Z"),
    })).rejects.toMatchObject({ code: "USAGE_INVALID_INPUT" });

    const records = await service.listUsageRecords(binding.workspaceId);
    expect(records.some((record) => record.binding.providerOperationRef === "provider_resolved")).toBe(true);
    expect(records.some((record) => record.binding.providerOperationRef === "provider_rewritten")).toBe(false);
  });

  it("attributes only an explicitly single generated Artifact", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    const { settlementId } = await service.settleProviderOutcome(settlement());
    await service.attributeGeneratedArtifact({
      workspaceId: binding.workspaceId,
      principalId: binding.principalId,
      runId: binding.runId,
      stepAttemptId: binding.stepAttemptId,
      effectKey: binding.effectKey,
      settlementId,
      artifactId: "artifact_output",
      outputName: "image",
      recordedAt: new Date("2026-08-01T10:00:02.000Z"),
    });
    const records = await service.listUsageRecords(binding.workspaceId);
    expect(records.every((record) => record.directArtifactId === "artifact_output")).toBe(true);
    expect([...repository.usageRecords.values()].every((record) => record.directArtifactId === null)).toBe(true);
    await service.correctUsage({
      workspaceId: binding.workspaceId,
      settlementId,
      reason: "provider_reconciliation",
      usage: [{ dimension: "gemini.tokens.input@1", unit: "count", source: "reported", quantity: "1001" }],
      evidence: metadata.evidence,
      recordedAt: new Date("2026-08-01T10:00:03.000Z"),
    });
    expect((await service.listUsageRecords(binding.workspaceId)).every(
      (record) => record.directArtifactId === "artifact_output",
    )).toBe(true);
    expect([...repository.usageRecords.values()].every((record) => record.directArtifactId === null)).toBe(true);
  });

  it("rejects divergent corrections from the same immutable head", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    const { settlementId } = await service.settleProviderOutcome(settlement({
      metadata: {
        ...metadata,
        usage: [{ dimension: "gemini.tokens.input@1", unit: "count", source: "unknown", quantity: null }],
      },
    }));
    const results = await Promise.allSettled([
      service.correctUsage({
        workspaceId: binding.workspaceId,
        settlementId,
        reason: "provider_reconciliation_a",
        usage: [{ dimension: "gemini.tokens.input@1", unit: "count", source: "reported", quantity: "20" }],
        evidence: metadata.evidence,
        recordedAt: new Date("2026-08-01T10:01:00.000Z"),
      }),
      service.correctUsage({
        workspaceId: binding.workspaceId,
        settlementId,
        reason: "provider_reconciliation_b",
        usage: [{ dimension: "gemini.tokens.input@1", unit: "count", source: "reported", quantity: "21" }],
        evidence: metadata.evidence,
        recordedAt: new Date("2026-08-01T10:01:01.000Z"),
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(repository.usageRecords.size).toBe(2);
    expect(repository.valuations.size).toBe(2);
  });

  it("rolls back a bundled correction when direct attribution conflicts", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    const { settlementId } = await service.settleProviderOutcome(settlement());
    await service.attributeGeneratedArtifact({
      workspaceId: binding.workspaceId,
      principalId: binding.principalId,
      runId: binding.runId,
      stepAttemptId: binding.stepAttemptId,
      effectKey: binding.effectKey,
      settlementId,
      artifactId: "artifact_original",
      outputName: "image",
      recordedAt: new Date("2026-08-01T10:00:02.000Z"),
    });
    const usagePlan = await service.planProviderReconciliation(settlement({
      metadata: {
        ...metadata,
        usage: metadata.usage.map((item) => item.dimension === "gemini.tokens.input@1"
          ? { ...item, quantity: "1001" }
          : item),
      },
      recordedAt: new Date("2026-08-01T10:02:00.000Z"),
    }));
    const attributionPlan = service.planGeneratedArtifactAttribution({
      workspaceId: binding.workspaceId,
      principalId: binding.principalId,
      runId: binding.runId,
      stepAttemptId: binding.stepAttemptId,
      effectKey: binding.effectKey,
      settlementId,
      artifactId: "artifact_conflicting",
      outputName: "image",
      recordedAt: new Date("2026-08-01T10:02:00.000Z"),
    });
    const before = {
      records: repository.usageRecords.size,
      valuations: repository.valuations.size,
      events: repository.meteringEvents.size,
      receipts: repository.receipts.size,
    };
    await expect(repository.appendBundle({ usagePlan, attributionPlan })).resolves.toBe("conflict");
    expect({
      records: repository.usageRecords.size,
      valuations: repository.valuations.size,
      events: repository.meteringEvents.size,
      receipts: repository.receipts.size,
    }).toEqual(before);
  });

  it("refuses to attribute another Attempt's Artifact identity to a settlement", async () => {
    const repository = new InMemoryUsageRepository();
    const service = new UsageLedgerService(repository);
    const { settlementId } = await service.settleProviderOutcome(settlement());
    await expect(service.attributeGeneratedArtifact({
      workspaceId: binding.workspaceId,
      principalId: binding.principalId,
      runId: binding.runId,
      stepAttemptId: "attempt_other",
      effectKey: "effect_other",
      settlementId,
      artifactId: "artifact_other",
      outputName: "image",
      recordedAt: new Date("2026-08-01T10:02:00.000Z"),
    })).rejects.toMatchObject({ code: "USAGE_UNAVAILABLE" });
  });
});
