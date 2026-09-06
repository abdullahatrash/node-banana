ALTER TABLE "model_generation_budget_reservations" ADD COLUMN "quoted_amount_usd" numeric(12,6);
ALTER TABLE "model_generation_budget_reservations" ADD COLUMN "actual_amount_usd" numeric(12,6);
ALTER TABLE "model_generation_budget_reservations" ADD COLUMN "released_amount_usd" numeric(12,6) NOT NULL DEFAULT 0;
UPDATE "model_generation_budget_reservations" SET "quoted_amount_usd" = "amount_usd" WHERE "quoted_amount_usd" IS NULL;
ALTER TABLE "model_generation_budget_reservations" ALTER COLUMN "quoted_amount_usd" SET NOT NULL;
ALTER TABLE "model_generation_budget_reservations" DROP CONSTRAINT "model_generation_budget_reservations_value_check";
ALTER TABLE "model_generation_budget_reservations" ADD CONSTRAINT "model_generation_budget_reservations_value_check" CHECK("amount_usd" > 0 AND "quoted_amount_usd" > 0 AND "released_amount_usd" >= 0 AND ("actual_amount_usd" IS NULL OR "actual_amount_usd" >= 0) AND "status" IN ('held','released','settled','outcome_unknown'));
--> statement-breakpoint
ALTER TABLE "model_fallback_spend_reservations" ADD COLUMN "quoted_amount_usd" numeric(12,6);
ALTER TABLE "model_fallback_spend_reservations" ADD COLUMN "actual_amount_usd" numeric(12,6);
ALTER TABLE "model_fallback_spend_reservations" ADD COLUMN "released_amount_usd" numeric(12,6) NOT NULL DEFAULT 0;
UPDATE "model_fallback_spend_reservations" SET "quoted_amount_usd" = "amount_usd" WHERE "quoted_amount_usd" IS NULL;
ALTER TABLE "model_fallback_spend_reservations" ALTER COLUMN "quoted_amount_usd" SET NOT NULL;
ALTER TABLE "model_fallback_spend_reservations" DROP CONSTRAINT "model_fallback_spend_reservations_status_check";
ALTER TABLE "model_fallback_spend_reservations" ADD CONSTRAINT "model_fallback_spend_reservations_status_check" CHECK("amount_usd" > 0 AND "quoted_amount_usd" > 0 AND "released_amount_usd" >= 0 AND ("actual_amount_usd" IS NULL OR "actual_amount_usd" >= 0) AND "status" IN ('held','released','settled','outcome_unknown'));
--> statement-breakpoint
ALTER TABLE "model_provider_effect_claims" ADD COLUMN "claim_expires_at" timestamp with time zone;
ALTER TABLE "model_provider_effect_claims" ADD COLUMN "credential_ref" jsonb;
ALTER TABLE "model_provider_effect_claims" ADD COLUMN "executed_version" text;
UPDATE "model_provider_effect_claims" SET "claim_expires_at" = "claimed_at" + interval '2 minutes' WHERE "claim_expires_at" IS NULL;
ALTER TABLE "model_provider_effect_claims" ALTER COLUMN "claim_expires_at" SET NOT NULL;
ALTER TABLE "model_provider_effect_claims" ADD CONSTRAINT "model_provider_effect_claims_credential_check" CHECK("credential_ref" IS NULL OR (jsonb_typeof("credential_ref") = 'object' AND "credential_ref"->>'provider' = 'replicate' AND length("credential_ref"->>'id') > 0 AND ("credential_ref"->>'updatedAt')::timestamptz IS NOT NULL));
CREATE INDEX "model_provider_effect_claims_stale_claim_idx" ON "model_provider_effect_claims"("state", "claim_expires_at") WHERE "state" = 'claimed';
--> statement-breakpoint
ALTER TABLE "replicate_prediction_identities" ADD COLUMN "executed_version" text;
ALTER TABLE "replicate_prediction_identities" ADD COLUMN "credential_ref" jsonb;
ALTER TABLE "replicate_prediction_identities" ADD CONSTRAINT "replicate_prediction_identities_execution_check" CHECK(("executed_version" IS NULL OR length("executed_version") > 0) AND ("credential_ref" IS NULL OR (jsonb_typeof("credential_ref") = 'object' AND "credential_ref"->>'provider' = 'replicate')));
