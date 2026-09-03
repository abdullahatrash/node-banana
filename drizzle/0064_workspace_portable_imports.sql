CREATE TABLE "workspace_portable_import_records" (
  "workspace_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "kind" text NOT NULL,
  "source" text NOT NULL,
  "source_manifest_digest" text NOT NULL,
  "source_id" text NOT NULL,
  "source_digest" text NOT NULL,
  "destination_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "mapping" jsonb NOT NULL,
  "disposition" text NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "workspace_portable_import_records_pk" PRIMARY KEY("workspace_id", "idempotency_key"),
  CONSTRAINT "workspace_portable_import_records_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict,
  CONSTRAINT "workspace_portable_import_records_user_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict,
  CONSTRAINT "workspace_portable_import_records_kind_check" CHECK ("kind" in ('media','content_revision','prompt','brand_source','calendar_plan','platform_export_metadata')),
  CONSTRAINT "workspace_portable_import_records_digest_check" CHECK ("source_manifest_digest" ~ '^sha256:[a-f0-9]{64}$' and "source_digest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "workspace_portable_import_records_disposition_check" CHECK ("disposition" in ('created','matched','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_portable_import_records_source_unique" ON "workspace_portable_import_records" USING btree ("workspace_id","source_manifest_digest","kind","source_id");
--> statement-breakpoint
CREATE INDEX "workspace_portable_import_records_destination_idx" ON "workspace_portable_import_records" USING btree ("workspace_id","kind","destination_id");
