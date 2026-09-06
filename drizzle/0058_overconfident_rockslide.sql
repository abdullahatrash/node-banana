CREATE TABLE "workspace_audit_trail_events" (
	"workspace_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"id" text NOT NULL,
	"event" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_audit_trail_events_pk" PRIMARY KEY("workspace_id","sequence"),
	CONSTRAINT "workspace_audit_trail_events_sequence_check" CHECK ("workspace_audit_trail_events"."sequence" > 0 and octet_length("workspace_audit_trail_events"."event"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "workspace_governance_mutation_receipts" (
	"workspace_id" text NOT NULL,
	"capability" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_governance_mutation_receipts_pk" PRIMARY KEY("workspace_id","capability","idempotency_key"),
	CONSTRAINT "workspace_governance_mutation_receipts_digest_check" CHECK ("workspace_governance_mutation_receipts"."request_digest" ~ '^sha256:[a-f0-9]{64}$' and "workspace_governance_mutation_receipts"."capability" ~ '^[a-z][a-z0-9_.]*@[1-9][0-9]*$' and length("workspace_governance_mutation_receipts"."idempotency_key") between 8 and 200)
);
--> statement-breakpoint
CREATE TABLE "workspace_governance_resources" (
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_governance_resources_pk" PRIMARY KEY("workspace_id","kind","id"),
	CONSTRAINT "workspace_governance_resources_identity_check" CHECK ("workspace_governance_resources"."id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and "workspace_governance_resources"."version" > 0 and length("workspace_governance_resources"."status") between 1 and 80),
	CONSTRAINT "workspace_governance_resources_kind_check" CHECK ("workspace_governance_resources"."kind" in ('custom_role','member_role_assignment','invitation_binding','portfolio','portfolio_assignment','review_guest_grant','review_guest_session','approval_policy','step_up_challenge','step_up_session','audit_export','workspace_export','workspace_import','data_region_policy','retention_policy','retention_hold','deletion_receipt','tombstone','safety_decision','safety_appeal','bulk_operation')),
	CONSTRAINT "workspace_governance_resources_body_size_check" CHECK (octet_length("workspace_governance_resources"."body"::text) <= 2097152)
);
--> statement-breakpoint
ALTER TABLE "workspace_audit_trail_events" ADD CONSTRAINT "workspace_audit_trail_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_governance_mutation_receipts" ADD CONSTRAINT "workspace_governance_mutation_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_governance_resources" ADD CONSTRAINT "workspace_governance_resources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_governance_resources" ADD CONSTRAINT "workspace_governance_resources_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_audit_trail_events_id_unique" ON "workspace_audit_trail_events" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "workspace_audit_trail_events_workspace_time_idx" ON "workspace_audit_trail_events" USING btree ("workspace_id","occurred_at","sequence");--> statement-breakpoint
CREATE INDEX "workspace_governance_resources_workspace_kind_status_idx" ON "workspace_governance_resources" USING btree ("workspace_id","kind","status","updated_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_workspace_governance_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workspace governance evidence is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER workspace_audit_trail_events_append_only
BEFORE UPDATE OR DELETE ON "workspace_audit_trail_events"
FOR EACH ROW EXECUTE FUNCTION reject_workspace_governance_evidence_mutation();--> statement-breakpoint
CREATE TRIGGER workspace_governance_mutation_receipts_append_only
BEFORE UPDATE OR DELETE ON "workspace_governance_mutation_receipts"
FOR EACH ROW EXECUTE FUNCTION reject_workspace_governance_evidence_mutation();
