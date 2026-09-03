ALTER TABLE "workspace_governance_mutation_receipts" ADD COLUMN "actor_identity" text;--> statement-breakpoint
ALTER TABLE "workspace_governance_mutation_receipts" ADD COLUMN "auth_context_digest" text;--> statement-breakpoint
ALTER TABLE "workspace_governance_mutation_receipts" ADD CONSTRAINT "workspace_governance_mutation_receipts_actor_binding_check" CHECK (("actor_identity" is null and "auth_context_digest" is null) or ("actor_identity" ~ '^(human|review_guest):[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and "auth_context_digest" ~ '^sha256:[a-f0-9]{64}$'));--> statement-breakpoint
ALTER TABLE "workspace_governance_secret_deliveries" ADD COLUMN "actor_identity" text DEFAULT 'human:legacy-unbound' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_governance_secret_deliveries" ADD COLUMN "auth_context_digest" text DEFAULT 'sha256:0000000000000000000000000000000000000000000000000000000000000000' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_governance_secret_deliveries" ALTER COLUMN "actor_identity" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workspace_governance_secret_deliveries" ALTER COLUMN "auth_context_digest" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workspace_governance_secret_deliveries" ADD CONSTRAINT "workspace_governance_secret_deliveries_actor_binding_check" CHECK ("actor_identity" ~ '^(human|review_guest):[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and "auth_context_digest" ~ '^sha256:[a-f0-9]{64}$');
