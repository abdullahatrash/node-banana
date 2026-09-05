ALTER TABLE "referral_payout_requests" ADD COLUMN "provider_idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "referral_payout_requests" ADD COLUMN "dispatch_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "referral_payout_requests" ADD COLUMN "max_dispatch_attempts" integer DEFAULT 12 NOT NULL;
--> statement-breakpoint
ALTER TABLE "referral_payout_requests" ADD COLUMN "next_dispatch_at" timestamptz DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "referral_payout_requests" ADD COLUMN "dispatch_lease_owner" text;
--> statement-breakpoint
ALTER TABLE "referral_payout_requests" ADD COLUMN "dispatch_lease_expires_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "referral_payout_requests" ADD COLUMN "last_dispatch_error_code" text;
--> statement-breakpoint
UPDATE "referral_payout_requests"
SET "provider_idempotency_key" = 'referral-payout:' || "workspace_id" || ':' || "id"
WHERE "provider_idempotency_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "referral_payout_requests" ALTER COLUMN "provider_idempotency_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "referral_payout_requests" ADD CONSTRAINT "referral_payout_requests_dispatch_check" CHECK (
  "provider_idempotency_key" ~ '^referral-payout:[^:]+:[^:]+$'
  AND "dispatch_attempts" >= 0
  AND "max_dispatch_attempts" BETWEEN 1 AND 100
  AND "dispatch_attempts" <= "max_dispatch_attempts"
  AND (("dispatch_lease_owner" IS NULL AND "dispatch_lease_expires_at" IS NULL) OR ("dispatch_lease_owner" IS NOT NULL AND "dispatch_lease_expires_at" IS NOT NULL))
  AND ("last_dispatch_error_code" IS NULL OR length("last_dispatch_error_code") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_payout_requests_provider_idempotency_unique" ON "referral_payout_requests"("provider_idempotency_key");
--> statement-breakpoint
CREATE INDEX "referral_payout_requests_dispatch_due_idx" ON "referral_payout_requests"("state", "next_dispatch_at", "dispatch_lease_expires_at", "submitted_at");
