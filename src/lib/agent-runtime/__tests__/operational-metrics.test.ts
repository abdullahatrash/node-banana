import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEmit = vi.fn(async (_input: unknown) => undefined);

vi.mock("@/lib/agent-runtime/observability/production", () => ({
  operationalMetricsSink: { emit: (input: unknown) => mockEmit(input) },
}));

import {
  emitArtifactBytesMetric,
  emitProviderEffectMetric,
  emitQueueWaitMetric,
  emitQuotaDecisionMetric,
  emitRunStatusMetric,
} from "@/lib/agent-runtime/operational-metrics";

const recordedAt = new Date("2026-08-01T12:34:56.789Z");

describe("production operational metric producers", () => {
  beforeEach(() => mockEmit.mockClear());

  it("uses minute buckets, deterministic event identities, and no high-cardinality dimensions", async () => {
    const emitAll = async () => {
      await emitRunStatusMetric({
        workspaceId: "workspace-secret-id",
        canonicalEventId: "run-secret-id",
        status: "completed",
        recordedAt,
      });
      await emitProviderEffectMetric({
        workspaceId: "workspace-secret-id",
        canonicalEventId: "attempt-secret-id",
        outcome: "failed_known",
        providerFamily: "openai",
        operationFamily: "text",
        recordedAt,
      });
      await emitQuotaDecisionMetric({
        workspaceId: "workspace-secret-id",
        canonicalEventId: "wait-secret-id",
        boundary: "provider_effect",
        outcome: "wait",
        reasonFamily: "capacity",
        recordedAt,
      });
      await emitArtifactBytesMetric({
        workspaceId: "workspace-secret-id",
        canonicalEventId: "artifact-secret-id",
        sizeBytes: 4096,
        recordedAt,
      });
      await emitQueueWaitMetric({
        workspaceId: "workspace-secret-id",
        canonicalEventId: "lease-secret-id",
        durationMs: 1234.4,
        recordedAt,
      });
    };

    await emitAll();
    const first = structuredClone(mockEmit.mock.calls);
    await emitAll();
    const second = mockEmit.mock.calls.slice(first.length);
    expect(second).toEqual(first);

    for (const [input] of first as Array<[Record<string, unknown>]>) {
      expect(input.eventId).toMatch(/^ome_[a-f0-9]{32}$/);
      expect(input.windowStartsAt).toEqual(new Date("2026-08-01T12:34:00.000Z"));
      expect(input.windowEndsAt).toEqual(new Date("2026-08-01T12:35:00.000Z"));
      const dimensions = input.dimensions as Array<{ key: string; value: string }>;
      expect(dimensions.every(({ key }) =>
        [
          "status",
          "outcome",
          "boundary",
          "provider_family",
          "operation_family",
          "reason_family",
        ].includes(key),
      )).toBe(true);
      expect(JSON.stringify(dimensions)).not.toMatch(
        /(workspace-secret-id|run-secret-id|attempt-secret-id|wait-secret-id|artifact-secret-id|lease-secret-id)/,
      );
    }

    // A receipt keyed by the deterministic event identity applies each replay
    // once; the core sink enforces the same contract transactionally.
    const applied = new Set<string>();
    let count = 0;
    for (const [input] of mockEmit.mock.calls as Array<[
      { eventId: string }
    ]>) {
      if (!applied.has(input.eventId)) {
        applied.add(input.eventId);
        count += 1;
      }
    }
    expect(count).toBe(5);
  });

  it("cannot replace a canonical result when the sink throws", async () => {
    mockEmit.mockRejectedValueOnce(new Error("database-secret"));
    await expect(
      emitRunStatusMetric({
        workspaceId: "workspace-safe",
        canonicalEventId: "run-safe",
        status: "failed",
        recordedAt,
      }),
    ).resolves.toBeUndefined();
  });
});
