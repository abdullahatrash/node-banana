CREATE TABLE "social_oauth_selection_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"platform" "social_platform" NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"access_token_secret" text,
	"token_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_oauth_selection_sessions" ADD CONSTRAINT "social_oauth_selection_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_oauth_selection_sessions" ADD CONSTRAINT "social_oauth_selection_sessions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_oauth_selection_sessions_workspace_idx" ON "social_oauth_selection_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "social_oauth_selection_sessions_expires_at_idx" ON "social_oauth_selection_sessions" USING btree ("expires_at");