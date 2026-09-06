CREATE TABLE "product_campaign_occurrences" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "campaign_id" text NOT NULL,
  "campaign_revision" integer NOT NULL,
  "campaign_digest" text NOT NULL,
  "occurrence_key" text NOT NULL,
  "scheduled_at" timestamp with time zone NOT NULL,
  "format" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "state" text NOT NULL,
  "lease_token" text,
  "lease_expires_at" timestamp with time zone,
  "lease_generation" integer DEFAULT 0 NOT NULL,
  "workflow_run_id" text,
  "start_snapshot_digest" text,
  "quote_id" text,
  "quoted_amount" text,
  "currency" text,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "product_campaign_occurrences_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "product_campaign_occurrences_key_unique" UNIQUE("workspace_id", "campaign_id", "occurrence_key"),
  CONSTRAINT "product_campaign_occurrences_campaign_fk" FOREIGN KEY ("workspace_id", "campaign_id") REFERENCES "workspace_product_records"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "product_campaign_occurrences_run_fk" FOREIGN KEY ("workspace_id", "workflow_run_id") REFERENCES "workflow_runs"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "product_campaign_occurrences_digest_check" CHECK ("campaign_revision" > 0 AND "campaign_digest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "product_campaign_occurrences_state_check" CHECK ("state" IN ('scheduled','claimed','submitting','running','succeeded','failed_known','outcome_unknown','cancelled')),
  CONSTRAINT "product_campaign_occurrences_lease_check" CHECK (("state" = 'claimed' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("state" <> 'claimed' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)),
  CONSTRAINT "product_campaign_occurrences_run_check" CHECK (("workflow_run_id" IS NULL AND "start_snapshot_digest" IS NULL) OR ("workflow_run_id" IS NOT NULL AND "start_snapshot_digest" ~ '^sha256:[a-f0-9]{64}$')),
  CONSTRAINT "product_campaign_occurrences_quote_check" CHECK (("quote_id" IS NULL AND "quoted_amount" IS NULL AND "currency" IS NULL) OR ("quote_id" IS NOT NULL AND "quoted_amount" ~ '^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$' AND "currency" ~ '^[A-Z]{3}$')),
  CONSTRAINT "product_campaign_occurrences_terminal_check" CHECK (("state" IN ('succeeded','failed_known','cancelled') AND "completed_at" IS NOT NULL) OR ("state" NOT IN ('succeeded','failed_known','cancelled') AND "completed_at" IS NULL))
);
CREATE INDEX "product_campaign_occurrences_due_idx" ON "product_campaign_occurrences" ("state", "scheduled_at", "id");
CREATE INDEX "product_campaign_occurrences_campaign_idx" ON "product_campaign_occurrences" ("workspace_id", "campaign_id", "scheduled_at", "id");

CREATE TABLE "product_runtime_scan_checkpoints" (
  "scan_key" text PRIMARY KEY,
  "cursor_at" timestamp with time zone,
  "cursor_id" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_runtime_scan_checkpoints_cursor_check" CHECK (("cursor_at" IS NULL AND "cursor_id" IS NULL) OR ("cursor_at" IS NOT NULL AND "cursor_id" IS NOT NULL))
);

CREATE TABLE "product_blitz_replenishment_runs" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "campaign_id" text NOT NULL,
  "source_key" text NOT NULL,
  "invocation" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "state" text NOT NULL,
  "lease_token" text,
  "lease_expires_at" timestamp with time zone,
  "lease_generation" integer DEFAULT 0 NOT NULL,
  "policy_snapshot" jsonb NOT NULL,
  "created_count" integer DEFAULT 0 NOT NULL,
  "stop_reason" text,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "product_blitz_replenishment_runs_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "product_blitz_replenishment_runs_source_unique" UNIQUE("workspace_id", "campaign_id", "source_key"),
  CONSTRAINT "product_blitz_replenishment_runs_campaign_fk" FOREIGN KEY ("workspace_id", "campaign_id") REFERENCES "workspace_product_records"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "product_blitz_replenishment_runs_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "product_blitz_replenishment_runs_invocation_check" CHECK ("invocation" IN ('daily','manual')),
  CONSTRAINT "product_blitz_replenishment_runs_state_check" CHECK ("state" IN ('claimed','succeeded','failed_known')),
  CONSTRAINT "product_blitz_replenishment_runs_lease_check" CHECK (("state" = 'claimed' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("state" <> 'claimed' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)),
  CONSTRAINT "product_blitz_replenishment_runs_count_check" CHECK ("created_count" >= 0),
  CONSTRAINT "product_blitz_replenishment_runs_terminal_check" CHECK (("state" = 'claimed' AND "completed_at" IS NULL) OR ("state" <> 'claimed' AND "completed_at" IS NOT NULL))
);
CREATE INDEX "product_blitz_replenishment_runs_lease_idx" ON "product_blitz_replenishment_runs" ("state", "lease_expires_at", "id");

CREATE TABLE "product_blitz_replenishment_items" (
  "workspace_id" text NOT NULL,
  "run_id" text NOT NULL,
  "position" integer NOT NULL,
  "source_record_id" text NOT NULL,
  "blitz_item_id" text NOT NULL,
  "rationale_digest" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_blitz_replenishment_items_pk" PRIMARY KEY("workspace_id", "run_id", "position"),
  CONSTRAINT "product_blitz_replenishment_items_source_unique" UNIQUE("workspace_id", "run_id", "source_record_id"),
  CONSTRAINT "product_blitz_replenishment_items_blitz_unique" UNIQUE("workspace_id", "blitz_item_id"),
  CONSTRAINT "product_blitz_replenishment_items_run_fk" FOREIGN KEY ("workspace_id", "run_id") REFERENCES "product_blitz_replenishment_runs"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "product_blitz_replenishment_items_source_fk" FOREIGN KEY ("workspace_id", "source_record_id") REFERENCES "workspace_product_records"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "product_blitz_replenishment_items_blitz_fk" FOREIGN KEY ("workspace_id", "blitz_item_id") REFERENCES "workspace_product_records"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "product_blitz_replenishment_items_position_check" CHECK ("position" >= 0 AND "rationale_digest" ~ '^sha256:[a-f0-9]{64}$')
);

CREATE OR REPLACE FUNCTION enforce_product_campaign_occurrence_snapshot_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.id IS DISTINCT FROM OLD.id OR
     NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.campaign_revision IS DISTINCT FROM OLD.campaign_revision OR
     NEW.campaign_digest IS DISTINCT FROM OLD.campaign_digest OR NEW.occurrence_key IS DISTINCT FROM OLD.occurrence_key OR
     NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at OR NEW.format IS DISTINCT FROM OLD.format OR
     NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'product campaign occurrence snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_campaign_occurrence_snapshot_immutable
BEFORE UPDATE ON "product_campaign_occurrences"
FOR EACH ROW EXECUTE FUNCTION enforce_product_campaign_occurrence_snapshot_immutable();

CREATE OR REPLACE FUNCTION enforce_product_blitz_replenishment_identity_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.id IS DISTINCT FROM OLD.id OR
     NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.source_key IS DISTINCT FROM OLD.source_key OR
     NEW.invocation IS DISTINCT FROM OLD.invocation OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id OR
     NEW.policy_snapshot IS DISTINCT FROM OLD.policy_snapshot OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'product Blitz replenishment identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_blitz_replenishment_identity_immutable
BEFORE UPDATE ON "product_blitz_replenishment_runs"
FOR EACH ROW EXECUTE FUNCTION enforce_product_blitz_replenishment_identity_immutable();
