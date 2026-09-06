CREATE TABLE "model_fallback_spend_reservations" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "authorization_id" text NOT NULL,
  "intent_id" text NOT NULL,
  "amount_usd" numeric(12,6) NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "released_at" timestamp with time zone,
  CONSTRAINT "model_fallback_spend_reservations_pk" PRIMARY KEY("workspace_id", "authorization_id", "intent_id"),
  CONSTRAINT "model_fallback_spend_reservations_grant_fk" FOREIGN KEY("workspace_id", "authorization_id") REFERENCES "model_fallback_authorizations"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "model_fallback_spend_reservations_intent_unique" UNIQUE("workspace_id", "intent_id"),
  CONSTRAINT "model_fallback_spend_reservations_status_check" CHECK("amount_usd" > 0 AND "status" IN ('held','released'))
);
--> statement-breakpoint
CREATE INDEX "model_fallback_spend_reservations_active_idx" ON "model_fallback_spend_reservations"("workspace_id", "authorization_id", "status");
--> statement-breakpoint
CREATE TABLE "model_provider_effect_claims" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "intent_id" text NOT NULL,
  "provider" text NOT NULL,
  "state" text NOT NULL,
  "claim_token" text NOT NULL,
  "prediction_id" text,
  "claimed_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "model_provider_effect_claims_pk" PRIMARY KEY("workspace_id", "intent_id"),
  CONSTRAINT "model_provider_effect_claims_intent_fk" FOREIGN KEY("workspace_id", "intent_id") REFERENCES "generation_intents"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "model_provider_effect_claims_prediction_unique" UNIQUE("prediction_id"),
  CONSTRAINT "model_provider_effect_claims_state_check" CHECK("provider" = 'replicate' AND "state" IN ('claimed','submitted','outcome_unknown') AND length("claim_token") BETWEEN 16 AND 200)
);
