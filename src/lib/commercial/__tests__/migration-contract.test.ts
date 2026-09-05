import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("commercial schema", () => { it("separates plans, trial identity, managed credits, BYOK evidence boundary, referral cash, fraud evidence, and command receipts", () => { const sql = readFileSync("drizzle/0090_billing_credits_referrals.sql", "utf8"); for (const value of ["billing_plan_versions", "beneficiary_identity_digest", "workspace_subscriptions", "managed_execution_commercial_quotes", "generation_credit_buckets", "generation_credit_reservations", "generation_credit_ledger_entries", "commercial_command_receipts", "referral_payout_ledger_entries", "referral_fraud_evidence", "outcome_unknown"]) expect(sql).toContain(value); expect(sql).not.toContain("byok_credit"); }); });
describe("checkout recovery migration", () => { it("leases due sessions and persists backoff progress", () => { const sql = readFileSync("drizzle/0097_checkout_recovery_leases.sql", "utf8"); for (const value of ["recovery_attempts", "next_recovery_at", "recovery_lease_owner", "recovery_lease_expires_at", "last_recovery_status", "due_recovery_idx"]) expect(sql).toContain(value); }); });
describe("merchant subscription lifecycle migration", () => { it("persists ordered provider cursors and replay-safe receipts", () => { const sql = readFileSync("drizzle/0132_merchant_subscription_lifecycle.sql", "utf8"); for (const value of ["merchant_last_event_at", "merchant_last_event_id", "merchant_subscription_webhook_receipts", "provider_occurred_at", "outcome_unknown", "subscription.payment_completed", "subscription.cancel_at_period_end"]) expect(sql).toContain(value); }); });
describe("merchant financial evidence migration", () => { it("keeps merchant transactions, immutable adjustment events, and latest projections separate", () => { const sql = readFileSync("drizzle/0133_merchant_financial_evidence.sql", "utf8"); for (const value of ["merchant_billing_transactions", "merchant_billing_adjustment_events", "merchant_billing_adjustments", "adjustment_events_pk", "transaction_ref", "invoice_number", "refunded_minor", "chargeback_reversed", "provider_occurred_at", "received_at"]) expect(sql).toContain(value); }); });
describe("merchant credit clawback migration", () => { it("tracks applied and outstanding clawbacks and permits reversible ledger evidence", () => { const sql = readFileSync("drizzle/0134_merchant_credit_clawbacks.sql", "utf8"); for (const value of ["merchant_credit_liabilities", "target_clawback_units", "applied_clawback_units", "outstanding_units", "clawback_reverse", "merchant_credit_liabilities_bucket_fk"]) expect(sql).toContain(value); }); });
describe("subscription period financial holds migration", () => {
  it("binds transaction evidence and managed-execution holds to one exact paid period", () => {
    const sql = readFileSync("drizzle/0135_subscription_period_financial_holds.sql", "utf8");
    for (const value of [
      "period_starts_at",
      "period_ends_at",
      "merchant_execution_holds",
      "merchant_subscription_ref",
      "refunded",
      "disputed",
      "active",
      "released",
      "merchant_execution_holds_transaction_fk",
      "merchant_execution_holds_active_period_idx",
    ]) expect(sql).toContain(value);
    expect(sql).toContain('"period_ends_at" > "period_starts_at"');
    expect(sql).toContain("WHERE \"state\" = 'active'");
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b/i);
  });
  it("indexes every execution-hold workspace foreign key, including released history", () => {
    expect(readFileSync("drizzle/0136_execution_hold_workspace_index.sql", "utf8")).toContain("merchant_execution_holds_workspace_idx");
  });
});
describe("workspace seat entitlement migration", () => {
  it("serializes membership inserts and fails closed at the immutable plan limit", () => {
    const sql = readFileSync("drizzle/0144_workspace_seat_entitlement.sql", "utf8");
    for (const value of [
      "enforce_workspace_seat_entitlement",
      "FOR UPDATE",
      "workspaceSeats",
      "PLAN_ENTITLEMENTS_INVALID",
      "PLAN_WORKSPACE_SEAT_LIMIT_REACHED",
      "BEFORE INSERT",
      "cancel_at_period_end",
      "grace_ends_at",
      "clock_timestamp()",
    ]) expect(sql).toContain(value);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b/i);
  });
});
