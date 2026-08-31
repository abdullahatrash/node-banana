ALTER TABLE "credential_spend_events" DROP CONSTRAINT "credential_spend_events_state_check";--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_state_check" CHECK ((
        ("credential_spend_events"."status" = 'pending'
          and "credential_spend_events"."safe_result" is null
          and "credential_spend_events"."failure_code" is null
          and "credential_spend_events"."completed_at" is null
          and "credential_spend_events"."failed_at" is null
          and "credential_spend_events"."unknown_at" is null)
        or
        ("credential_spend_events"."status" = 'completed'
          and "credential_spend_events"."safe_result" is not null
          and "credential_spend_events"."failure_code" is null
          and "credential_spend_events"."completed_at" is not null
          and "credential_spend_events"."failed_at" is null)
        or
        ("credential_spend_events"."status" = 'failed'
          and "credential_spend_events"."failure_code" is not null
          and "credential_spend_events"."completed_at" is null
          and "credential_spend_events"."failed_at" is not null
          and "credential_spend_events"."unknown_at" is null)
        or
        ("credential_spend_events"."status" = 'unknown'
          and "credential_spend_events"."safe_result" is null
          and "credential_spend_events"."failure_code" is not null
          and "credential_spend_events"."completed_at" is null
          and "credential_spend_events"."failed_at" is null
          and "credential_spend_events"."unknown_at" is not null)
      ));