import { describe, expect, it } from "vitest";
import type { BudgetReservation } from "../../budgets/types";
import type { QuotaReservation } from "../../quotas/types";
import type { CostValuation, UsageRecord } from "../../usage/types";
import {
  artifactUsageContext,
  costValuationEvidence,
  diagnosticTraceQuery,
  mergeWorkflowRunEventPages,
  runReservationEvidence,
  workflowRunArtifactMembership,
  workflowRunInspectionQueryPlan,
} from "../inspection";
import type { WorkflowRunDto, WorkflowStepAttemptDto } from "../types";

const now = new Date("2026-08-09T10:00:00.000Z");

function run(): WorkflowRunDto {
  return {
    id: "run_1",
    workspaceId: "workspace_1",
    workflowId: "workflow_1",
    workflowRevisionId: "revision_1",
    state: "completed",
    startSnapshotDigest: `sha256:${"a".repeat(64)}`,
    startSnapshot: {
      schema: "workflow-run-start-snapshot/v1",
      workflowId: "workflow_1",
      workflowRevisionId: "revision_1",
      workflowRevision: 1,
      definitionDigest: `sha256:${"b".repeat(64)}`,
      operationRegistryDigest: `sha256:${"c".repeat(64)}`,
      definition: {
        schema: "content-workflow-revision-definition/v1",
        workflowId: "workflow_1",
        name: "Inspection fixture",
        inputs: {},
        credentialSlots: {},
        steps: [],
        outputs: {},
      },
      inputs: [],
      operationContracts: [],
      artifactReferences: [{
        inputName: "hero",
        artifactId: "artifact_input",
        digest: `sha256:${"d".repeat(64)}`,
        kind: "image",
        mediaType: "image/png",
        sizeBytes: 10,
        width: 1,
        height: 1,
      }],
      credentialReferences: [],
      authorization: {
        principalId: "principal_1",
        keyId: "key_1",
        evidenceRef: `evidence:sha256:${"e".repeat(64)}`,
      },
    },
    output: null,
    finalSnapshot: {
      schema: "workflow-run-final-snapshot/v1",
      runId: "run_1",
      startSnapshotDigest: `sha256:${"a".repeat(64)}`,
      stepAttempts: [],
      outputs: {
        final: {
          artifactId: "artifact_output",
          digest: `sha256:${"f".repeat(64)}`,
          kind: "image",
          mediaType: "image/png",
          sizeBytes: 20,
        },
      },
    },
    finalSnapshotDigest: `sha256:${"1".repeat(64)}`,
    derivation: null,
    resumeAt: null,
    failureCode: null,
    acceptedAt: now.toISOString(),
    startedAt: now.toISOString(),
    completedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function attempt(): WorkflowStepAttemptDto {
  return {
    id: "attempt_1",
    workspaceId: "workspace_1",
    runId: "run_1",
    stepId: "step_1",
    attempt: 1,
    state: "completed",
    operationIdentity: "test.generate@1",
    operationContractDigest: `sha256:${"2".repeat(64)}`,
    provider: "test",
    providerOperation: "generate",
    model: "deterministic",
    intentDigest: `sha256:${"3".repeat(64)}`,
    effectKey: "effect_1",
    inputs: [{
      port: "image",
      kind: "image",
      source: { kind: "workflow_input", inputName: "hero" },
      contentDigest: `sha256:${"d".repeat(64)}`,
      artifactId: "artifact_input",
    }],
    outputs: {
      image: {
        artifactId: "artifact_output",
        digest: `sha256:${"f".repeat(64)}`,
        kind: "image",
        mediaType: "image/png",
        sizeBytes: 20,
      },
    },
    providerOperationRef: "provider_ref_1",
    outcome: { kind: "succeeded", providerOperationRef: "provider_ref_1" },
    reconciliation: null,
    failureCode: null,
    startedAt: now.toISOString(),
    completedAt: now.toISOString(),
  };
}

function usage(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    schema: "usage-record/v1",
    id: "usage_1",
    settlementId: "settlement_1",
    binding: {
      workspaceId: "workspace_1",
      principalId: "principal_1",
      workflowId: "workflow_1",
      runId: "run_1",
      stepAttemptId: "attempt_1",
      stepId: "step_1",
      attempt: 1,
      provider: "test",
      providerOperation: "generate",
      providerOperationRef: "provider_ref_1",
      model: "deterministic",
      effectKey: "effect_1",
    },
    interval: { startedAt: now, endedAt: now },
    dimension: "image.count@1",
    unit: "count",
    source: "reported",
    quantity: "1",
    outcome: "succeeded",
    evidence: {
      providerRequestId: null,
      httpStatus: 200,
      providerCode: null,
      operatorTraceRef: null,
      effectDisposition: "accepted",
    },
    directArtifactId: "artifact_output",
    lineageArtifactIds: ["artifact_input"],
    supersedesUsageRecordId: null,
    correctionReason: null,
    recordedAt: now,
    ...overrides,
  };
}

function valuation(overrides: Partial<CostValuation> = {}): CostValuation {
  return {
    schema: "cost-valuation/v1",
    id: "valuation_1",
    settlementId: "settlement_1",
    workspaceId: "workspace_1",
    principalId: "principal_1",
    runId: "run_1",
    stepAttemptId: "attempt_1",
    usageRecordIds: ["usage_1"],
    basis: "provider_reported",
    pricingSource: "provider_reported",
    amount: "1.25",
    currency: "USD",
    providerCostEvidenceRef: `evidence:sha256:${"4".repeat(64)}`,
    pricingSnapshotIds: [],
    pricingSnapshots: [],
    fxSnapshotId: null,
    supersedesCostValuationId: null,
    recordedAt: now,
    ...overrides,
  };
}

describe("Workflow Run inspection query contract", () => {
  it("plans only canonical versioned capability reads", () => {
    const plan = workflowRunInspectionQueryPlan({
      workflowId: " workflow_1 ",
      runId: "run_1",
      workflowRevisionId: "revision_1",
      eventCursor: "event_cursor",
      pageSize: 25,
    });

    expect(plan).toMatchObject({
      revision: {
        capability: "workflow_versions.get@2",
        input: { workflowId: "workflow_1", revisionId: "revision_1" },
      },
      run: { capability: "workflow_runs.get@2" },
      attempts: { capability: "workflow_step_attempts.list@2" },
      events: {
        capability: "workflow_run_events.list@2",
        input: { cursor: "event_cursor" },
      },
      usage: {
        capability: "usage_records.list@1",
        input: { runId: "run_1", limit: 25 },
      },
      valuations: { capability: "cost_valuations.list@1" },
      summary: { capability: "usage_summaries.get@1" },
      budgetReservations: { capability: "budget_reservations.list@1" },
      quotaReservations: { capability: "quota_reservations.list@1" },
      quotaWaits: { capability: "quota_waits.list@1" },
    });
    expect(
      workflowRunInspectionQueryPlan({ workflowId: "w", runId: "r" }).events
        .input,
    ).not.toHaveProperty("cursor");
  });

  it("rejects malformed local query-plan inputs before transport", () => {
    expect(() => workflowRunInspectionQueryPlan({ workflowId: "", runId: "run" }))
      .toThrow("Workflow ID is invalid");
    expect(() => workflowRunInspectionQueryPlan({
      workflowId: "workflow",
      runId: "run",
      pageSize: 101,
    })).toThrow("page size");
  });

  it("derives Artifact membership and keeps direct usage distinct from lineage context", () => {
    const record = usage();
    const foreignAttempt = {
      ...attempt(),
      id: "attempt_foreign",
      runId: "run_2",
      inputs: [],
      outputs: {
        image: {
          artifactId: "artifact_foreign",
          digest: `sha256:${"9".repeat(64)}`,
          kind: "image" as const,
          mediaType: "image/png",
          sizeBytes: 30,
        },
      },
    };
    expect(workflowRunArtifactMembership({
      run: run(),
      attempts: [attempt(), foreignAttempt],
      usageRecords: [record],
    })).toEqual([
      { artifactId: "artifact_input", roles: ["input", "lineage_context"] },
      { artifactId: "artifact_output", roles: ["output"] },
    ]);
    expect(artifactUsageContext([record], "artifact_output")).toEqual({
      direct: [record],
      lineageContext: [],
    });
    expect(artifactUsageContext([record], "artifact_input")).toEqual({
      direct: [],
      lineageContext: [record],
    });
  });

  it("merges ordered event pages while detecting gaps and conflicting replays", () => {
    const accepted = {
      id: "event_1",
      runId: "run_1",
      sequence: 1,
      type: "run.accepted" as const,
      data: {},
      occurredAt: now.toISOString(),
    };
    const started = {
      id: "event_2",
      runId: "run_1",
      sequence: 2,
      type: "step.attempt.started" as const,
      data: { stepAttemptId: "attempt_1" },
      occurredAt: now.toISOString(),
    };
    expect(mergeWorkflowRunEventPages([accepted], [accepted, started])).toEqual([
      accepted,
      started,
    ]);
    expect(() => mergeWorkflowRunEventPages([accepted], [{
      ...started,
      sequence: 3,
    }])).toThrow("sequence gap");
    expect(() => mergeWorkflowRunEventPages([accepted], [{
      ...accepted,
      id: "conflicting_event",
    }])).toThrow("sequence conflicts");
  });

  it("keeps unknown valuations explicit and never coerces them to zero", () => {
    const known = valuation();
    const noEffectCost = valuation({
      id: "valuation_no_effect",
      basis: "effect_not_created",
      pricingSource: "effect_not_created",
      amount: "0",
      currency: null,
      providerCostEvidenceRef: null,
    });
    const unknown = valuation({
      id: "valuation_unknown",
      basis: "unknown",
      pricingSource: "unknown",
      amount: null,
      currency: null,
      providerCostEvidenceRef: null,
    });
    expect(costValuationEvidence([known, noEffectCost, unknown])).toEqual({
      known: [known, noEffectCost],
      unknown: [unknown],
    });
  });

  it("filters reservation evidence to the inspected Run without aggregating it", () => {
    const budget = { runId: "run_1" } as BudgetReservation;
    const otherBudget = { runId: "run_2" } as BudgetReservation;
    const quota = { runId: "run_1" } as QuotaReservation;
    expect(runReservationEvidence({
      runId: "run_1",
      budget: [budget, otherBudget],
      quota: [quota],
    })).toEqual([
      { kind: "budget", reservation: budget },
      { kind: "quota", reservation: quota },
    ]);
  });

  it("builds only the operator-granted sanitized trace read", () => {
    expect(diagnosticTraceQuery({
      operatorTraceRef: `otr_${"a".repeat(32)}`,
      operatorGrantId: "grant_1",
    })).toEqual({
      capability: "diagnostic_traces.get@1",
      input: {
        operatorTraceRef: `otr_${"a".repeat(32)}`,
        operatorGrantId: "grant_1",
      },
    });
    expect(() => diagnosticTraceQuery({
      operatorTraceRef: "trace_raw_payload",
      operatorGrantId: "grant_1",
    })).toThrow("Operator Trace Reference is invalid");
  });
});
