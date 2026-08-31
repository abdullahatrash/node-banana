import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRecordOperationalTrace = vi.fn();

vi.mock("@/lib/agent-runtime/observability/production", () => ({
  recordOperationalTrace: (...args: unknown[]) =>
    mockRecordOperationalTrace(...args),
}));

import { recordSafeOperationalTrace } from "@/lib/agent-runtime/safe-diagnostics";

const input = {
  workspaceId: "workspace-safe",
  category: "provider" as const,
  severity: "error" as const,
  code: "PROVIDER_FAILED",
  stage: "execution" as const,
  outcome: "failed" as const,
  providerFamily: "openai" as const,
  httpStatus: 500,
  retryable: true,
  durationMs: 12,
  attempt: 1,
  createdAt: new Date("2026-08-01T12:00:00.000Z"),
};

describe("recordSafeOperationalTrace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards only the typed allowlist and returns a persisted opaque ref", async () => {
    mockRecordOperationalTrace.mockResolvedValue(
      "otr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    await expect(recordSafeOperationalTrace(input)).resolves.toBe(
      "otr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(mockRecordOperationalTrace).toHaveBeenCalledWith({
      ...input,
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
    });
  });

  it("returns null for absent, malformed, or unavailable persisted diagnostics", async () => {
    mockRecordOperationalTrace
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("trace_request_digest")
      .mockRejectedValueOnce(new Error("persistence-secret"));

    await expect(Promise.all([
      recordSafeOperationalTrace(input),
      recordSafeOperationalTrace(input),
      recordSafeOperationalTrace(input),
      recordSafeOperationalTrace({ ...input, workspaceId: null }),
    ])).resolves.toEqual([null, null, null, null]);
  });

  it("never calls persistence for a non-allowlisted code", async () => {
    const ref = await recordSafeOperationalTrace({
      ...input,
      code: "prompt secret / provider body",
    });
    expect(ref).toBeNull();
    expect(mockRecordOperationalTrace).not.toHaveBeenCalled();
  });
});
