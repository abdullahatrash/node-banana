CREATE TABLE "referral_capture_receipts" (
  "id" text PRIMARY KEY,
  "referral_code_id" text NOT NULL,
  "referrer_workspace_id" text NOT NULL,
  "visitor_token_digest" text NOT NULL,
  "state" text NOT NULL,
  "captured_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "attributed_at" timestamptz,
  CONSTRAINT "referral_capture_receipts_code_fk" FOREIGN KEY("referrer_workspace_id", "referral_code_id") REFERENCES "workspace_referral_codes"("workspace_id", "id") ON DELETE restrict,
  CONSTRAINT "referral_capture_receipts_values_check" CHECK (
    "visitor_token_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "state" IN ('captured','attributed','expired','superseded')
    AND "expires_at" > "captured_at"
    AND (("state" = 'attributed' AND "attributed_at" IS NOT NULL) OR ("state" <> 'attributed' AND "attributed_at" IS NULL))
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_capture_receipts_visitor_unique" ON "referral_capture_receipts"("visitor_token_digest");
--> statement-breakpoint
CREATE INDEX "referral_capture_receipts_referrer_cursor_idx" ON "referral_capture_receipts"("referrer_workspace_id", "captured_at", "id");
--> statement-breakpoint
CREATE INDEX "referral_capture_receipts_expiry_idx" ON "referral_capture_receipts"("state", "expires_at");
--> statement-breakpoint
ALTER TABLE "referral_attributions" ADD COLUMN "capture_id" text;
--> statement-breakpoint
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_capture_fk" FOREIGN KEY("capture_id") REFERENCES "referral_capture_receipts"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "referral_attributions_capture_unique" ON "referral_attributions"("capture_id");
--> statement-breakpoint
CREATE FUNCTION protect_referral_capture_identity() RETURNS trigger AS $$
BEGIN
  IF NEW."id" <> OLD."id"
    OR NEW."referral_code_id" <> OLD."referral_code_id"
    OR NEW."referrer_workspace_id" <> OLD."referrer_workspace_id"
    OR NEW."visitor_token_digest" <> OLD."visitor_token_digest"
    OR NEW."captured_at" <> OLD."captured_at"
    OR NEW."expires_at" <> OLD."expires_at" THEN
    RAISE EXCEPTION 'referral capture identity is immutable';
  END IF;
  IF OLD."state" IN ('attributed','expired','superseded') AND NEW."state" <> OLD."state" THEN
    RAISE EXCEPTION 'terminal referral capture state is immutable';
  END IF;
  IF OLD."state" = 'captured' AND NEW."state" NOT IN ('captured','attributed','expired','superseded') THEN
    RAISE EXCEPTION 'invalid referral capture state transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "referral_capture_identity_guard" BEFORE UPDATE ON "referral_capture_receipts" FOR EACH ROW EXECUTE FUNCTION protect_referral_capture_identity();
