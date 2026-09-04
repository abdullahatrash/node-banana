CREATE TABLE "calendar_reschedule_commands" (
  "workspace_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "state" text NOT NULL,
  "initiating_user_id" text NOT NULL,
  "initiating_principal_id" text NOT NULL,
  "initiating_key_id" text NOT NULL,
  "authorization_evidence_ref" text NOT NULL,
  "service_principal_id" text NOT NULL,
  "service_key_id" text NOT NULL,
  "source_revision_id" text NOT NULL,
  "source_revision" integer NOT NULL,
  "target_id" text NOT NULL,
  "result" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  CONSTRAINT "calendar_reschedule_commands_pk" PRIMARY KEY("workspace_id", "idempotency_key"),
  CONSTRAINT "calendar_reschedule_commands_workspace_fk" FOREIGN KEY("workspace_id") REFERENCES "workspaces"("id") ON DELETE restrict,
  CONSTRAINT "calendar_reschedule_commands_user_fk" FOREIGN KEY("initiating_user_id") REFERENCES "user"("id") ON DELETE restrict,
  CONSTRAINT "calendar_reschedule_commands_values_check" CHECK (
    "request_digest" ~ '^sha256:[a-f0-9]{64}$' AND
    "state" IN ('pending','completed') AND "source_revision" > 0 AND
    length("idempotency_key") BETWEEN 8 AND 200 AND
    (("state" = 'pending' AND "result" IS NULL AND "completed_at" IS NULL) OR
     ("state" = 'completed' AND "result" IS NOT NULL AND "completed_at" IS NOT NULL))
  )
);
--> statement-breakpoint
CREATE INDEX "calendar_reschedule_commands_source_idx" ON "calendar_reschedule_commands"("workspace_id", "source_revision_id", "target_id", "created_at");
--> statement-breakpoint
CREATE FUNCTION "prevent_calendar_reschedule_actor_rebinding"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."request_digest" IS DISTINCT FROM OLD."request_digest" OR
     NEW."initiating_user_id" IS DISTINCT FROM OLD."initiating_user_id" OR
     NEW."initiating_principal_id" IS DISTINCT FROM OLD."initiating_principal_id" OR
     NEW."initiating_key_id" IS DISTINCT FROM OLD."initiating_key_id" OR
     NEW."authorization_evidence_ref" IS DISTINCT FROM OLD."authorization_evidence_ref" OR
     NEW."service_principal_id" IS DISTINCT FROM OLD."service_principal_id" OR
     NEW."service_key_id" IS DISTINCT FROM OLD."service_key_id" OR
     NEW."source_revision_id" IS DISTINCT FROM OLD."source_revision_id" OR
     NEW."source_revision" IS DISTINCT FROM OLD."source_revision" OR
     NEW."target_id" IS DISTINCT FROM OLD."target_id" OR
     OLD."state" = 'completed' THEN
    RAISE EXCEPTION 'calendar reschedule attribution is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "calendar_reschedule_actor_immutable" BEFORE UPDATE ON "calendar_reschedule_commands" FOR EACH ROW EXECUTE FUNCTION "prevent_calendar_reschedule_actor_rebinding"();
