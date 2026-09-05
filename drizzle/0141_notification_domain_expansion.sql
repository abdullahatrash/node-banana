ALTER TABLE "workspace_notification_preferences" ADD COLUMN "channel_email_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_notification_preferences" ADD COLUMN "publishing_email_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_notification_preferences" ADD COLUMN "credit_email_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_notification_events" ADD COLUMN "required_permission" text;
--> statement-breakpoint
UPDATE "workspace_notification_events" SET "required_permission" = 'product:billing:read' WHERE "required_permission" IS NULL;
--> statement-breakpoint
ALTER TABLE "workspace_notification_events" ALTER COLUMN "required_permission" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_notification_events" DROP CONSTRAINT "workspace_notification_events_values_check";
--> statement-breakpoint
ALTER TABLE "workspace_notification_events" ADD CONSTRAINT "workspace_notification_events_values_check" CHECK (
  "event_type" in (
    'billing.refund_applied','billing.refund_reversed','billing.dispute_opened','billing.dispute_resolved',
    'security.credential_created','security.credential_rotated','security.credential_revoked','security.credential_status_changed','security.spend_authority_changed',
    'channel.consent_expiring','channel.reconnect_required',
    'publishing.approval_requested','publishing.approval_approved','publishing.approval_denied','publishing.delivery_failed','publishing.delivery_outcome_unknown','publishing.social_failed',
    'credits.low','credits.exhausted'
  )
  and "required_permission" in ('workspaces:write','social:view','social:manage','product:billing:read')
  and (
    ("event_type" like 'billing.%' and "required_permission" = 'product:billing:read')
    or ("event_type" like 'credits.%' and "required_permission" = 'product:billing:read')
    or ("event_type" like 'security.%' and "required_permission" = 'workspaces:write')
    or ("event_type" like 'channel.%' and "required_permission" = 'social:manage')
    or ("event_type" = 'publishing.approval_requested' and "required_permission" = 'social:manage')
    or ("event_type" in ('publishing.approval_approved','publishing.approval_denied','publishing.delivery_failed','publishing.delivery_outcome_unknown','publishing.social_failed') and "required_permission" = 'social:view')
  )
  and "severity" in ('info','warning','critical')
  and octet_length("source_ref") between 1 and 500
  and octet_length("facts"::text) between 2 and 8192
  and octet_length("action_path") between 1 and 501
  and "action_path" ~ '^/[A-Za-z0-9/_?=&.-]*$'
);
--> statement-breakpoint
CREATE INDEX "workspace_notification_events_permission_cursor_idx" ON "workspace_notification_events" USING btree ("workspace_id", "required_permission", "occurred_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE TABLE "workspace_notification_credit_states" (
  "workspace_id" text PRIMARY KEY NOT NULL,
  "balance_state" text NOT NULL,
  "available_units" bigint NOT NULL,
  "warning_threshold" bigint DEFAULT 10 NOT NULL,
  "episode" integer DEFAULT 0 NOT NULL,
  "last_ledger_sequence" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "workspace_notification_credit_states_workspace_fk" FOREIGN KEY("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "workspace_notification_credit_states_values_check" CHECK (
    "balance_state" in ('healthy','low','exhausted')
    and "available_units" >= 0
    and "warning_threshold" between 1 and 1000000
    and "episode" >= 0
    and "last_ledger_sequence" >= 0
  )
);
--> statement-breakpoint
CREATE INDEX "credential_security_events_notification_cursor_idx" ON "credential_security_events" USING btree ("created_at", "id") WHERE "event_type" in ('profile.created','profile.reprovisioned','profile.rotated','version.revoked','profile.status_changed','spend_grant.created','spend_grant.revoked');
--> statement-breakpoint
CREATE INDEX "social_events_notification_cursor_idx" ON "social_events" USING btree ("created_at", "id") WHERE "user_facing" = true AND "event_type" in ('account.reauth_required','post.failed','dispatch.failed');
--> statement-breakpoint
CREATE INDEX "social_accounts_consent_expiry_idx" ON "social_accounts" USING btree ("token_expires_at", "id") WHERE "disabled" = false AND "requires_reauth" = false AND "token_expires_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_requests_notification_cursor_idx" ON "runtime_publishing_approval_requests" USING btree ("created_at", "id");
--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_decisions_notification_cursor_idx" ON "runtime_publishing_approval_decisions" USING btree ("decided_at", "id");
--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_events_notification_cursor_idx" ON "runtime_publishing_delivery_events" USING btree ("occurred_at", "id") WHERE "type" in ('publication.failed_terminal','publication.outcome_unknown');
