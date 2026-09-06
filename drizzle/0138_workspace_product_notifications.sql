CREATE TABLE "workspace_notification_preferences" (
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "delivery_locale" text,
  "billing_email_enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "workspace_notification_preferences_pk" PRIMARY KEY("workspace_id", "user_id"),
  CONSTRAINT "workspace_notification_preferences_membership_fk" FOREIGN KEY("workspace_id", "user_id") REFERENCES "public"."workspace_members"("workspace_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "workspace_notification_preferences_locale_check" CHECK ("delivery_locale" is null or "delivery_locale" in ('ar','en'))
);
--> statement-breakpoint
CREATE INDEX "workspace_notification_preferences_user_idx" ON "workspace_notification_preferences" USING btree ("user_id", "workspace_id");
--> statement-breakpoint
CREATE TABLE "workspace_notification_events" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "event_type" text NOT NULL,
  "source_ref" text NOT NULL,
  "severity" text NOT NULL,
  "facts" jsonb NOT NULL,
  "action_path" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "workspace_notification_events_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "workspace_notification_events_source_unique" UNIQUE("workspace_id", "source_ref"),
  CONSTRAINT "workspace_notification_events_workspace_fk" FOREIGN KEY("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "workspace_notification_events_values_check" CHECK ("event_type" in ('billing.refund_applied','billing.refund_reversed','billing.dispute_opened','billing.dispute_resolved') and "severity" in ('info','warning','critical') and octet_length("facts"::text) between 2 and 8192 and octet_length("action_path") between 1 and 501 and "action_path" ~ '^/[A-Za-z0-9/_?=&.-]*$')
);
--> statement-breakpoint
CREATE INDEX "workspace_notification_events_cursor_idx" ON "workspace_notification_events" USING btree ("workspace_id", "occurred_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE TABLE "workspace_notification_recipients" (
  "workspace_id" text NOT NULL,
  "event_id" text NOT NULL,
  "user_id" text NOT NULL,
  "delivery_locale" text NOT NULL,
  "in_app_state" text DEFAULT 'unread' NOT NULL,
  "email_state" text NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 8 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "last_error_code" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "read_at" timestamp with time zone,
  "email_delivered_at" timestamp with time zone,
  CONSTRAINT "workspace_notification_recipients_pk" PRIMARY KEY("workspace_id", "event_id", "user_id"),
  CONSTRAINT "workspace_notification_recipients_event_fk" FOREIGN KEY("workspace_id", "event_id") REFERENCES "public"."workspace_notification_events"("workspace_id", "id") ON DELETE CASCADE,
  CONSTRAINT "workspace_notification_recipients_membership_fk" FOREIGN KEY("workspace_id", "user_id") REFERENCES "public"."workspace_members"("workspace_id", "user_id") ON DELETE CASCADE,
  CONSTRAINT "workspace_notification_recipients_values_check" CHECK ("delivery_locale" in ('ar','en') and "in_app_state" in ('unread','read') and "email_state" in ('pending','processing','delivered','suppressed','failed_known','outcome_unknown') and "max_attempts" between 1 and 20 and "attempt" between 0 and "max_attempts" and (("in_app_state" = 'unread' and "read_at" is null) or ("in_app_state" = 'read' and "read_at" is not null)) and (("email_state" = 'processing' and "lease_owner" is not null and "lease_expires_at" is not null) or ("email_state" <> 'processing' and "lease_owner" is null and "lease_expires_at" is null)) and (("email_state" = 'delivered' and "email_delivered_at" is not null) or ("email_state" <> 'delivered' and "email_delivered_at" is null)))
);
--> statement-breakpoint
CREATE INDEX "workspace_notification_recipients_user_cursor_idx" ON "workspace_notification_recipients" USING btree ("workspace_id", "user_id", "created_at" DESC, "event_id" DESC);
--> statement-breakpoint
CREATE INDEX "workspace_notification_recipients_email_due_idx" ON "workspace_notification_recipients" USING btree ("next_attempt_at", "workspace_id", "event_id", "user_id") WHERE "email_state" in ('pending','processing');
