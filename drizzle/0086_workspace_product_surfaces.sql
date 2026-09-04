CREATE TABLE "workspace_product_records" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "workspace_product_records_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "workspace_product_records_revision_check" CHECK ("workspace_product_records"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_product_command_receipts" (
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"record_id" text NOT NULL,
	"result_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_product_command_receipts_pk" PRIMARY KEY("workspace_id","idempotency_key"),
	CONSTRAINT "workspace_product_command_receipts_digest_check" CHECK ("workspace_product_command_receipts"."request_digest" ~ '^sha256:[a-f0-9]{64}$' and "workspace_product_command_receipts"."result_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "workspace_product_records" ADD CONSTRAINT "workspace_product_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_product_records" ADD CONSTRAINT "workspace_product_records_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_product_records" ADD CONSTRAINT "workspace_product_records_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_product_command_receipts" ADD CONSTRAINT "workspace_product_command_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_product_command_receipts" ADD CONSTRAINT "workspace_product_command_receipts_record_fk" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."workspace_product_records"("workspace_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workspace_product_records_workspace_kind_state_idx" ON "workspace_product_records" USING btree ("workspace_id","kind","state","updated_at");
