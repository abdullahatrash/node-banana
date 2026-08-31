CREATE TABLE "agent_authority_provisioning_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"key_id" text NOT NULL,
	"grant_set_id" text NOT NULL,
	"grant_revision_id" text NOT NULL,
	"grant_revision" integer NOT NULL,
	"policy_revision_id" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_authority_provisioning_receipts" ADD CONSTRAINT "agent_authority_provisioning_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_authority_provisioning_receipts" ADD CONSTRAINT "agent_authority_provisioning_receipts_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_authority_provisioning_receipts" ADD CONSTRAINT "agent_authority_provisioning_receipts_key_id_agent_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."agent_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_authority_provisioning_receipts" ADD CONSTRAINT "agent_authority_provisioning_receipts_grant_set_id_agent_grant_sets_id_fk" FOREIGN KEY ("grant_set_id") REFERENCES "public"."agent_grant_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_authority_provisioning_receipts" ADD CONSTRAINT "agent_authority_provisioning_receipts_grant_revision_id_agent_grant_revisions_id_fk" FOREIGN KEY ("grant_revision_id") REFERENCES "public"."agent_grant_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_authority_provisioning_receipts" ADD CONSTRAINT "agent_authority_provisioning_receipts_policy_revision_id_workspace_agent_policy_revisions_id_fk" FOREIGN KEY ("policy_revision_id") REFERENCES "public"."workspace_agent_policy_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_authority_provisioning_receipts_request_unique" ON "agent_authority_provisioning_receipts" USING btree ("workspace_id","actor_user_id","request_id");