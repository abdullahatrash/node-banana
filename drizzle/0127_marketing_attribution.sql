CREATE TABLE "marketing_attribution_consents" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"revision" integer NOT NULL,
	"purpose" text NOT NULL,
	"status" text NOT NULL,
	"notice_version" text NOT NULL,
	"region_review_version" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "marketing_attribution_consents_pk" PRIMARY KEY("workspace_id","user_id","provider","revision"),
	CONSTRAINT "marketing_attribution_consents_values_check" CHECK ("marketing_attribution_consents"."provider" = 'x_ads' and "marketing_attribution_consents"."purpose" = 'advertising_attribution' and "marketing_attribution_consents"."status" in ('active','revoked') and "marketing_attribution_consents"."revision" > 0 and length("marketing_attribution_consents"."notice_version") between 1 and 100 and length("marketing_attribution_consents"."region_review_version") between 1 and 100 and "marketing_attribution_consents"."expires_at" > "marketing_attribution_consents"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "marketing_attribution_events" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"event_name" text NOT NULL,
	"conversion_id" text NOT NULL,
	"consent_revision" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"failure_code" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "marketing_attribution_events_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "marketing_attribution_events_values_check" CHECK ("marketing_attribution_events"."provider" = 'x_ads' and "marketing_attribution_events"."event_name" in ('sign_up','trial_started','purchase') and "marketing_attribution_events"."id" ~ '^mae_[a-f0-9]{32}$' and "marketing_attribution_events"."conversion_id" ~ '^mac_[a-f0-9]{64}$' and "marketing_attribution_events"."consent_revision" > 0 and "marketing_attribution_events"."state" in ('queued','delivering','delivered','cancelled','failed_known','outcome_unknown') and "marketing_attribution_events"."attempt" >= 0 and "marketing_attribution_events"."max_attempts" between 1 and 12 and "marketing_attribution_events"."attempt" <= "marketing_attribution_events"."max_attempts" and octet_length("marketing_attribution_events"."payload"::text) <= 4096 and "marketing_attribution_events"."expires_at" > "marketing_attribution_events"."created_at")
);
--> statement-breakpoint
CREATE TABLE "marketing_attribution_delivery_receipts" (
	"workspace_id" text NOT NULL,
	"event_id" text NOT NULL,
	"provider" text NOT NULL,
	"conversion_id" text NOT NULL,
	"event_name" text NOT NULL,
	"outcome" text NOT NULL,
	"request_digest" text NOT NULL,
	"provider_debug_id" text,
	"delivered_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "marketing_attribution_delivery_receipts_pk" PRIMARY KEY("workspace_id","event_id"),
	CONSTRAINT "marketing_attribution_delivery_receipts_values_check" CHECK ("marketing_attribution_delivery_receipts"."provider" = 'x_ads' and "marketing_attribution_delivery_receipts"."event_name" in ('sign_up','trial_started','purchase') and "marketing_attribution_delivery_receipts"."outcome" in ('accepted','outcome_unknown') and "marketing_attribution_delivery_receipts"."request_digest" ~ '^sha256:[a-f0-9]{64}$' and "marketing_attribution_delivery_receipts"."expires_at" > "marketing_attribution_delivery_receipts"."delivered_at")
);
--> statement-breakpoint
CREATE TABLE "marketing_attribution_mutation_receipts" (
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "marketing_attribution_mutation_receipts_pk" PRIMARY KEY("workspace_id","idempotency_key"),
	CONSTRAINT "marketing_attribution_mutation_receipts_values_check" CHECK ("marketing_attribution_mutation_receipts"."request_digest" ~ '^sha256:[a-f0-9]{64}$' and length("marketing_attribution_mutation_receipts"."idempotency_key") between 8 and 200 and "marketing_attribution_mutation_receipts"."expires_at" > "marketing_attribution_mutation_receipts"."created_at")
);
--> statement-breakpoint
ALTER TABLE "marketing_attribution_consents" ADD CONSTRAINT "marketing_attribution_consents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_attribution_consents" ADD CONSTRAINT "marketing_attribution_consents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_attribution_events" ADD CONSTRAINT "marketing_attribution_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_attribution_events" ADD CONSTRAINT "marketing_attribution_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_attribution_events" ADD CONSTRAINT "marketing_attribution_events_consent_fk" FOREIGN KEY ("workspace_id","user_id","provider","consent_revision") REFERENCES "public"."marketing_attribution_consents"("workspace_id","user_id","provider","revision") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_attribution_delivery_receipts" ADD CONSTRAINT "marketing_attribution_delivery_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_attribution_delivery_receipts" ADD CONSTRAINT "marketing_attribution_delivery_receipts_event_fk" FOREIGN KEY ("workspace_id","event_id") REFERENCES "public"."marketing_attribution_events"("workspace_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "marketing_attribution_mutation_receipts" ADD CONSTRAINT "marketing_attribution_mutation_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "marketing_attribution_consents_current_idx" ON "marketing_attribution_consents" USING btree ("workspace_id","user_id","provider","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_attribution_events_conversion_unique" ON "marketing_attribution_events" USING btree ("provider","conversion_id");
--> statement-breakpoint
CREATE INDEX "marketing_attribution_events_due_idx" ON "marketing_attribution_events" USING btree ("state","next_attempt_at","lease_expires_at","id");
--> statement-breakpoint
CREATE INDEX "marketing_attribution_events_subject_idx" ON "marketing_attribution_events" USING btree ("workspace_id","user_id","provider","state");
--> statement-breakpoint
CREATE INDEX "marketing_attribution_delivery_receipts_expiry_idx" ON "marketing_attribution_delivery_receipts" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "marketing_attribution_mutation_receipts_expiry_idx" ON "marketing_attribution_mutation_receipts" USING btree ("expires_at");
