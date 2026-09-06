CREATE TABLE "licensed_trend_provider_cursors" (
  "provider_key" text PRIMARY KEY NOT NULL,
  "last_sequence" bigint DEFAULT 0 NOT NULL,
  "last_event_id" text,
  "last_occurred_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "licensed_trend_provider_cursors_values_check" CHECK (
    "provider_key" ~ '^[a-z][a-z0-9._-]{1,119}$'
    AND "last_sequence" >= 0
    AND (("last_sequence" = 0 AND "last_event_id" IS NULL AND "last_occurred_at" IS NULL)
      OR ("last_sequence" > 0 AND "last_event_id" IS NOT NULL AND "last_occurred_at" IS NOT NULL))
  )
);
--> statement-breakpoint
CREATE TABLE "licensed_trend_provider_events" (
  "provider_key" text NOT NULL,
  "event_id" text NOT NULL,
  "sequence" bigint NOT NULL,
  "event_digest" text NOT NULL,
  "key_id" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone NOT NULL,
  "payload" jsonb NOT NULL,
  "state" text NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 8 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "failure_code" text,
  "operator_note" text,
  "finished_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "licensed_trend_provider_events_pk" PRIMARY KEY("provider_key", "event_id"),
  CONSTRAINT "licensed_trend_provider_events_sequence_unique" UNIQUE("provider_key", "sequence"),
  CONSTRAINT "licensed_trend_provider_events_provider_fk" FOREIGN KEY ("provider_key") REFERENCES "public"."licensed_trend_provider_cursors"("provider_key") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "licensed_trend_provider_events_values_check" CHECK (
    "provider_key" ~ '^[a-z][a-z0-9._-]{1,119}$'
    AND octet_length("event_id") BETWEEN 1 AND 200
    AND "sequence" > 0
    AND "event_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND octet_length("key_id") BETWEEN 1 AND 120
    AND "payload"->>'schema' = 'licensed-trend-provider-event/v1'
    AND "payload"->>'action' IN ('publish_batch', 'set_catalog_state')
    AND "state" IN ('queued', 'claimed', 'succeeded', 'failed_known', 'outcome_unknown', 'skipped')
    AND "attempt" BETWEEN 0 AND "max_attempts"
    AND "max_attempts" BETWEEN 1 AND 20
    AND ("operator_note" IS NULL OR octet_length("operator_note") BETWEEN 8 AND 500)
    AND (("state" = 'claimed' AND "lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
      OR ("state" <> 'claimed' AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL))
  )
);
--> statement-breakpoint
CREATE INDEX "licensed_trend_provider_events_due_idx"
  ON "licensed_trend_provider_events" USING btree ("next_attempt_at", "provider_key", "sequence")
  WHERE "state" IN ('queued', 'claimed');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.protect_licensed_trend_provider_event_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD."provider_key" IS DISTINCT FROM NEW."provider_key"
    OR OLD."event_id" IS DISTINCT FROM NEW."event_id"
    OR OLD."sequence" IS DISTINCT FROM NEW."sequence"
    OR OLD."event_digest" IS DISTINCT FROM NEW."event_digest"
    OR OLD."key_id" IS DISTINCT FROM NEW."key_id"
    OR OLD."occurred_at" IS DISTINCT FROM NEW."occurred_at"
    OR OLD."received_at" IS DISTINCT FROM NEW."received_at"
    OR OLD."payload" IS DISTINCT FROM NEW."payload"
  THEN
    RAISE EXCEPTION 'LICENSED_TREND_PROVIDER_EVENT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER licensed_trend_provider_event_identity_guard
BEFORE UPDATE ON public."licensed_trend_provider_events"
FOR EACH ROW
EXECUTE FUNCTION public.protect_licensed_trend_provider_event_identity();
