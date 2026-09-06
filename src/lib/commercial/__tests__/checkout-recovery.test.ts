import { describe, expect, it } from "vitest";

import { checkoutRecoveryDelayMs } from "../checkout";

describe("merchant checkout recovery backoff", () => {
  it("advances pending sessions without monopolizing the oldest page", () => {
    expect(checkoutRecoveryDelayMs(0, "pending")).toBe(15_000);
    expect(checkoutRecoveryDelayMs(1, "pending")).toBe(30_000);
    expect(checkoutRecoveryDelayMs(4, "pending")).toBe(240_000);
  });

  it("backs off provider outages and caps every retry", () => {
    expect(checkoutRecoveryDelayMs(0, "unavailable")).toBe(60_000);
    expect(checkoutRecoveryDelayMs(2, "error")).toBe(240_000);
    expect(checkoutRecoveryDelayMs(100, "error")).toBe(900_000);
  });
});
