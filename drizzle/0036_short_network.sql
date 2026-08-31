ALTER TABLE "workflow_run_mutation_receipts" ADD COLUMN "key_id" text;--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" ADD COLUMN "authorization_evidence_ref" text;--> statement-breakpoint
UPDATE "workflow_run_mutation_receipts" AS receipt
SET
  "key_id" = run."key_id",
  "authorization_evidence_ref" = run."authorization_evidence_ref"
FROM "workflow_runs" AS run
WHERE run."workspace_id" = receipt."workspace_id"
  AND run."id" = receipt."run_id";--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" ALTER COLUMN "key_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" ALTER COLUMN "authorization_evidence_ref" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" ADD CONSTRAINT "workflow_run_mutation_receipts_authorization_evidence_fk" FOREIGN KEY ("workspace_id","principal_id","key_id","authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_mutation_receipts" ADD CONSTRAINT "workflow_run_mutation_receipts_authorization_evidence_check" CHECK (length("workflow_run_mutation_receipts"."key_id") between 1 and 200
        and length("workflow_run_mutation_receipts"."authorization_evidence_ref") between 1 and 200);
