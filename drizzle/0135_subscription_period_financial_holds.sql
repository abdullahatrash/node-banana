ALTER TABLE "merchant_billing_transactions" ADD COLUMN "period_starts_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "merchant_billing_transactions" ADD COLUMN "period_ends_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "merchant_billing_transactions" DROP CONSTRAINT "merchant_billing_transactions_values_check";
--> statement-breakpoint
ALTER TABLE "merchant_billing_transactions" ADD CONSTRAINT "merchant_billing_transactions_values_check" CHECK ("purpose_kind" in ('subscription','credit_pack','channel_onboarding','subscription_renewal') and "amount_minor" >= 0 and "refunded_minor" between 0 and "amount_minor" and "currency" ~ '^[A-Z]{3}$' and "status" in ('completed','partially_refunded','refunded','disputed','chargeback_reversed') and (("period_starts_at" is null and "period_ends_at" is null) or ("period_starts_at" is not null and "period_ends_at" > "period_starts_at")));
--> statement-breakpoint
CREATE TABLE "merchant_execution_holds" (
  "provider" text NOT NULL,
  "transaction_ref" text NOT NULL,
  "workspace_id" text NOT NULL,
  "merchant_subscription_ref" text NOT NULL,
  "period_starts_at" timestamp with time zone NOT NULL,
  "period_ends_at" timestamp with time zone NOT NULL,
  "reason" text NOT NULL,
  "state" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "merchant_execution_holds_pk" PRIMARY KEY("provider", "transaction_ref"),
  CONSTRAINT "merchant_execution_holds_transaction_fk" FOREIGN KEY ("provider", "transaction_ref") REFERENCES "public"."merchant_billing_transactions"("provider", "transaction_ref") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "merchant_execution_holds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "merchant_execution_holds_values_check" CHECK ("period_ends_at" > "period_starts_at" and "reason" in ('refunded','disputed') and "state" in ('active','released'))
);
--> statement-breakpoint
CREATE INDEX "merchant_execution_holds_active_period_idx" ON "merchant_execution_holds" USING btree ("workspace_id", "merchant_subscription_ref", "period_starts_at", "period_ends_at") WHERE "state" = 'active';
