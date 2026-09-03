CREATE TABLE "runtime_operation_projection_leases" (
  "workspace_id" text PRIMARY KEY REFERENCES "workspaces"("id") ON DELETE cascade,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone NOT NULL,
  "last_projected_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "runtime_operation_projection_leases_owner_check" CHECK("lease_owner" IS NULL OR length("lease_owner") BETWEEN 16 AND 200)
);
--> statement-breakpoint
CREATE INDEX "runtime_operation_projection_leases_due_idx" ON "runtime_operation_projection_leases"("lease_expires_at", "workspace_id");
