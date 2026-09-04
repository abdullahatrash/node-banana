CREATE TYPE "public"."saved_prompt_mode" AS ENUM('photo', 'video', 'copy');--> statement-breakpoint
CREATE TABLE "saved_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"mode" "saved_prompt_mode" NOT NULL,
	"name" text NOT NULL,
	"prompt_text" text NOT NULL,
	"form_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "saved_prompts" ADD CONSTRAINT "saved_prompts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_prompts_workspace_deleted_idx" ON "saved_prompts" USING btree ("workspace_id","deleted_at");--> statement-breakpoint
CREATE INDEX "saved_prompts_public_mode_deleted_idx" ON "saved_prompts" USING btree ("is_public","mode","deleted_at");--> statement-breakpoint
CREATE INDEX "saved_prompts_created_at_idx" ON "saved_prompts" USING btree ("created_at");
