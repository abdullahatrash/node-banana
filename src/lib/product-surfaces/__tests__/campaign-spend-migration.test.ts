import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(process.cwd(), "drizzle/0099_campaign_cumulative_spend_reservations.sql"), "utf8");

describe("campaign cumulative spend migration", () => {
  it("pins one immutable reservation to every occurrence before submission", () => {
    expect(migration).toContain('CREATE TABLE "product_campaign_spend_reservations"');
    expect(migration).toContain('PRIMARY KEY("workspace_id", "occurrence_id")');
    expect(migration).toContain('REFERENCES "product_campaign_occurrences"("workspace_id", "id") ON DELETE RESTRICT');
    expect(migration).toContain("product_campaign_spend_reservation_identity_immutable");
  });

  it("retains exact money, credit, pricing and ambiguous outcome facts", () => {
    for (const field of ["quoted_amount_cents", "reserved_credit_units", "credit_unit_price_usd", "actual_amount_cents", "actual_credit_units"]) expect(migration).toContain(`"${field}"`);
    expect(migration).toContain("'held','settled','released','outcome_unknown'");
  });
});
