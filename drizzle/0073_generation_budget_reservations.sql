CREATE TABLE "model_generation_budget_reservations" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "intent_id" text NOT NULL,
  "policy_id" text NOT NULL,
  "policy_revision_id" text NOT NULL,
  "period_starts_at" timestamp with time zone NOT NULL,
  "period_ends_at" timestamp with time zone,
  "amount_usd" numeric(12,6) NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "model_generation_budget_reservations_pk" PRIMARY KEY("workspace_id", "intent_id"),
  CONSTRAINT "model_generation_budget_reservations_policy_fk" FOREIGN KEY("workspace_id", "policy_id") REFERENCES "runtime_budget_policies"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "model_generation_budget_reservations_revision_fk" FOREIGN KEY("workspace_id", "policy_revision_id") REFERENCES "runtime_budget_policy_revisions"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "model_generation_budget_reservations_value_check" CHECK("amount_usd" > 0 AND "status" IN ('held','released','settled','outcome_unknown'))
);
--> statement-breakpoint
CREATE INDEX "model_generation_budget_reservations_period_idx" ON "model_generation_budget_reservations"("workspace_id", "policy_id", "period_starts_at", "status");
