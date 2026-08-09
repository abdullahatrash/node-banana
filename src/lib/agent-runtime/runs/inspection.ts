import type { BudgetReservation } from "../budgets/types";
import type { QuotaReservation } from "../quotas/types";
import type { CostValuation, UsageRecord } from "../usage/types";
import type {
  WorkflowRunDto,
  WorkflowRunEventDto,
  WorkflowStepAttemptDto,
} from "./types";

export const WORKFLOW_RUN_INSPECTION_CAPABILITIES = {
  revision: "workflow_versions.get@2",
  run: "workflow_runs.get@2",
  attempts: "workflow_step_attempts.list@2",
  events: "workflow_run_events.list@2",
  artifact: "workflow_run_artifacts.get@2",
  usage: "usage_records.list@1",
  valuations: "cost_valuations.list@1",
  summary: "usage_summaries.get@1",
  budgetReservations: "budget_reservations.list@1",
  quotaReservations: "quota_reservations.list@1",
  quotaWaits: "quota_waits.list@1",
  diagnosticTrace: "diagnostic_traces.get@1",
} as const;

export interface WorkflowRunInspectionQueryPlan {
  revision: {
    capability: typeof WORKFLOW_RUN_INSPECTION_CAPABILITIES.revision;
    input: { workflowId: string; revisionId: string };
  } | null;
  run: {
    capability: typeof WORKFLOW_RUN_INSPECTION_CAPABILITIES.run;
    input: { workflowId: string; runId: string };
  };
  attempts: {
    capability: typeof WORKFLOW_RUN_INSPECTION_CAPABILITIES.attempts;
    input: { workflowId: string; runId: string };
  };
  events: {
    capability: typeof WORKFLOW_RUN_INSPECTION_CAPABILITIES.events;
    input: { workflowId: string; runId: string; cursor?: string };
  };
  usage: {
    capability: typeof WORKFLOW_RUN_INSPECTION_CAPABILITIES.usage;
    input: { runId: string; limit: number; cursor?: string };
  };
  valuations: {
    capability: typeof WORKFLOW_RUN_INSPECTION_CAPABILITIES.valuations;
    input: { runId: string; limit: number; cursor?: string };
  };
  summary: {
    capability: typeof WORKFLOW_RUN_INSPECTION_CAPABILITIES.summary;
    input: { runId: string };
  };
  budgetReservations: {
    capability: typeof WORKFLOW_RUN_INSPECTION_CAPABILITIES.budgetReservations;
    input: { runId: string };
  };
  quotaReservations: {
    capability: typeof WORKFLOW_RUN_INSPECTION_CAPABILITIES.quotaReservations;
    input: { runId: string; limit: number };
  };
  quotaWaits: {
    capability: typeof WORKFLOW_RUN_INSPECTION_CAPABILITIES.quotaWaits;
    input: { runId: string; limit: number };
  };
}

function requiredIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new TypeError(`${label} is invalid.`);
  }
  return normalized;
}

function optionalCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_048) {
    throw new TypeError("Inspection cursor is invalid.");
  }
  return normalized;
}

/**
 * Describes the canonical reads used by the Cockpit. It intentionally does
 * not execute or aggregate them: every read still crosses the shared
 * Capability Entrypoint and therefore rechecks current authorization.
 */
export function workflowRunInspectionQueryPlan(input: {
  workflowId: string;
  runId: string;
  workflowRevisionId?: string;
  eventCursor?: string;
  usageCursor?: string;
  valuationCursor?: string;
  pageSize?: number;
}): WorkflowRunInspectionQueryPlan {
  const workflowId = requiredIdentifier(input.workflowId, "Workflow ID");
  const runId = requiredIdentifier(input.runId, "Workflow Run ID");
  const revisionId = input.workflowRevisionId === undefined
    ? undefined
    : requiredIdentifier(input.workflowRevisionId, "Workflow Revision ID");
  const pageSize = input.pageSize ?? 50;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new TypeError("Inspection page size is invalid.");
  }
  const eventCursor = optionalCursor(input.eventCursor);
  const usageCursor = optionalCursor(input.usageCursor);
  const valuationCursor = optionalCursor(input.valuationCursor);

  return {
    revision: revisionId
      ? {
          capability: WORKFLOW_RUN_INSPECTION_CAPABILITIES.revision,
          input: { workflowId, revisionId },
        }
      : null,
    run: {
      capability: WORKFLOW_RUN_INSPECTION_CAPABILITIES.run,
      input: { workflowId, runId },
    },
    attempts: {
      capability: WORKFLOW_RUN_INSPECTION_CAPABILITIES.attempts,
      input: { workflowId, runId },
    },
    events: {
      capability: WORKFLOW_RUN_INSPECTION_CAPABILITIES.events,
      input: { workflowId, runId, ...(eventCursor ? { cursor: eventCursor } : {}) },
    },
    usage: {
      capability: WORKFLOW_RUN_INSPECTION_CAPABILITIES.usage,
      input: { runId, limit: pageSize, ...(usageCursor ? { cursor: usageCursor } : {}) },
    },
    valuations: {
      capability: WORKFLOW_RUN_INSPECTION_CAPABILITIES.valuations,
      input: { runId, limit: pageSize, ...(valuationCursor ? { cursor: valuationCursor } : {}) },
    },
    summary: {
      capability: WORKFLOW_RUN_INSPECTION_CAPABILITIES.summary,
      input: { runId },
    },
    budgetReservations: {
      capability: WORKFLOW_RUN_INSPECTION_CAPABILITIES.budgetReservations,
      input: { runId },
    },
    quotaReservations: {
      capability: WORKFLOW_RUN_INSPECTION_CAPABILITIES.quotaReservations,
      input: { runId, limit: pageSize },
    },
    quotaWaits: {
      capability: WORKFLOW_RUN_INSPECTION_CAPABILITIES.quotaWaits,
      input: { runId, limit: pageSize },
    },
  };
}

export interface WorkflowRunArtifactMembership {
  artifactId: string;
  roles: Array<"input" | "output" | "reused_output" | "lineage_context">;
}

function stableInspectionJson(value: unknown): string {
  const normalized = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalized);
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalized(child)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalized(value));
}

/** Returns only Artifact IDs proven by retained Run evidence. */
export function workflowRunArtifactMembership(input: {
  run: WorkflowRunDto;
  attempts: WorkflowStepAttemptDto[];
  usageRecords?: UsageRecord[];
}): WorkflowRunArtifactMembership[] {
  const roles = new Map<string, Set<WorkflowRunArtifactMembership["roles"][number]>>();
  const add = (
    artifactId: string | null | undefined,
    role: WorkflowRunArtifactMembership["roles"][number],
  ) => {
    if (!artifactId) return;
    const found = roles.get(artifactId) ?? new Set();
    found.add(role);
    roles.set(artifactId, found);
  };

  for (const reference of input.run.startSnapshot.artifactReferences) {
    add(reference.artifactId, "input");
  }
  for (const attempt of input.attempts) {
    if (attempt.runId !== input.run.id) continue;
    for (const attemptInput of attempt.inputs) {
      add(attemptInput.artifactId, "input");
    }
    for (const output of Object.values(attempt.outputs ?? {})) {
      add(output.artifactId, "output");
    }
  }
  for (const output of Object.values(input.run.finalSnapshot?.outputs ?? {})) {
    add(output.artifactId, "output");
  }
  for (const reused of input.run.derivation?.reusedOutputs ?? []) {
    for (const output of Object.values(reused.outputs)) {
      add(output.artifactId, "reused_output");
    }
  }
  for (const record of input.usageRecords ?? []) {
    if (record.binding.runId !== input.run.id) continue;
    add(record.directArtifactId, "output");
    for (const artifactId of record.lineageArtifactIds) {
      add(artifactId, "lineage_context");
    }
  }

  return [...roles]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([artifactId, found]) => ({
      artifactId,
      roles: [...found].sort(),
    }));
}

/**
 * Merges retained/live pages without silently hiding gaps or conflicting
 * sequence replays. The canonical Run snapshot remains the state authority;
 * this list is only an ordered progress projection.
 */
export function mergeWorkflowRunEventPages(
  retained: WorkflowRunEventDto[],
  incoming: WorkflowRunEventDto[],
): WorkflowRunEventDto[] {
  const bySequence = new Map<number, WorkflowRunEventDto>();
  for (const event of [...retained, ...incoming]) {
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
      throw new TypeError("Workflow Run event sequence is invalid.");
    }
    const prior = bySequence.get(event.sequence);
    if (prior && stableInspectionJson(prior) !== stableInspectionJson(event)) {
      throw new TypeError("Workflow Run event sequence conflicts.");
    }
    bySequence.set(event.sequence, event);
  }
  const merged = [...bySequence.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  for (let index = 1; index < merged.length; index += 1) {
    if (merged[index]!.sequence !== merged[index - 1]!.sequence + 1) {
      throw new TypeError("Workflow Run event page contains a sequence gap.");
    }
  }
  return merged;
}

export function artifactUsageContext(
  records: UsageRecord[],
  artifactId: string,
): {
  direct: UsageRecord[];
  lineageContext: UsageRecord[];
} {
  const direct: UsageRecord[] = [];
  const lineageContext: UsageRecord[] = [];
  for (const record of records) {
    if (record.directArtifactId === artifactId) {
      direct.push(record);
    } else if (record.lineageArtifactIds.includes(artifactId)) {
      lineageContext.push(record);
    }
  }
  return { direct, lineageContext };
}

export function costValuationEvidence(values: CostValuation[]): {
  known: CostValuation[];
  unknown: CostValuation[];
} {
  const known: CostValuation[] = [];
  const unknown: CostValuation[] = [];
  for (const value of values) {
    const exactNoEffectCost =
      value.basis === "effect_not_created" &&
      value.pricingSource === "effect_not_created" &&
      value.amount === "0";
    if (
      !exactNoEffectCost &&
      (value.basis === "unknown" ||
        value.pricingSource === "unknown" ||
        value.amount === null ||
        value.currency === null)
    ) {
      unknown.push(value);
    } else {
      known.push(value);
    }
  }
  return { known, unknown };
}

export type RunReservationEvidence =
  | { kind: "budget"; reservation: BudgetReservation }
  | { kind: "quota"; reservation: QuotaReservation };

/**
 * Keeps reservations as evidence rows. The Cockpit must not add currencies,
 * quota dimensions, scopes, or overlapping reservation layers together.
 */
export function runReservationEvidence(input: {
  runId: string;
  budget: BudgetReservation[];
  quota: QuotaReservation[];
}): RunReservationEvidence[] {
  return [
    ...input.budget
      .filter((reservation) => reservation.runId === input.runId)
      .map((reservation) => ({ kind: "budget" as const, reservation })),
    ...input.quota
      .filter((reservation) => reservation.runId === input.runId)
      .map((reservation) => ({ kind: "quota" as const, reservation })),
  ];
}

export function diagnosticTraceQuery(input: {
  operatorTraceRef: string;
  operatorGrantId: string;
}) {
  if (!/^otr_[a-f0-9]{32}$/.test(input.operatorTraceRef)) {
    throw new TypeError("Operator Trace Reference is invalid.");
  }
  return {
    capability: WORKFLOW_RUN_INSPECTION_CAPABILITIES.diagnosticTrace,
    input: {
      operatorTraceRef: input.operatorTraceRef,
      operatorGrantId: requiredIdentifier(input.operatorGrantId, "Operator Grant ID"),
    },
  } as const;
}
