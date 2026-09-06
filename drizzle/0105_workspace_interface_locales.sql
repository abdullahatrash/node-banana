ALTER TABLE "workspace_settings"
  ADD COLUMN "default_interface_locale" text DEFAULT 'ar' NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_settings"
  ADD CONSTRAINT "workspace_settings_default_interface_locale_check"
  CHECK ("default_interface_locale" in ('ar', 'en'));
--> statement-breakpoint
CREATE TABLE "workspace_interface_locale_preferences" (
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "interface_locale" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_interface_locale_preferences_pk" PRIMARY KEY("workspace_id", "user_id"),
  CONSTRAINT "workspace_interface_locale_preferences_locale_check" CHECK ("interface_locale" in ('ar', 'en')),
  CONSTRAINT "workspace_interface_locale_preferences_membership_fk"
    FOREIGN KEY ("workspace_id", "user_id")
    REFERENCES "workspace_members"("workspace_id", "user_id")
    ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "workspace_interface_locale_preferences_user_idx"
  ON "workspace_interface_locale_preferences" USING btree ("user_id", "workspace_id");
--> statement-breakpoint
INSERT INTO "workspace_interface_locale_preferences" (
  "workspace_id",
  "user_id",
  "interface_locale",
  "created_at",
  "updated_at"
)
SELECT
  member."workspace_id",
  member."user_id",
  preference."interface_locale",
  greatest(member."created_at", preference."created_at"),
  greatest(member."updated_at", preference."updated_at")
FROM "workspace_members" member
INNER JOIN "user_preferences" preference ON preference."user_id" = member."user_id"
ON CONFLICT ("workspace_id", "user_id") DO NOTHING;
