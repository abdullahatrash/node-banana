import { beforeEach, describe, expect, it, vi } from "vitest";

const { start } = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("workflow/api", () => ({ start }));

import { DurableOnboardingQueue } from "../durable-queue";

describe("DurableOnboardingQueue", () => {
  beforeEach(() => start.mockReset());

  it("starts the durable workflow with only server-owned identifiers", async () => {
    const queue = new DurableOnboardingQueue();
    await queue.schedule({ workspaceId: "ws_1", runId: "run_1" });

    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][1]).toEqual([{ workspaceId: "ws_1", runId: "run_1" }]);
  });
});
