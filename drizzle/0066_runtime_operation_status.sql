CREATE TABLE "runtime_operations" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "id" text NOT NULL, "kind" text NOT NULL, "resource_id" text NOT NULL,
  "state" text NOT NULL, "stage" text, "revision" integer NOT NULL,
  "actor" jsonb NOT NULL, "metadata" jsonb NOT NULL, "retry_of_operation_id" text,
  "created_at" timestamp with time zone NOT NULL, "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "runtime_operations_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "runtime_operations_identity_check" CHECK ("id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and "resource_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and "revision" > 0),
  CONSTRAINT "runtime_operations_state_check" CHECK ("state" in ('queued','admitted','running','waiting_user','waiting_provider','waiting_quota','waiting_time','blocked','cancelling','cancelled','succeeded','failed_known','outcome_unknown')),
  CONSTRAINT "runtime_operations_stage_check" CHECK (("state" = 'running' and "stage" ~ '^[a-z][a-z0-9_.-]{0,79}$') or ("state" <> 'running' and "stage" is null)),
  CONSTRAINT "runtime_operations_metadata_size_check" CHECK (octet_length("metadata"::text) <= 16384)
);
--> statement-breakpoint
CREATE INDEX "runtime_operations_workspace_state_time_idx" ON "runtime_operations"("workspace_id", "state", "updated_at", "id");
--> statement-breakpoint
CREATE INDEX "runtime_operations_resource_idx" ON "runtime_operations"("workspace_id", "kind", "resource_id");
--> statement-breakpoint
CREATE TABLE "runtime_operation_events" (
  "workspace_id" text NOT NULL, "operation_id" text NOT NULL, "revision" integer NOT NULL,
  "id" text NOT NULL, "event" jsonb NOT NULL, "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "runtime_operation_events_pk" PRIMARY KEY("workspace_id", "operation_id", "revision"),
  CONSTRAINT "runtime_operation_events_operation_fk" FOREIGN KEY("workspace_id", "operation_id") REFERENCES "runtime_operations"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "runtime_operation_events_revision_check" CHECK ("revision" > 0 and octet_length("event"::text) <= 16384),
  CONSTRAINT "runtime_operation_events_id_unique" UNIQUE("workspace_id", "id")
);
--> statement-breakpoint
CREATE INDEX "runtime_operation_events_operation_idx" ON "runtime_operation_events"("workspace_id", "operation_id", "occurred_at");
--> statement-breakpoint
CREATE TABLE "runtime_operation_mutation_receipts" (
  "workspace_id" text NOT NULL, "idempotency_key" text NOT NULL, "request_digest" text NOT NULL,
  "operation_id" text NOT NULL, "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "runtime_operation_mutation_receipts_pk" PRIMARY KEY("workspace_id", "idempotency_key"),
  CONSTRAINT "runtime_operation_mutation_receipts_operation_fk" FOREIGN KEY("workspace_id", "operation_id") REFERENCES "runtime_operations"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "runtime_operation_mutation_receipts_digest_check" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$' and length("idempotency_key") between 8 and 200)
);
