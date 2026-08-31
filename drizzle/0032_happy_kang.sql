CREATE TABLE "content_workflow_revisions" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"revision" integer NOT NULL,
	"definition_digest" text NOT NULL,
	"definition" jsonb NOT NULL,
	"operation_registry_digest" text NOT NULL,
	"author_principal_id" text NOT NULL,
	"author_key_id" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_workflow_revisions_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "content_workflow_revisions_revision_check" CHECK ("content_workflow_revisions"."revision" > 0),
	CONSTRAINT "content_workflow_revisions_definition_digest_check" CHECK ("content_workflow_revisions"."definition_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "content_workflow_revisions_registry_digest_check" CHECK ("content_workflow_revisions"."operation_registry_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "content_workflow_revisions_definition_identity_check" CHECK (jsonb_typeof("content_workflow_revisions"."definition") = 'object'
        and "content_workflow_revisions"."definition"->>'schema' = 'content-workflow-revision-definition/v1'
        and "content_workflow_revisions"."definition"->>'workflowId' = "content_workflow_revisions"."workflow_id"),
	CONSTRAINT "content_workflow_revisions_id_check" CHECK (length("content_workflow_revisions"."id") between 1 and 200 and "content_workflow_revisions"."id" ~ '^[a-zA-Z0-9_-]+$'),
	CONSTRAINT "content_workflow_revisions_evidence_check" CHECK (length("content_workflow_revisions"."authorization_evidence_ref") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "content_workflows" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"created_by_principal_id" text NOT NULL,
	"created_by_key_id" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_workflows_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "content_workflows_current_revision_check" CHECK ("content_workflows"."current_revision" >= 0),
	CONSTRAINT "content_workflows_id_check" CHECK (length("content_workflows"."id") between 1 and 200 and "content_workflows"."id" ~ '^[a-zA-Z0-9_-]+$'),
	CONSTRAINT "content_workflows_evidence_check" CHECK (length("content_workflows"."authorization_evidence_ref") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "workflow_revision_mutation_receipts" (
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"capability" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_revision_mutation_receipts_pk" PRIMARY KEY("workspace_id","principal_id","capability","idempotency_key"),
	CONSTRAINT "workflow_revision_mutation_receipts_capability_check" CHECK ("workflow_revision_mutation_receipts"."capability" in ('workflows.create@1', 'workflow_versions.create@1')),
	CONSTRAINT "workflow_revision_mutation_receipts_idempotency_key_check" CHECK (length("workflow_revision_mutation_receipts"."idempotency_key") between 8 and 200 and "workflow_revision_mutation_receipts"."idempotency_key" ~ '^[!-~]+$'),
	CONSTRAINT "workflow_revision_mutation_receipts_fingerprint_check" CHECK ("workflow_revision_mutation_receipts"."request_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "workflow_revision_mutation_receipts_resource_id_check" CHECK (length("workflow_revision_mutation_receipts"."resource_id") between 1 and 200 and "workflow_revision_mutation_receipts"."resource_id" ~ '^[a-zA-Z0-9_-]+$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_principal_id_unique" ON "agent_keys" USING btree ("principal_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_workflow_revisions_workspace_workflow_revision_unique" ON "content_workflow_revisions" USING btree ("workspace_id","workflow_id","revision");--> statement-breakpoint
CREATE INDEX "content_workflow_revisions_workspace_workflow_created_idx" ON "content_workflow_revisions" USING btree ("workspace_id","workflow_id","created_at","id");--> statement-breakpoint
CREATE INDEX "content_workflows_workspace_updated_idx" ON "content_workflows" USING btree ("workspace_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "workflow_revision_mutation_receipts_workspace_created_idx" ON "workflow_revision_mutation_receipts" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "content_workflow_revisions" ADD CONSTRAINT "content_workflow_revisions_workspace_workflow_fk" FOREIGN KEY ("workspace_id","workflow_id") REFERENCES "public"."content_workflows"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workflow_revisions" ADD CONSTRAINT "content_workflow_revisions_workspace_author_fk" FOREIGN KEY ("workspace_id","author_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workflow_revisions" ADD CONSTRAINT "content_workflow_revisions_author_key_fk" FOREIGN KEY ("author_principal_id","author_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workflows" ADD CONSTRAINT "content_workflows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workflows" ADD CONSTRAINT "content_workflows_workspace_creator_fk" FOREIGN KEY ("workspace_id","created_by_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_workflows" ADD CONSTRAINT "content_workflows_creator_key_fk" FOREIGN KEY ("created_by_principal_id","created_by_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_revision_mutation_receipts" ADD CONSTRAINT "workflow_revision_mutation_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_revision_mutation_receipts" ADD CONSTRAINT "workflow_revision_mutation_receipts_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "content_workflow_insert_only_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "content_workflow_revisions_insert_only"
BEFORE UPDATE OR DELETE ON "content_workflow_revisions"
FOR EACH ROW EXECUTE FUNCTION "content_workflow_insert_only_guard"();--> statement-breakpoint
CREATE TRIGGER "workflow_revision_mutation_receipts_insert_only"
BEFORE UPDATE OR DELETE ON "workflow_revision_mutation_receipts"
FOR EACH ROW EXECUTE FUNCTION "content_workflow_insert_only_guard"();--> statement-breakpoint
CREATE FUNCTION "content_workflow_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Content Workflow identities cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY['current_revision', 'updated_at'])
		<> (to_jsonb(OLD) - ARRAY['current_revision', 'updated_at']) THEN
		RAISE EXCEPTION 'Content Workflow provenance is immutable';
	END IF;
	IF NEW.current_revision <> OLD.current_revision + 1 THEN
		RAISE EXCEPTION 'Content Workflow revision must advance by exactly one';
	END IF;
	IF NEW.updated_at < OLD.updated_at THEN
		RAISE EXCEPTION 'Content Workflow updated_at cannot move backward';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "content_workflows_identity_immutable"
BEFORE UPDATE OR DELETE ON "content_workflows"
FOR EACH ROW EXECUTE FUNCTION "content_workflow_identity_guard"();
