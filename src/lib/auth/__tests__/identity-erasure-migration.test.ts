import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("identity erasure receipt migration", () => {
  it("retains only bounded pseudonymous completion evidence", () => {
    const migration = readFileSync(
      "drizzle/0142_identity_erasure_receipts.sql",
      "utf8",
    );

    for (const value of [
      'CREATE TABLE "identity_erasure_receipts"',
      '"user_id" text PRIMARY KEY',
      '"receipt_id" text NOT NULL',
      '"request_digest" text NOT NULL',
      '"result" jsonb NOT NULL',
      "ON DELETE RESTRICT",
      "octet_length",
      "identity_erasure_receipts_values_check",
    ]) {
      expect(migration).toContain(value);
    }

    expect(migration).not.toMatch(/\b(email|name|ip_address|user_agent)\b/i);
    expect(migration).not.toMatch(/ON DELETE CASCADE/i);
  });

  it("makes receipts rewrite-proof and rejects restored auth or membership state", () => {
    const migration = readFileSync(
      "drizzle/0143_identity_erasure_guards.sql",
      "utf8",
    );

    for (const value of [
      'CREATE TRIGGER "identity_erasure_receipts_immutable"',
      'BEFORE UPDATE ON "identity_erasure_receipts"',
      'CREATE FUNCTION "reject_erased_identity_access_state"()',
      'FROM "user"',
      "FOR KEY SHARE",
      'FROM "identity_erasure_receipts"',
      'CREATE TRIGGER "account_reject_erased_identity"',
      'CREATE TRIGGER "session_reject_erased_identity"',
      'CREATE TRIGGER "member_reject_erased_identity"',
      'CREATE TRIGGER "workspace_members_reject_erased_identity"',
    ]) {
      expect(migration).toContain(value);
    }

    expect(migration).not.toMatch(/BEFORE DELETE ON "identity_erasure_receipts"/i);
  });
});
