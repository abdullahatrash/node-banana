CREATE TABLE "artifact_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"artifact_id" text,
	"upload_id" text,
	"event_type" text NOT NULL,
	"request_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_audit_events_type_check" CHECK ("artifact_audit_events"."event_type" in (
        'artifact.imported',
        'artifact.upload_begun',
        'artifact.upload_completed',
        'artifact.download_handoff_created'
      )),
	CONSTRAINT "artifact_audit_events_fingerprint_check" CHECK ("artifact_audit_events"."request_fingerprint" is null or "artifact_audit_events"."request_fingerprint" ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "artifact_contents" (
	"workspace_id" text NOT NULL,
	"digest" text NOT NULL,
	"kind" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"inline_text" text,
	"storage_key" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_contents_pk" PRIMARY KEY("workspace_id","digest"),
	CONSTRAINT "artifact_contents_digest_check" CHECK ("artifact_contents"."digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "artifact_contents_kind_check" CHECK ("artifact_contents"."kind" in ('text', 'image')),
	CONSTRAINT "artifact_contents_size_check" CHECK ("artifact_contents"."size_bytes" >= 0 and "artifact_contents"."size_bytes" <= 52428800),
	CONSTRAINT "artifact_contents_location_check" CHECK ((
        "artifact_contents"."kind" = 'text'
        and "artifact_contents"."inline_text" is not null
        and "artifact_contents"."storage_key" is null
        and "artifact_contents"."width" is null
        and "artifact_contents"."height" is null
      ) or (
        "artifact_contents"."kind" = 'image'
        and "artifact_contents"."inline_text" is null
        and "artifact_contents"."storage_key" is not null
        and "artifact_contents"."width" > 0
        and "artifact_contents"."height" > 0
      )),
	CONSTRAINT "artifact_contents_storage_key_check" CHECK ("artifact_contents"."storage_key" is null or (
        length("artifact_contents"."storage_key") between 1 and 1024
        and "artifact_contents"."storage_key" !~* '^https?://'
      ))
);
--> statement-breakpoint
CREATE TABLE "artifact_mutation_receipts" (
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"capability" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_mutation_receipts_pk" PRIMARY KEY("workspace_id","principal_id","capability","idempotency_key"),
	CONSTRAINT "artifact_mutation_receipts_fingerprint_check" CHECK ("artifact_mutation_receipts"."request_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "artifact_mutation_receipts_capability_check" CHECK ("artifact_mutation_receipts"."capability" in (
        'artifacts.import@1',
        'artifact_uploads.begin@1',
        'artifact_uploads.complete@1'
      ))
);
--> statement-breakpoint
CREATE TABLE "artifact_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"staging_key" text NOT NULL,
	"declared_media_type" text NOT NULL,
	"expected_digest" text,
	"expected_size_bytes" integer,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"artifact_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "artifact_uploads_status_check" CHECK ("artifact_uploads"."status" in ('pending', 'completed', 'failed')),
	CONSTRAINT "artifact_uploads_expected_digest_check" CHECK ("artifact_uploads"."expected_digest" is null or "artifact_uploads"."expected_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "artifact_uploads_expected_size_check" CHECK ("artifact_uploads"."expected_size_bytes" is null or (
        "artifact_uploads"."expected_size_bytes" >= 0
        and "artifact_uploads"."expected_size_bytes" <= 52428800
      )),
	CONSTRAINT "artifact_uploads_staging_key_check" CHECK (length("artifact_uploads"."staging_key") between 1 and 1024 and "artifact_uploads"."staging_key" !~* '^https?://'),
	CONSTRAINT "artifact_uploads_state_check" CHECK ((
        "artifact_uploads"."status" = 'pending'
        and "artifact_uploads"."artifact_id" is null
        and "artifact_uploads"."completed_at" is null
      ) or (
        "artifact_uploads"."status" = 'completed'
        and "artifact_uploads"."artifact_id" is not null
        and "artifact_uploads"."completed_at" is not null
      ) or "artifact_uploads"."status" = 'failed')
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"content_digest" text NOT NULL,
	"kind" text NOT NULL,
	"media_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"creator_principal_id" text NOT NULL,
	"origin" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"retention_mode" text NOT NULL,
	"retention_snapshot_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "artifacts_type_check" CHECK ("artifacts"."kind" in ('text', 'image')),
	CONSTRAINT "artifacts_origin_check" CHECK ("artifacts"."origin" = 'imported'),
	CONSTRAINT "artifacts_retention_check" CHECK ("artifacts"."retention_mode" = 'workspace_default')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_contents_identity_unique" ON "artifact_contents" USING btree ("workspace_id","digest","kind","media_type","size_bytes");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_uploads_workspace_id_unique" ON "artifact_uploads" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_workspace_id_unique" ON "artifacts" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "artifact_audit_events" ADD CONSTRAINT "artifact_audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_audit_events" ADD CONSTRAINT "artifact_audit_events_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_audit_events" ADD CONSTRAINT "artifact_audit_events_workspace_artifact_fk" FOREIGN KEY ("workspace_id","artifact_id") REFERENCES "public"."artifacts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_audit_events" ADD CONSTRAINT "artifact_audit_events_workspace_upload_fk" FOREIGN KEY ("workspace_id","upload_id") REFERENCES "public"."artifact_uploads"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_contents" ADD CONSTRAINT "artifact_contents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_mutation_receipts" ADD CONSTRAINT "artifact_mutation_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_mutation_receipts" ADD CONSTRAINT "artifact_mutation_receipts_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_uploads" ADD CONSTRAINT "artifact_uploads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_uploads" ADD CONSTRAINT "artifact_uploads_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_uploads" ADD CONSTRAINT "artifact_uploads_workspace_artifact_fk" FOREIGN KEY ("workspace_id","artifact_id") REFERENCES "public"."artifacts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_content_fk" FOREIGN KEY ("workspace_id","content_digest","kind","media_type","size_bytes") REFERENCES "public"."artifact_contents"("workspace_id","digest","kind","media_type","size_bytes") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_creator_fk" FOREIGN KEY ("workspace_id","creator_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_audit_events_workspace_created_idx" ON "artifact_audit_events" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_contents_storage_key_unique" ON "artifact_contents" USING btree ("storage_key") WHERE "artifact_contents"."storage_key" is not null;--> statement-breakpoint
CREATE INDEX "artifact_uploads_workspace_status_expiry_idx" ON "artifact_uploads" USING btree ("workspace_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_uploads_staging_key_unique" ON "artifact_uploads" USING btree ("staging_key");--> statement-breakpoint
CREATE INDEX "artifacts_workspace_created_idx" ON "artifacts" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "artifacts_workspace_digest_idx" ON "artifacts" USING btree ("workspace_id","content_digest");--> statement-breakpoint
CREATE FUNCTION "artifact_insert_only_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "artifact_contents_insert_only"
BEFORE UPDATE OR DELETE ON "artifact_contents"
FOR EACH ROW EXECUTE FUNCTION "artifact_insert_only_guard"();--> statement-breakpoint
CREATE TRIGGER "artifact_mutation_receipts_insert_only"
BEFORE UPDATE OR DELETE ON "artifact_mutation_receipts"
FOR EACH ROW EXECUTE FUNCTION "artifact_insert_only_guard"();--> statement-breakpoint
CREATE TRIGGER "artifact_audit_events_insert_only"
BEFORE UPDATE OR DELETE ON "artifact_audit_events"
FOR EACH ROW EXECUTE FUNCTION "artifact_insert_only_guard"();--> statement-breakpoint
CREATE FUNCTION "artifact_provenance_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF (to_jsonb(NEW) - 'deleted_at') <> (to_jsonb(OLD) - 'deleted_at') THEN
		RAISE EXCEPTION 'Artifact provenance is immutable';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "artifacts_provenance_immutable"
BEFORE UPDATE ON "artifacts"
FOR EACH ROW EXECUTE FUNCTION "artifact_provenance_guard"();
