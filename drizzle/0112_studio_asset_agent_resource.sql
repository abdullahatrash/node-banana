ALTER TABLE "built_in_agent_authority_provisioning_receipts"
  DROP CONSTRAINT "built_in_agent_authority_receipts_purpose_check";
--> statement-breakpoint
ALTER TABLE "built_in_agent_authority_provisioning_receipts"
  ADD CONSTRAINT "built_in_agent_authority_receipts_purpose_check" CHECK (
    ("purpose" = 'content_workflow' AND "capability" IN ('workflow_runs.start@2', 'workflow_runs.start@3'))
    OR
    ("purpose" = 'calendar_reschedule' AND "capability" = 'publishing_plan_revisions.create@1')
  );
--> statement-breakpoint
ALTER TABLE "built_in_agent_authority_provisioning_receipts"
  DROP CONSTRAINT "built_in_agent_authority_receipts_resources_check";
--> statement-breakpoint
ALTER TABLE "built_in_agent_authority_provisioning_receipts"
  ADD CONSTRAINT "built_in_agent_authority_receipts_resources_check" CHECK (
    jsonb_typeof("resources") = 'object'
    AND "resources" ?& array['channelIds','credentialProfileIds','workflowIds','automationIds','artifactIds']
    AND ("resources" - array['channelIds','credentialProfileIds','workflowIds','automationIds','studioAssetIds','artifactIds']) = '{}'::jsonb
    AND jsonb_typeof("resources"->'channelIds') = 'array'
    AND jsonb_typeof("resources"->'credentialProfileIds') = 'array'
    AND jsonb_typeof("resources"->'workflowIds') = 'array'
    AND jsonb_typeof("resources"->'automationIds') = 'array'
    AND (NOT ("resources" ? 'studioAssetIds') OR jsonb_typeof("resources"->'studioAssetIds') = 'array')
    AND jsonb_typeof("resources"->'artifactIds') = 'array'
    AND ("capability" <> 'workflow_runs.start@3' OR "resources" ? 'studioAssetIds')
    AND (
      (
        "purpose" = 'content_workflow'
        AND "resources"->'channelIds' = '[]'::jsonb
        AND "resources"->'credentialProfileIds' = '[]'::jsonb
        AND "resources"->'automationIds' = '[]'::jsonb
      )
      OR
      (
        "purpose" = 'calendar_reschedule'
        AND "resources"->'credentialProfileIds' = '[]'::jsonb
        AND "resources"->'workflowIds' = '[]'::jsonb
        AND "resources"->'automationIds' = '[]'::jsonb
        AND (NOT ("resources" ? 'studioAssetIds') OR "resources"->'studioAssetIds' = '[]'::jsonb)
      )
    )
  );
--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts"
  DROP CONSTRAINT "workflow_run_mutation_receipts_capability_check";
--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts"
  ADD CONSTRAINT "workflow_run_mutation_receipts_capability_check" CHECK (
    "capability" IN (
      'workflow_runs.start@1',
      'workflow_runs.start@2',
      'workflow_runs.start@3',
      'workflow_runs.retry@1',
      'workflow_runs.reconcile@1',
      'workflow_runs.resume@1'
    )
  );
--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts"
  DROP CONSTRAINT "workflow_run_mutation_receipts_result_check";
--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts"
  ADD CONSTRAINT "workflow_run_mutation_receipts_result_check" CHECK (
    (
      "capability" IN (
        'workflow_runs.start@1',
        'workflow_runs.start@2',
        'workflow_runs.start@3'
      )
      AND "result" IS NULL
    ) OR (
      "capability" IN (
        'workflow_runs.retry@1',
        'workflow_runs.reconcile@1',
        'workflow_runs.resume@1'
      )
      AND jsonb_typeof("result") = 'object'
      AND "result"->'run'->>'id' = "run_id"
      AND "result"->'inspect'->>'capability' = 'workflow_runs.get@1'
      AND "result"->'inspect'->'input'->>'runId' = "run_id"
      AND "result"->'events'->>'capability' = 'workflow_run_events.list@1'
      AND "result"->'events'->'input'->>'runId' = "run_id"
      AND "result"->'events'->'input'->>'cursor' = "initial_event_cursor"
      AND octet_length("result"::text) <= 2097152
    )
  );
