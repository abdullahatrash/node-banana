CREATE TABLE "agent_authorization_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"key_id" text NOT NULL,
	"capability_name" text NOT NULL,
	"capability_version" integer NOT NULL,
	"contract_digest" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"operator_trace_ref" text NOT NULL,
	"grant_revision_ids" jsonb NOT NULL,
	"resources" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_grant_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_set_id" text NOT NULL,
	"revision" integer NOT NULL,
	"grants" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_grant_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"name" text NOT NULL,
	"active_revision" integer,
	"disabled_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_security_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"key_id" text NOT NULL,
	"event_type" text NOT NULL,
	"capability_name" text NOT NULL,
	"capability_version" integer NOT NULL,
	"reason" text NOT NULL,
	"resource_kinds" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_agent_policies" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"grants" jsonb NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_keys" ADD COLUMN "authorization_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_authorization_decisions" ADD CONSTRAINT "agent_authorization_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_authorization_decisions" ADD CONSTRAINT "agent_authorization_decisions_principal_id_agent_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_authorization_decisions" ADD CONSTRAINT "agent_authorization_decisions_key_id_agent_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."agent_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grant_revisions" ADD CONSTRAINT "agent_grant_revisions_grant_set_id_agent_grant_sets_id_fk" FOREIGN KEY ("grant_set_id") REFERENCES "public"."agent_grant_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grant_revisions" ADD CONSTRAINT "agent_grant_revisions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grant_sets" ADD CONSTRAINT "agent_grant_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grant_sets" ADD CONSTRAINT "agent_grant_sets_principal_id_agent_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grant_sets" ADD CONSTRAINT "agent_grant_sets_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_security_events" ADD CONSTRAINT "agent_security_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_security_events" ADD CONSTRAINT "agent_security_events_principal_id_agent_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_security_events" ADD CONSTRAINT "agent_security_events_key_id_agent_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."agent_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_profiles" ADD CONSTRAINT "credential_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ADD CONSTRAINT "workspace_agent_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ADD CONSTRAINT "workspace_agent_policies_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_authorization_decisions_workspace_created_idx" ON "agent_authorization_decisions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_authorization_decisions_principal_created_idx" ON "agent_authorization_decisions" USING btree ("principal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_authorization_decisions_trace_unique" ON "agent_authorization_decisions" USING btree ("operator_trace_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_grant_revisions_set_revision_unique" ON "agent_grant_revisions" USING btree ("grant_set_id","revision");--> statement-breakpoint
CREATE INDEX "agent_grant_revisions_set_idx" ON "agent_grant_revisions" USING btree ("grant_set_id");--> statement-breakpoint
CREATE INDEX "agent_grant_sets_principal_idx" ON "agent_grant_sets" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "agent_grant_sets_workspace_idx" ON "agent_grant_sets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_security_events_workspace_created_idx" ON "agent_security_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_security_events_principal_created_idx" ON "agent_security_events" USING btree ("principal_id","created_at");--> statement-breakpoint
CREATE INDEX "credential_profiles_workspace_idx" ON "credential_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE FUNCTION "prevent_agent_grant_revision_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'agent grant revisions are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "agent_grant_revisions_immutable"
BEFORE UPDATE OR DELETE ON "agent_grant_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_agent_grant_revision_mutation"();--> statement-breakpoint
CREATE FUNCTION "prevent_agent_key_scope_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."authorization_scopes" IS DISTINCT FROM OLD."authorization_scopes" THEN
		RAISE EXCEPTION 'agent key authorization scopes are immutable';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "agent_key_scopes_immutable"
BEFORE UPDATE OF "authorization_scopes" ON "agent_keys"
FOR EACH ROW EXECUTE FUNCTION "prevent_agent_key_scope_mutation"();
