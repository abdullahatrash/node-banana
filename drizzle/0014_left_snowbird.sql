ALTER TYPE "public"."social_platform" ADD VALUE 'bluesky';--> statement-breakpoint
ALTER TYPE "public"."social_platform" ADD VALUE 'mastodon';--> statement-breakpoint
CREATE TABLE "social_mastodon_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_url" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"max_characters" integer DEFAULT 500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "social_mastodon_instances_url_unique" ON "social_mastodon_instances" USING btree ("instance_url");