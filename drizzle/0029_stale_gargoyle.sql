CREATE TABLE "credential_human_mutation_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"capability_identity" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"safe_result" jsonb NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_human_mutation_receipts_capability_identity_check" CHECK ("credential_human_mutation_receipts"."capability_identity" ~ '^credentials\.[a-z][a-z0-9_.]*@[1-9][0-9]*$'),
	CONSTRAINT "credential_human_mutation_receipts_idempotency_key_check" CHECK (length("credential_human_mutation_receipts"."idempotency_key") between 8 and 200),
	CONSTRAINT "credential_human_mutation_receipts_request_fingerprint_check" CHECK ("credential_human_mutation_receipts"."request_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "credential_human_mutation_receipts_safe_result_size_check" CHECK (octet_length("credential_human_mutation_receipts"."safe_result"::text) <= 65536),
	CONSTRAINT "credential_human_mutation_receipts_safe_result_redaction_check" CHECK ("credential_human_mutation_receipts"."safe_result"::text !~* '"(secret|token|password|ciphertext)"\s*:')
);
--> statement-breakpoint
ALTER TABLE "credential_human_mutation_receipts" ADD CONSTRAINT "credential_human_mutation_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_human_mutation_receipts" ADD CONSTRAINT "credential_human_mutation_receipts_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_human_mutation_receipts_invocation_unique" ON "credential_human_mutation_receipts" USING btree ("workspace_id","actor_user_id","capability_identity","idempotency_key");--> statement-breakpoint
CREATE INDEX "credential_human_mutation_receipts_workspace_completed_idx" ON "credential_human_mutation_receipts" USING btree ("workspace_id","completed_at");
