CREATE TABLE "identity_erasure_receipts" (
  "user_id" text PRIMARY KEY NOT NULL,
  "receipt_id" text NOT NULL,
  "request_digest" text NOT NULL,
  "result" jsonb NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "identity_erasure_receipts_receipt_id_unique" UNIQUE("receipt_id"),
  CONSTRAINT "identity_erasure_receipts_user_fk" FOREIGN KEY("user_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT,
  CONSTRAINT "identity_erasure_receipts_values_check" CHECK (
    "receipt_id" ~ '^ier_[a-f0-9]{32}$'
    and "request_digest" ~ '^sha256:[a-f0-9]{64}$'
    and octet_length("result"::text) between 2 and 4096
    and "completed_at" >= "requested_at"
  )
);
