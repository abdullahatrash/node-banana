CREATE TYPE "public"."byok_provider" AS ENUM('gemini', 'openai', 'anthropic', 'kie', 'fal', 'replicate', 'wavespeed');--> statement-breakpoint
CREATE TABLE "workspace_provider_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" "byok_provider" NOT NULL,
	"key_encrypted" text NOT NULL,
	"key_hint" text NOT NULL,
	"last_validated_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_provider_keys" ADD CONSTRAINT "workspace_provider_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_provider_keys" ADD CONSTRAINT "workspace_provider_keys_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_provider_keys_workspace_provider_unique" ON "workspace_provider_keys" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "workspace_provider_keys_workspace_idx" ON "workspace_provider_keys" USING btree ("workspace_id");