ALTER TABLE "merchant_checkout_sessions" ADD COLUMN "recovery_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchant_checkout_sessions" ADD COLUMN "next_recovery_at" timestamptz DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchant_checkout_sessions" ADD COLUMN "recovery_lease_owner" text;
--> statement-breakpoint
ALTER TABLE "merchant_checkout_sessions" ADD COLUMN "recovery_lease_expires_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "merchant_checkout_sessions" ADD COLUMN "last_recovery_status" text;
--> statement-breakpoint
ALTER TABLE "merchant_checkout_sessions" DROP CONSTRAINT "merchant_checkout_sessions_values_check";
--> statement-breakpoint
ALTER TABLE "merchant_checkout_sessions" ADD CONSTRAINT "merchant_checkout_sessions_values_check" CHECK (
  "purpose_kind" IN ('subscription','credit_pack','channel_onboarding') AND
  "state" IN ('creating','ready','completed','failed_known','expired','cancelled','outcome_unknown') AND
  "amount_minor">=0 AND "tax_minor">=0 AND "currency" ~ '^[A-Z]{3}$' AND
  "terms_digest" ~ '^sha256:[a-f0-9]{64}$' AND "expires_at">"created_at" AND "recovery_attempts">=0
);
--> statement-breakpoint
DROP INDEX "merchant_checkout_sessions_recovery_idx";
--> statement-breakpoint
CREATE INDEX "merchant_checkout_sessions_due_recovery_idx" ON "merchant_checkout_sessions"("state","next_recovery_at","id");
