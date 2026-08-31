CREATE TABLE "runtime_publishing_delivery_cancellations" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"principal_id" text,
	"key_id" text,
	"user_id" text,
	"capability" text NOT NULL,
	"authorization_session_id" text NOT NULL,
	"authorization_contract_digest" text NOT NULL,
	"authorization_admission_evidence_ref" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"authorization_evidence_digest" text NOT NULL,
	"authorized_resources" jsonb NOT NULL,
	"authority_grants" jsonb NOT NULL,
	"authorization_issued_at" timestamp with time zone NOT NULL,
	"authorization_expires_at" timestamp with time zone NOT NULL,
	"state_at_request" text NOT NULL,
	"outcome" text NOT NULL,
	"externally_completed_at_request" boolean,
	"externally_reversed" boolean NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_delivery_cancellations_pk" PRIMARY KEY("workspace_id","delivery_id"),
	CONSTRAINT "runtime_publishing_delivery_cancellations_identity_check" CHECK ("runtime_publishing_delivery_cancellations"."id" ~ '^pdc_[A-Za-z0-9_-]+$'
        and length("runtime_publishing_delivery_cancellations"."id") between 1 and 200
        and length("runtime_publishing_delivery_cancellations"."authorization_session_id") between 1 and 200),
	CONSTRAINT "runtime_publishing_delivery_cancellations_actor_check" CHECK (("runtime_publishing_delivery_cancellations"."actor_kind" = 'agent'
          and "runtime_publishing_delivery_cancellations"."actor_id" = "runtime_publishing_delivery_cancellations"."principal_id"
          and "runtime_publishing_delivery_cancellations"."principal_id" is not null
          and "runtime_publishing_delivery_cancellations"."key_id" is not null
          and "runtime_publishing_delivery_cancellations"."user_id" is null
          and jsonb_array_length("runtime_publishing_delivery_cancellations"."authority_grants") = 0)
        or ("runtime_publishing_delivery_cancellations"."actor_kind" = 'human'
          and "runtime_publishing_delivery_cancellations"."actor_id" = "runtime_publishing_delivery_cancellations"."user_id"
          and "runtime_publishing_delivery_cancellations"."user_id" is not null
          and "runtime_publishing_delivery_cancellations"."principal_id" is null
          and "runtime_publishing_delivery_cancellations"."key_id" is null
          and jsonb_array_length("runtime_publishing_delivery_cancellations"."authority_grants") = 1)),
	CONSTRAINT "runtime_publishing_delivery_cancellations_authorization_check" CHECK ("runtime_publishing_delivery_cancellations"."capability" = 'publishing_deliveries.cancel@1'
        and "runtime_publishing_delivery_cancellations"."authorization_contract_digest" = 'sha256:cae0f4b46fca3c38dd014bf2c27b2b8f2a3555d24eb62da60c367e49f2e1554e'
        and length("runtime_publishing_delivery_cancellations"."authorization_admission_evidence_ref") between 1 and 200
        and length("runtime_publishing_delivery_cancellations"."authorization_evidence_ref") between 1 and 200
        and "runtime_publishing_delivery_cancellations"."authorization_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof("runtime_publishing_delivery_cancellations"."authorized_resources") = 'object'
        and "runtime_publishing_delivery_cancellations"."authorized_resources" ?& array['channelIds','artifactIds']
        and ("runtime_publishing_delivery_cancellations"."authorized_resources" - array['channelIds','artifactIds']) = '{}'::jsonb
        and jsonb_typeof("runtime_publishing_delivery_cancellations"."authorized_resources"->'channelIds') = 'array'
        and jsonb_array_length("runtime_publishing_delivery_cancellations"."authorized_resources"->'channelIds') between 1 and 50
        and jsonb_typeof("runtime_publishing_delivery_cancellations"."authorized_resources"->'artifactIds') = 'array'
        and jsonb_array_length("runtime_publishing_delivery_cancellations"."authorized_resources"->'artifactIds') between 1 and 200
        and jsonb_typeof("runtime_publishing_delivery_cancellations"."authority_grants") = 'array'
        and jsonb_array_length("runtime_publishing_delivery_cancellations"."authority_grants") between 0 and 50
        and "runtime_publishing_delivery_cancellations"."authorization_expires_at" > "runtime_publishing_delivery_cancellations"."authorization_issued_at"
        and "runtime_publishing_delivery_cancellations"."requested_at" >= "runtime_publishing_delivery_cancellations"."authorization_issued_at"
        and "runtime_publishing_delivery_cancellations"."requested_at" < "runtime_publishing_delivery_cancellations"."authorization_expires_at"),
	CONSTRAINT "runtime_publishing_delivery_cancellations_result_check" CHECK ("runtime_publishing_delivery_cancellations"."state_at_request" in (
          'scheduled','dispatching','confirmation_pending','succeeded',
          'failed','outcome_unknown','cancelled'
        )
        and "runtime_publishing_delivery_cancellations"."outcome" in ('prevented','conditional','unknown','too_late')
        and "runtime_publishing_delivery_cancellations"."externally_reversed" = false
        and (("runtime_publishing_delivery_cancellations"."outcome" = 'prevented' and "runtime_publishing_delivery_cancellations"."state_at_request" in ('scheduled','dispatching'))
          or ("runtime_publishing_delivery_cancellations"."outcome" = 'conditional' and "runtime_publishing_delivery_cancellations"."state_at_request" = 'confirmation_pending')
          or ("runtime_publishing_delivery_cancellations"."outcome" = 'unknown' and "runtime_publishing_delivery_cancellations"."state_at_request" in ('scheduled','dispatching','outcome_unknown'))
          or ("runtime_publishing_delivery_cancellations"."outcome" = 'too_late' and "runtime_publishing_delivery_cancellations"."state_at_request" in ('succeeded','failed')))
        and (("runtime_publishing_delivery_cancellations"."outcome" in ('unknown','conditional')
            and "runtime_publishing_delivery_cancellations"."externally_completed_at_request" is null)
          or ("runtime_publishing_delivery_cancellations"."outcome" = 'prevented'
            and "runtime_publishing_delivery_cancellations"."externally_completed_at_request" = false)
          or ("runtime_publishing_delivery_cancellations"."outcome" = 'too_late'
            and "runtime_publishing_delivery_cancellations"."externally_completed_at_request" = ("runtime_publishing_delivery_cancellations"."state_at_request" = 'succeeded'))))
);
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" DROP CONSTRAINT "runtime_publishing_deliveries_state_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" DROP CONSTRAINT "runtime_publishing_deliveries_lifecycle_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" DROP CONSTRAINT "runtime_publishing_deliveries_time_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_events" DROP CONSTRAINT "runtime_publishing_delivery_events_type_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "effect_contact_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" DISABLE TRIGGER "runtime_publishing_deliveries_identity_immutable";--> statement-breakpoint
UPDATE "runtime_publishing_deliveries"
SET "effect_contact_started_at" = "dispatch_started_at"
WHERE "intent_digest" IS NOT NULL
	AND "dispatch_started_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ENABLE TRIGGER "runtime_publishing_deliveries_identity_immutable";--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_cancellations" ADD CONSTRAINT "runtime_publishing_delivery_cancellations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_cancellations" ADD CONSTRAINT "runtime_publishing_delivery_cancellations_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_cancellations" ADD CONSTRAINT "runtime_publishing_delivery_cancellations_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_cancellations" ADD CONSTRAINT "runtime_publishing_delivery_cancellations_key_fk" FOREIGN KEY ("principal_id","key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_cancellations" ADD CONSTRAINT "runtime_publishing_delivery_cancellations_agent_evidence_fk" FOREIGN KEY ("workspace_id","principal_id","key_id","authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_cancellations_identity_unique" ON "runtime_publishing_delivery_cancellations" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_cancellations_actor_idx" ON "runtime_publishing_delivery_cancellations" USING btree ("workspace_id","actor_kind","actor_id","requested_at");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_cancellations_principal_idx" ON "runtime_publishing_delivery_cancellations" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_cancellations_key_idx" ON "runtime_publishing_delivery_cancellations" USING btree ("principal_id","key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_cancellations_agent_evidence_idx" ON "runtime_publishing_delivery_cancellations" USING btree ("workspace_id","principal_id","key_id","authorization_evidence_ref");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_cancellations_user_idx" ON "runtime_publishing_delivery_cancellations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_cancellations_requested_idx" ON "runtime_publishing_delivery_cancellations" USING btree ("workspace_id","requested_at","delivery_id");--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_state_check" CHECK ("runtime_publishing_deliveries"."desired_state" in ('publish','cancel')
        and "runtime_publishing_deliveries"."state" in (
          'scheduled','dispatching','confirmation_pending',
          'succeeded','failed','outcome_unknown','cancelled'
        )
        and "runtime_publishing_deliveries"."next_event_sequence" >= 3
        and "runtime_publishing_deliveries"."next_outbox_generation" >= 2);--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_lifecycle_check" CHECK (("runtime_publishing_deliveries"."state" = 'scheduled'
          and "runtime_publishing_deliveries"."desired_state" = 'publish'
          and "runtime_publishing_deliveries"."intent_digest" is null
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'scheduled'
          and "runtime_publishing_deliveries"."desired_state" = 'publish'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'dispatching'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'confirmation_pending'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'succeeded'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" = 'failed'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" = 'failed'
          and "runtime_publishing_deliveries"."intent_digest" is null
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is null
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" = 'outcome_unknown'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" = 'cancelled'
          and "runtime_publishing_deliveries"."desired_state" = 'cancel'
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is null
          and (("runtime_publishing_deliveries"."intent_digest" is null and "runtime_publishing_deliveries"."dispatch_started_at" is null)
            or ("runtime_publishing_deliveries"."intent_digest" is not null and "runtime_publishing_deliveries"."dispatch_started_at" is not null))
          and "runtime_publishing_deliveries"."completed_at" is not null));--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_time_check" CHECK ("runtime_publishing_deliveries"."scheduled_at" >= "runtime_publishing_deliveries"."accepted_at"
        and "runtime_publishing_deliveries"."updated_at" >= "runtime_publishing_deliveries"."accepted_at"
        and ("runtime_publishing_deliveries"."dispatch_started_at" is null or "runtime_publishing_deliveries"."dispatch_started_at" >= "runtime_publishing_deliveries"."accepted_at")
        and ("runtime_publishing_deliveries"."effect_contact_started_at" is null or (
          "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" >= "runtime_publishing_deliveries"."dispatch_started_at"
        ))
        and ("runtime_publishing_deliveries"."completed_at" is null or "runtime_publishing_deliveries"."completed_at" >= "runtime_publishing_deliveries"."dispatch_started_at"));--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_events" ADD CONSTRAINT "runtime_publishing_delivery_events_type_check" CHECK ("runtime_publishing_delivery_events"."type" in (
        'delivery.accepted','delivery.scheduled','delivery.cancellation_requested',
        'delivery.cancelled','effect.not_created','effect.prepared','effect.contact_started',
        'publication.confirmation_pending','publication.retry_scheduled',
        'publication.succeeded','publication.failed',
        'publication.outcome_unknown'
      ));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "runtime_publishing_delivery_event_insert_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	next_sequence integer;
BEGIN
	SELECT "next_event_sequence" INTO next_sequence
	FROM "runtime_publishing_deliveries"
	WHERE "workspace_id" = NEW.workspace_id AND "id" = NEW.delivery_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'Publishing Delivery event has no canonical Delivery';
	END IF;
	IF NEW.sequence = 1 AND NEW.type = 'delivery.accepted' AND next_sequence = 3 THEN
		RETURN NEW;
	END IF;
	IF NEW.sequence = 2 AND NEW.type = 'delivery.scheduled' AND next_sequence = 3 THEN
		RETURN NEW;
	END IF;
	IF NEW.sequence = next_sequence AND NEW.type IN (
		'delivery.cancellation_requested','effect.not_created','effect.prepared',
		'effect.contact_started','publication.confirmation_pending',
		'publication.retry_scheduled','publication.succeeded',
		'publication.failed','publication.outcome_unknown'
	) THEN
		RETURN NEW;
	END IF;
	IF NEW.sequence = next_sequence + 1 AND (
		(NEW.type = 'delivery.cancelled' AND EXISTS (
			SELECT 1 FROM "runtime_publishing_delivery_events" e
			WHERE e.workspace_id = NEW.workspace_id AND e.delivery_id = NEW.delivery_id
				AND e.sequence = next_sequence
				AND e.type = 'delivery.cancellation_requested'
				AND e.evidence->>'cancellationId' = NEW.evidence->>'cancellationId'
		)) OR
		(NEW.type = 'publication.outcome_unknown'
			AND NEW.evidence->>'failureCode' = 'CANCELLED_AFTER_EFFECT_CONTACT'
			AND EXISTS (
				SELECT 1 FROM "runtime_publishing_delivery_events" e
				WHERE e.workspace_id = NEW.workspace_id AND e.delivery_id = NEW.delivery_id
					AND e.sequence = next_sequence
					AND e.type = 'delivery.cancellation_requested'
			))
	) THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'Publishing Delivery event is out of sequence';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "runtime_publishing_delivery_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	event_type text;
	event_delta integer;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Publishing Deliveries cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY[
		'desired_state','state','intent_digest','provider_operation_ref',
		'latest_effect_evidence_digest','failure_code','next_event_sequence',
		'next_outbox_generation','dispatch_started_at','effect_contact_started_at',
		'completed_at','updated_at'
	]) <> (to_jsonb(OLD) - ARRAY[
		'desired_state','state','intent_digest','provider_operation_ref',
		'latest_effect_evidence_digest','failure_code','next_event_sequence',
		'next_outbox_generation','dispatch_started_at','effect_contact_started_at',
		'completed_at','updated_at'
	]) THEN
		RAISE EXCEPTION 'Publishing Delivery release identity is immutable';
	END IF;
	event_delta := NEW.next_event_sequence - OLD.next_event_sequence;
	IF NEW.updated_at < OLD.updated_at OR event_delta NOT IN (1, 2) THEN
		RAISE EXCEPTION 'Publishing Delivery transition must append ordered events';
	END IF;
	IF OLD.desired_state = 'cancel' AND NEW.desired_state <> 'cancel' THEN
		RAISE EXCEPTION 'Publishing Delivery cancellation desired state is irreversible';
	END IF;

	IF OLD.desired_state = 'publish' AND NEW.desired_state = 'cancel' THEN
		IF OLD.state IN ('scheduled','dispatching') AND
			OLD.effect_contact_started_at IS NULL AND NEW.state = 'cancelled' AND
			NEW.effect_contact_started_at IS NULL AND event_delta = 2 AND
			NEW.intent_digest IS NOT DISTINCT FROM OLD.intent_digest AND
			NEW.provider_operation_ref IS NOT DISTINCT FROM OLD.provider_operation_ref AND
			NEW.latest_effect_evidence_digest IS NOT DISTINCT FROM OLD.latest_effect_evidence_digest AND
			NEW.failure_code IS NOT DISTINCT FROM OLD.failure_code AND
			NEW.dispatch_started_at IS NOT DISTINCT FROM OLD.dispatch_started_at AND
			OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
			IF NOT EXISTS (SELECT 1 FROM "runtime_publishing_delivery_events"
				WHERE workspace_id = OLD.workspace_id AND delivery_id = OLD.id
					AND sequence = OLD.next_event_sequence
					AND type = 'delivery.cancellation_requested') OR
				NOT EXISTS (SELECT 1 FROM "runtime_publishing_delivery_events"
				WHERE workspace_id = OLD.workspace_id AND delivery_id = OLD.id
					AND sequence = OLD.next_event_sequence + 1
					AND type = 'delivery.cancelled') THEN
				RAISE EXCEPTION 'Publishing Delivery prevention evidence is incomplete';
			END IF;
		ELSIF OLD.state IN ('scheduled','dispatching') AND
			OLD.effect_contact_started_at IS NOT NULL AND NEW.state = 'outcome_unknown' AND
			NEW.effect_contact_started_at = OLD.effect_contact_started_at AND event_delta = 2 AND
			NEW.intent_digest IS NOT DISTINCT FROM OLD.intent_digest AND
			NEW.provider_operation_ref IS NULL AND
			NEW.dispatch_started_at IS NOT DISTINCT FROM OLD.dispatch_started_at AND
			NEW.latest_effect_evidence_digest IS NOT NULL AND
			NEW.failure_code = 'CANCELLED_AFTER_EFFECT_CONTACT' AND
			OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
			IF NOT EXISTS (SELECT 1 FROM "runtime_publishing_delivery_events"
				WHERE workspace_id = OLD.workspace_id AND delivery_id = OLD.id
					AND sequence = OLD.next_event_sequence
					AND type = 'delivery.cancellation_requested') OR
				NOT EXISTS (SELECT 1 FROM "runtime_publishing_delivery_events"
				WHERE workspace_id = OLD.workspace_id AND delivery_id = OLD.id
					AND sequence = OLD.next_event_sequence + 1
					AND type = 'publication.outcome_unknown'
					AND evidence->>'failureCode' = 'CANCELLED_AFTER_EFFECT_CONTACT') THEN
				RAISE EXCEPTION 'Publishing Delivery unknown cancellation evidence is incomplete';
			END IF;
		ELSIF NEW.state = OLD.state AND
			NEW.effect_contact_started_at IS NOT DISTINCT FROM OLD.effect_contact_started_at AND
			event_delta = 1 AND
			NEW.intent_digest IS NOT DISTINCT FROM OLD.intent_digest AND
			NEW.provider_operation_ref IS NOT DISTINCT FROM OLD.provider_operation_ref AND
			NEW.latest_effect_evidence_digest IS NOT DISTINCT FROM OLD.latest_effect_evidence_digest AND
			NEW.failure_code IS NOT DISTINCT FROM OLD.failure_code AND
			NEW.dispatch_started_at IS NOT DISTINCT FROM OLD.dispatch_started_at AND
			NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at THEN
			IF NOT EXISTS (SELECT 1 FROM "runtime_publishing_delivery_events"
				WHERE workspace_id = OLD.workspace_id AND delivery_id = OLD.id
					AND sequence = OLD.next_event_sequence
					AND type = 'delivery.cancellation_requested') THEN
				RAISE EXCEPTION 'Publishing Delivery cancellation request evidence is missing';
			END IF;
		ELSE
			RAISE EXCEPTION 'Invalid Publishing Delivery cancellation transition';
		END IF;
	ELSIF NEW.state = OLD.state AND event_delta = 1 AND
		NEW.effect_contact_started_at IS NOT NULL AND
		(OLD.effect_contact_started_at IS NULL OR (
			OLD.effect_contact_started_at = NEW.effect_contact_started_at AND
			NOT EXISTS (SELECT 1 FROM "runtime_publishing_delivery_events"
				WHERE workspace_id = OLD.workspace_id AND delivery_id = OLD.id
					AND type = 'effect.contact_started'
			))) THEN
		event_type := 'effect.contact_started';
	ELSIF OLD.desired_state = 'cancel' AND
		OLD.state IN ('scheduled','dispatching') AND NEW.state = 'outcome_unknown' AND
		OLD.effect_contact_started_at IS NOT NULL AND event_delta = 1 AND
		NEW.intent_digest IS NOT DISTINCT FROM OLD.intent_digest AND
		NEW.provider_operation_ref IS NULL AND
		NEW.dispatch_started_at IS NOT DISTINCT FROM OLD.dispatch_started_at AND
		NEW.effect_contact_started_at = OLD.effect_contact_started_at AND
		NEW.latest_effect_evidence_digest IS NOT NULL AND
		NEW.failure_code IS NOT NULL AND
		NEW.completed_at IS NOT NULL THEN
		event_type := 'publication.outcome_unknown';
	ELSIF OLD.state = 'scheduled' AND NEW.state = 'dispatching' AND
		NEW.effect_contact_started_at IS NULL THEN
		event_type := 'effect.prepared';
	ELSIF OLD.state = 'scheduled' AND NEW.state = 'failed' AND OLD.intent_digest IS NULL THEN
		event_type := 'effect.not_created';
	ELSIF OLD.state = 'dispatching' AND NEW.state = 'scheduled' THEN
		event_type := 'publication.retry_scheduled';
	ELSIF OLD.state IN ('dispatching','confirmation_pending') AND NEW.state = 'confirmation_pending' THEN
		event_type := 'publication.confirmation_pending';
	ELSIF OLD.state IN ('dispatching','confirmation_pending') AND NEW.state = 'succeeded' THEN
		event_type := 'publication.succeeded';
	ELSIF OLD.state IN ('dispatching','confirmation_pending') AND NEW.state = 'failed' THEN
		event_type := 'publication.failed';
	ELSIF OLD.desired_state = 'cancel' AND OLD.state = 'confirmation_pending' AND
		NEW.state = 'outcome_unknown' AND
		NEW.intent_digest IS NOT DISTINCT FROM OLD.intent_digest AND
		NEW.provider_operation_ref IS NULL AND
		NEW.dispatch_started_at IS NOT DISTINCT FROM OLD.dispatch_started_at AND
		NEW.effect_contact_started_at = OLD.effect_contact_started_at AND
		NEW.latest_effect_evidence_digest IS NOT NULL AND NEW.failure_code IS NOT NULL AND
		NEW.completed_at IS NOT NULL THEN
		event_type := 'publication.outcome_unknown';
	ELSIF OLD.desired_state = 'publish' AND
		OLD.state IN ('dispatching','confirmation_pending') AND NEW.state = 'outcome_unknown' THEN
		event_type := 'publication.outcome_unknown';
	ELSE
		RAISE EXCEPTION 'Invalid Publishing Delivery state transition';
	END IF;

	IF event_type IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "runtime_publishing_delivery_events"
		WHERE workspace_id = OLD.workspace_id AND delivery_id = OLD.id
			AND sequence = OLD.next_event_sequence AND type = event_type
	) THEN
		RAISE EXCEPTION 'Publishing Delivery transition event is missing';
	END IF;
	IF event_type NOT IN ('effect.prepared','effect.contact_started') AND
		NEW.effect_contact_started_at IS DISTINCT FROM OLD.effect_contact_started_at THEN
		RAISE EXCEPTION 'Publishing Delivery contact boundary changed without its event';
	END IF;
	IF NEW.next_outbox_generation = OLD.next_outbox_generation + 1 THEN
		IF event_type NOT IN ('publication.retry_scheduled','publication.confirmation_pending')
			OR NOT EXISTS (
				SELECT 1 FROM "runtime_publishing_delivery_outbox_intents"
				WHERE workspace_id = OLD.workspace_id AND delivery_id = OLD.id
					AND generation = OLD.next_outbox_generation AND state = 'pending'
			) THEN
			RAISE EXCEPTION 'Publishing Delivery follow-up outbox is missing';
		END IF;
	ELSIF NEW.next_outbox_generation <> OLD.next_outbox_generation THEN
		RAISE EXCEPTION 'Publishing Delivery outbox generation is not monotonic';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_cancellations_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_cancellations"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_delivery_cancellation_commit_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	delivery_row "runtime_publishing_deliveries"%ROWTYPE;
	channel_count integer;
	artifact_count integer;
	grant_count integer;
BEGIN
	SELECT * INTO delivery_row FROM "runtime_publishing_deliveries"
	WHERE workspace_id = NEW.workspace_id AND id = NEW.delivery_id;
	IF NOT FOUND OR delivery_row.desired_state <> 'cancel' THEN
		RAISE EXCEPTION 'Publishing Delivery cancellation has no canonical desired state';
	END IF;
	SELECT count(*), count(DISTINCT value) INTO channel_count, grant_count
	FROM jsonb_array_elements_text(NEW.authorized_resources->'channelIds') AS x(value);
	SELECT count(DISTINCT value) INTO artifact_count
	FROM jsonb_array_elements_text(NEW.authorized_resources->'artifactIds') AS x(value);
	IF channel_count <> 1 OR grant_count <> 1 OR
		NEW.authorized_resources->'channelIds'->>0 <> delivery_row.channel_id OR
		artifact_count <> jsonb_array_length(NEW.authorized_resources->'artifactIds') OR
		NOT (NEW.authorized_resources->'artifactIds' @> delivery_row.artifact_ids AND
			delivery_row.artifact_ids @> NEW.authorized_resources->'artifactIds') THEN
		RAISE EXCEPTION 'Publishing Delivery cancellation resources are not exact';
	END IF;
	IF (NEW.actor_kind = 'agent' AND jsonb_array_length(NEW.authority_grants) <> 0) OR
		(NEW.actor_kind = 'human' AND (
			jsonb_array_length(NEW.authority_grants) <> 1 OR
			jsonb_typeof(NEW.authority_grants->0) <> 'object' OR
			NOT (NEW.authority_grants->0 ?& array['channelId','grantId']) OR
			(NEW.authority_grants->0 - array['channelId','grantId']) <> '{}'::jsonb OR
			NEW.authority_grants->0->>'channelId' <> delivery_row.channel_id
		)) THEN
		RAISE EXCEPTION 'Publishing Delivery Human grant evidence is not exact';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM "runtime_publishing_delivery_events" e
		WHERE e.workspace_id = NEW.workspace_id AND e.delivery_id = NEW.delivery_id
			AND e.type = 'delivery.cancellation_requested'
			AND e.evidence->>'cancellationId' = NEW.id
			AND e.evidence->>'actorKind' = NEW.actor_kind
	) THEN
		RAISE EXCEPTION 'Publishing Delivery cancellation request event is missing';
	END IF;
	IF NEW.outcome = 'prevented' AND (
		delivery_row.state <> 'cancelled' OR NOT EXISTS (
			SELECT 1 FROM "runtime_publishing_delivery_events" e
			WHERE e.workspace_id = NEW.workspace_id AND e.delivery_id = NEW.delivery_id
				AND e.type = 'delivery.cancelled'
				AND e.evidence->>'cancellationId' = NEW.id
		)
	) THEN
		RAISE EXCEPTION 'Publishing Delivery prevention proof is incomplete';
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "runtime_publishing_delivery_cancellation_complete"
AFTER INSERT ON "runtime_publishing_delivery_cancellations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_cancellation_commit_guard"();--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_delivery_cancellation_state_commit_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	matching_cancellations integer;
BEGIN
	IF OLD.desired_state <> 'publish' OR NEW.desired_state <> 'cancel' THEN
		RETURN NULL;
	END IF;
	SELECT count(*) INTO matching_cancellations
	FROM "runtime_publishing_delivery_cancellations" c
	JOIN "runtime_publishing_delivery_events" e
		ON e.workspace_id = c.workspace_id
		AND e.delivery_id = c.delivery_id
		AND e.sequence = OLD.next_event_sequence
		AND e.type = 'delivery.cancellation_requested'
		AND e.evidence->>'cancellationId' = c.id
		AND e.evidence->>'actorKind' = c.actor_kind
	WHERE c.workspace_id = OLD.workspace_id
		AND c.delivery_id = OLD.id
		AND c.state_at_request = OLD.state
		AND c.requested_at = e.occurred_at
		AND (
			(c.outcome = 'prevented'
				AND e.evidence->>'effectDisposition' = 'not_created') OR
			(c.outcome = 'conditional'
				AND e.evidence->>'effectDisposition' = 'provider_accepted') OR
			(c.outcome = 'unknown' AND (
				e.evidence->>'effectDisposition' = 'contact_started' OR
				(OLD.state = 'outcome_unknown'
					AND e.evidence->>'effectDisposition' = 'terminal')
			)) OR
			(c.outcome = 'too_late'
				AND e.evidence->>'effectDisposition' = 'terminal')
		);
	IF matching_cancellations <> 1 THEN
		RAISE EXCEPTION 'Publishing Delivery cancellation ledger is missing or inconsistent';
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "runtime_publishing_delivery_cancellation_state_complete"
AFTER UPDATE ON "runtime_publishing_deliveries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD.desired_state = 'publish' AND NEW.desired_state = 'cancel')
EXECUTE FUNCTION "runtime_publishing_delivery_cancellation_state_commit_guard"();
