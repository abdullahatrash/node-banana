CREATE TABLE "merchant_adjustment_webhook_receipts" (
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "payload_digest" text NOT NULL,
  "adjustment_ref" text NOT NULL,
  "transaction_ref" text NOT NULL,
  "merchant_subscription_ref" text,
  "merchant_customer_ref" text NOT NULL,
  "action" text NOT NULL,
  "status" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "reason" text NOT NULL,
  "state" text NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 12 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "last_error_code" text,
  "provider_occurred_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "processed_at" timestamp with time zone,
  CONSTRAINT "merchant_adjustment_webhook_receipts_pk" PRIMARY KEY("provider", "event_id"),
  CONSTRAINT "merchant_adjustment_webhook_receipts_values_check" CHECK ("payload_digest" ~ '^sha256:[a-f0-9]{64}$' and "action" in ('credit','refund','chargeback','chargeback_reverse','chargeback_warning','chargeback_warning_reverse','credit_reverse') and "status" in ('pending_approval','approved','rejected','reversed') and "amount_minor" >= 0 and "currency" ~ '^[A-Z]{3}$' and octet_length("reason") between 1 and 4096 and "state" in ('received','pending_dependency','processing','applied','failed_known','outcome_unknown') and "max_attempts" between 1 and 50 and "attempt" between 0 and "max_attempts" and (("state" = 'processing' and "lease_owner" is not null and "lease_expires_at" is not null) or ("state" <> 'processing' and "lease_owner" is null and "lease_expires_at" is null)))
);
--> statement-breakpoint
CREATE INDEX "merchant_adjustment_webhook_receipts_transaction_idx" ON "merchant_adjustment_webhook_receipts" USING btree ("provider", "transaction_ref", "state", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX "merchant_adjustment_webhook_receipts_due_idx" ON "merchant_adjustment_webhook_receipts" USING btree ("next_attempt_at", "provider", "event_id") WHERE "state" in ('received','pending_dependency','processing');
