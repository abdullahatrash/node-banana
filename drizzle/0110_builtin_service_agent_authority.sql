ALTER TABLE "agent_grant_sets" ALTER COLUMN "created_by_user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_grant_sets" ADD COLUMN "created_by_system_actor_id" text;
--> statement-breakpoint
ALTER TABLE "agent_grant_sets" ADD COLUMN "initiating_user_id" text REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "agent_grant_sets" ADD CONSTRAINT "agent_grant_sets_actor_check" CHECK (
  ("created_by_user_id" IS NOT NULL AND "created_by_system_actor_id" IS NULL AND "initiating_user_id" IS NULL)
  OR
  ("created_by_user_id" IS NULL AND "created_by_system_actor_id" = 'tasmeemai:builtin-service-authority@1' AND "initiating_user_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "agent_grant_revisions" ALTER COLUMN "created_by_user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_grant_revisions" ADD COLUMN "created_by_system_actor_id" text;
--> statement-breakpoint
ALTER TABLE "agent_grant_revisions" ADD COLUMN "initiating_user_id" text REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "agent_grant_revisions" ADD CONSTRAINT "agent_grant_revisions_actor_check" CHECK (
  ("created_by_user_id" IS NOT NULL AND "created_by_system_actor_id" IS NULL AND "initiating_user_id" IS NULL)
  OR
  ("created_by_user_id" IS NULL AND "created_by_system_actor_id" = 'tasmeemai:builtin-service-authority@1' AND "initiating_user_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "workspace_agent_policy_revisions" ALTER COLUMN "created_by_user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_agent_policy_revisions" ADD COLUMN "created_by_system_actor_id" text;
--> statement-breakpoint
ALTER TABLE "workspace_agent_policy_revisions" ADD COLUMN "initiating_user_id" text REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "workspace_agent_policy_revisions" ADD CONSTRAINT "workspace_agent_policy_revisions_actor_check" CHECK (
  ("created_by_user_id" IS NOT NULL AND "created_by_system_actor_id" IS NULL AND "initiating_user_id" IS NULL)
  OR
  ("created_by_user_id" IS NULL AND "created_by_system_actor_id" = 'tasmeemai:builtin-service-authority@1' AND "initiating_user_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ALTER COLUMN "updated_by_user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ADD COLUMN "updated_by_system_actor_id" text;
--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ADD COLUMN "initiating_user_id" text REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "workspace_agent_policies" ADD CONSTRAINT "workspace_agent_policies_actor_check" CHECK (
  ("updated_by_user_id" IS NOT NULL AND "updated_by_system_actor_id" IS NULL AND "initiating_user_id" IS NULL)
  OR
  ("updated_by_user_id" IS NULL AND "updated_by_system_actor_id" = 'tasmeemai:builtin-service-authority@1' AND "initiating_user_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "agent_security_events" ADD COLUMN "system_actor_id" text;
--> statement-breakpoint
ALTER TABLE "agent_security_events" ADD COLUMN "initiating_user_id" text REFERENCES "user"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "agent_security_events" ADD CONSTRAINT "agent_security_events_system_actor_check" CHECK (
  "system_actor_id" IS NULL
  OR ("actor_user_id" IS NULL AND "system_actor_id" = 'tasmeemai:builtin-service-authority@1' AND "initiating_user_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_grant_sets_workspace_principal_id_unique" ON "agent_grant_sets" ("workspace_id","principal_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_grant_revisions_set_id_unique" ON "agent_grant_revisions" ("grant_set_id","id");
--> statement-breakpoint
CREATE TABLE "built_in_agent_authority_provisioning_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "purpose" text NOT NULL,
  "system_actor_id" text NOT NULL,
  "initiating_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "sponsor_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "principal_id" text NOT NULL,
  "key_id" text NOT NULL REFERENCES "agent_keys"("id") ON DELETE RESTRICT,
  "grant_set_id" text NOT NULL REFERENCES "agent_grant_sets"("id") ON DELETE RESTRICT,
  "grant_revision_id" text NOT NULL REFERENCES "agent_grant_revisions"("id") ON DELETE RESTRICT,
  "grant_revision" integer NOT NULL,
  "policy_revision_id" text NOT NULL REFERENCES "workspace_agent_policy_revisions"("id") ON DELETE RESTRICT,
  "policy_revision" integer NOT NULL,
  "capability" text NOT NULL,
  "authorization_contract_digest" text NOT NULL,
  "resources" jsonb NOT NULL,
  "request_id" text NOT NULL,
  "request_fingerprint" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "built_in_agent_authority_receipts_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "agent_principals"("workspace_id","id") ON DELETE RESTRICT,
  CONSTRAINT "built_in_agent_authority_receipts_key_fk" FOREIGN KEY ("principal_id","key_id") REFERENCES "agent_keys"("principal_id","id") ON DELETE RESTRICT,
  CONSTRAINT "built_in_agent_authority_receipts_grant_set_fk" FOREIGN KEY ("workspace_id","principal_id","grant_set_id") REFERENCES "agent_grant_sets"("workspace_id","principal_id","id") ON DELETE RESTRICT,
  CONSTRAINT "built_in_agent_authority_receipts_grant_revision_fk" FOREIGN KEY ("grant_set_id","grant_revision_id") REFERENCES "agent_grant_revisions"("grant_set_id","id") ON DELETE RESTRICT,
  CONSTRAINT "built_in_agent_authority_receipts_policy_revision_fk" FOREIGN KEY ("workspace_id","policy_revision_id") REFERENCES "workspace_agent_policy_revisions"("workspace_id","id") ON DELETE RESTRICT,
  CONSTRAINT "built_in_agent_authority_receipts_purpose_check" CHECK (
    ("purpose" = 'content_workflow' AND "capability" = 'workflow_runs.start@2')
    OR
    ("purpose" = 'calendar_reschedule' AND "capability" = 'publishing_plan_revisions.create@1')
  ),
  CONSTRAINT "built_in_agent_authority_receipts_actor_check" CHECK ("system_actor_id" = 'tasmeemai:builtin-service-authority@1'),
  CONSTRAINT "built_in_agent_authority_receipts_digest_check" CHECK ("authorization_contract_digest" ~ '^sha256:[a-f0-9]{64}$' AND "request_fingerprint" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "built_in_agent_authority_receipts_revision_check" CHECK ("grant_revision" > 0 AND "policy_revision" > 0),
  CONSTRAINT "built_in_agent_authority_receipts_resources_check" CHECK (
    jsonb_typeof("resources") = 'object'
    AND "resources" ?& array['channelIds','credentialProfileIds','workflowIds','automationIds','artifactIds']
    AND ("resources" - array['channelIds','credentialProfileIds','workflowIds','automationIds','artifactIds']) = '{}'::jsonb
    AND jsonb_typeof("resources"->'channelIds') = 'array'
    AND jsonb_typeof("resources"->'credentialProfileIds') = 'array'
    AND jsonb_typeof("resources"->'workflowIds') = 'array'
    AND jsonb_typeof("resources"->'automationIds') = 'array'
    AND jsonb_typeof("resources"->'artifactIds') = 'array'
    AND (
      ("purpose" = 'content_workflow' AND "resources"->'channelIds' = '[]'::jsonb AND "resources"->'credentialProfileIds' = '[]'::jsonb AND "resources"->'automationIds' = '[]'::jsonb)
      OR
      ("purpose" = 'calendar_reschedule' AND "resources"->'credentialProfileIds' = '[]'::jsonb AND "resources"->'workflowIds' = '[]'::jsonb AND "resources"->'automationIds' = '[]'::jsonb)
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "built_in_agent_authority_receipts_request_unique" ON "built_in_agent_authority_provisioning_receipts" ("workspace_id","purpose","request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "built_in_agent_authority_receipts_key_unique" ON "built_in_agent_authority_provisioning_receipts" ("key_id");
--> statement-breakpoint
CREATE INDEX "built_in_agent_authority_receipts_initiator_idx" ON "built_in_agent_authority_provisioning_receipts" ("workspace_id","initiating_user_id","created_at");
--> statement-breakpoint
CREATE FUNCTION prevent_built_in_agent_authority_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'built-in Agent authority provisioning evidence is immutable'; END; $$;
--> statement-breakpoint
CREATE TRIGGER "built_in_agent_authority_receipts_immutable" BEFORE UPDATE OR DELETE ON "built_in_agent_authority_provisioning_receipts" FOR EACH ROW EXECUTE FUNCTION prevent_built_in_agent_authority_receipt_mutation();
