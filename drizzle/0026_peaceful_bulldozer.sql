ALTER TYPE "public"."credential_security_event_type" ADD VALUE 'version.revoked' BEFORE 'profile.status_changed';--> statement-breakpoint
DROP INDEX "credential_profiles_workspace_name_unique";--> statement-breakpoint
ALTER TABLE "credential_profile_versions" ADD COLUMN "usable_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_profiles_workspace_name_unique" ON "credential_profiles" USING btree ("workspace_id","name") WHERE "credential_profiles"."status" = 'active';