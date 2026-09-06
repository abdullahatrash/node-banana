CREATE TABLE "model_fallback_authorizations" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "id" text NOT NULL, "revision" integer NOT NULL,
  "status" text NOT NULL, "authorization" jsonb NOT NULL, "source_provider" text NOT NULL, "source_model" text NOT NULL, "capability" text NOT NULL,
  "max_total_cost_usd" numeric(12,6) NOT NULL, "issued_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE restrict,
  "issued_at" timestamp with time zone NOT NULL, "expires_at" timestamp with time zone NOT NULL, "revoked_at" timestamp with time zone,
  CONSTRAINT "model_fallback_authorizations_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "model_fallback_authorizations_revision_check" CHECK ("revision" > 0 and "status" in ('active','revoked') and "max_total_cost_usd" > 0)
);
--> statement-breakpoint
CREATE INDEX "model_fallback_authorizations_active_idx" ON "model_fallback_authorizations"("workspace_id", "status", "expires_at");
--> statement-breakpoint
CREATE TABLE "generation_intents" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "id" text NOT NULL, "intent" jsonb NOT NULL,
  "brand_profile_id" text NOT NULL, "brand_revision" integer NOT NULL, "prompt_digest" text NOT NULL,
  "selected_provider" text NOT NULL, "selected_model" text NOT NULL, "reservation_id" text NOT NULL,
  "created_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE restrict, "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "generation_intents_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "generation_intents_digest_check" CHECK ("prompt_digest" ~ '^sha256:[a-f0-9]{64}$' and "brand_revision" > 0)
);
--> statement-breakpoint
CREATE INDEX "generation_intents_brand_idx" ON "generation_intents"("workspace_id", "brand_profile_id", "brand_revision");
--> statement-breakpoint
CREATE TABLE "model_routing_mutation_receipts" (
  "workspace_id" text NOT NULL, "idempotency_key" text NOT NULL, "request_digest" text NOT NULL,
  "resource_kind" text NOT NULL, "resource_id" text NOT NULL, "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "model_routing_mutation_receipts_pk" PRIMARY KEY("workspace_id", "idempotency_key"),
  CONSTRAINT "model_routing_mutation_receipts_digest_check" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$' and "resource_kind" in ('fallback_authorization','generation_intent') and length("idempotency_key") between 8 and 200)
);
--> statement-breakpoint
CREATE TABLE "replicate_prediction_identities" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "intent_id" text NOT NULL,
  "prediction_id" text NOT NULL, "model" jsonb NOT NULL, "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "replicate_prediction_identities_pk" PRIMARY KEY("workspace_id", "intent_id"),
  CONSTRAINT "replicate_prediction_identities_intent_fk" FOREIGN KEY("workspace_id", "intent_id") REFERENCES "generation_intents"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "replicate_prediction_identities_prediction_unique" UNIQUE("prediction_id"),
  CONSTRAINT "replicate_prediction_identities_prediction_check" CHECK (length("prediction_id") between 1 and 200)
);
