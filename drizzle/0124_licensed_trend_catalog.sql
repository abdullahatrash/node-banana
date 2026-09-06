CREATE TABLE "licensed_trend_catalog_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "provider_key" text NOT NULL,
  "provider_item_id" text NOT NULL,
  "active_revision" integer NOT NULL,
  "state" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "licensed_trend_catalog_entries_provider_item_unique" UNIQUE("provider_key", "provider_item_id"),
  CONSTRAINT "licensed_trend_catalog_entries_values_check" CHECK ("active_revision" > 0 AND "state" IN ('active','paused','revoked') AND "provider_key" ~ '^[a-z][a-z0-9._-]{1,119}$')
);
--> statement-breakpoint
CREATE INDEX "licensed_trend_catalog_entries_state_idx" ON "licensed_trend_catalog_entries" ("state", "updated_at", "id");
--> statement-breakpoint
CREATE TABLE "licensed_trend_catalog_revisions" (
  "catalog_id" text NOT NULL,
  "revision" integer NOT NULL,
  "document" jsonb NOT NULL,
  "document_digest" text NOT NULL,
  "content_language" text NOT NULL,
  "arabic_variety" text,
  "region" text NOT NULL,
  "format" text NOT NULL,
  "published_at" timestamptz NOT NULL,
  "metrics_observed_at" timestamptz NOT NULL,
  "rights_expires_at" timestamptz,
  "searchable_text" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "licensed_trend_catalog_revisions_pk" PRIMARY KEY("catalog_id", "revision"),
  CONSTRAINT "licensed_trend_catalog_revisions_values_check" CHECK ("revision" > 0 AND "document_digest" ~ '^sha256:[a-f0-9]{64}$' AND "content_language" IN ('ar','en') AND ("content_language" = 'ar' OR "arabic_variety" IS NULL) AND "metrics_observed_at" >= "published_at"),
  CONSTRAINT "licensed_trend_catalog_revisions_document_check" CHECK ("document"->>'schema' = 'licensed-trend-catalog-entry/v1' AND "document"->>'id' = "catalog_id" AND ("document"->>'revision')::integer = "revision" AND "document"->>'digest' = "document_digest")
);
--> statement-breakpoint
ALTER TABLE "licensed_trend_catalog_revisions" ADD CONSTRAINT "licensed_trend_catalog_revisions_catalog_fk" FOREIGN KEY ("catalog_id") REFERENCES "licensed_trend_catalog_entries"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX "licensed_trend_catalog_revisions_browse_idx" ON "licensed_trend_catalog_revisions" ("content_language", "region", "format", "metrics_observed_at", "catalog_id");
--> statement-breakpoint
CREATE TABLE "licensed_trend_workspace_entitlements" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "catalog_id" text NOT NULL,
  "catalog_revision" integer NOT NULL,
  "catalog_digest" text NOT NULL,
  "state" text NOT NULL,
  "document" jsonb NOT NULL,
  "document_digest" text NOT NULL,
  "granted_at" timestamptz NOT NULL,
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "licensed_trend_workspace_entitlements_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "licensed_trend_workspace_entitlements_exact_unique" UNIQUE("workspace_id", "catalog_id", "catalog_revision"),
  CONSTRAINT "licensed_trend_workspace_entitlements_values_check" CHECK ("catalog_revision" > 0 AND "catalog_digest" ~ '^sha256:[a-f0-9]{64}$' AND "document_digest" ~ '^sha256:[a-f0-9]{64}$' AND "state" IN ('active','revoked') AND (("state" = 'active' AND "revoked_at" IS NULL) OR ("state" = 'revoked' AND "revoked_at" IS NOT NULL)) AND ("expires_at" IS NULL OR "expires_at" > "granted_at")),
  CONSTRAINT "licensed_trend_workspace_entitlements_document_check" CHECK ("document"->>'schema' = 'licensed-trend-workspace-entitlement/v1' AND "document"->>'id' = "id" AND "document"->>'workspaceId' = "workspace_id" AND "document"->>'digest' = "document_digest")
);
--> statement-breakpoint
ALTER TABLE "licensed_trend_workspace_entitlements" ADD CONSTRAINT "licensed_trend_workspace_entitlements_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "licensed_trend_workspace_entitlements" ADD CONSTRAINT "licensed_trend_workspace_entitlements_catalog_revision_fk" FOREIGN KEY ("catalog_id", "catalog_revision") REFERENCES "licensed_trend_catalog_revisions"("catalog_id", "revision") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX "licensed_trend_workspace_entitlements_browse_idx" ON "licensed_trend_workspace_entitlements" ("workspace_id", "state", "expires_at", "catalog_id");
--> statement-breakpoint
CREATE TABLE "licensed_trend_materialization_jobs" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "entitlement_id" text NOT NULL,
  "catalog_id" text NOT NULL,
  "catalog_revision" integer NOT NULL,
  "catalog_digest" text NOT NULL,
  "state" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "source_destination_key" text NOT NULL,
  "evidence_destination_key" text NOT NULL,
  "source_asset_id" text,
  "evidence_document_asset_id" text,
  "rights_evidence_id" text,
  "rights_snapshot_id" text,
  "inspiration_item_id" text,
  "attempt" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "lease_owner" text,
  "lease_generation" integer DEFAULT 0 NOT NULL,
  "lease_expires_at" timestamptz,
  "next_attempt_at" timestamptz NOT NULL,
  "failure_code" text,
  "requested_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "licensed_trend_materialization_jobs_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "licensed_trend_materialization_jobs_command_unique" UNIQUE("workspace_id", "idempotency_key"),
  CONSTRAINT "licensed_trend_materialization_jobs_entitlement_unique" UNIQUE("workspace_id", "entitlement_id"),
  CONSTRAINT "licensed_trend_materialization_jobs_values_check" CHECK ("catalog_revision" > 0 AND "catalog_digest" ~ '^sha256:[a-f0-9]{64}$' AND "request_digest" ~ '^sha256:[a-f0-9]{64}$' AND length("idempotency_key") BETWEEN 8 AND 200 AND "state" IN ('queued','claimed','succeeded','failed_known') AND "attempt" >= 0 AND "attempt" <= "max_attempts" AND "max_attempts" BETWEEN 1 AND 20 AND "lease_generation" >= 0),
  CONSTRAINT "licensed_trend_materialization_jobs_lease_check" CHECK (("state" = 'claimed' AND "lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR ("state" <> 'claimed' AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "licensed_trend_materialization_jobs" ADD CONSTRAINT "licensed_trend_materialization_jobs_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "licensed_trend_materialization_jobs" ADD CONSTRAINT "licensed_trend_materialization_jobs_requested_by_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "licensed_trend_materialization_jobs" ADD CONSTRAINT "licensed_trend_materialization_jobs_entitlement_fk" FOREIGN KEY ("workspace_id", "entitlement_id") REFERENCES "licensed_trend_workspace_entitlements"("workspace_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "licensed_trend_materialization_jobs" ADD CONSTRAINT "licensed_trend_materialization_jobs_catalog_revision_fk" FOREIGN KEY ("catalog_id", "catalog_revision") REFERENCES "licensed_trend_catalog_revisions"("catalog_id", "revision") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "licensed_trend_materialization_jobs" ADD CONSTRAINT "licensed_trend_materialization_jobs_source_asset_fk" FOREIGN KEY ("source_asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "licensed_trend_materialization_jobs" ADD CONSTRAINT "licensed_trend_materialization_jobs_evidence_asset_fk" FOREIGN KEY ("evidence_document_asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "licensed_trend_materialization_jobs" ADD CONSTRAINT "licensed_trend_materialization_jobs_inspiration_item_fk" FOREIGN KEY ("workspace_id", "inspiration_item_id") REFERENCES "workspace_product_records"("workspace_id", "id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX "licensed_trend_materialization_jobs_due_idx" ON "licensed_trend_materialization_jobs" ("state", "next_attempt_at", "lease_expires_at", "id");
