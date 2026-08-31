CREATE TABLE "runtime_publishing_deliveries" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"release_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_revision_id" text NOT NULL,
	"plan_revision" integer NOT NULL,
	"plan_revision_digest" text NOT NULL,
	"validation_evidence_digest" text NOT NULL,
	"approval_request_id" text NOT NULL,
	"approval_decision_id" text NOT NULL,
	"target_ordinal" integer NOT NULL,
	"target_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"artifact_ids" jsonb NOT NULL,
	"target_snapshot" jsonb NOT NULL,
	"target_snapshot_digest" text NOT NULL,
	"publish_at" timestamp with time zone NOT NULL,
	"desired_state" text NOT NULL,
	"state" text NOT NULL,
	"effect_key" text NOT NULL,
	"intent_digest" text,
	"provider_operation_ref" text,
	"latest_effect_evidence_digest" text,
	"failure_code" text,
	"next_event_sequence" integer NOT NULL,
	"next_outbox_generation" integer NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"dispatch_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_deliveries_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_deliveries_identity_check" CHECK ("runtime_publishing_deliveries"."id" ~ '^pdl_[A-Za-z0-9_-]+$'
        and length("runtime_publishing_deliveries"."id") between 1 and 200
        and length("runtime_publishing_deliveries"."target_id") between 1 and 200
        and length("runtime_publishing_deliveries"."channel_id") between 1 and 200
        and "runtime_publishing_deliveries"."target_ordinal" >= 0
        and "runtime_publishing_deliveries"."plan_revision" > 0
        and "runtime_publishing_deliveries"."plan_revision_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_deliveries"."validation_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_deliveries"."target_snapshot_digest" ~ '^sha256:[a-f0-9]{64}$'
        and length("runtime_publishing_deliveries"."effect_key") between 1 and 500
        and "runtime_publishing_deliveries"."effect_key" = btrim("runtime_publishing_deliveries"."effect_key")
        and "runtime_publishing_deliveries"."effect_key" !~ '[[:cntrl:]]'),
	CONSTRAINT "runtime_publishing_deliveries_snapshot_check" CHECK (jsonb_typeof("runtime_publishing_deliveries"."artifact_ids") = 'array'
        and jsonb_array_length("runtime_publishing_deliveries"."artifact_ids") between 1 and 51
        and jsonb_typeof("runtime_publishing_deliveries"."target_snapshot") = 'object'
        and "runtime_publishing_deliveries"."target_snapshot"->>'schema' = 'publishing-delivery-target-snapshot/v1'
        and "runtime_publishing_deliveries"."target_snapshot"->'target'->>'targetId' = "runtime_publishing_deliveries"."target_id"
        and "runtime_publishing_deliveries"."target_snapshot"->'target'->>'channelId' = "runtime_publishing_deliveries"."channel_id"
        and "runtime_publishing_deliveries"."target_snapshot"->>'targetDigest' ~ '^sha256:[a-f0-9]{64}$'
        and octet_length("runtime_publishing_deliveries"."target_snapshot"::text) <= 262144),
	CONSTRAINT "runtime_publishing_deliveries_state_check" CHECK ("runtime_publishing_deliveries"."desired_state" = 'publish'
        and "runtime_publishing_deliveries"."state" in (
          'scheduled','dispatching','confirmation_pending',
          'succeeded','failed','outcome_unknown'
        )
        and "runtime_publishing_deliveries"."next_event_sequence" >= 3
        and "runtime_publishing_deliveries"."next_outbox_generation" >= 2),
	CONSTRAINT "runtime_publishing_deliveries_evidence_check" CHECK (("runtime_publishing_deliveries"."intent_digest" is null or "runtime_publishing_deliveries"."intent_digest" ~ '^sha256:[a-f0-9]{64}$')
        and ("runtime_publishing_deliveries"."latest_effect_evidence_digest" is null or "runtime_publishing_deliveries"."latest_effect_evidence_digest" ~ '^sha256:[a-f0-9]{64}$')
        and ("runtime_publishing_deliveries"."provider_operation_ref" is null or (
          length("runtime_publishing_deliveries"."provider_operation_ref") between 1 and 500
          and "runtime_publishing_deliveries"."provider_operation_ref" = btrim("runtime_publishing_deliveries"."provider_operation_ref")
          and "runtime_publishing_deliveries"."provider_operation_ref" !~ '[[:cntrl:]]'
        ))
        and ("runtime_publishing_deliveries"."failure_code" is null or "runtime_publishing_deliveries"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,79}$')),
	CONSTRAINT "runtime_publishing_deliveries_lifecycle_check" CHECK (("runtime_publishing_deliveries"."state" = 'scheduled'
          and "runtime_publishing_deliveries"."intent_digest" is null
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'scheduled'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
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
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'succeeded'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" = 'failed'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" = 'failed'
          and "runtime_publishing_deliveries"."intent_digest" is null
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is null
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" = 'outcome_unknown'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is not null)),
	CONSTRAINT "runtime_publishing_deliveries_time_check" CHECK ("runtime_publishing_deliveries"."scheduled_at" >= "runtime_publishing_deliveries"."accepted_at"
        and "runtime_publishing_deliveries"."updated_at" >= "runtime_publishing_deliveries"."accepted_at"
        and ("runtime_publishing_deliveries"."dispatch_started_at" is null or "runtime_publishing_deliveries"."dispatch_started_at" >= "runtime_publishing_deliveries"."accepted_at")
        and ("runtime_publishing_deliveries"."completed_at" is null or "runtime_publishing_deliveries"."completed_at" >= "runtime_publishing_deliveries"."dispatch_started_at"))
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_events" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_delivery_events_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_delivery_events_sequence_check" CHECK ("runtime_publishing_delivery_events"."sequence" > 0),
	CONSTRAINT "runtime_publishing_delivery_events_type_check" CHECK ("runtime_publishing_delivery_events"."type" in (
        'delivery.accepted','delivery.scheduled','effect.not_created','effect.prepared',
        'publication.confirmation_pending','publication.retry_scheduled',
        'publication.succeeded','publication.failed',
        'publication.outcome_unknown'
      )),
	CONSTRAINT "runtime_publishing_delivery_events_evidence_check" CHECK (jsonb_typeof("runtime_publishing_delivery_events"."evidence") = 'object'
        and octet_length("runtime_publishing_delivery_events"."evidence"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_execution_leases" (
	"workspace_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"lease_token" text NOT NULL,
	"fence" bigint NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"renewed_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "runtime_publishing_delivery_execution_leases_pk" PRIMARY KEY("workspace_id","delivery_id"),
	CONSTRAINT "runtime_publishing_delivery_execution_leases_identity_check" CHECK ("runtime_publishing_delivery_execution_leases"."fence" > 0
        and length("runtime_publishing_delivery_execution_leases"."worker_id") between 1 and 200
        and length("runtime_publishing_delivery_execution_leases"."lease_token") between 1 and 200),
	CONSTRAINT "runtime_publishing_delivery_execution_leases_time_check" CHECK ("runtime_publishing_delivery_execution_leases"."expires_at" > "runtime_publishing_delivery_execution_leases"."acquired_at"
        and "runtime_publishing_delivery_execution_leases"."renewed_at" >= "runtime_publishing_delivery_execution_leases"."acquired_at"
        and ("runtime_publishing_delivery_execution_leases"."released_at" is null or "runtime_publishing_delivery_execution_leases"."released_at" >= "runtime_publishing_delivery_execution_leases"."acquired_at"))
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_outbox_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"generation" integer NOT NULL,
	"state" text NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"delivery_token" text,
	"delivery_attempts" integer NOT NULL,
	"claimed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "runtime_publishing_delivery_outbox_identity_check" CHECK (length("runtime_publishing_delivery_outbox_intents"."id") between 1 and 200
        and length("runtime_publishing_delivery_outbox_intents"."dedupe_key") between 1 and 500
        and "runtime_publishing_delivery_outbox_intents"."generation" > 0
        and "runtime_publishing_delivery_outbox_intents"."delivery_attempts" >= 0),
	CONSTRAINT "runtime_publishing_delivery_outbox_state_check" CHECK ("runtime_publishing_delivery_outbox_intents"."state" in ('pending','claimed','delivered')),
	CONSTRAINT "runtime_publishing_delivery_outbox_lifecycle_check" CHECK (("runtime_publishing_delivery_outbox_intents"."state" = 'pending'
          and "runtime_publishing_delivery_outbox_intents"."delivery_token" is null
          and "runtime_publishing_delivery_outbox_intents"."claimed_at" is null
          and "runtime_publishing_delivery_outbox_intents"."delivered_at" is null)
        or ("runtime_publishing_delivery_outbox_intents"."state" = 'claimed'
          and "runtime_publishing_delivery_outbox_intents"."delivery_token" is not null
          and "runtime_publishing_delivery_outbox_intents"."claimed_at" is not null
          and "runtime_publishing_delivery_outbox_intents"."delivered_at" is null)
        or ("runtime_publishing_delivery_outbox_intents"."state" = 'delivered'
          and "runtime_publishing_delivery_outbox_intents"."delivery_token" is null
          and "runtime_publishing_delivery_outbox_intents"."claimed_at" is not null
          and "runtime_publishing_delivery_outbox_intents"."delivered_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_release_receipts" (
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"capability" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"release_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_delivery_release_receipts_pk" PRIMARY KEY("workspace_id","principal_id","capability","idempotency_key"),
	CONSTRAINT "runtime_publishing_delivery_release_receipts_contract_check" CHECK ("runtime_publishing_delivery_release_receipts"."capability" = 'publishing_plan_revisions.release@1'
        and length("runtime_publishing_delivery_release_receipts"."idempotency_key") between 8 and 200
        and "runtime_publishing_delivery_release_receipts"."idempotency_key" ~ '^[!-~]+$'
        and "runtime_publishing_delivery_release_receipts"."request_fingerprint" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_releases" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_revision_id" text NOT NULL,
	"plan_revision" integer NOT NULL,
	"plan_revision_digest" text NOT NULL,
	"approval_request_id" text NOT NULL,
	"approval_decision_id" text NOT NULL,
	"approval_consumption_id" text NOT NULL,
	"consuming_principal_id" text NOT NULL,
	"consuming_key_id" text NOT NULL,
	"capability" text NOT NULL,
	"authorization_contract_digest" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"authorized_resources" jsonb NOT NULL,
	"authorization_issued_at" timestamp with time zone NOT NULL,
	"authorization_expires_at" timestamp with time zone NOT NULL,
	"validation_session_id" text NOT NULL,
	"validation_evidence_digest" text NOT NULL,
	"validation_current_state_digest" text NOT NULL,
	"accepted_deliveries" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_delivery_releases_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_delivery_releases_identity_check" CHECK ("runtime_publishing_delivery_releases"."id" ~ '^pdr_[A-Za-z0-9_-]+$'
        and length("runtime_publishing_delivery_releases"."id") between 1 and 200
        and "runtime_publishing_delivery_releases"."plan_revision" > 0),
	CONSTRAINT "runtime_publishing_delivery_releases_authorization_check" CHECK ("runtime_publishing_delivery_releases"."capability" = 'publishing_plan_revisions.release@1'
        and "runtime_publishing_delivery_releases"."authorization_contract_digest" = 'sha256:487fcf4d881ef927ada89e11c1851b402bf414c1083c8d6618644d503aa1e80e'
        and length("runtime_publishing_delivery_releases"."authorization_evidence_ref") between 1 and 200
        and jsonb_typeof("runtime_publishing_delivery_releases"."authorized_resources") = 'object'
        and "runtime_publishing_delivery_releases"."authorized_resources" ?& array['channelIds','artifactIds']
        and ("runtime_publishing_delivery_releases"."authorized_resources" - array['channelIds','artifactIds']) = '{}'::jsonb
        and jsonb_typeof("runtime_publishing_delivery_releases"."authorized_resources"->'channelIds') = 'array'
        and jsonb_array_length("runtime_publishing_delivery_releases"."authorized_resources"->'channelIds') between 1 and 50
        and jsonb_typeof("runtime_publishing_delivery_releases"."authorized_resources"->'artifactIds') = 'array'
        and jsonb_array_length("runtime_publishing_delivery_releases"."authorized_resources"->'artifactIds') between 1 and 200
        and "runtime_publishing_delivery_releases"."authorization_expires_at" > "runtime_publishing_delivery_releases"."authorization_issued_at"
        and "runtime_publishing_delivery_releases"."created_at" >= "runtime_publishing_delivery_releases"."authorization_issued_at"
        and "runtime_publishing_delivery_releases"."created_at" < "runtime_publishing_delivery_releases"."authorization_expires_at"),
	CONSTRAINT "runtime_publishing_delivery_releases_validation_check" CHECK ("runtime_publishing_delivery_releases"."plan_revision_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_releases"."validation_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_releases"."validation_current_state_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_releases"."validation_session_id" ~ '^pavs_[A-Za-z0-9_-]+$'
        and jsonb_typeof("runtime_publishing_delivery_releases"."accepted_deliveries") = 'array'
        and jsonb_array_length("runtime_publishing_delivery_releases"."accepted_deliveries") between 1 and 50
        and octet_length("runtime_publishing_delivery_releases"."accepted_deliveries"::text) <= 262144)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_approval_consumptions_release_identity_unique" ON "runtime_publishing_approval_consumptions" USING btree ("workspace_id","approval_request_id","decision_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_releases_exact_identity_unique" ON "runtime_publishing_delivery_releases" USING btree ("workspace_id","id","plan_id","plan_revision_id","plan_revision","plan_revision_digest","validation_evidence_digest","approval_request_id","approval_decision_id");--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_release_fk" FOREIGN KEY ("workspace_id","release_id","plan_id","plan_revision_id","plan_revision","plan_revision_digest","validation_evidence_digest","approval_request_id","approval_decision_id") REFERENCES "public"."runtime_publishing_delivery_releases"("workspace_id","id","plan_id","plan_revision_id","plan_revision","plan_revision_digest","validation_evidence_digest","approval_request_id","approval_decision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_events" ADD CONSTRAINT "runtime_publishing_delivery_events_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_execution_leases" ADD CONSTRAINT "runtime_publishing_delivery_execution_leases_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_outbox_intents" ADD CONSTRAINT "runtime_publishing_delivery_outbox_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_release_receipts" ADD CONSTRAINT "runtime_publishing_delivery_release_receipts_release_fk" FOREIGN KEY ("workspace_id","release_id") REFERENCES "public"."runtime_publishing_delivery_releases"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_release_receipts" ADD CONSTRAINT "runtime_publishing_delivery_release_receipts_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_releases" ADD CONSTRAINT "runtime_publishing_delivery_releases_revision_fk" FOREIGN KEY ("workspace_id","plan_id","plan_revision_id","plan_revision","plan_revision_digest","validation_evidence_digest") REFERENCES "public"."runtime_publishing_plan_revisions"("workspace_id","plan_id","id","revision","definition_digest","validation_evidence_digest") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_releases" ADD CONSTRAINT "runtime_publishing_delivery_releases_approval_fk" FOREIGN KEY ("workspace_id","approval_request_id","approval_decision_id") REFERENCES "public"."runtime_publishing_approval_decisions"("workspace_id","request_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_releases" ADD CONSTRAINT "runtime_publishing_delivery_releases_consumption_fk" FOREIGN KEY ("workspace_id","approval_request_id","approval_decision_id","approval_consumption_id") REFERENCES "public"."runtime_publishing_approval_consumptions"("workspace_id","approval_request_id","decision_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_releases" ADD CONSTRAINT "runtime_publishing_delivery_releases_principal_fk" FOREIGN KEY ("workspace_id","consuming_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_releases" ADD CONSTRAINT "runtime_publishing_delivery_releases_key_fk" FOREIGN KEY ("consuming_principal_id","consuming_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_releases" ADD CONSTRAINT "runtime_publishing_delivery_releases_authorization_evidence_fk" FOREIGN KEY ("workspace_id","consuming_principal_id","consuming_key_id","authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_deliveries_release_target_unique" ON "runtime_publishing_deliveries" USING btree ("workspace_id","release_id","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_deliveries_release_ordinal_unique" ON "runtime_publishing_deliveries" USING btree ("workspace_id","release_id","target_ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_deliveries_effect_key_unique" ON "runtime_publishing_deliveries" USING btree ("workspace_id","effect_key");--> statement-breakpoint
CREATE INDEX "runtime_publishing_deliveries_release_idx" ON "runtime_publishing_deliveries" USING btree ("workspace_id","release_id","accepted_at","id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_deliveries_workspace_accepted_idx" ON "runtime_publishing_deliveries" USING btree ("workspace_id","accepted_at","id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_deliveries_revision_accepted_idx" ON "runtime_publishing_deliveries" USING btree ("workspace_id","plan_revision_id","accepted_at","id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_deliveries_state_due_idx" ON "runtime_publishing_deliveries" USING btree ("state","publish_at","updated_at","id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_deliveries_channel_idx" ON "runtime_publishing_deliveries" USING btree ("workspace_id","channel_id","accepted_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_events_delivery_sequence_unique" ON "runtime_publishing_delivery_events" USING btree ("workspace_id","delivery_id","sequence");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_events_delivery_sequence_idx" ON "runtime_publishing_delivery_events" USING btree ("workspace_id","delivery_id","sequence");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_execution_leases_expiry_idx" ON "runtime_publishing_delivery_execution_leases" USING btree ("expires_at","workspace_id","delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_outbox_delivery_generation_unique" ON "runtime_publishing_delivery_outbox_intents" USING btree ("workspace_id","delivery_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_outbox_dedupe_key_unique" ON "runtime_publishing_delivery_outbox_intents" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_outbox_claim_idx" ON "runtime_publishing_delivery_outbox_intents" USING btree ("state","available_at","delivery_id","generation","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_release_receipts_release_unique" ON "runtime_publishing_delivery_release_receipts" USING btree ("workspace_id","release_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_release_receipts_created_idx" ON "runtime_publishing_delivery_release_receipts" USING btree ("workspace_id","created_at","release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_releases_decision_unique" ON "runtime_publishing_delivery_releases" USING btree ("workspace_id","approval_decision_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_releases_principal_created_idx" ON "runtime_publishing_delivery_releases" USING btree ("workspace_id","consuming_principal_id","created_at","id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_releases_revision_idx" ON "runtime_publishing_delivery_releases" USING btree ("workspace_id","plan_revision_id","created_at","id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_releases_consumption_idx" ON "runtime_publishing_delivery_releases" USING btree ("workspace_id","approval_request_id","approval_decision_id","approval_consumption_id");--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_delivery_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_releases_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_releases"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_release_receipts_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_release_receipts"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_events_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_events"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_delivery_event_insert_guard"()
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
		'effect.not_created','effect.prepared','publication.confirmation_pending',
		'publication.retry_scheduled','publication.succeeded',
		'publication.failed','publication.outcome_unknown'
	) THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'Publishing Delivery event is out of sequence';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_events_insert_guarded"
BEFORE INSERT ON "runtime_publishing_delivery_events"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_event_insert_guard"();--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_delivery_event_commit_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	next_sequence integer;
BEGIN
	SELECT "next_event_sequence" INTO next_sequence
	FROM "runtime_publishing_deliveries"
	WHERE "workspace_id" = NEW.workspace_id AND "id" = NEW.delivery_id;
	IF NEW.sequence IN (1, 2) AND next_sequence >= 3 THEN
		RETURN NULL;
	END IF;
	IF next_sequence > NEW.sequence THEN
		RETURN NULL;
	END IF;
	RAISE EXCEPTION 'Publishing Delivery event is not committed by canonical state';
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "runtime_publishing_delivery_events_canonical"
AFTER INSERT ON "runtime_publishing_delivery_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_event_commit_guard"();--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_delivery_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	event_type text;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Publishing Deliveries cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY[
		'desired_state','state','intent_digest','provider_operation_ref',
		'latest_effect_evidence_digest','failure_code','next_event_sequence',
		'next_outbox_generation','dispatch_started_at','completed_at','updated_at'
	]) <> (to_jsonb(OLD) - ARRAY[
		'desired_state','state','intent_digest','provider_operation_ref',
		'latest_effect_evidence_digest','failure_code','next_event_sequence',
		'next_outbox_generation','dispatch_started_at','completed_at','updated_at'
	]) THEN
		RAISE EXCEPTION 'Publishing Delivery release identity is immutable';
	END IF;
	IF NEW.updated_at < OLD.updated_at OR NEW.next_event_sequence <> OLD.next_event_sequence + 1 THEN
		RAISE EXCEPTION 'Publishing Delivery transition must append one ordered event';
	END IF;
	IF OLD.state = 'scheduled' AND NEW.state = 'dispatching' THEN
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
	ELSIF OLD.state IN ('dispatching','confirmation_pending') AND NEW.state = 'outcome_unknown' THEN
		event_type := 'publication.outcome_unknown';
	ELSE
		RAISE EXCEPTION 'Invalid Publishing Delivery state transition';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM "runtime_publishing_delivery_events"
		WHERE "workspace_id" = OLD.workspace_id AND "delivery_id" = OLD.id
			AND "sequence" = OLD.next_event_sequence AND "type" = event_type
	) THEN
		RAISE EXCEPTION 'Publishing Delivery transition event is missing';
	END IF;
	IF NEW.next_outbox_generation = OLD.next_outbox_generation + 1 THEN
		IF event_type NOT IN ('publication.retry_scheduled','publication.confirmation_pending')
			OR NOT EXISTS (
				SELECT 1 FROM "runtime_publishing_delivery_outbox_intents"
				WHERE "workspace_id" = OLD.workspace_id AND "delivery_id" = OLD.id
					AND "generation" = OLD.next_outbox_generation AND "state" = 'pending'
			) THEN
			RAISE EXCEPTION 'Publishing Delivery follow-up outbox is missing';
		END IF;
	ELSIF NEW.next_outbox_generation <> OLD.next_outbox_generation THEN
		RAISE EXCEPTION 'Publishing Delivery outbox generation is not monotonic';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_deliveries_identity_immutable"
BEFORE UPDATE OR DELETE ON "runtime_publishing_deliveries"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_identity_guard"();--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_delivery_outbox_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Publishing Delivery outbox intents cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY[
		'state','available_at','delivery_token','delivery_attempts','claimed_at','delivered_at'
	]) <> (to_jsonb(OLD) - ARRAY[
		'state','available_at','delivery_token','delivery_attempts','claimed_at','delivered_at'
	]) THEN
		RAISE EXCEPTION 'Publishing Delivery outbox identity is immutable';
	END IF;
	IF NEW.delivery_attempts < OLD.delivery_attempts OR
		NEW.delivery_attempts > OLD.delivery_attempts + 1 THEN
		RAISE EXCEPTION 'Publishing Delivery outbox attempts are not monotonic';
	END IF;
	IF OLD.state = 'pending' THEN
		IF NEW.state <> 'claimed' OR NEW.delivery_attempts <> OLD.delivery_attempts + 1 THEN
			RAISE EXCEPTION 'Pending Publishing Delivery outbox may only be claimed';
		END IF;
	ELSIF OLD.state = 'claimed' AND NEW.state = 'claimed' THEN
		IF NEW.delivery_attempts <> OLD.delivery_attempts + 1 THEN
			RAISE EXCEPTION 'Publishing Delivery outbox reclaim must advance attempts';
		END IF;
	ELSIF OLD.state = 'claimed' AND NEW.state IN ('pending','delivered') THEN
		IF NEW.delivery_attempts <> OLD.delivery_attempts THEN
			RAISE EXCEPTION 'Publishing Delivery outbox release retains attempts';
		END IF;
	ELSE
		RAISE EXCEPTION 'Invalid Publishing Delivery outbox transition';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_outbox_identity_immutable"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_outbox_intents"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_outbox_guard"();--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_delivery_lease_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Publishing Delivery leases cannot be deleted';
	END IF;
	IF NEW.workspace_id <> OLD.workspace_id OR NEW.delivery_id <> OLD.delivery_id OR
		NEW.fence < OLD.fence OR NEW.fence > OLD.fence + 1 THEN
		RAISE EXCEPTION 'Publishing Delivery lease identity or fence is invalid';
	END IF;
	IF NEW.fence = OLD.fence THEN
		IF NEW.worker_id <> OLD.worker_id OR NEW.lease_token <> OLD.lease_token OR
			NEW.acquired_at <> OLD.acquired_at OR NEW.expires_at < OLD.expires_at OR
			NEW.renewed_at < OLD.renewed_at OR
			(OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at) THEN
			RAISE EXCEPTION 'Publishing Delivery lease changed within a fence illegally';
		END IF;
	ELSIF NEW.released_at IS NOT NULL THEN
		RAISE EXCEPTION 'New Publishing Delivery fence must be active';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_lease_fence_monotonic"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_execution_leases"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_lease_guard"();--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_delivery_release_acceptance_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	accepted_count integer;
	delivery_count integer;
BEGIN
	SELECT jsonb_array_length(NEW.accepted_deliveries) INTO accepted_count;
	SELECT count(*) INTO delivery_count
	FROM "runtime_publishing_deliveries"
	WHERE "workspace_id" = NEW.workspace_id AND "release_id" = NEW.id;
	IF delivery_count <> accepted_count OR accepted_count < 1 OR
		NOT EXISTS (
			SELECT 1 FROM "runtime_publishing_delivery_release_receipts"
			WHERE "workspace_id" = NEW.workspace_id AND "release_id" = NEW.id
		) OR NOT EXISTS (
			SELECT 1 FROM "runtime_publishing_approval_consumptions"
			WHERE "workspace_id" = NEW.workspace_id
				AND "approval_request_id" = NEW.approval_request_id
				AND "decision_id" = NEW.approval_decision_id
				AND "id" = NEW.approval_consumption_id
		) THEN
		RAISE EXCEPTION 'Publishing Delivery release acceptance is incomplete';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM jsonb_array_elements(NEW.accepted_deliveries) WITH ORDINALITY AS x(ref, ordinal)
		LEFT JOIN "runtime_publishing_deliveries" d
			ON d.workspace_id = NEW.workspace_id AND d.release_id = NEW.id
			AND d.target_ordinal = x.ordinal - 1
		WHERE d.id IS NULL OR NOT (
			x.ref ?& array['id','targetId','channelId','publishAt','state','effectKey',
				'acceptedAt','scheduledAt','externallyCompleted']
			AND (x.ref - array['id','targetId','channelId','publishAt','state','effectKey',
				'acceptedAt','scheduledAt','externallyCompleted']) = '{}'::jsonb
			AND x.ref->>'id' = d.id AND x.ref->>'targetId' = d.target_id
			AND x.ref->>'channelId' = d.channel_id AND x.ref->>'state' = 'scheduled'
			AND x.ref->>'effectKey' = d.effect_key
			AND (x.ref->>'publishAt')::timestamptz = d.publish_at
			AND (x.ref->>'acceptedAt')::timestamptz = d.accepted_at
			AND (x.ref->>'scheduledAt')::timestamptz = d.scheduled_at
			AND x.ref->'externallyCompleted' = 'false'::jsonb
			AND d.state = 'scheduled' AND d.next_event_sequence = 3
			AND d.next_outbox_generation = 2
			AND EXISTS (SELECT 1 FROM "runtime_publishing_delivery_events" e
				WHERE e.workspace_id = d.workspace_id AND e.delivery_id = d.id
					AND e.sequence = 1 AND e.type = 'delivery.accepted')
			AND EXISTS (SELECT 1 FROM "runtime_publishing_delivery_events" e
				WHERE e.workspace_id = d.workspace_id AND e.delivery_id = d.id
					AND e.sequence = 2 AND e.type = 'delivery.scheduled')
			AND EXISTS (SELECT 1 FROM "runtime_publishing_delivery_outbox_intents" o
				WHERE o.workspace_id = d.workspace_id AND o.delivery_id = d.id
					AND o.generation = 1 AND o.state = 'pending')
		)
	) THEN
		RAISE EXCEPTION 'Publishing Delivery accepted projection diverges from relational rows';
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "runtime_publishing_delivery_release_acceptance_complete"
AFTER INSERT ON "runtime_publishing_delivery_releases"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_release_acceptance_guard"();
