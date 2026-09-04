CREATE TABLE "channel_onboarding_offer_versions" (
  "offer_id" text NOT NULL, "version" integer NOT NULL, "platform" "social_platform" NOT NULL, "status" text NOT NULL,
  "authored_name" jsonb NOT NULL, "authored_description" jsonb NOT NULL, "supported_regions" jsonb NOT NULL,
  "customer_requirements" jsonb NOT NULL, "max_partner_hours" integer NOT NULL, "local_price_minor" bigint NOT NULL,
  "currency" text NOT NULL, "tax_mode" text NOT NULL, "terms_digest" text NOT NULL, "compliance_policy_version" text NOT NULL,
  "effective_at" timestamptz NOT NULL, "retired_at" timestamptz, "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "channel_onboarding_offer_versions_pk" PRIMARY KEY("offer_id","version"),
  CONSTRAINT "channel_onboarding_offer_versions_values_check" CHECK ("version">0 AND "status" IN ('draft','active','retired') AND "max_partner_hours" BETWEEN 0 AND 100 AND "local_price_minor">=0 AND "currency" ~ '^[A-Z]{3}$' AND "tax_mode"='inclusive' AND "terms_digest" ~ '^sha256:[a-f0-9]{64}$' AND jsonb_array_length("supported_regions")>0)
);
--> statement-breakpoint
CREATE INDEX "channel_onboarding_offer_versions_active_idx" ON "channel_onboarding_offer_versions"("status","platform","effective_at");
--> statement-breakpoint
CREATE TABLE "channel_onboarding_partners" (
  "id" text PRIMARY KEY, "legal_name" text NOT NULL, "status" text NOT NULL, "supported_platforms" jsonb NOT NULL,
  "supported_regions" jsonb NOT NULL, "vetting_digest" text NOT NULL, "policy_version" text NOT NULL,
  "effective_at" timestamptz NOT NULL, "expires_at" timestamptz NOT NULL, "revoked_at" timestamptz, "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "channel_onboarding_partners_values_check" CHECK ("status" IN ('vetted','suspended','revoked') AND "vetting_digest" ~ '^sha256:[a-f0-9]{64}$' AND "expires_at">"effective_at" AND jsonb_array_length("supported_platforms")>0 AND jsonb_array_length("supported_regions")>0)
);
--> statement-breakpoint
CREATE INDEX "channel_onboarding_partners_eligibility_idx" ON "channel_onboarding_partners"("status","expires_at");
--> statement-breakpoint
CREATE TABLE "channel_onboarding_commercial_quotes" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "id" text NOT NULL, "purpose_ref" text NOT NULL,
  "offer_id" text NOT NULL, "offer_version" integer NOT NULL, "state" text NOT NULL, "subtotal_minor" bigint NOT NULL,
  "tax_minor" bigint NOT NULL, "total_minor" bigint NOT NULL, "currency" text NOT NULL, "terms_digest" text NOT NULL,
  "issued_at" timestamptz NOT NULL, "expires_at" timestamptz NOT NULL, "accepted_by_user_id" text REFERENCES "user"("id") ON DELETE restrict,
  "accepted_at" timestamptz, "merchant_payment_ref" text, "merchant_refund_ref" text,
  CONSTRAINT "channel_onboarding_commercial_quotes_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "channel_onboarding_commercial_quotes_offer_fk" FOREIGN KEY("offer_id","offer_version") REFERENCES "channel_onboarding_offer_versions"("offer_id","version") ON DELETE restrict,
  CONSTRAINT "channel_onboarding_commercial_quotes_values_check" CHECK ("state" IN ('offered','accepted','payment_pending','paid','refunded','cancelled','failed','expired') AND "subtotal_minor">=0 AND "tax_minor">=0 AND "total_minor"="subtotal_minor"+"tax_minor" AND "currency" ~ '^[A-Z]{3}$' AND "terms_digest" ~ '^sha256:[a-f0-9]{64}$' AND "expires_at">"issued_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "channel_onboarding_commercial_quotes_purpose_unique" ON "channel_onboarding_commercial_quotes"("workspace_id","purpose_ref");
--> statement-breakpoint
CREATE INDEX "channel_onboarding_commercial_quotes_state_idx" ON "channel_onboarding_commercial_quotes"("workspace_id","state","expires_at");
--> statement-breakpoint
CREATE TABLE "channel_onboarding_orders" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "id" text NOT NULL,
  "offer_id" text NOT NULL, "offer_version" integer NOT NULL, "platform" "social_platform" NOT NULL, "region" text NOT NULL,
  "state" text NOT NULL, "revision" integer DEFAULT 1 NOT NULL, "quote_id" text, "credential_profile_id" text REFERENCES "credential_profiles"("id") ON DELETE restrict,
  "connected_social_account_id" text REFERENCES "social_accounts"("id") ON DELETE restrict, "compliance_evidence_digest" text NOT NULL,
  "blocked_reason_code" text, "created_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE restrict,
  "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL,
  CONSTRAINT "channel_onboarding_orders_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "channel_onboarding_orders_offer_fk" FOREIGN KEY("offer_id","offer_version") REFERENCES "channel_onboarding_offer_versions"("offer_id","version") ON DELETE restrict,
  CONSTRAINT "channel_onboarding_orders_quote_fk" FOREIGN KEY("workspace_id","quote_id") REFERENCES "channel_onboarding_commercial_quotes"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "channel_onboarding_orders_state_check" CHECK ("state" IN ('draft','quoted','payment_pending','accepted','customer_action','partner_action','readiness_review','ready_to_connect','connected','blocked','cancelled','refunded','failed') AND "revision">0 AND "compliance_evidence_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX "channel_onboarding_orders_state_cursor_idx" ON "channel_onboarding_orders"("workspace_id","state","updated_at","id");
--> statement-breakpoint
CREATE TABLE "channel_onboarding_partner_assignments" (
  "workspace_id" text NOT NULL, "id" text NOT NULL, "order_id" text NOT NULL, "partner_id" text NOT NULL REFERENCES "channel_onboarding_partners"("id") ON DELETE restrict,
  "purpose" text NOT NULL, "scope" jsonb NOT NULL, "starts_at" timestamptz NOT NULL, "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz, "assigned_by_user_id" text REFERENCES "user"("id") ON DELETE restrict, "created_at" timestamptz NOT NULL,
  CONSTRAINT "channel_onboarding_partner_assignments_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "channel_onboarding_partner_assignments_order_fk" FOREIGN KEY("workspace_id","order_id") REFERENCES "channel_onboarding_orders"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "channel_onboarding_partner_assignments_values_check" CHECK ("purpose" IN ('guided_setup','readiness_review','support') AND "expires_at">"starts_at" AND ("expires_at"-"starts_at")<=interval '14 days' AND "scope" ?& array['permittedActions','orderId','platform','region'] AND NOT ("scope"->'permittedActions' ?| array['credential.read','credential.write','publish','impersonate']))
);
--> statement-breakpoint
CREATE INDEX "channel_onboarding_partner_assignments_active_idx" ON "channel_onboarding_partner_assignments"("workspace_id","order_id","expires_at");
--> statement-breakpoint
CREATE TABLE "channel_onboarding_tasks" (
  "workspace_id" text NOT NULL, "id" text NOT NULL, "order_id" text NOT NULL, "assignment_id" text,
  "actor_kind" text NOT NULL, "kind" text NOT NULL, "status" text NOT NULL, "instructions" jsonb NOT NULL,
  "evidence_digest" text, "due_at" timestamptz, "completed_at" timestamptz, "created_at" timestamptz NOT NULL,
  CONSTRAINT "channel_onboarding_tasks_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "channel_onboarding_tasks_order_fk" FOREIGN KEY("workspace_id","order_id") REFERENCES "channel_onboarding_orders"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "channel_onboarding_tasks_assignment_fk" FOREIGN KEY("workspace_id","assignment_id") REFERENCES "channel_onboarding_partner_assignments"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "channel_onboarding_tasks_values_check" CHECK ("actor_kind" IN ('customer','partner','system') AND "status" IN ('open','completed','cancelled') AND ("evidence_digest" IS NULL OR "evidence_digest" ~ '^sha256:[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE INDEX "channel_onboarding_tasks_order_idx" ON "channel_onboarding_tasks"("workspace_id","order_id","status","created_at");
--> statement-breakpoint
CREATE TABLE "channel_onboarding_readiness_reviews" (
  "workspace_id" text NOT NULL, "id" text NOT NULL, "order_id" text NOT NULL, "decision" text NOT NULL,
  "checklist" jsonb NOT NULL, "evidence_digest" text NOT NULL, "reviewer_ref" text NOT NULL, "reviewed_at" timestamptz NOT NULL,
  CONSTRAINT "channel_onboarding_readiness_reviews_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "channel_onboarding_readiness_reviews_order_fk" FOREIGN KEY("workspace_id","order_id") REFERENCES "channel_onboarding_orders"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "channel_onboarding_readiness_reviews_values_check" CHECK ("decision" IN ('ready','customer_action','partner_action','blocked') AND "evidence_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX "channel_onboarding_readiness_reviews_order_idx" ON "channel_onboarding_readiness_reviews"("workspace_id","order_id","reviewed_at");
--> statement-breakpoint
CREATE TABLE "channel_onboarding_credential_handoffs" (
  "workspace_id" text NOT NULL, "id" text NOT NULL, "order_id" text NOT NULL,
  "credential_profile_id" text NOT NULL REFERENCES "credential_profiles"("id") ON DELETE restrict, "profile_version" integer NOT NULL,
  "provider" text NOT NULL, "handed_off_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE restrict, "handed_off_at" timestamptz NOT NULL,
  CONSTRAINT "channel_onboarding_credential_handoffs_pk" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "channel_onboarding_credential_handoffs_order_fk" FOREIGN KEY("workspace_id","order_id") REFERENCES "channel_onboarding_orders"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "channel_onboarding_credential_handoffs_order_version_unique" UNIQUE("workspace_id","order_id","profile_version"),
  CONSTRAINT "channel_onboarding_credential_handoffs_version_check" CHECK ("profile_version">0)
);
--> statement-breakpoint
CREATE TABLE "channel_onboarding_events" (
  "workspace_id" text NOT NULL, "order_id" text NOT NULL, "revision" integer NOT NULL, "id" text NOT NULL,
  "from_state" text, "to_state" text NOT NULL, "actor_ref" text NOT NULL, "reason_code" text NOT NULL, "facts" jsonb NOT NULL, "occurred_at" timestamptz NOT NULL,
  CONSTRAINT "channel_onboarding_events_pk" PRIMARY KEY("workspace_id","order_id","revision"),
  CONSTRAINT "channel_onboarding_events_order_fk" FOREIGN KEY("workspace_id","order_id") REFERENCES "channel_onboarding_orders"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "channel_onboarding_events_id_unique" UNIQUE("workspace_id","id"), CONSTRAINT "channel_onboarding_events_revision_check" CHECK ("revision">0)
);
--> statement-breakpoint
CREATE TABLE "channel_onboarding_command_receipts" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict, "idempotency_key" text NOT NULL,
  "request_digest" text NOT NULL, "result" jsonb NOT NULL, "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "channel_onboarding_command_receipts_pk" PRIMARY KEY("workspace_id","idempotency_key"),
  CONSTRAINT "channel_onboarding_command_receipts_digest_check" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
