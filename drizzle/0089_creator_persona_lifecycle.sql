CREATE TABLE "creator_personas" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "kind" text NOT NULL,
  "state" text NOT NULL,
  "name" text NOT NULL,
  "content_language" text NOT NULL,
  "arabic_variety" text,
  "disclosure" text NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "reusable_model_ref" text,
  "retention_until" timestamp with time zone NOT NULL,
  "suspended_reason_code" text,
  "created_by_user_id" text NOT NULL,
  "updated_by_user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "creator_personas_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "creator_personas_kind_check" CHECK ("kind" in ('synthetic','consented_likeness')),
  CONSTRAINT "creator_personas_state_check" CHECK ("state" in ('draft','consent_review','ready_to_train','training','review','active','training_failed','suspended','consent_expired','deleted')),
  CONSTRAINT "creator_personas_locale_check" CHECK ("content_language" in ('ar','en') and ("arabic_variety" is null or "arabic_variety" in ('msa','gulf','egyptian','levantine','maghrebi'))),
  CONSTRAINT "creator_personas_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "creator_persona_evidence" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "persona_id" text NOT NULL,
  "persona_revision" integer NOT NULL,
  "type" text NOT NULL,
  "issuer" text NOT NULL,
  "subject_digest" text NOT NULL,
  "scope" jsonb NOT NULL,
  "evidence_digest" text NOT NULL,
  "provider" text,
  "provider_policy_version" text,
  "effective_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "verified_by_user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "creator_persona_evidence_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "creator_persona_evidence_type_check" CHECK ("type" in ('likeness_consent','provider_acceptance','disclosure_review','abuse_review')),
  CONSTRAINT "creator_persona_evidence_digest_check" CHECK ("subject_digest" ~ '^sha256:[a-f0-9]{64}$' and "evidence_digest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "creator_persona_evidence_window_check" CHECK ("expires_at" > "effective_at")
);
--> statement-breakpoint
CREATE TABLE "creator_persona_training_sources" (
  "workspace_id" text NOT NULL,
  "persona_id" text NOT NULL,
  "asset_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "asset_checksum" text NOT NULL,
  "consent_evidence_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "creator_persona_training_sources_pk" PRIMARY KEY("workspace_id", "persona_id", "asset_id"),
  CONSTRAINT "creator_persona_training_sources_ordinal_check" CHECK ("ordinal" >= 0),
  CONSTRAINT "creator_persona_training_sources_checksum_check" CHECK ("asset_checksum" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "creator_persona_training_jobs" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "persona_id" text NOT NULL,
  "persona_revision" integer NOT NULL,
  "state" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "model_version" text NOT NULL,
  "qualification_digest" text NOT NULL,
  "provider_acceptance_evidence_id" text NOT NULL,
  "operation_id" text NOT NULL,
  "provider_job_ref" text,
  "result_model_ref" text,
  "failure_code" text,
  "requested_by_user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "creator_persona_training_jobs_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "creator_persona_training_jobs_state_check" CHECK ("state" in ('queued','admitted','running','waiting_provider','succeeded','failed_known','outcome_unknown','cancelled')),
  CONSTRAINT "creator_persona_training_jobs_digest_check" CHECK ("qualification_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "creator_persona_usages" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "persona_id" text NOT NULL,
  "persona_revision" integer NOT NULL,
  "purpose" text NOT NULL,
  "resource_id" text NOT NULL,
  "consent_evidence_id" text,
  "provider_acceptance_evidence_id" text NOT NULL,
  "disclosure_evidence_id" text NOT NULL,
  "disclosure" text NOT NULL,
  "bound_by_user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "creator_persona_usages_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "creator_persona_usages_purpose_check" CHECK ("purpose" in ('generation','content_set','channel','blitz'))
);
--> statement-breakpoint
CREATE TABLE "creator_persona_events" (
  "workspace_id" text NOT NULL,
  "persona_id" text NOT NULL,
  "revision" integer NOT NULL,
  "id" text NOT NULL,
  "type" text NOT NULL,
  "actor_user_id" text,
  "facts" jsonb NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "creator_persona_events_pk" PRIMARY KEY("workspace_id", "persona_id", "revision"),
  CONSTRAINT "creator_persona_events_id_unique" UNIQUE("workspace_id", "id"),
  CONSTRAINT "creator_persona_events_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "creator_persona_command_receipts" (
  "workspace_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "persona_id" text NOT NULL,
  "result_revision" integer NOT NULL,
  "result" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "creator_persona_command_receipts_pk" PRIMARY KEY("workspace_id", "idempotency_key"),
  CONSTRAINT "creator_persona_command_receipts_digest_check" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$' and "result_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "creator_personas" ADD CONSTRAINT "creator_personas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_personas" ADD CONSTRAINT "creator_personas_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_personas" ADD CONSTRAINT "creator_personas_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_evidence" ADD CONSTRAINT "creator_persona_evidence_persona_fk" FOREIGN KEY ("workspace_id", "persona_id") REFERENCES "public"."creator_personas"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_evidence" ADD CONSTRAINT "creator_persona_evidence_verified_by_user_id_user_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_sources" ADD CONSTRAINT "creator_persona_training_sources_persona_fk" FOREIGN KEY ("workspace_id", "persona_id") REFERENCES "public"."creator_personas"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_sources" ADD CONSTRAINT "creator_persona_training_sources_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_sources" ADD CONSTRAINT "creator_persona_training_sources_evidence_fk" FOREIGN KEY ("workspace_id", "consent_evidence_id") REFERENCES "public"."creator_persona_evidence"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD CONSTRAINT "creator_persona_training_jobs_persona_fk" FOREIGN KEY ("workspace_id", "persona_id") REFERENCES "public"."creator_personas"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD CONSTRAINT "creator_persona_training_jobs_acceptance_fk" FOREIGN KEY ("workspace_id", "provider_acceptance_evidence_id") REFERENCES "public"."creator_persona_evidence"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_training_jobs" ADD CONSTRAINT "creator_persona_training_jobs_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_usages" ADD CONSTRAINT "creator_persona_usages_persona_fk" FOREIGN KEY ("workspace_id", "persona_id") REFERENCES "public"."creator_personas"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_usages" ADD CONSTRAINT "creator_persona_usages_acceptance_fk" FOREIGN KEY ("workspace_id", "provider_acceptance_evidence_id") REFERENCES "public"."creator_persona_evidence"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_usages" ADD CONSTRAINT "creator_persona_usages_disclosure_fk" FOREIGN KEY ("workspace_id", "disclosure_evidence_id") REFERENCES "public"."creator_persona_evidence"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_usages" ADD CONSTRAINT "creator_persona_usages_consent_fk" FOREIGN KEY ("workspace_id", "consent_evidence_id") REFERENCES "public"."creator_persona_evidence"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_usages" ADD CONSTRAINT "creator_persona_usages_bound_by_user_id_user_id_fk" FOREIGN KEY ("bound_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_events" ADD CONSTRAINT "creator_persona_events_persona_fk" FOREIGN KEY ("workspace_id", "persona_id") REFERENCES "public"."creator_personas"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_events" ADD CONSTRAINT "creator_persona_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_command_receipts" ADD CONSTRAINT "creator_persona_command_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "creator_persona_command_receipts" ADD CONSTRAINT "creator_persona_command_receipts_persona_fk" FOREIGN KEY ("workspace_id", "persona_id") REFERENCES "public"."creator_personas"("workspace_id", "id") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "creator_personas_workspace_state_cursor_idx" ON "creator_personas" ("workspace_id", "state", "updated_at", "id");
--> statement-breakpoint
CREATE INDEX "creator_personas_retention_idx" ON "creator_personas" ("state", "retention_until");
--> statement-breakpoint
CREATE INDEX "creator_persona_evidence_active_idx" ON "creator_persona_evidence" ("workspace_id", "persona_id", "type", "expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "creator_persona_training_sources_order_unique" ON "creator_persona_training_sources" ("workspace_id", "persona_id", "ordinal");
--> statement-breakpoint
CREATE UNIQUE INDEX "creator_persona_training_jobs_operation_unique" ON "creator_persona_training_jobs" ("workspace_id", "operation_id");
--> statement-breakpoint
CREATE INDEX "creator_persona_training_jobs_persona_cursor_idx" ON "creator_persona_training_jobs" ("workspace_id", "persona_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "creator_persona_training_jobs_state_cursor_idx" ON "creator_persona_training_jobs" ("workspace_id", "state", "updated_at", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "creator_persona_usages_resource_unique" ON "creator_persona_usages" ("workspace_id", "persona_id", "purpose", "resource_id");
--> statement-breakpoint
CREATE INDEX "creator_persona_usages_resource_idx" ON "creator_persona_usages" ("workspace_id", "purpose", "resource_id");
--> statement-breakpoint
CREATE INDEX "creator_persona_usages_persona_cursor_idx" ON "creator_persona_usages" ("workspace_id", "persona_id", "created_at", "id");
