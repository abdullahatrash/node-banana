CREATE TABLE "referral_recipient_profiles" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE restrict,
  "reward_preference" text NOT NULL,
  "verification_state" text NOT NULL,
  "legal_country" text,
  "payout_currency" text,
  "payout_provider" text,
  "provider_recipient_ref" text,
  "tax_evidence_ref" text,
  "terms_accepted_at" timestamptz,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "referral_recipient_profiles_pk" PRIMARY KEY("workspace_id", "user_id"),
  CONSTRAINT "referral_recipient_profiles_values_check" CHECK (
    "reward_preference" IN ('generation_credit','cash') AND "verification_state" IN ('unconfigured','pending','verified','rejected','suspended') AND "revision" > 0
    AND ("legal_country" IS NULL OR "legal_country" ~ '^[A-Z]{2}$') AND ("payout_currency" IS NULL OR "payout_currency" ~ '^[A-Z]{3}$')
    AND (("verification_state" = 'verified' AND "legal_country" IS NOT NULL AND "payout_currency" IS NOT NULL AND "payout_provider" IS NOT NULL AND "provider_recipient_ref" IS NOT NULL AND "tax_evidence_ref" IS NOT NULL AND "terms_accepted_at" IS NOT NULL) OR "verification_state" <> 'verified')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_recipient_profiles_provider_ref_unique" ON "referral_recipient_profiles"("payout_provider", "provider_recipient_ref");
--> statement-breakpoint
CREATE INDEX "referral_recipient_profiles_state_idx" ON "referral_recipient_profiles"("verification_state", "updated_at");
--> statement-breakpoint
CREATE TABLE "referral_recipient_profile_revisions" (
  "workspace_id" text NOT NULL, "user_id" text NOT NULL, "revision" integer NOT NULL,
  "reward_preference" text NOT NULL, "verification_state" text NOT NULL, "legal_country" text, "payout_currency" text,
  "payout_provider" text, "provider_recipient_ref" text, "tax_evidence_ref" text, "terms_accepted_at" timestamptz,
  "evidence_digest" text NOT NULL, "actor_ref" text NOT NULL, "recorded_at" timestamptz NOT NULL,
  CONSTRAINT "referral_recipient_profile_revisions_pk" PRIMARY KEY("workspace_id", "user_id", "revision"),
  CONSTRAINT "referral_recipient_profile_revisions_profile_fk" FOREIGN KEY("workspace_id", "user_id") REFERENCES "referral_recipient_profiles"("workspace_id", "user_id") ON DELETE restrict,
  CONSTRAINT "referral_recipient_profile_revisions_values_check" CHECK ("revision" > 0 AND "reward_preference" IN ('generation_credit','cash') AND "verification_state" IN ('unconfigured','pending','verified','rejected','suspended') AND "evidence_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "referral_payout_requests" (
  "workspace_id" text NOT NULL, "id" text NOT NULL, "recipient_user_id" text NOT NULL, "profile_revision" integer NOT NULL,
  "state" text NOT NULL, "currency" text NOT NULL, "total_minor" bigint NOT NULL, "merchant_payout_ref" text,
  "evidence_digest" text NOT NULL, "submitted_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL, "paid_at" timestamptz,
  CONSTRAINT "referral_payout_requests_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "referral_payout_requests_profile_revision_fk" FOREIGN KEY("workspace_id", "recipient_user_id", "profile_revision") REFERENCES "referral_recipient_profile_revisions"("workspace_id", "user_id", "revision") ON DELETE restrict,
  CONSTRAINT "referral_payout_requests_values_check" CHECK ("profile_revision" > 0 AND "state" IN ('submitted','processing','action_required','paid','failed_known','outcome_unknown','cancelled') AND "currency" ~ '^[A-Z]{3}$' AND "total_minor" > 0 AND "evidence_digest" ~ '^sha256:[a-f0-9]{64}$' AND (("state" = 'paid' AND "merchant_payout_ref" IS NOT NULL AND "paid_at" IS NOT NULL) OR ("state" <> 'paid' AND "paid_at" IS NULL)))
);
--> statement-breakpoint
CREATE INDEX "referral_payout_requests_state_idx" ON "referral_payout_requests"("workspace_id", "recipient_user_id", "state", "updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_payout_requests_merchant_ref_unique" ON "referral_payout_requests"("merchant_payout_ref");
--> statement-breakpoint
CREATE TABLE "referral_payout_request_rewards" (
  "workspace_id" text NOT NULL, "payout_request_id" text NOT NULL, "reward_id" text NOT NULL, "amount_minor" bigint NOT NULL, "currency" text NOT NULL,
  CONSTRAINT "referral_payout_request_rewards_pk" PRIMARY KEY("workspace_id", "payout_request_id", "reward_id"),
  CONSTRAINT "referral_payout_request_rewards_request_fk" FOREIGN KEY("workspace_id", "payout_request_id") REFERENCES "referral_payout_requests"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "referral_payout_request_rewards_reward_fk" FOREIGN KEY("workspace_id", "reward_id") REFERENCES "referral_rewards"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "referral_payout_request_rewards_values_check" CHECK ("amount_minor" > 0 AND "currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_payout_request_rewards_reward_unique" ON "referral_payout_request_rewards"("workspace_id", "reward_id");
--> statement-breakpoint
CREATE TABLE "referral_payout_events" (
  "workspace_id" text NOT NULL, "payout_request_id" text NOT NULL, "sequence" integer NOT NULL, "id" text NOT NULL,
  "from_state" text, "to_state" text NOT NULL, "event_type" text NOT NULL, "provider_event_ref" text,
  "evidence_digest" text NOT NULL, "occurred_at" timestamptz NOT NULL, "received_at" timestamptz NOT NULL,
  CONSTRAINT "referral_payout_events_pk" PRIMARY KEY("workspace_id", "payout_request_id", "sequence"),
  CONSTRAINT "referral_payout_events_request_fk" FOREIGN KEY("workspace_id", "payout_request_id") REFERENCES "referral_payout_requests"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "referral_payout_events_values_check" CHECK ("sequence" > 0 AND "to_state" IN ('submitted','processing','action_required','paid','failed_known','outcome_unknown','cancelled') AND "event_type" IN ('submitted','processing','action_required','paid','failed_known','outcome_unknown','cancelled') AND "evidence_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_payout_events_id_unique" ON "referral_payout_events"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_payout_events_provider_ref_unique" ON "referral_payout_events"("provider_event_ref");
--> statement-breakpoint
CREATE FUNCTION protect_referral_financial_evidence() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'referral financial evidence is append-only'; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "referral_recipient_profile_revisions_immutable" BEFORE UPDATE OR DELETE ON "referral_recipient_profile_revisions" FOR EACH ROW EXECUTE FUNCTION protect_referral_financial_evidence();
--> statement-breakpoint
CREATE TRIGGER "referral_payout_request_rewards_immutable" BEFORE UPDATE OR DELETE ON "referral_payout_request_rewards" FOR EACH ROW EXECUTE FUNCTION protect_referral_financial_evidence();
--> statement-breakpoint
CREATE TRIGGER "referral_payout_events_immutable" BEFORE UPDATE OR DELETE ON "referral_payout_events" FOR EACH ROW EXECUTE FUNCTION protect_referral_financial_evidence();
