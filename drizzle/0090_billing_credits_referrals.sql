CREATE TABLE "billing_plan_versions" (
  "plan_id" text NOT NULL, "version" integer NOT NULL, "status" text NOT NULL, "authored_name" jsonb NOT NULL,
  "currency" text NOT NULL, "price_minor" bigint NOT NULL, "billing_interval" text NOT NULL, "tax_mode" text NOT NULL,
  "trial_days" integer NOT NULL, "trial_credit_units" bigint NOT NULL, "entitlements" jsonb NOT NULL, "terms_digest" text NOT NULL,
  "effective_at" timestamptz NOT NULL, "retired_at" timestamptz, "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "billing_plan_versions_pk" PRIMARY KEY("plan_id","version"),
  CONSTRAINT "billing_plan_versions_values_check" CHECK ("version">0 AND "status" IN ('draft','active','retired') AND "currency" ~ '^[A-Z]{3}$' AND "price_minor">=0 AND "billing_interval" IN ('month','year','one_time') AND "tax_mode" IN ('inclusive','exclusive') AND "trial_days" BETWEEN 0 AND 90 AND "trial_credit_units">=0 AND "terms_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX "billing_plan_versions_active_idx" ON "billing_plan_versions"("status","effective_at");
--> statement-breakpoint
CREATE TABLE "billing_trial_grants" (
  "id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "beneficiary_identity_digest" text NOT NULL UNIQUE, "plan_id" text NOT NULL, "plan_version" integer NOT NULL,
  "status" text NOT NULL, "granted_at" timestamptz NOT NULL, "expires_at" timestamptz NOT NULL, "consumed_at" timestamptz,
  CONSTRAINT "billing_trial_grants_plan_fk" FOREIGN KEY("plan_id","plan_version") REFERENCES "billing_plan_versions"("plan_id","version") ON DELETE restrict,
  CONSTRAINT "billing_trial_grants_digest_check" CHECK ("beneficiary_identity_digest" ~ '^sha256:[a-f0-9]{64}$' AND "status" IN ('active','consumed','expired','revoked') AND "expires_at">"granted_at")
);
--> statement-breakpoint
CREATE INDEX "billing_trial_grants_workspace_idx" ON "billing_trial_grants"("workspace_id","status");
--> statement-breakpoint
CREATE TABLE "workspace_subscriptions" (
  "workspace_id" text PRIMARY KEY REFERENCES "workspaces"("id") ON DELETE restrict, "state" text NOT NULL,
  "plan_id" text NOT NULL, "plan_version" integer NOT NULL, "trial_grant_id" text REFERENCES "billing_trial_grants"("id") ON DELETE restrict,
  "merchant_customer_ref" text, "merchant_subscription_ref" text, "current_period_starts_at" timestamptz NOT NULL,
  "current_period_ends_at" timestamptz NOT NULL, "grace_ends_at" timestamptz, "revision" integer DEFAULT 1 NOT NULL, "updated_at" timestamptz NOT NULL,
  CONSTRAINT "workspace_subscriptions_plan_fk" FOREIGN KEY("plan_id","plan_version") REFERENCES "billing_plan_versions"("plan_id","version") ON DELETE restrict,
  CONSTRAINT "workspace_subscriptions_state_check" CHECK ("state" IN ('trialing','active','past_due','grace','cancel_at_period_end','cancelled','suspended') AND "revision">0 AND "current_period_ends_at">"current_period_starts_at" AND ("grace_ends_at" IS NULL OR "grace_ends_at">="current_period_ends_at"))
);
--> statement-breakpoint
CREATE INDEX "workspace_subscriptions_state_idx" ON "workspace_subscriptions"("state","current_period_ends_at");
--> statement-breakpoint
CREATE TABLE "workspace_subscription_events" (
  "workspace_id" text NOT NULL, "revision" integer NOT NULL, "id" text NOT NULL UNIQUE, "from_state" text, "to_state" text NOT NULL,
  "reason_code" text NOT NULL, "actor_ref" text NOT NULL, "facts" jsonb NOT NULL, "occurred_at" timestamptz NOT NULL,
  CONSTRAINT "workspace_subscription_events_pk" PRIMARY KEY("workspace_id","revision"),
  CONSTRAINT "workspace_subscription_events_subscription_fk" FOREIGN KEY("workspace_id") REFERENCES "workspace_subscriptions"("workspace_id") ON DELETE restrict,
  CONSTRAINT "workspace_subscription_events_state_check" CHECK ("revision">0 AND "to_state" IN ('trialing','active','past_due','grace','cancel_at_period_end','cancelled','suspended'))
);
--> statement-breakpoint
CREATE TABLE "managed_execution_commercial_quotes" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "id" text NOT NULL, "purpose_ref" text NOT NULL,
  "state" text NOT NULL, "max_credit_debit" bigint NOT NULL, "local_price_minor" bigint, "currency" text, "tax_minor" bigint,
  "pricing_snapshot_digest" text NOT NULL, "issued_at" timestamptz NOT NULL, "expires_at" timestamptz NOT NULL,
  "accepted_by_user_id" text REFERENCES "user"("id") ON DELETE restrict, "accepted_at" timestamptz,
  CONSTRAINT "managed_execution_commercial_quotes_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "managed_execution_commercial_quotes_values_check" CHECK ("state" IN ('offered','accepted','reserved','settled','released','outcome_unknown','expired') AND "max_credit_debit">0 AND "pricing_snapshot_digest" ~ '^sha256:[a-f0-9]{64}$' AND "expires_at">"issued_at" AND (("currency" IS NULL AND "local_price_minor" IS NULL AND "tax_minor" IS NULL) OR ("currency" ~ '^[A-Z]{3}$' AND "local_price_minor">=0 AND "tax_minor">=0)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "managed_execution_commercial_quotes_purpose_unique" ON "managed_execution_commercial_quotes"("workspace_id","purpose_ref");
--> statement-breakpoint
CREATE INDEX "managed_execution_commercial_quotes_state_idx" ON "managed_execution_commercial_quotes"("workspace_id","state","expires_at");
--> statement-breakpoint
CREATE TABLE "generation_credit_buckets" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "id" text NOT NULL, "kind" text NOT NULL,
  "source_ref" text NOT NULL, "granted_units" bigint NOT NULL, "available_units" bigint NOT NULL, "expires_at" timestamptz,
  "revision" integer DEFAULT 1 NOT NULL, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL,
  CONSTRAINT "generation_credit_buckets_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "generation_credit_buckets_values_check" CHECK ("kind" IN ('allowance','purchased','referral') AND "granted_units">=0 AND "available_units" BETWEEN 0 AND "granted_units" AND "revision">0 AND (("kind"='allowance' AND "expires_at" IS NOT NULL) OR "kind"<>'allowance'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "generation_credit_buckets_source_unique" ON "generation_credit_buckets"("workspace_id","kind","source_ref");
--> statement-breakpoint
CREATE INDEX "generation_credit_buckets_spend_order_idx" ON "generation_credit_buckets"("workspace_id","kind","expires_at","created_at","id");
--> statement-breakpoint
CREATE TABLE "generation_credit_reservations" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "id" text NOT NULL, "quote_id" text NOT NULL,
  "state" text NOT NULL, "max_debit_units" bigint NOT NULL, "settled_units" bigint, "allocations" jsonb NOT NULL,
  "external_effect_ref" text, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL,
  CONSTRAINT "generation_credit_reservations_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "generation_credit_reservations_quote_fk" FOREIGN KEY("workspace_id","quote_id") REFERENCES "managed_execution_commercial_quotes"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "generation_credit_reservations_values_check" CHECK ("state" IN ('held','settled','released','outcome_unknown') AND "max_debit_units">0 AND ("settled_units" IS NULL OR "settled_units" BETWEEN 0 AND "max_debit_units"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "generation_credit_reservations_quote_unique" ON "generation_credit_reservations"("workspace_id","quote_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "generation_credit_reservations_effect_unique" ON "generation_credit_reservations"("workspace_id","external_effect_ref");
--> statement-breakpoint
CREATE INDEX "generation_credit_reservations_state_idx" ON "generation_credit_reservations"("workspace_id","state","updated_at");
--> statement-breakpoint
CREATE TABLE "generation_credit_ledger_entries" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "sequence" integer NOT NULL, "id" text NOT NULL,
  "bucket_id" text NOT NULL, "reservation_id" text, "entry_type" text NOT NULL, "delta_units" bigint NOT NULL,
  "balance_after_units" bigint NOT NULL, "source_ref" text NOT NULL, "created_at" timestamptz NOT NULL,
  CONSTRAINT "generation_credit_ledger_entries_pk" PRIMARY KEY("workspace_id","sequence"),
  CONSTRAINT "generation_credit_ledger_entries_bucket_fk" FOREIGN KEY("workspace_id","bucket_id") REFERENCES "generation_credit_buckets"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "generation_credit_ledger_entries_reservation_fk" FOREIGN KEY("workspace_id","reservation_id") REFERENCES "generation_credit_reservations"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "generation_credit_ledger_entries_values_check" CHECK ("sequence">0 AND "entry_type" IN ('grant','purchase','referral_reward','reserve','release','settle','refund','expire','clawback') AND "balance_after_units">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "generation_credit_ledger_entries_id_unique" ON "generation_credit_ledger_entries"("workspace_id","id");
--> statement-breakpoint
CREATE INDEX "generation_credit_ledger_entries_bucket_cursor_idx" ON "generation_credit_ledger_entries"("workspace_id","bucket_id","sequence");
--> statement-breakpoint
CREATE TABLE "commercial_command_receipts" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "idempotency_key" text NOT NULL, "request_digest" text NOT NULL, "result" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "commercial_command_receipts_pk" PRIMARY KEY("workspace_id","idempotency_key"),
  CONSTRAINT "commercial_command_receipts_digest_check" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "workspace_referral_codes" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "id" text NOT NULL, "code" text NOT NULL,
  "reward_mode" text NOT NULL, "status" text NOT NULL, "recipient_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE restrict, "created_at" timestamptz NOT NULL,
  CONSTRAINT "workspace_referral_codes_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "workspace_referral_codes_values_check" CHECK ("reward_mode" IN ('generation_credit','cash') AND "status" IN ('active','paused','closed') AND "code" ~ '^[A-Z0-9-]{6,32}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_referral_codes_code_unique" ON "workspace_referral_codes"("code");
--> statement-breakpoint
CREATE TABLE "referral_attributions" (
  "id" text PRIMARY KEY, "referral_code_id" text NOT NULL, "referrer_workspace_id" text NOT NULL,
  "referred_identity_digest" text NOT NULL, "referred_workspace_id" text REFERENCES "workspaces"("id") ON DELETE restrict,
  "state" text NOT NULL, "attribution_digest" text NOT NULL, "attributed_at" timestamptz NOT NULL, "qualified_at" timestamptz,
  CONSTRAINT "referral_attributions_code_fk" FOREIGN KEY("referrer_workspace_id","referral_code_id") REFERENCES "workspace_referral_codes"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "referral_attributions_values_check" CHECK ("state" IN ('attributed','qualified','rewarded','fraud_hold','refunded','clawed_back','rejected') AND "referred_identity_digest" ~ '^sha256:[a-f0-9]{64}$' AND "attribution_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_attributions_recipient_unique" ON "referral_attributions"("referred_identity_digest");
--> statement-breakpoint
CREATE INDEX "referral_attributions_referrer_idx" ON "referral_attributions"("referrer_workspace_id","state","attributed_at");
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "id" text NOT NULL,
  "attribution_id" text NOT NULL REFERENCES "referral_attributions"("id") ON DELETE restrict, "mode" text NOT NULL, "state" text NOT NULL,
  "credit_units" bigint, "cash_minor" bigint, "currency" text, "threshold_minor" bigint, "tax_evidence_ref" text,
  "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL,
  CONSTRAINT "referral_rewards_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "referral_rewards_values_check" CHECK ("mode" IN ('generation_credit','cash') AND "state" IN ('pending','available','payout_pending','paid','fraud_hold','refunded','clawed_back') AND (("mode"='generation_credit' AND "credit_units">0 AND "cash_minor" IS NULL AND "currency" IS NULL) OR ("mode"='cash' AND "cash_minor">0 AND "currency" ~ '^[A-Z]{3}$' AND "credit_units" IS NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_rewards_attribution_unique" ON "referral_rewards"("attribution_id");
--> statement-breakpoint
CREATE INDEX "referral_rewards_state_idx" ON "referral_rewards"("workspace_id","state","updated_at");
--> statement-breakpoint
CREATE TABLE "referral_payout_ledger_entries" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "sequence" integer NOT NULL, "id" text NOT NULL,
  "reward_id" text NOT NULL, "entry_type" text NOT NULL, "amount_minor" bigint NOT NULL, "currency" text NOT NULL,
  "merchant_payout_ref" text, "tax_evidence_ref" text, "occurred_at" timestamptz NOT NULL,
  CONSTRAINT "referral_payout_ledger_entries_pk" PRIMARY KEY("workspace_id","sequence"),
  CONSTRAINT "referral_payout_ledger_entries_reward_fk" FOREIGN KEY("workspace_id","reward_id") REFERENCES "referral_rewards"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "referral_payout_ledger_entries_values_check" CHECK ("sequence">0 AND "entry_type" IN ('earned','hold','release','paid','refund','clawback') AND "amount_minor"<>0 AND "currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_payout_ledger_entries_id_unique" ON "referral_payout_ledger_entries"("workspace_id","id");
--> statement-breakpoint
CREATE INDEX "referral_payout_ledger_entries_reward_idx" ON "referral_payout_ledger_entries"("workspace_id","reward_id","sequence");
--> statement-breakpoint
CREATE TABLE "referral_fraud_evidence" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "id" text NOT NULL,
  "attribution_id" text NOT NULL REFERENCES "referral_attributions"("id") ON DELETE restrict, "decision" text NOT NULL,
  "policy_version" text NOT NULL, "evidence_digest" text NOT NULL, "reviewer_ref" text NOT NULL, "decided_at" timestamptz NOT NULL,
  CONSTRAINT "referral_fraud_evidence_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "referral_fraud_evidence_values_check" CHECK ("decision" IN ('clear','hold','reject') AND "evidence_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX "referral_fraud_evidence_attribution_idx" ON "referral_fraud_evidence"("workspace_id","attribution_id","decided_at");
