import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("managed Channel Onboarding schema", () => {
  it("persists every lifecycle, commercial, partner, readiness, vault-handoff, and idempotency boundary", () => {
    const sql = readFileSync("drizzle/0091_managed_channel_onboarding.sql", "utf8");
    for (const value of ["channel_onboarding_offer_versions", "channel_onboarding_commercial_quotes", "channel_onboarding_orders", "customer_action", "partner_action", "readiness_review", "channel_onboarding_partner_assignments", "credential.read", "channel_onboarding_tasks", "channel_onboarding_readiness_reviews", "channel_onboarding_credential_handoffs", "channel_onboarding_events", "channel_onboarding_command_receipts"]) expect(sql).toContain(value);
    expect(sql).not.toContain("password");
  });
});
