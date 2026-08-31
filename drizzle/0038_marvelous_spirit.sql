ALTER TABLE "workflow_step_attempts" DROP CONSTRAINT "workflow_step_attempts_payload_check";--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD CONSTRAINT "workflow_step_attempts_payload_check" CHECK (jsonb_typeof("workflow_step_attempts"."inputs") = 'array'
        and octet_length("workflow_step_attempts"."inputs"::text) <= 262144
        and (
          "workflow_step_attempts"."outputs" is null
          or (
            jsonb_typeof("workflow_step_attempts"."outputs") = 'object'
            and octet_length("workflow_step_attempts"."outputs"::text) <= 262144
          )
        )
        and (
          "workflow_step_attempts"."outcome" is null
          or (
            jsonb_typeof("workflow_step_attempts"."outcome") = 'object'
            and octet_length("workflow_step_attempts"."outcome"::text) <= 4096
          )
        )
        and (
          "workflow_step_attempts"."reconciliation" is null
          or (
            jsonb_typeof("workflow_step_attempts"."reconciliation") = 'object'
            and octet_length("workflow_step_attempts"."reconciliation"::text) <= 4096
          )
        )
        and (
          "workflow_step_attempts"."provider_metadata" is null
          or (
            jsonb_typeof("workflow_step_attempts"."provider_metadata") = 'object'
            and octet_length("workflow_step_attempts"."provider_metadata"::text) <= 65536
          )
        ));