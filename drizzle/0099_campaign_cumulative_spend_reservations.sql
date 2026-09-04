CREATE TABLE "product_campaign_spend_reservations" (
  "workspace_id" text NOT NULL,
  "occurrence_id" text NOT NULL,
  "campaign_id" text NOT NULL,
  "campaign_revision" integer NOT NULL,
  "quote_id" text NOT NULL,
  "currency" text NOT NULL,
  "quoted_amount_cents" bigint NOT NULL,
  "reserved_credit_units" bigint NOT NULL,
  "credit_unit_price_usd" text,
  "state" text NOT NULL,
  "actual_amount_cents" bigint,
  "actual_credit_units" bigint,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "product_campaign_spend_reservations_pk" PRIMARY KEY("workspace_id", "occurrence_id"),
  CONSTRAINT "product_campaign_spend_reservations_quote_unique" UNIQUE("workspace_id", "quote_id"),
  CONSTRAINT "product_campaign_spend_reservations_occurrence_fk" FOREIGN KEY ("workspace_id", "occurrence_id") REFERENCES "product_campaign_occurrences"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "product_campaign_spend_reservations_values_check" CHECK (
    "campaign_revision" > 0 AND "currency" = 'USD' AND "quoted_amount_cents" > 0 AND
    "reserved_credit_units" >= 0 AND
    ("credit_unit_price_usd" IS NULL OR "credit_unit_price_usd" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$') AND
    "state" IN ('held','settled','released','outcome_unknown') AND
    ("actual_amount_cents" IS NULL OR "actual_amount_cents" >= 0) AND
    ("actual_credit_units" IS NULL OR "actual_credit_units" >= 0)
  )
);

CREATE INDEX "product_campaign_spend_reservations_campaign_idx"
  ON "product_campaign_spend_reservations" ("workspace_id", "campaign_id", "state", "created_at");

CREATE OR REPLACE FUNCTION enforce_product_campaign_spend_reservation_identity_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
     NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id OR
     NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR
     NEW.campaign_revision IS DISTINCT FROM OLD.campaign_revision OR
     NEW.quote_id IS DISTINCT FROM OLD.quote_id OR
     NEW.currency IS DISTINCT FROM OLD.currency OR
     NEW.quoted_amount_cents IS DISTINCT FROM OLD.quoted_amount_cents OR
     NEW.reserved_credit_units IS DISTINCT FROM OLD.reserved_credit_units OR
     NEW.credit_unit_price_usd IS DISTINCT FROM OLD.credit_unit_price_usd OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'product campaign spend reservation identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_campaign_spend_reservation_identity_immutable
BEFORE UPDATE ON "product_campaign_spend_reservations"
FOR EACH ROW EXECUTE FUNCTION enforce_product_campaign_spend_reservation_identity_immutable();
