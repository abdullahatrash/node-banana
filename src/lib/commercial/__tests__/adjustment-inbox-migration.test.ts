import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("merchant adjustment inbox migration", () => {
  const sql = readFileSync("drizzle/0137_merchant_adjustment_inbox.sql", "utf8");

  it("retains a normalized, replay-safe receipt before projecting its financial effect", () => {
    for (const value of [
      "merchant_adjustment_webhook_receipts",
      "provider",
      "event_id",
      "payload_digest",
      "adjustment_ref",
      "transaction_ref",
      "merchant_subscription_ref",
      "merchant_customer_ref",
      "action",
      "status",
      "amount_minor",
      "currency",
      "reason",
      "provider_occurred_at",
      "received_at",
    ]) expect(sql).toContain(value);

    expect(sql).toContain('PRIMARY KEY("provider", "event_id")');
    expect(sql).toContain("'^sha256:[a-f0-9]{64}$'");
    expect(sql).not.toMatch(/"(raw_)?payload"\s+jsonb/i);
  });

  it("models dependency waits, leased recovery, and terminal outcomes explicitly", () => {
    for (const state of [
      "received",
      "pending_dependency",
      "processing",
      "applied",
      "failed_known",
      "outcome_unknown",
    ]) expect(sql).toContain(`'${state}'`);

    for (const value of [
      "attempt",
      "max_attempts",
      "next_attempt_at",
      "lease_owner",
      "lease_expires_at",
      "last_error_code",
      "processed_at",
    ]) expect(sql).toContain(value);

    expect(sql).toMatch(/"attempt"\s+BETWEEN\s+0\s+AND\s+"max_attempts"/i);
    expect(sql).toMatch(/"state"\s*=\s*'processing'[\s\S]*"lease_owner"\s+IS\s+NOT\s+NULL[\s\S]*"lease_expires_at"\s+IS\s+NOT\s+NULL/i);
  });

  it("has a partial due-work index instead of indexing terminal history", () => {
    const dueIndex = sql.match(/CREATE\s+INDEX\s+"merchant_adjustment_webhook_receipts_due_idx"[\s\S]*?;/i)?.[0];
    expect(dueIndex).toMatch(/WHERE\s+"state"\s+IN\s*\([^)]*'received'[^)]*'pending_dependency'[^)]*'processing'[^)]*\)/i);
    expect(dueIndex).not.toMatch(/'applied'|'failed_known'|'outcome_unknown'/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b/i);
  });
});
