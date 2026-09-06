import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workspace notification migration", () => {
  const sql = readFileSync("drizzle/0138_workspace_product_notifications.sql", "utf8");
  const deliverySql = readFileSync("drizzle/0139_notification_delivery_snapshots.sql", "utf8");
  const expansionSql = readFileSync("drizzle/0141_notification_domain_expansion.sql", "utf8");

  it("separates canonical events, recipient state, and personal preferences", () => {
    for (const table of ["workspace_notification_events", "workspace_notification_recipients", "workspace_notification_preferences"]) expect(sql).toContain(`CREATE TABLE "${table}"`);
    expect(sql).toContain('UNIQUE("workspace_id", "source_ref")');
    expect(sql).toContain('FOREIGN KEY("workspace_id", "event_id")');
    expect(sql).toContain('FOREIGN KEY("workspace_id", "user_id")');
  });

  it("keeps delivery recoverable and terminal ambiguity explicit", () => {
    for (const value of ["pending", "processing", "delivered", "suppressed", "failed_known", "outcome_unknown", "lease_owner", "lease_expires_at", "max_attempts"]) expect(sql).toContain(value);
    const due = sql.match(/CREATE INDEX "workspace_notification_recipients_email_due_idx"[\s\S]*?;/)?.[0];
    expect(due).toContain("WHERE");
    expect(due).toContain("'pending','processing'");
    expect(due).not.toMatch(/'delivered'|'failed_known'|'outcome_unknown'/);
  });

  it("persists semantic facts instead of localized prose or raw merchant payloads", () => {
    expect(sql).toContain('"event_type" text NOT NULL');
    expect(sql).toContain('"facts" jsonb NOT NULL');
    expect(sql).not.toMatch(/translated_(title|body)|raw_payload/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b/i);
  });

  it("snapshots an immutable localized email payload for byte-stable retries", () => {
    for (const column of ["catalog_version", "rendered_title", "rendered_body", "rendered_action_label", "email_action_url", "email_payload_digest"]) expect(deliverySql).toContain(`"${column}"`);
    expect(deliverySql).toContain("'^sha256:[a-f0-9]{64}$'");
    expect(deliverySql).toContain("is null");
    expect(deliverySql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b/i);
  });

  it("expands notifications with permission and source-specific recovery boundaries", () => {
    for (const value of ["required_permission", "channel_email_enabled", "publishing_email_enabled", "credit_email_enabled", "workspace_notification_credit_states", "security.credential_rotated", "channel.consent_expiring", "publishing.approval_requested", "publishing.delivery_outcome_unknown", "credits.exhausted"]) expect(expansionSql).toContain(value);
    for (const index of ["credential_security_events_notification_cursor_idx", "social_events_notification_cursor_idx", "social_accounts_consent_expiry_idx", "runtime_publishing_approval_requests_notification_cursor_idx", "runtime_publishing_approval_decisions_notification_cursor_idx", "runtime_publishing_delivery_events_notification_cursor_idx"]) expect(expansionSql).toContain(index);
    expect(expansionSql).toContain("octet_length(\"source_ref\") between 1 and 500");
    expect(expansionSql).toContain("event_type\" like 'security.%'");
    expect(expansionSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b/i);
  });
});
