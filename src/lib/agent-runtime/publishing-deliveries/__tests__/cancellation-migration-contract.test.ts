import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "drizzle/0049_runtime_publishing_delivery_cancellations.sql",
  ),
  "utf8",
);

describe("Publishing Delivery cancellation migration contract", () => {
  it("backfills every legacy prepared intent conservatively before lifecycle checks", () => {
    const addColumn = migration.indexOf('ADD COLUMN "effect_contact_started_at"');
    const backfill = migration.indexOf('SET "effect_contact_started_at" = "dispatch_started_at"');
    const lifecycle = migration.indexOf(
      'ADD CONSTRAINT "runtime_publishing_deliveries_lifecycle_check"',
    );
    expect(addColumn).toBeGreaterThan(0);
    expect(backfill).toBeGreaterThan(addColumn);
    expect(lifecycle).toBeGreaterThan(backfill);
    expect(migration).toContain('WHERE "intent_digest" IS NOT NULL');
    expect(migration).toContain('DISABLE TRIGGER "runtime_publishing_deliveries_identity_immutable"');
    expect(migration).toContain('ENABLE TRIGGER "runtime_publishing_deliveries_identity_immutable"');
  });

  it("installs intrinsic append-only cancellation and exact authority indexes", () => {
    expect(migration).toContain("runtime_publishing_delivery_cancellations_pk");
    expect(migration).toContain("runtime_publishing_delivery_cancellations_insert_only");
    expect(migration).toContain("runtime_publishing_delivery_cancellation_complete");
    expect(migration).toContain(
      "runtime_publishing_delivery_cancellation_state_complete",
    );
    expect(migration).toContain(
      "Publishing Delivery cancellation ledger is missing or inconsistent",
    );
    for (const index of [
      "runtime_publishing_delivery_cancellations_principal_idx",
      "runtime_publishing_delivery_cancellations_key_idx",
      "runtime_publishing_delivery_cancellations_agent_evidence_idx",
      "runtime_publishing_delivery_cancellations_user_idx",
    ]) expect(migration).toContain(index);
    expect(migration).toContain(
      "sha256:cae0f4b46fca3c38dd014bf2c27b2b8f2a3555d24eb62da60c367e49f2e1554e",
    );
    expect(migration).toContain(
      'jsonb_array_length("runtime_publishing_delivery_cancellations"."authority_grants") = 1',
    );
    expect(migration).toContain(
      '"runtime_publishing_delivery_cancellations"."externally_completed_at_request" is null',
    );
    expect(migration).toContain("Publishing Delivery Human grant evidence is not exact");
  });

  it("requires every publish-to-cancel transition to have its exact ledger row", () => {
    expect(migration).toContain(
      'CREATE FUNCTION "runtime_publishing_delivery_cancellation_state_commit_guard"',
    );
    expect(migration).toContain(
      "WHEN (OLD.desired_state = 'publish' AND NEW.desired_state = 'cancel')",
    );
    expect(migration).toContain("c.state_at_request = OLD.state");
    expect(migration).toContain("e.evidence->>'cancellationId' = c.id");
    expect(migration).toContain("e.evidence->>'actorKind' = c.actor_kind");
    expect(migration).toContain("c.requested_at = e.occurred_at");
    expect(migration).toContain("matching_cancellations <> 1");
  });

  it("guards the contact barrier and the exact one-or-two-event cancellation transitions", () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "runtime_publishing_delivery_event_insert_guard"',
    );
    expect(migration).toContain("NEW.sequence = next_sequence + 1");
    expect(migration).toContain("NEW.type = 'delivery.cancelled'");
    expect(migration).toContain("'CANCELLED_AFTER_EFFECT_CONTACT'");
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "runtime_publishing_delivery_identity_guard"',
    );
    expect(migration).toContain("event_delta NOT IN (1, 2)");
    expect(migration).toContain("'effect_contact_started_at'");
    expect(migration).toContain("Publishing Delivery cancellation desired state is irreversible");
    expect(migration).toContain("Publishing Delivery prevention evidence is incomplete");
    expect(migration).toContain("Publishing Delivery unknown cancellation evidence is incomplete");
  });
});
