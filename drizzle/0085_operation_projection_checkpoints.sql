CREATE TABLE "runtime_operation_projection_checkpoints" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "source_adapter" text NOT NULL,
  "last_source_updated_at" timestamptz NOT NULL,
  "last_resource_id" text NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "runtime_operation_projection_checkpoints_pk" PRIMARY KEY ("workspace_id", "source_adapter"),
  CONSTRAINT "runtime_operation_projection_checkpoints_value_check" CHECK (length("source_adapter") between 3 and 100 AND length("last_resource_id") between 1 and 200)
);

REVOKE INSERT, UPDATE, DELETE ON "runtime_operation_projection_checkpoints" FROM PUBLIC;
