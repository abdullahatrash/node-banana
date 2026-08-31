import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { operationalMetricsSink } from "./observability/production";
import type {
  OperationalMetricDeltaInput,
  OperationalMetricDimension,
} from "./observability/types";

type ProviderFamily = Extract<
  OperationalMetricDimension,
  { key: "provider_family" }
>["value"];
type OperationFamily = Extract<
  OperationalMetricDimension,
  { key: "operation_family" }
>["value"];
type QuotaBoundary = Extract<
  OperationalMetricDimension,
  { key: "boundary" }
>["value"];

function minuteWindow(at: Date): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 60_000) };
}

function metricEventId(kind: string, canonicalEventId: string): string {
  return `ome_${canonicalDigest({ kind, canonicalEventId }).slice(7, 39)}`;
}

async function emit(
  input: Omit<
    OperationalMetricDeltaInput,
    "eventId" | "windowStartsAt" | "windowEndsAt"
  > & { kind: string; canonicalEventId: string },
): Promise<void> {
  const { startsAt, endsAt } = minuteWindow(input.recordedAt);
  try {
    await operationalMetricsSink.emit({
      workspaceId: input.workspaceId,
      eventId: metricEventId(input.kind, input.canonicalEventId),
      name: input.name,
      dimensions: input.dimensions,
      windowStartsAt: startsAt,
      windowEndsAt: endsAt,
      countDelta: input.countDelta,
      sumDelta: input.sumDelta,
      recordedAt: input.recordedAt,
    });
  } catch {
    // Operational metrics never alter the already-committed canonical result.
  }
}

export function emitRunStatusMetric(input: {
  workspaceId: string;
  canonicalEventId: string;
  status: "accepted" | "waiting" | "completed" | "failed" | "outcome_unknown";
  recordedAt: Date;
}): Promise<void> {
  return emit({
    ...input,
    kind: `run:${input.status}`,
    name: "runtime.run.count",
    dimensions: [{ key: "status", value: input.status }],
    countDelta: 1,
    sumDelta: 1,
  });
}

export function emitProviderEffectMetric(input: {
  workspaceId: string;
  canonicalEventId: string;
  outcome: "succeeded" | "failed_known" | "outcome_unknown";
  providerFamily: ProviderFamily;
  operationFamily: OperationFamily;
  recordedAt: Date;
}): Promise<void> {
  return emit({
    ...input,
    kind: `provider:${input.outcome}`,
    name: "runtime.provider.effect.count",
    dimensions: [
      { key: "outcome", value: input.outcome },
      { key: "boundary", value: "provider_effect" },
      { key: "provider_family", value: input.providerFamily },
      { key: "operation_family", value: input.operationFamily },
    ],
    countDelta: 1,
    sumDelta: 1,
  });
}

export function emitQuotaDecisionMetric(input: {
  workspaceId: string;
  canonicalEventId: string;
  boundary: QuotaBoundary;
  outcome: "succeeded" | "denied" | "wait";
  reasonFamily: "capacity" | "policy" | "suspension" | "unknown";
  recordedAt: Date;
}): Promise<void> {
  return emit({
    ...input,
    kind: `quota:${input.outcome}`,
    name: "runtime.quota.decision.count",
    dimensions: [
      { key: "outcome", value: input.outcome },
      { key: "boundary", value: input.boundary },
      { key: "reason_family", value: input.reasonFamily },
    ],
    countDelta: 1,
    sumDelta: 1,
  });
}

export function emitArtifactBytesMetric(input: {
  workspaceId: string;
  canonicalEventId: string;
  sizeBytes: number;
  recordedAt: Date;
}): Promise<void> {
  return emit({
    ...input,
    kind: "artifact:bytes",
    name: "runtime.artifact.bytes",
    dimensions: [
      { key: "boundary", value: "artifact_storage" },
      { key: "operation_family", value: "storage" },
    ],
    countDelta: 1,
    sumDelta: input.sizeBytes,
  });
}

export function emitQueueWaitMetric(input: {
  workspaceId: string;
  canonicalEventId: string;
  durationMs: number;
  recordedAt: Date;
}): Promise<void> {
  return emit({
    ...input,
    kind: "queue:wait",
    name: "runtime.queue.wait_ms",
    dimensions: [
      { key: "boundary", value: "run_concurrency" },
      { key: "outcome", value: "wait" },
    ],
    countDelta: 1,
    sumDelta: Math.max(0, Math.round(input.durationMs)),
  });
}

export function providerFamily(value: string): ProviderFamily {
  const normalized = value.toLowerCase();
  if (normalized === "google" || normalized === "gemini") return "google";
  if (normalized === "openai") return "openai";
  if (normalized === "kie") return "kie";
  if (normalized === "internal") return "internal";
  return "unknown";
}

export function operationFamily(value: string): OperationFamily {
  const normalized = value.toLowerCase();
  for (const family of ["text", "image", "audio", "video"] as const) {
    if (normalized.includes(family)) return family;
  }
  return normalized.includes("workflow") ? "workflow" : "unknown";
}

export function quotaReasonFamily(
  reasonCodes: readonly string[],
): "capacity" | "policy" | "suspension" | "unknown" {
  if (reasonCodes.includes("EMERGENCY_SPEND_SUSPENDED")) return "suspension";
  if (reasonCodes.includes("QUOTA_POLICY_UNAVAILABLE")) return "policy";
  if (reasonCodes.includes("QUOTA_CAPACITY_EXHAUSTED")) return "capacity";
  return "unknown";
}
