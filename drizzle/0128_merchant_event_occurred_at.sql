ALTER TABLE "merchant_webhook_receipts" ADD COLUMN "provider_occurred_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "merchant_webhook_receipts" SET "provider_occurred_at" = "received_at" WHERE "provider_occurred_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "merchant_webhook_receipts" ALTER COLUMN "provider_occurred_at" SET NOT NULL;
