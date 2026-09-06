import { beforeEach, describe, expect, it, vi } from "vitest";

const { start } = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("workflow/api", () => ({ start }));

import { DurableOnboardingQueue } from "../durable-queue";

describe("DurableOnboardingQueue", () => {
  beforeEach(() => start.mockReset());

  it("retains the dispatch failure while logging only safe diagnostics", async () => {
    const error = Object.assign(new Error("private source text and credentials"), { code: "QUEUE_UNAVAILABLE", status: 503 });
    start.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(new DurableOnboardingQueue().schedule({ workspaceId: "ws_1", runId: "run_1" })).rejects.toBe(error);
      expect(log).toHaveBeenCalledWith("[onboarding] Workflow dispatch failed", expect.objectContaining({ code: "QUEUE_UNAVAILABLE", status: 503 }));
      expect(JSON.stringify(log.mock.calls)).not.toContain(error.message);
    } finally { log.mockRestore(); }
  });

  it("starts the durable workflow with only server-owned identifiers", async () => {
    const queue = new DurableOnboardingQueue();
    await queue.schedule({ workspaceId: "ws_1", runId: "run_1" });

    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][1]).toEqual([{ workspaceId: "ws_1", runId: "run_1" }]);
  });
});
