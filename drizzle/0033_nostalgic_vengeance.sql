CREATE TABLE "workflow_run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_run_events_sequence_check" CHECK ("workflow_run_events"."sequence" > 0),
	CONSTRAINT "workflow_run_events_type_check" CHECK ("workflow_run_events"."type" in ('run.accepted', 'step.completed', 'run.completed', 'run.failed')),
	CONSTRAINT "workflow_run_events_data_size_check" CHECK (jsonb_typeof("workflow_run_events"."data") = 'object' and octet_length("workflow_run_events"."data"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "workflow_run_execution_leases" (
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"fence" bigint NOT NULL,
	"worker_id" text NOT NULL,
	"token" text NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "workflow_run_execution_leases_pk" PRIMARY KEY("workspace_id","run_id"),
	CONSTRAINT "workflow_run_execution_leases_fence_check" CHECK ("workflow_run_execution_leases"."fence" > 0),
	CONSTRAINT "workflow_run_execution_leases_time_check" CHECK ("workflow_run_execution_leases"."expires_at" > "workflow_run_execution_leases"."acquired_at"
        and ("workflow_run_execution_leases"."released_at" is null or "workflow_run_execution_leases"."released_at" >= "workflow_run_execution_leases"."acquired_at"))
);
--> statement-breakpoint
CREATE TABLE "workflow_run_mutation_receipts" (
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"capability" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"run_id" text NOT NULL,
	"initial_event_cursor" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_run_mutation_receipts_pk" PRIMARY KEY("workspace_id","principal_id","capability","idempotency_key"),
	CONSTRAINT "workflow_run_mutation_receipts_capability_check" CHECK ("workflow_run_mutation_receipts"."capability" = 'workflow_runs.start@1'),
	CONSTRAINT "workflow_run_mutation_receipts_idempotency_key_check" CHECK (length("workflow_run_mutation_receipts"."idempotency_key") between 8 and 200 and "workflow_run_mutation_receipts"."idempotency_key" ~ '^[!-~]+$'),
	CONSTRAINT "workflow_run_mutation_receipts_fingerprint_check" CHECK ("workflow_run_mutation_receipts"."request_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "workflow_run_mutation_receipts_cursor_check" CHECK (length("workflow_run_mutation_receipts"."initial_event_cursor") between 1 and 2048)
);
--> statement-breakpoint
CREATE TABLE "workflow_run_outbox_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"state" text NOT NULL,
	"delivery_token" text,
	"delivery_attempts" integer NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_run_outbox_intents_state_check" CHECK ("workflow_run_outbox_intents"."state" in ('pending', 'delivering', 'delivered')),
	CONSTRAINT "workflow_run_outbox_intents_attempts_check" CHECK ("workflow_run_outbox_intents"."delivery_attempts" >= 0),
	CONSTRAINT "workflow_run_outbox_intents_lifecycle_check" CHECK ((
        "workflow_run_outbox_intents"."state" = 'pending'
          and "workflow_run_outbox_intents"."delivery_token" is null
          and "workflow_run_outbox_intents"."claimed_at" is null
          and "workflow_run_outbox_intents"."delivered_at" is null
      ) or (
        "workflow_run_outbox_intents"."state" = 'delivering'
          and "workflow_run_outbox_intents"."delivery_token" is not null
          and "workflow_run_outbox_intents"."claimed_at" is not null
          and "workflow_run_outbox_intents"."delivered_at" is null
      ) or (
        "workflow_run_outbox_intents"."state" = 'delivered'
          and "workflow_run_outbox_intents"."delivery_token" is null
          and "workflow_run_outbox_intents"."claimed_at" is not null
          and "workflow_run_outbox_intents"."delivered_at" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_revision_id" text NOT NULL,
	"state" text NOT NULL,
	"start_snapshot_digest" text NOT NULL,
	"start_snapshot" jsonb NOT NULL,
	"next_event_sequence" integer NOT NULL,
	"output" jsonb,
	"failure_code" text,
	"principal_id" text NOT NULL,
	"key_id" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workflow_runs_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "workflow_runs_state_check" CHECK ("workflow_runs"."state" in ('accepted', 'running', 'completed', 'failed')),
	CONSTRAINT "workflow_runs_identity_check" CHECK (length("workflow_runs"."id") between 1 and 200 and "workflow_runs"."id" ~ '^[a-zA-Z0-9_-]+$'),
	CONSTRAINT "workflow_runs_snapshot_digest_check" CHECK ("workflow_runs"."start_snapshot_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "workflow_runs_snapshot_check" CHECK (jsonb_typeof("workflow_runs"."start_snapshot") = 'object'
        and "workflow_runs"."start_snapshot"->>'schema' = 'workflow-run-start-snapshot/v1'
        and "workflow_runs"."start_snapshot"->>'workflowId' = "workflow_runs"."workflow_id"
        and "workflow_runs"."start_snapshot"->>'workflowRevisionId' = "workflow_runs"."workflow_revision_id"
        and "workflow_runs"."start_snapshot"->'authorization'->>'principalId' = "workflow_runs"."principal_id"
        and "workflow_runs"."start_snapshot"->'authorization'->>'keyId' = "workflow_runs"."key_id"
        and "workflow_runs"."start_snapshot"->'authorization'->>'evidenceRef' = "workflow_runs"."authorization_evidence_ref"
        and octet_length("workflow_runs"."start_snapshot"::text) <= 1048576),
	CONSTRAINT "workflow_runs_next_event_sequence_check" CHECK ("workflow_runs"."next_event_sequence" >= 2),
	CONSTRAINT "workflow_runs_evidence_check" CHECK (length("workflow_runs"."authorization_evidence_ref") between 1 and 200),
	CONSTRAINT "workflow_runs_lifecycle_check" CHECK ((
        "workflow_runs"."state" = 'accepted'
          and "workflow_runs"."started_at" is null
          and "workflow_runs"."completed_at" is null
          and "workflow_runs"."output" is null
          and "workflow_runs"."failure_code" is null
      ) or (
        "workflow_runs"."state" = 'running'
          and "workflow_runs"."started_at" is not null
          and "workflow_runs"."completed_at" is null
          and "workflow_runs"."output" is null
          and "workflow_runs"."failure_code" is null
      ) or (
        "workflow_runs"."state" = 'completed'
          and "workflow_runs"."started_at" is not null
          and "workflow_runs"."completed_at" is not null
          and "workflow_runs"."output" is not null
          and "workflow_runs"."failure_code" is null
      ) or (
        "workflow_runs"."state" = 'failed'
          and "workflow_runs"."started_at" is not null
          and "workflow_runs"."completed_at" is not null
          and "workflow_runs"."output" is null
          and "workflow_runs"."failure_code" is not null
      )),
	CONSTRAINT "workflow_runs_failure_code_check" CHECK ("workflow_runs"."failure_code" is null or "workflow_runs"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,79}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_authorization_decisions_run_evidence_unique" ON "agent_authorization_decisions" USING btree ("workspace_id","principal_id","key_id","operator_trace_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "content_workflow_revisions_workspace_workflow_id_unique" ON "content_workflow_revisions" USING btree ("workspace_id","workflow_id","id");--> statement-breakpoint
ALTER TABLE "workflow_run_events" ADD CONSTRAINT "workflow_run_events_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_execution_leases" ADD CONSTRAINT "workflow_run_execution_leases_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" ADD CONSTRAINT "workflow_run_mutation_receipts_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" ADD CONSTRAINT "workflow_run_mutation_receipts_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_outbox_intents" ADD CONSTRAINT "workflow_run_outbox_intents_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_workflow_fk" FOREIGN KEY ("workspace_id","workflow_id") REFERENCES "public"."content_workflows"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_workflow_revision_fk" FOREIGN KEY ("workspace_id","workflow_id","workflow_revision_id") REFERENCES "public"."content_workflow_revisions"("workspace_id","workflow_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_principal_key_fk" FOREIGN KEY ("principal_id","key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_authorization_evidence_fk" FOREIGN KEY ("workspace_id","principal_id","key_id","authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_events_workspace_run_sequence_unique" ON "workflow_run_events" USING btree ("workspace_id","run_id","sequence");--> statement-breakpoint
CREATE INDEX "workflow_run_events_workspace_run_idx" ON "workflow_run_events" USING btree ("workspace_id","run_id","sequence");--> statement-breakpoint
CREATE INDEX "workflow_run_execution_leases_expiry_idx" ON "workflow_run_execution_leases" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "workflow_run_mutation_receipts_workspace_created_idx" ON "workflow_run_mutation_receipts" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_outbox_intents_workspace_run_unique" ON "workflow_run_outbox_intents" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_outbox_intents_dedupe_key_unique" ON "workflow_run_outbox_intents" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "workflow_run_outbox_intents_delivery_idx" ON "workflow_run_outbox_intents" USING btree ("state","available_at","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_workspace_workflow_id_unique" ON "workflow_runs" USING btree ("workspace_id","workflow_id","id");--> statement-breakpoint
CREATE INDEX "workflow_runs_workspace_updated_idx" ON "workflow_runs" USING btree ("workspace_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_updated_idx" ON "workflow_runs" USING btree ("workspace_id","workflow_id","updated_at","id");--> statement-breakpoint
CREATE FUNCTION "workflow_run_insert_only_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workflow_run_events_insert_only"
BEFORE UPDATE OR DELETE ON "workflow_run_events"
FOR EACH ROW EXECUTE FUNCTION "workflow_run_insert_only_guard"();--> statement-breakpoint
CREATE TRIGGER "workflow_run_receipts_insert_only"
BEFORE UPDATE OR DELETE ON "workflow_run_mutation_receipts"
FOR EACH ROW EXECUTE FUNCTION "workflow_run_insert_only_guard"();--> statement-breakpoint
CREATE FUNCTION "workflow_run_event_insert_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	run_state text;
	next_sequence integer;
BEGIN
	SELECT "state", "next_event_sequence"
	INTO run_state, next_sequence
	FROM "workflow_runs"
	WHERE "workspace_id" = NEW.workspace_id
		AND "id" = NEW.run_id
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'Workflow Run event has no canonical Run';
	END IF;
	IF run_state = 'accepted' THEN
		IF NEW.sequence <> 1 OR NEW.type <> 'run.accepted' THEN
			RAISE EXCEPTION 'Accepted Workflow Runs permit only the first accepted event';
		END IF;
	ELSIF run_state = 'running' THEN
		IF NEW.sequence = next_sequence
			AND NEW.type IN ('step.completed', 'run.failed') THEN
			RETURN NEW;
		END IF;
		IF NEW.sequence = next_sequence + 1
			AND NEW.type = 'run.completed'
			AND EXISTS (
				SELECT 1 FROM "workflow_run_events"
				WHERE "workspace_id" = NEW.workspace_id
					AND "run_id" = NEW.run_id
					AND "sequence" = next_sequence
					AND "type" = 'step.completed'
			) THEN
			RETURN NEW;
		END IF;
		RAISE EXCEPTION 'Workflow Run event is out of sequence or invalid for the transition';
	ELSE
		RAISE EXCEPTION 'Terminal Workflow Runs reject additional events';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workflow_run_events_insert_guarded"
BEFORE INSERT ON "workflow_run_events"
FOR EACH ROW EXECUTE FUNCTION "workflow_run_event_insert_guard"();--> statement-breakpoint
CREATE FUNCTION "workflow_run_event_commit_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	run_state text;
	next_sequence integer;
BEGIN
	SELECT "state", "next_event_sequence"
	INTO run_state, next_sequence
	FROM "workflow_runs"
	WHERE "workspace_id" = NEW.workspace_id
		AND "id" = NEW.run_id;
	IF NEW.sequence = 1 AND NEW.type = 'run.accepted'
		AND next_sequence >= 2 THEN
		RETURN NULL;
	END IF;
	IF NEW.type = 'step.completed'
		AND run_state = 'completed'
		AND next_sequence = NEW.sequence + 2
		AND EXISTS (
			SELECT 1 FROM "workflow_run_events"
			WHERE "workspace_id" = NEW.workspace_id
				AND "run_id" = NEW.run_id
				AND "sequence" = NEW.sequence + 1
				AND "type" = 'run.completed'
		) THEN
		RETURN NULL;
	END IF;
	IF NEW.type = 'run.completed'
		AND run_state = 'completed'
		AND next_sequence = NEW.sequence + 1
		AND EXISTS (
			SELECT 1 FROM "workflow_run_events"
			WHERE "workspace_id" = NEW.workspace_id
				AND "run_id" = NEW.run_id
				AND "sequence" = NEW.sequence - 1
				AND "type" = 'step.completed'
		) THEN
		RETURN NULL;
	END IF;
	IF NEW.type = 'run.failed'
		AND run_state = 'failed'
		AND next_sequence = NEW.sequence + 1 THEN
		RETURN NULL;
	END IF;
	RAISE EXCEPTION 'Workflow Run event is not part of a committed canonical transition';
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "workflow_run_events_canonical"
AFTER INSERT ON "workflow_run_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "workflow_run_event_commit_guard"();--> statement-breakpoint
CREATE FUNCTION "workflow_run_acceptance_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM "workflow_run_events"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.id
			AND "sequence" = 1
			AND "type" = 'run.accepted'
	) OR NOT EXISTS (
		SELECT 1
		FROM "workflow_run_mutation_receipts"
		WHERE "workspace_id" = NEW.workspace_id
			AND "principal_id" = NEW.principal_id
			AND "capability" = 'workflow_runs.start@1'
			AND "run_id" = NEW.id
	) OR NOT EXISTS (
		SELECT 1
		FROM "workflow_run_outbox_intents"
		WHERE "workspace_id" = NEW.workspace_id
			AND "run_id" = NEW.id
	) THEN
		RAISE EXCEPTION 'Workflow Run acceptance must include its first event, receipt, and outbox intent';
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "workflow_run_acceptance_complete"
AFTER INSERT ON "workflow_runs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "workflow_run_acceptance_guard"();--> statement-breakpoint
CREATE FUNCTION "workflow_run_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Workflow Runs cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY[
			'state',
			'next_event_sequence',
			'output',
			'failure_code',
			'started_at',
			'completed_at',
			'updated_at'
		]) <> (to_jsonb(OLD) - ARRAY[
			'state',
			'next_event_sequence',
			'output',
			'failure_code',
			'started_at',
			'completed_at',
			'updated_at'
		]) THEN
		RAISE EXCEPTION 'Workflow Run start snapshot and provenance are immutable';
	END IF;
	IF OLD.state = 'accepted' AND NEW.state = 'running' THEN
		IF NEW.next_event_sequence <> OLD.next_event_sequence THEN
			RAISE EXCEPTION 'Starting a Workflow Run cannot append an event';
		END IF;
	ELSIF OLD.state = 'running' AND NEW.state = 'completed' THEN
		IF NEW.next_event_sequence <> OLD.next_event_sequence + 2 THEN
			RAISE EXCEPTION 'Workflow Run completion requires exactly two events';
		END IF;
		IF NOT EXISTS (
			SELECT 1 FROM "workflow_run_events"
			WHERE "workspace_id" = OLD.workspace_id
				AND "run_id" = OLD.id
				AND "sequence" = OLD.next_event_sequence
				AND "type" = 'step.completed'
		) OR NOT EXISTS (
			SELECT 1 FROM "workflow_run_events"
			WHERE "workspace_id" = OLD.workspace_id
				AND "run_id" = OLD.id
				AND "sequence" = OLD.next_event_sequence + 1
				AND "type" = 'run.completed'
		) THEN
			RAISE EXCEPTION 'Workflow Run completion events are missing or out of order';
		END IF;
	ELSIF OLD.state = 'running' AND NEW.state = 'failed' THEN
		IF NEW.next_event_sequence <> OLD.next_event_sequence + 1 THEN
			RAISE EXCEPTION 'Workflow Run failure requires exactly one event';
		END IF;
		IF NOT EXISTS (
			SELECT 1 FROM "workflow_run_events"
			WHERE "workspace_id" = OLD.workspace_id
				AND "run_id" = OLD.id
				AND "sequence" = OLD.next_event_sequence
				AND "type" = 'run.failed'
		) THEN
			RAISE EXCEPTION 'Workflow Run failure event is missing or out of order';
		END IF;
	ELSE
		RAISE EXCEPTION 'Invalid Workflow Run state transition';
	END IF;
	IF NEW.updated_at < OLD.updated_at THEN
		RAISE EXCEPTION 'Workflow Run updated_at cannot move backward';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workflow_runs_identity_immutable"
BEFORE UPDATE OR DELETE ON "workflow_runs"
FOR EACH ROW EXECUTE FUNCTION "workflow_run_identity_guard"();--> statement-breakpoint
CREATE FUNCTION "workflow_run_outbox_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Workflow Run outbox intents cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY[
			'state',
			'delivery_token',
			'delivery_attempts',
			'available_at',
			'claimed_at',
			'delivered_at'
		]) <> (to_jsonb(OLD) - ARRAY[
			'state',
			'delivery_token',
			'delivery_attempts',
			'available_at',
			'claimed_at',
			'delivered_at'
	]) THEN
		RAISE EXCEPTION 'Workflow Run outbox identity is immutable';
	END IF;
	IF NEW.delivery_attempts < OLD.delivery_attempts
		OR NEW.delivery_attempts > OLD.delivery_attempts + 1 THEN
		RAISE EXCEPTION 'Workflow Run outbox delivery attempts must advance monotonically';
	END IF;
	IF OLD.state = 'pending' THEN
		IF NEW.state <> 'delivering'
			OR NEW.delivery_attempts <> OLD.delivery_attempts + 1 THEN
			RAISE EXCEPTION 'Pending Workflow Run outbox intents may only be claimed';
		END IF;
	ELSIF OLD.state = 'delivering' AND NEW.state = 'delivering' THEN
		IF NEW.delivery_attempts <> OLD.delivery_attempts + 1 THEN
			RAISE EXCEPTION 'Workflow Run outbox reclaim must advance delivery attempts';
		END IF;
	ELSIF OLD.state = 'delivering' AND NEW.state IN ('pending', 'delivered') THEN
		IF NEW.delivery_attempts <> OLD.delivery_attempts THEN
			RAISE EXCEPTION 'Workflow Run outbox release and delivery retain delivery attempts';
		END IF;
	ELSE
		RAISE EXCEPTION 'Invalid Workflow Run outbox transition';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workflow_run_outbox_identity_immutable"
BEFORE UPDATE OR DELETE ON "workflow_run_outbox_intents"
FOR EACH ROW EXECUTE FUNCTION "workflow_run_outbox_identity_guard"();--> statement-breakpoint
CREATE FUNCTION "workflow_run_lease_fence_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Workflow Run execution leases cannot be deleted';
	END IF;
	IF NEW.workspace_id <> OLD.workspace_id OR NEW.run_id <> OLD.run_id THEN
		RAISE EXCEPTION 'Workflow Run execution lease identity is immutable';
	END IF;
	IF NEW.fence < OLD.fence OR NEW.fence > OLD.fence + 1 THEN
		RAISE EXCEPTION 'Workflow Run execution fence must advance monotonically';
	END IF;
	IF NEW.fence = OLD.fence
		AND (
			NEW.worker_id <> OLD.worker_id
			OR NEW.token <> OLD.token
			OR NEW.acquired_at <> OLD.acquired_at
			OR NEW.expires_at <> OLD.expires_at
		) THEN
		RAISE EXCEPTION 'Workflow Run execution lease cannot change within a fence';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workflow_run_lease_fence_monotonic"
BEFORE UPDATE OR DELETE ON "workflow_run_execution_leases"
FOR EACH ROW EXECUTE FUNCTION "workflow_run_lease_fence_guard"();
