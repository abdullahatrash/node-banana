CREATE TABLE "merchant_checkout_sessions" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "id" text NOT NULL,
  "purpose_kind" text NOT NULL,
  "purpose_ref" text NOT NULL,
  "state" text NOT NULL,
  "commercial_snapshot" jsonb NOT NULL,
  "amount_minor" bigint NOT NULL,
  "tax_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "terms_digest" text NOT NULL,
  "merchant_checkout_ref" text,
  "merchant_customer_ref" text,
  "merchant_effect_ref" text,
  "created_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE restrict,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "completed_at" timestamptz,
  CONSTRAINT "merchant_checkout_sessions_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "merchant_checkout_sessions_values_check" CHECK (
    "purpose_kind" IN ('subscription','credit_pack','channel_onboarding') AND
    "state" IN ('creating','ready','completed','failed_known','expired','cancelled','outcome_unknown') AND
    "amount_minor">=0 AND "tax_minor">=0 AND "currency" ~ '^[A-Z]{3}$' AND
    "terms_digest" ~ '^sha256:[a-f0-9]{64}$' AND "expires_at">"created_at"
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_checkout_sessions_purpose_unique" ON "merchant_checkout_sessions"("workspace_id","purpose_kind","purpose_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_checkout_sessions_id_unique" ON "merchant_checkout_sessions"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_checkout_sessions_provider_ref_unique" ON "merchant_checkout_sessions"("merchant_checkout_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_checkout_sessions_effect_ref_unique" ON "merchant_checkout_sessions"("merchant_effect_ref");
--> statement-breakpoint
CREATE INDEX "merchant_checkout_sessions_recovery_idx" ON "merchant_checkout_sessions"("state","updated_at","id");
--> statement-breakpoint
CREATE TABLE "merchant_webhook_receipts" (
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "payload_digest" text NOT NULL,
  "event_type" text NOT NULL,
  "checkout_id" text NOT NULL REFERENCES "merchant_checkout_sessions"("id") ON DELETE restrict,
  "merchant_effect_ref" text NOT NULL,
  "state" text NOT NULL,
  "failure_code" text,
  "received_at" timestamptz NOT NULL,
  "processed_at" timestamptz,
  CONSTRAINT "merchant_webhook_receipts_pk" PRIMARY KEY("provider","event_id"),
  CONSTRAINT "merchant_webhook_receipts_values_check" CHECK (
    "payload_digest" ~ '^sha256:[a-f0-9]{64}$' AND "event_type" IN ('checkout.completed','checkout.failed','checkout.expired','checkout.cancelled') AND
    "state" IN ('received','processing','applied','ignored','failed_known','outcome_unknown')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_webhook_receipts_effect_unique" ON "merchant_webhook_receipts"("provider","merchant_effect_ref","event_type");
--> statement-breakpoint
CREATE INDEX "merchant_webhook_receipts_state_idx" ON "merchant_webhook_receipts"("state","received_at","event_id");
--> statement-breakpoint
CREATE TABLE "generation_credit_pack_versions" (
  "pack_id" text NOT NULL,
  "version" integer NOT NULL,
  "status" text NOT NULL,
  "authored_name" jsonb NOT NULL,
  "credit_units" bigint NOT NULL,
  "price_minor" bigint NOT NULL,
  "tax_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "terms_digest" text NOT NULL,
  "effective_at" timestamptz NOT NULL,
  "retired_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "generation_credit_pack_versions_pk" PRIMARY KEY("pack_id","version"),
  CONSTRAINT "generation_credit_pack_versions_values_check" CHECK (
    "version">0 AND "status" IN ('draft','active','retired') AND "credit_units">0 AND
    "price_minor">0 AND "tax_minor">=0 AND "currency" ~ '^[A-Z]{3}$' AND
    "terms_digest" ~ '^sha256:[a-f0-9]{64}$'
  )
);
--> statement-breakpoint
CREATE INDEX "generation_credit_pack_versions_active_idx" ON "generation_credit_pack_versions"("status","effective_at","retired_at");
--> statement-breakpoint
UPDATE "channel_onboarding_offer_versions" AS offer
SET "customer_requirements" = normalized.value
FROM (
  SELECT source."offer_id", source."version", jsonb_agg(
    CASE WHEN jsonb_typeof(item.value) = 'string' THEN jsonb_build_object(
      'key', 'legacy_' || item.ordinality,
      'label', jsonb_build_object('ar', item.value #>> '{}', 'en', item.value #>> '{}'),
      'instructions', jsonb_build_object('ar', item.value #>> '{}', 'en', item.value #>> '{}'),
      'required', true
    ) ELSE item.value END ORDER BY item.ordinality
  ) AS value
  FROM "channel_onboarding_offer_versions" AS source,
  jsonb_array_elements(source."customer_requirements") WITH ORDINALITY AS item(value, ordinality)
  GROUP BY source."offer_id", source."version"
) AS normalized
WHERE offer."offer_id" = normalized."offer_id" AND offer."version" = normalized."version";
