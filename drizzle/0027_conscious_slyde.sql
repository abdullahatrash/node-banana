ALTER TABLE "credential_security_events" ADD CONSTRAINT "credential_security_events_actor_check" CHECK ("credential_security_events"."actor_user_id" is not null or "credential_security_events"."principal_id" is not null);--> statement-breakpoint
ALTER TABLE "credential_security_events" ADD CONSTRAINT "credential_security_events_effect_ref_check" CHECK (("credential_security_events"."event_type" in ('effect.reserved', 'effect.replayed')) = ("credential_security_events"."effect_ref" is not null));--> statement-breakpoint
ALTER TABLE "credential_security_events" ADD CONSTRAINT "credential_security_events_details_size_check" CHECK (octet_length("credential_security_events"."details"::text) <= 4096);--> statement-breakpoint
ALTER TABLE "credential_security_events" ADD CONSTRAINT "credential_security_events_details_redaction_check" CHECK ("credential_security_events"."details"::text !~* '"[^"]*(secret|token|password|ciphertext)[^"]*"\s*:');--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_mode_check" CHECK ("credential_spend_events"."mode" in ('bounded', 'audited_unbounded'));--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_request_fingerprint_check" CHECK ("credential_spend_events"."request_fingerprint" ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_resolved_version_check" CHECK ("credential_spend_events"."resolved_version" > 0);
--> statement-breakpoint
UPDATE "projects"
SET "workflow_json" = "workflow_json" - 'credentialSlots'
WHERE "workflow_json" ? 'credentialSlots';
