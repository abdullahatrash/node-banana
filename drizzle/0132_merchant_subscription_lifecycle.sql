ALTER TABLE "workspace_subscriptions" ADD COLUMN "merchant_last_event_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ADD COLUMN "merchant_last_event_id" text;
--> statement-breakpoint
CREATE TABLE "merchant_subscription_webhook_receipts" (
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "payload_digest" text NOT NULL,
  "event_type" text NOT NULL,
  "workspace_id" text NOT NULL,
  "merchant_subscription_ref" text NOT NULL,
  "merchant_transaction_ref" text,
  "state" text NOT NULL,
  "failure_code" text,
  "provider_occurred_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "processed_at" timestamp with time zone,
  CONSTRAINT "merchant_subscription_webhook_receipts_pk" PRIMARY KEY("provider", "event_id"),
  CONSTRAINT "merchant_subscription_webhook_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "merchant_subscription_webhook_receipts_values_check" CHECK ("payload_digest" ~ '^sha256:[a-f0-9]{64}$' and "event_type" in ('subscription.payment_completed','subscription.active','subscription.grace','subscription.cancel_at_period_end','subscription.cancelled','subscription.suspended') and "state" in ('received','processing','applied','ignored','outcome_unknown'))
);
--> statement-breakpoint
CREATE INDEX "merchant_subscription_webhook_receipts_workspace_idx" ON "merchant_subscription_webhook_receipts" USING btree ("workspace_id", "provider_occurred_at", "event_id");
--> statement-breakpoint
CREATE INDEX "merchant_subscription_webhook_receipts_state_idx" ON "merchant_subscription_webhook_receipts" USING btree ("state", "received_at", "event_id");
