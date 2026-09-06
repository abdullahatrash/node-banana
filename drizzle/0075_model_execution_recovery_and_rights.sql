ALTER TABLE "model_provider_effect_claims" DROP CONSTRAINT "model_provider_effect_claims_state_check";
--> statement-breakpoint
ALTER TABLE "model_provider_effect_claims" ADD COLUMN "provider_status" text NOT NULL DEFAULT 'starting';
ALTER TABLE "model_provider_effect_claims" ADD COLUMN "next_poll_at" timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE "model_provider_effect_claims" ADD COLUMN "poll_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "model_provider_effect_claims" ADD COLUMN "lease_owner" text;
ALTER TABLE "model_provider_effect_claims" ADD COLUMN "lease_expires_at" timestamp with time zone;
ALTER TABLE "model_provider_effect_claims" ADD CONSTRAINT "model_provider_effect_claims_state_check" CHECK("provider" = 'replicate' AND "state" IN ('claimed','submitted','outcome_unknown','succeeded','failed_known','cancelled') AND length("claim_token") BETWEEN 16 AND 200 AND "poll_attempts" >= 0);
--> statement-breakpoint
CREATE INDEX "model_provider_effect_claims_poll_idx" ON "model_provider_effect_claims"("state", "next_poll_at", "lease_expires_at");
--> statement-breakpoint
CREATE TABLE "inspiration_rights_snapshots" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "id" text NOT NULL, "revision" integer NOT NULL, "snapshot" jsonb NOT NULL, "digest" text NOT NULL,
  "basis" text NOT NULL, "permitted_remix" text NOT NULL,
  "created_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE restrict,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "inspiration_rights_snapshots_pk" PRIMARY KEY("workspace_id", "id", "revision"),
  CONSTRAINT "inspiration_rights_snapshots_digest_check" CHECK("digest" ~ '^sha256:[a-f0-9]{64}$' AND "revision" > 0 AND "basis" IN ('owned','licensed','public_domain','consented') AND "permitted_remix" IN ('reference_only','transform','derivative'))
);
--> statement-breakpoint
ALTER TABLE "generation_intents" ADD COLUMN "rights_snapshot_id" text;
ALTER TABLE "generation_intents" ADD COLUMN "rights_snapshot_revision" integer;
ALTER TABLE "generation_intents" ADD COLUMN "remix_brief_digest" text;
ALTER TABLE "generation_intents" ADD COLUMN "output_contract" jsonb;
ALTER TABLE "generation_intents" ADD CONSTRAINT "generation_intents_rights_fk" FOREIGN KEY("workspace_id", "rights_snapshot_id", "rights_snapshot_revision") REFERENCES "inspiration_rights_snapshots"("workspace_id", "id", "revision") ON DELETE restrict NOT VALID;
ALTER TABLE "generation_intents" ADD CONSTRAINT "generation_intents_execution_contract_check" CHECK(("rights_snapshot_id" IS NULL AND "rights_snapshot_revision" IS NULL AND "remix_brief_digest" IS NULL AND "output_contract" IS NULL) OR ("rights_snapshot_id" IS NOT NULL AND "rights_snapshot_revision" > 0 AND "remix_brief_digest" ~ '^sha256:[a-f0-9]{64}$' AND jsonb_typeof("output_contract") = 'object'));
