CREATE TABLE "workspace_product_record_revisions" (
	"workspace_id" text NOT NULL,
	"record_id" text NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"payload" jsonb NOT NULL,
	"author_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_product_record_revisions_pk" PRIMARY KEY("workspace_id","record_id","revision"),
	CONSTRAINT "workspace_product_record_revisions_revision_check" CHECK ("workspace_product_record_revisions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "workspace_product_record_revisions" ADD CONSTRAINT "workspace_product_record_revisions_record_fk" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."workspace_product_records"("workspace_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_product_record_revisions" ADD CONSTRAINT "workspace_product_record_revisions_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
