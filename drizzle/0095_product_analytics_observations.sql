CREATE TABLE "product_analytics_observations" (
  "workspace_id" text NOT NULL,
  "id" text NOT NULL,
  "source_id" text NOT NULL,
  "source_revision" integer NOT NULL,
  "source_kind" text NOT NULL,
  "metric" text NOT NULL,
  "value" integer NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "window_ended_at" timestamp with time zone NOT NULL,
  "evidence_digest" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_analytics_observations_pk" PRIMARY KEY("workspace_id", "id"),
  CONSTRAINT "product_analytics_observations_idempotency_unique" UNIQUE("workspace_id", "source_id", "idempotency_key"),
  CONSTRAINT "product_analytics_observations_source_revision_fk" FOREIGN KEY ("workspace_id", "source_id", "source_revision") REFERENCES "workspace_product_record_revisions"("workspace_id", "record_id", "revision") ON DELETE RESTRICT,
  CONSTRAINT "product_analytics_observations_source_check" CHECK (("source_kind" = 'website_analytics_source' AND "metric" = 'websiteViews') OR ("source_kind" = 'geo_analytics_source' AND "metric" = 'geoCitations')),
  CONSTRAINT "product_analytics_observations_value_check" CHECK ("value" >= 0 AND "value" <= 10000000),
  CONSTRAINT "product_analytics_observations_window_check" CHECK ("window_ended_at" > "window_started_at" AND "window_ended_at" <= "window_started_at" + interval '24 hours'),
  CONSTRAINT "product_analytics_observations_digest_check" CHECK ("evidence_digest" ~ '^sha256:[a-f0-9]{64}$' AND "request_digest" ~ '^sha256:[a-f0-9]{64}$' AND length("idempotency_key") BETWEEN 8 AND 200)
);
CREATE INDEX "product_analytics_observations_range_idx" ON "product_analytics_observations" ("workspace_id", "metric", "window_ended_at", "id");
CREATE INDEX "product_analytics_observations_source_idx" ON "product_analytics_observations" ("workspace_id", "source_id", "window_ended_at", "id");
