import { describe, expect, it } from "vitest";
import { workflowRunWorkerId } from "../worker-identity";

describe("workflowRunWorkerId", () => {
  it("is stable across SDK retries and valid as an internal worker ID", () => {
    const first = workflowRunWorkerId("sdk-step/with:opaque characters");
    const retry = workflowRunWorkerId("sdk-step/with:opaque characters");
    expect(retry).toBe(first);
    expect(first).toMatch(/^worker_[a-f0-9]{64}$/);
    expect(first.length).toBeLessThanOrEqual(200);
  });
});
