CREATE TYPE "public"."agent_principal_status" AS ENUM('active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TABLE "agent_pairing_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"lookup_prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"pepper_version" integer DEFAULT 1 NOT NULL,
	"agent_name" text NOT NULL,
	"key_name" text NOT NULL,
	"requested_access" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_workspace_id" text,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "agent_principals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"sponsor_user_id" text,
	"name" text NOT NULL,
	"requested_access" jsonb NOT NULL,
	"status" "agent_principal_status" DEFAULT 'active' NOT NULL,
	"suspended_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "agent_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"name" text NOT NULL,
	"lookup_prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"pepper_version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_sponsor_user_id_user_id_fk" FOREIGN KEY ("sponsor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pairing_challenges" ADD CONSTRAINT "agent_pairing_challenges_approved_workspace_id_workspaces_id_fk" FOREIGN KEY ("approved_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pairing_challenges" ADD CONSTRAINT "agent_pairing_challenges_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_principal_id_agent_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."agent_principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_pairing_challenges_prefix_unique" ON "agent_pairing_challenges" USING btree ("lookup_prefix");--> statement-breakpoint
CREATE INDEX "agent_pairing_challenges_expiry_idx" ON "agent_pairing_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "agent_principals_workspace_idx" ON "agent_principals" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_principals_sponsor_idx" ON "agent_principals" USING btree ("sponsor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_prefix_unique" ON "agent_keys" USING btree ("lookup_prefix");--> statement-breakpoint
CREATE INDEX "agent_keys_principal_idx" ON "agent_keys" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "agent_keys_expiry_idx" ON "agent_keys" USING btree ("expires_at");
