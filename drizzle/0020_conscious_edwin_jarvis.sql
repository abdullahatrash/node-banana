ALTER TABLE "workflows" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "workflows" CASCADE;--> statement-breakpoint
ALTER TABLE "agent_security_events" ADD COLUMN "change_ref" text;--> statement-breakpoint
ALTER TABLE "agent_security_events" ADD COLUMN "revision" integer;--> statement-breakpoint
ALTER TABLE "agent_security_events" ADD COLUMN "principal_status" text;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_agent_policy_revisions_workspace_id_unique" ON "workspace_agent_policy_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ADD CONSTRAINT "workspace_agent_policies_active_revision_workspace_fk" FOREIGN KEY ("workspace_id","active_revision_id") REFERENCES "public"."workspace_agent_policy_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;
