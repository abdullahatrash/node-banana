CREATE TABLE "agent_pairing_rate_limits" (
	"requester_fingerprint" text NOT NULL,
	"action" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_pairing_rate_limits_pk" PRIMARY KEY("requester_fingerprint","action")
);
--> statement-breakpoint
CREATE INDEX "agent_pairing_rate_limits_expiry_idx" ON "agent_pairing_rate_limits" USING btree ("expires_at");