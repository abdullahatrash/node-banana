CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_agent_policy_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"revision" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"grants" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_authorization_decisions" RENAME COLUMN "contract_digest" TO "authorization_contract_digest";--> statement-breakpoint
ALTER TABLE "agent_security_events" ALTER COLUMN "principal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_security_events" ALTER COLUMN "key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_authorization_decisions" ADD COLUMN "grant_revision_id" text;--> statement-breakpoint
ALTER TABLE "agent_authorization_decisions" ADD COLUMN "policy_revision_id" text;--> statement-breakpoint
ALTER TABLE "agent_security_events" ADD COLUMN "actor_user_id" text;--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ADD COLUMN "active_revision_id" text;--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ADD COLUMN "revision" integer;--> statement-breakpoint
INSERT INTO "workspace_agent_policy_revisions" (
	"id",
	"workspace_id",
	"revision",
	"enabled",
	"grants",
	"created_by_user_id",
	"created_at"
)
SELECT
	'policy-revision-v1:' || "workspace_id",
	"workspace_id",
	1,
	"enabled",
	"grants",
	"updated_by_user_id",
	"updated_at"
FROM "workspace_agent_policies";--> statement-breakpoint
UPDATE "workspace_agent_policies"
SET
	"active_revision_id" = 'policy-revision-v1:' || "workspace_id",
	"revision" = 1;--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ALTER COLUMN "active_revision_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ALTER COLUMN "revision" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_agent_policy_revisions" ADD CONSTRAINT "workspace_agent_policy_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_agent_policy_revisions" ADD CONSTRAINT "workspace_agent_policy_revisions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_workspace_idx" ON "workflows" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_agent_policy_revisions_workspace_revision_unique" ON "workspace_agent_policy_revisions" USING btree ("workspace_id","revision");--> statement-breakpoint
ALTER TABLE "agent_security_events" ADD CONSTRAINT "agent_security_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_grant_sets_principal_unique" ON "agent_grant_sets" USING btree ("principal_id");--> statement-breakpoint
ALTER TABLE "agent_authorization_decisions" DROP COLUMN "grant_revision_ids";--> statement-breakpoint
CREATE FUNCTION "prevent_workspace_agent_policy_revision_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'workspace agent policy revisions are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workspace_agent_policy_revisions_immutable"
BEFORE UPDATE OR DELETE ON "workspace_agent_policy_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_workspace_agent_policy_revision_mutation"();
