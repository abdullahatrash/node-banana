ALTER TABLE "generation_credit_ledger_entries" DROP CONSTRAINT "generation_credit_ledger_entries_values_check";
--> statement-breakpoint
ALTER TABLE "generation_credit_ledger_entries" ADD CONSTRAINT "generation_credit_ledger_entries_values_check" CHECK ("sequence" > 0 and "entry_type" in ('grant','purchase','referral_reward','reserve','release','settle','refund','expire','clawback','clawback_reverse') and "balance_after_units" >= 0);
--> statement-breakpoint
CREATE TABLE "merchant_credit_liabilities" (
  "provider" text NOT NULL,
  "transaction_ref" text NOT NULL,
  "workspace_id" text NOT NULL,
  "bucket_id" text NOT NULL,
  "target_clawback_units" bigint NOT NULL,
  "applied_clawback_units" bigint NOT NULL,
  "outstanding_units" bigint NOT NULL,
  "state" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "merchant_credit_liabilities_pk" PRIMARY KEY("provider", "transaction_ref"),
  CONSTRAINT "merchant_credit_liabilities_transaction_fk" FOREIGN KEY ("provider", "transaction_ref") REFERENCES "public"."merchant_billing_transactions"("provider", "transaction_ref") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "merchant_credit_liabilities_bucket_fk" FOREIGN KEY ("workspace_id", "bucket_id") REFERENCES "public"."generation_credit_buckets"("workspace_id", "id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "merchant_credit_liabilities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "merchant_credit_liabilities_values_check" CHECK ("target_clawback_units" >= 0 and "applied_clawback_units" >= 0 and "outstanding_units" >= 0 and "target_clawback_units" = "applied_clawback_units" + "outstanding_units" and (("state" = 'open' and "outstanding_units" > 0) or ("state" = 'clear' and "outstanding_units" = 0)))
);
--> statement-breakpoint
CREATE INDEX "merchant_credit_liabilities_workspace_idx" ON "merchant_credit_liabilities" USING btree ("workspace_id", "state", "updated_at");
