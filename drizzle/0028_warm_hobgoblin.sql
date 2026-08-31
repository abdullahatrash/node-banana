ALTER TABLE "credential_spend_events" RENAME COLUMN "amount_cents" TO "price_ceiling_cents";--> statement-breakpoint
ALTER TABLE "credential_spend_events" DROP CONSTRAINT "credential_spend_events_amount_check";--> statement-breakpoint
ALTER TABLE "credential_spend_grants" DROP CONSTRAINT "credential_spend_grants_spent_check";--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "safe_result" jsonb;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "unknown_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "reconciliation_reference" text;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "credential_spend_events"
SET
	"status" = 'unknown',
	"failure_code" = 'LEGACY_RECEIPT_REQUIRES_RECONCILIATION',
	"unknown_at" = "created_at",
	"updated_at" = "created_at";--> statement-breakpoint
CREATE INDEX "credential_spend_events_grant_status_created_idx" ON "credential_spend_events" USING btree ("spend_grant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "credential_spend_events_reconciliation_idx" ON "credential_spend_events" USING btree ("workspace_id","status","unknown_at") WHERE "credential_spend_events"."status" in ('pending', 'unknown');--> statement-breakpoint
ALTER TABLE "credential_spend_grants" DROP COLUMN "spent_cents";--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_status_check" CHECK ("credential_spend_events"."status" in ('pending', 'completed', 'failed', 'unknown'));--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_state_check" CHECK ((
        ("credential_spend_events"."status" = 'pending'
          and "credential_spend_events"."safe_result" is null
          and "credential_spend_events"."failure_code" is null
          and "credential_spend_events"."completed_at" is null
          and "credential_spend_events"."failed_at" is null
          and "credential_spend_events"."unknown_at" is null)
        or
        ("credential_spend_events"."status" = 'completed'
          and "credential_spend_events"."safe_result" is not null
          and "credential_spend_events"."failure_code" is null
          and "credential_spend_events"."completed_at" is not null
          and "credential_spend_events"."failed_at" is null)
        or
        ("credential_spend_events"."status" = 'failed'
          and "credential_spend_events"."safe_result" is null
          and "credential_spend_events"."failure_code" is not null
          and "credential_spend_events"."completed_at" is null
          and "credential_spend_events"."failed_at" is not null
          and "credential_spend_events"."unknown_at" is null)
        or
        ("credential_spend_events"."status" = 'unknown'
          and "credential_spend_events"."safe_result" is null
          and "credential_spend_events"."failure_code" is not null
          and "credential_spend_events"."completed_at" is null
          and "credential_spend_events"."failed_at" is null
          and "credential_spend_events"."unknown_at" is not null)
      ));--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_failure_code_check" CHECK ("credential_spend_events"."failure_code" is null or "credential_spend_events"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,79}$');--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_safe_result_size_check" CHECK ("credential_spend_events"."safe_result" is null or octet_length("credential_spend_events"."safe_result"::text) <= 65536);--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_safe_result_redaction_check" CHECK ("credential_spend_events"."safe_result" is null or "credential_spend_events"."safe_result"::text !~* '"[^"]*(secret|token|password|ciphertext)[^"]*"\s*:');--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_reconciliation_check" CHECK (("credential_spend_events"."reconciliation_reference" is null and "credential_spend_events"."reconciled_at" is null)
        or ("credential_spend_events"."reconciliation_reference" is not null and "credential_spend_events"."reconciled_at" is not null));--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_amount_check" CHECK ("credential_spend_events"."price_ceiling_cents" >= 0);
