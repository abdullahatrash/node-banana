ALTER TABLE "runtime_publishing_approval_authority_grants" DROP CONSTRAINT "runtime_publishing_approval_authority_grants_action_check";
--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_authority_grants" ADD CONSTRAINT "runtime_publishing_approval_authority_grants_action_check" CHECK ("runtime_publishing_approval_authority_grants"."action" = 'publish' and "runtime_publishing_approval_authority_grants"."subject_role_at_issue" in ('owner','admin','member'));
