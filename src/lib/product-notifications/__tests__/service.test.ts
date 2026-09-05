import { describe, expect, it } from "vitest";
import { renderBillingNotification } from "@/i18n/notifications";
import { billingNotificationEventType, notificationIdempotencyKey, notificationRetryDelayMs } from "../service";

describe("workspace billing notifications", () => {
  it("maps only approved customer-relevant financial transitions", () => {
    expect(billingNotificationEventType({ action: "refund", status: "approved" }, "partially_refunded")).toBe("billing.refund_applied");
    expect(billingNotificationEventType({ action: "credit_reverse", status: "approved" }, "completed")).toBe("billing.refund_reversed");
    expect(billingNotificationEventType({ action: "chargeback", status: "approved" }, "disputed")).toBe("billing.dispute_opened");
    expect(billingNotificationEventType({ action: "chargeback_reverse", status: "approved" }, "chargeback_reversed")).toBe("billing.dispute_resolved");
    expect(billingNotificationEventType({ action: "refund", status: "rejected" }, "completed")).toBeNull();
  });

  it("uses authored English and Arabic templates with the same interpolation contract", () => {
    const facts = { amountMinor: 1250, refundedMinor: 1250, currency: "USD", transactionRef: "txn_123", outstandingCredits: 4, executionHold: "active" as const };
    const en = renderBillingNotification("en", "workspace-notifications/v1", "billing.dispute_opened", facts);
    const ar = renderBillingNotification("ar", "workspace-notifications/v1", "billing.dispute_opened", facts);
    expect(en).toMatchObject({ title: "A billing dispute needs attention", actionLabel: "Open billing" });
    expect(en.body).toContain("txn_123");
    expect(ar).toMatchObject({ title: "نزاع فوترة يحتاج إلى تدخلك", actionLabel: "فتح الفوترة" });
    expect(ar.body).toContain("\u2068txn_123\u2069");
    expect(ar.body).toContain("نشط");
  });

  it("keeps all email retries inside the provider idempotency window", () => {
    expect(notificationRetryDelayMs(0)).toBe(60_000);
    expect(notificationRetryDelayMs(1)).toBe(120_000);
    expect(notificationRetryDelayMs(99)).toBe(1_800_000);
    expect(Array.from({ length: 8 }, (_, attempt) => notificationRetryDelayMs(attempt)).reduce((sum, value) => sum + value, 0)).toBeLessThan(24 * 60 * 60_000);
  });

  it("keeps the provider idempotency key stable across lease attempts", () => {
    const recipient = { workspaceId: "workspace_1", eventId: "event_1", userId: "user_1" };
    const firstAttempt = { ...recipient, attempt: 1, leaseOwner: "lease_a" };
    const finalAttempt = { ...recipient, attempt: 8, leaseOwner: "lease_b" };
    expect(notificationIdempotencyKey(firstAttempt)).toBe(notificationIdempotencyKey(finalAttempt));
  });
});
