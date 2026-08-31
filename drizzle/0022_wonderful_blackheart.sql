CREATE TABLE "credential_profile_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"version" integer NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_hint" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credential_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_spend_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"version_id" text NOT NULL,
	"spend_grant_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"mode" text NOT NULL,
	"effect_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_spend_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"mode" text NOT NULL,
	"limit_cents" integer,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "credential_profiles" ADD COLUMN "provider" text DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_profiles" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_profiles" ADD COLUMN "active_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "credential_profiles" SET "status" = 'disabled', "enabled" = false;--> statement-breakpoint
ALTER TABLE "credential_profile_versions" ADD CONSTRAINT "credential_profile_versions_profile_id_credential_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."credential_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_profile_versions" ADD CONSTRAINT "credential_profile_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_slots" ADD CONSTRAINT "credential_slots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_slots" ADD CONSTRAINT "credential_slots_profile_id_credential_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."credential_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_slots" ADD CONSTRAINT "credential_slots_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_principal_id_agent_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_profile_id_credential_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."credential_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_version_id_credential_profile_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."credential_profile_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_spend_grant_id_credential_spend_grants_id_fk" FOREIGN KEY ("spend_grant_id") REFERENCES "public"."credential_spend_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_grants" ADD CONSTRAINT "credential_spend_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_grants" ADD CONSTRAINT "credential_spend_grants_principal_id_agent_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_grants" ADD CONSTRAINT "credential_spend_grants_profile_id_credential_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."credential_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_grants" ADD CONSTRAINT "credential_spend_grants_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_profile_versions_profile_version_unique" ON "credential_profile_versions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE INDEX "credential_profile_versions_profile_status_idx" ON "credential_profile_versions" USING btree ("profile_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_slots_workspace_name_unique" ON "credential_slots" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "credential_slots_profile_idx" ON "credential_slots" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "credential_spend_events_workspace_created_idx" ON "credential_spend_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "credential_spend_events_grant_created_idx" ON "credential_spend_events" USING btree ("spend_grant_id","created_at");--> statement-breakpoint
CREATE INDEX "credential_spend_grants_principal_profile_status_idx" ON "credential_spend_grants" USING btree ("principal_id","profile_id","status");--> statement-breakpoint
CREATE INDEX "credential_spend_grants_workspace_idx" ON "credential_spend_grants" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_profiles_workspace_name_unique" ON "credential_profiles" USING btree ("workspace_id","name") WHERE "credential_profiles"."status" = 'active';
