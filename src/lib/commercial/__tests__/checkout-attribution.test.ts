import { describe, expect, it } from "vitest";
import { checkoutPurchaseAttribution } from "../checkout";

describe("merchant checkout attribution producer", () => {
  it("emits a replay-stable completed-purchase command from signed merchant facts", () => {
    expect(checkoutPurchaseAttribution({ workspaceId: "workspace-1", userId: "user-1", email: "person@example.com", amountMinor: 1299, currency: "usd", occurredAt: new Date("2026-09-04T12:00:00.000Z"), provider: "merchant", providerEventId: "event-1" })).toEqual({ workspaceId: "workspace-1", userId: "user-1", email: "person@example.com", eventName: "purchase", occurredAt: new Date("2026-09-04T12:00:00.000Z"), value: "12.99", currency: "USD", idempotencyKey: "xads:purchase:merchant:event-1" });
  });
});
