ALTER TABLE "runtime_publishing_approval_requests" ADD COLUMN "governance_policy" jsonb;
--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_requests" ADD CONSTRAINT "runtime_publishing_approval_requests_governance_policy_check" CHECK ("runtime_publishing_approval_requests"."governance_policy" is null or (
  "runtime_publishing_approval_requests"."governance_policy"->>'schema' = 'publishing-approval-governance-binding/v1'
  and ("runtime_publishing_approval_requests"."governance_policy"->>'policyRevision')::integer > 0
  and "runtime_publishing_approval_requests"."governance_policy"->>'policyDigest' ~ '^sha256:[a-f0-9]{64}$'
  and length("runtime_publishing_approval_requests"."governance_policy"->>'governanceRequestId') between 1 and 200
  and length("runtime_publishing_approval_requests"."governance_policy"->>'policyId') between 1 and 200
));
