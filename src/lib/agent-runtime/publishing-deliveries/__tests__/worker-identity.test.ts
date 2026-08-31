import { describe, expect, it } from "vitest";
import { publishingDeliveryWorkerId } from "../worker-identity";

describe("Publishing Delivery worker identity", () => {
  it("is stable per durable step and rejects missing identity", () => {
    expect(publishingDeliveryWorkerId("step_1")).toBe(
      publishingDeliveryWorkerId("step_1"),
    );
    expect(publishingDeliveryWorkerId("step_1")).not.toBe(
      publishingDeliveryWorkerId("step_2"),
    );
    expect(() => publishingDeliveryWorkerId("")).toThrow();
  });
});
