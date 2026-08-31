CREATE TYPE "public"."credential_security_event_type" AS ENUM('profile.created', 'profile.reprovisioned', 'profile.rotated', 'profile.status_changed', 'spend_grant.created', 'spend_grant.revoked', 'effect.reserved', 'effect.replayed');--> statement-breakpoint
CREATE TABLE "credential_security_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"event_type" "credential_security_event_type" NOT NULL,
	"actor_user_id" text,
	"principal_id" text,
	"profile_id" text,
	"version_id" text,
	"spend_grant_id" text,
	"effect_ref" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential_profile_versions" DROP CONSTRAINT "credential_profile_versions_profile_id_credential_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_slots" DROP CONSTRAINT "credential_slots_profile_id_credential_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_spend_events" DROP CONSTRAINT "credential_spend_events_principal_id_agent_principals_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_spend_events" DROP CONSTRAINT "credential_spend_events_profile_id_credential_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_spend_events" DROP CONSTRAINT "credential_spend_events_version_id_credential_profile_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_spend_events" DROP CONSTRAINT "credential_spend_events_spend_grant_id_credential_spend_grants_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_spend_grants" DROP CONSTRAINT "credential_spend_grants_principal_id_agent_principals_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_spend_grants" DROP CONSTRAINT "credential_spend_grants_profile_id_credential_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "credential_profile_versions" ADD COLUMN "workspace_id" text;--> statement-breakpoint
UPDATE "credential_profile_versions" AS "version"
SET "workspace_id" = "profile"."workspace_id"
FROM "credential_profiles" AS "profile"
WHERE "version"."profile_id" = "profile"."id";--> statement-breakpoint
ALTER TABLE "credential_profile_versions" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "slot_id" text;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "resolved_version" integer;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD COLUMN "resolved_provider" text;--> statement-breakpoint
UPDATE "credential_spend_events" AS "event"
SET
	"slot_id" = "slot"."id",
	"request_fingerprint" = 'sha256:' || md5(
		"event"."workspace_id" || ':' ||
		"event"."principal_id" || ':' ||
		"slot"."id" || ':' ||
		"event"."amount_cents"::text
	) || md5(
		'legacy:' ||
		"event"."workspace_id" || ':' ||
		"event"."principal_id" || ':' ||
		"slot"."id" || ':' ||
		"event"."amount_cents"::text
	),
	"resolved_version" = "version"."version",
	"resolved_provider" = "profile"."provider"
FROM "credential_slots" AS "slot"
JOIN "credential_profiles" AS "profile"
	ON "profile"."workspace_id" = "slot"."workspace_id"
	AND "profile"."id" = "slot"."profile_id"
JOIN "credential_profile_versions" AS "version"
	ON "version"."workspace_id" = "profile"."workspace_id"
	AND "version"."profile_id" = "profile"."id"
WHERE "event"."workspace_id" = "slot"."workspace_id"
	AND "event"."profile_id" = "slot"."profile_id"
	AND "event"."version_id" = "version"."id";--> statement-breakpoint
ALTER TABLE "credential_spend_events" ALTER COLUMN "slot_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ALTER COLUMN "request_fingerprint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ALTER COLUMN "resolved_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ALTER COLUMN "resolved_provider" SET NOT NULL;--> statement-breakpoint
UPDATE "credential_profile_versions"
SET "status" = 'superseded'
WHERE "status" = 'active';--> statement-breakpoint
UPDATE "credential_profile_versions" AS "version"
SET "status" = 'active'
FROM "credential_profiles" AS "profile"
WHERE "version"."workspace_id" = "profile"."workspace_id"
	AND "version"."profile_id" = "profile"."id"
	AND "version"."version" = "profile"."active_version"
	AND "version"."revoked_at" IS NULL
	AND "profile"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_principals_workspace_id_unique" ON "agent_principals" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_profile_versions_workspace_id_unique" ON "credential_profile_versions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_profile_versions_workspace_profile_id_unique" ON "credential_profile_versions" USING btree ("workspace_id","profile_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_profile_versions_workspace_profile_version_unique" ON "credential_profile_versions" USING btree ("workspace_id","profile_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_profile_versions_one_active_unique" ON "credential_profile_versions" USING btree ("workspace_id","profile_id") WHERE "credential_profile_versions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "credential_slots_workspace_profile_id_unique" ON "credential_slots" USING btree ("workspace_id","profile_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_spend_grants_workspace_principal_profile_id_unique" ON "credential_spend_grants" USING btree ("workspace_id","principal_id","profile_id","id");--> statement-breakpoint
ALTER TABLE "credential_security_events" ADD CONSTRAINT "credential_security_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_security_events" ADD CONSTRAINT "credential_security_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_security_events" ADD CONSTRAINT "credential_security_events_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_security_events" ADD CONSTRAINT "credential_security_events_workspace_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."credential_profiles"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_security_events" ADD CONSTRAINT "credential_security_events_workspace_profile_version_fk" FOREIGN KEY ("workspace_id","profile_id","version_id") REFERENCES "public"."credential_profile_versions"("workspace_id","profile_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_security_events" ADD CONSTRAINT "credential_security_events_workspace_principal_profile_grant_fk" FOREIGN KEY ("workspace_id","principal_id","profile_id","spend_grant_id") REFERENCES "public"."credential_spend_grants"("workspace_id","principal_id","profile_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_security_events_workspace_created_idx" ON "credential_security_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "credential_security_events_workspace_effect_idx" ON "credential_security_events" USING btree ("workspace_id","effect_ref");--> statement-breakpoint
ALTER TABLE "credential_profile_versions" ADD CONSTRAINT "credential_profile_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_profile_versions" ADD CONSTRAINT "credential_profile_versions_workspace_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."credential_profiles"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_slots" ADD CONSTRAINT "credential_slots_workspace_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."credential_profiles"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_workspace_slot_profile_fk" FOREIGN KEY ("workspace_id","profile_id","slot_id") REFERENCES "public"."credential_slots"("workspace_id","profile_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_workspace_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."credential_profiles"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_workspace_profile_version_fk" FOREIGN KEY ("workspace_id","profile_id","version_id") REFERENCES "public"."credential_profile_versions"("workspace_id","profile_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_events" ADD CONSTRAINT "credential_spend_events_workspace_principal_profile_grant_fk" FOREIGN KEY ("workspace_id","principal_id","profile_id","spend_grant_id") REFERENCES "public"."credential_spend_grants"("workspace_id","principal_id","profile_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_grants" ADD CONSTRAINT "credential_spend_grants_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_spend_grants" ADD CONSTRAINT "credential_spend_grants_workspace_profile_fk" FOREIGN KEY ("workspace_id","profile_id") REFERENCES "public"."credential_profiles"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_spend_events_workspace_request_fingerprint_idx" ON "credential_spend_events" USING btree ("workspace_id","request_fingerprint");--> statement-breakpoint
CREATE FUNCTION "credential_profile_active_version_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."status" = 'active' AND NEW."enabled" = true AND NEW."deleted_at" IS NULL
		AND NOT EXISTS (
			SELECT 1
			FROM "credential_profile_versions" AS "version"
			WHERE "version"."workspace_id" = NEW."workspace_id"
				AND "version"."profile_id" = NEW."id"
				AND "version"."version" = NEW."active_version"
				AND "version"."status" = 'active'
				AND "version"."revoked_at" IS NULL
		)
	THEN
		RAISE EXCEPTION 'active credential profile must reference its one active version';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "credential_profiles_active_version_guard"
AFTER INSERT OR UPDATE OF "workspace_id", "id", "active_version", "status", "enabled", "deleted_at"
ON "credential_profiles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "credential_profile_active_version_guard"();--> statement-breakpoint
CREATE FUNCTION "credential_version_active_profile_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	guard_workspace_id text;
	guard_profile_id text;
BEGIN
	IF TG_OP = 'DELETE' THEN
		guard_workspace_id := OLD."workspace_id";
		guard_profile_id := OLD."profile_id";
	ELSE
		guard_workspace_id := NEW."workspace_id";
		guard_profile_id := NEW."profile_id";
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "credential_profiles" AS "profile"
		WHERE "profile"."workspace_id" = guard_workspace_id
			AND "profile"."id" = guard_profile_id
			AND "profile"."status" = 'active'
			AND "profile"."enabled" = true
			AND "profile"."deleted_at" IS NULL
			AND NOT EXISTS (
				SELECT 1
				FROM "credential_profile_versions" AS "version"
				WHERE "version"."workspace_id" = "profile"."workspace_id"
					AND "version"."profile_id" = "profile"."id"
					AND "version"."version" = "profile"."active_version"
					AND "version"."status" = 'active'
					AND "version"."revoked_at" IS NULL
			)
	)
	THEN
		RAISE EXCEPTION 'credential version mutation would orphan an active profile';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "credential_versions_active_profile_guard"
AFTER INSERT OR UPDATE OR DELETE
ON "credential_profile_versions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "credential_version_active_profile_guard"();
