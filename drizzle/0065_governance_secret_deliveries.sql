CREATE TABLE "workspace_governance_secret_deliveries" (
  "workspace_id" text NOT NULL,
  "capability" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "encrypted_payload" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "workspace_governance_secret_deliveries_pk" PRIMARY KEY("workspace_id", "capability", "idempotency_key"),
  CONSTRAINT "workspace_governance_secret_deliveries_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict,
  CONSTRAINT "workspace_governance_secret_deliveries_digest_check" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "workspace_governance_secret_deliveries_envelope_check" CHECK ("encrypted_payload" like 'v1.%' and octet_length("encrypted_payload") <= 65536)
);
--> statement-breakpoint
CREATE INDEX "workspace_governance_secret_deliveries_expiry_idx" ON "workspace_governance_secret_deliveries" USING btree ("expires_at");
