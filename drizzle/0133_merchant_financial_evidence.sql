CREATE TABLE "merchant_billing_transactions" (
  "provider" text NOT NULL,
  "transaction_ref" text NOT NULL,
  "workspace_id" text NOT NULL,
  "checkout_id" text,
  "purpose_kind" text NOT NULL,
  "merchant_customer_ref" text NOT NULL,
  "merchant_subscription_ref" text,
  "merchant_receipt_ref" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "refunded_minor" bigint DEFAULT 0 NOT NULL,
  "currency" text NOT NULL,
  "invoice_number" text,
  "status" text NOT NULL,
  "provider_occurred_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "merchant_billing_transactions_pk" PRIMARY KEY("provider", "transaction_ref"),
  CONSTRAINT "merchant_billing_transactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "merchant_billing_transactions_values_check" CHECK ("purpose_kind" in ('subscription','credit_pack','channel_onboarding','subscription_renewal') and "amount_minor" >= 0 and "refunded_minor" between 0 and "amount_minor" and "currency" ~ '^[A-Z]{3}$' and "status" in ('completed','partially_refunded','refunded','disputed','chargeback_reversed'))
);
--> statement-breakpoint
CREATE INDEX "merchant_billing_transactions_workspace_idx" ON "merchant_billing_transactions" USING btree ("workspace_id", "provider_occurred_at", "transaction_ref");
--> statement-breakpoint
CREATE INDEX "merchant_billing_transactions_subscription_idx" ON "merchant_billing_transactions" USING btree ("provider", "merchant_subscription_ref", "provider_occurred_at");
--> statement-breakpoint
CREATE TABLE "merchant_billing_adjustment_events" (
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "adjustment_ref" text NOT NULL,
  "workspace_id" text NOT NULL,
  "transaction_ref" text NOT NULL,
  "merchant_subscription_ref" text,
  "merchant_customer_ref" text NOT NULL,
  "action" text NOT NULL,
  "status" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "reason" text NOT NULL,
  "provider_occurred_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  CONSTRAINT "merchant_billing_adjustment_events_pk" PRIMARY KEY("provider", "event_id"),
  CONSTRAINT "merchant_billing_adjustment_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "merchant_billing_adjustment_events_values_check" CHECK ("action" in ('credit','refund','chargeback','chargeback_reverse','chargeback_warning','chargeback_warning_reverse','credit_reverse') and "status" in ('pending_approval','approved','rejected','reversed') and "amount_minor" >= 0 and "currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE INDEX "merchant_billing_adjustment_events_adjustment_idx" ON "merchant_billing_adjustment_events" USING btree ("provider", "adjustment_ref", "provider_occurred_at", "event_id");
--> statement-breakpoint
CREATE INDEX "merchant_billing_adjustment_events_transaction_idx" ON "merchant_billing_adjustment_events" USING btree ("provider", "transaction_ref", "provider_occurred_at", "event_id");
--> statement-breakpoint
CREATE TABLE "merchant_billing_adjustments" (
  "provider" text NOT NULL,
  "adjustment_ref" text NOT NULL,
  "event_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "transaction_ref" text NOT NULL,
  "merchant_subscription_ref" text,
  "merchant_customer_ref" text NOT NULL,
  "action" text NOT NULL,
  "status" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "reason" text NOT NULL,
  "provider_occurred_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "merchant_billing_adjustments_pk" PRIMARY KEY("provider", "adjustment_ref"),
  CONSTRAINT "merchant_billing_adjustments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "merchant_billing_adjustments_values_check" CHECK ("action" in ('credit','refund','chargeback','chargeback_reverse','chargeback_warning','chargeback_warning_reverse','credit_reverse') and "status" in ('pending_approval','approved','rejected','reversed') and "amount_minor" >= 0 and "currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE INDEX "merchant_billing_adjustments_transaction_idx" ON "merchant_billing_adjustments" USING btree ("provider", "transaction_ref", "provider_occurred_at");
