CREATE TABLE "workspace_storage_limits" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"quota_bytes" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_storage_limits" ADD CONSTRAINT "workspace_storage_limits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "workspace_storage_limits" ("workspace_id", "quota_bytes", "updated_at")
SELECT "id", 10737418240, NOW()
FROM "workspaces"
ON CONFLICT ("workspace_id") DO NOTHING;
