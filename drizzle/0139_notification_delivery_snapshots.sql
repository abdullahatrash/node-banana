ALTER TABLE "workspace_notification_recipients" ADD COLUMN "catalog_version" text;
--> statement-breakpoint
ALTER TABLE "workspace_notification_recipients" ADD COLUMN "rendered_title" text;
--> statement-breakpoint
ALTER TABLE "workspace_notification_recipients" ADD COLUMN "rendered_body" text;
--> statement-breakpoint
ALTER TABLE "workspace_notification_recipients" ADD COLUMN "rendered_action_label" text;
--> statement-breakpoint
ALTER TABLE "workspace_notification_recipients" ADD COLUMN "email_action_url" text;
--> statement-breakpoint
ALTER TABLE "workspace_notification_recipients" ADD COLUMN "email_payload_digest" text;
--> statement-breakpoint
ALTER TABLE "workspace_notification_recipients" ADD CONSTRAINT "workspace_notification_recipients_snapshot_check" CHECK (("catalog_version" is null and "rendered_title" is null and "rendered_body" is null and "rendered_action_label" is null and "email_action_url" is null and "email_payload_digest" is null) or (octet_length("catalog_version") between 1 and 80 and octet_length("rendered_title") between 1 and 500 and octet_length("rendered_body") between 1 and 4096 and octet_length("rendered_action_label") between 1 and 200 and octet_length("email_action_url") between 9 and 2048 and "email_action_url" ~ '^https?://[^[:space:]]+$' and "email_payload_digest" ~ '^sha256:[a-f0-9]{64}$'));
