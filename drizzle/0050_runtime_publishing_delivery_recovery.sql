-- Backfills below intentionally rewrite #167/#168 rows. Suspend the live
-- append-only/transition triggers inside this migration transaction, then
-- reinstall them only after every new column and provenance backfill exists.
DROP TRIGGER "runtime_publishing_deliveries_identity_immutable"
ON "runtime_publishing_deliveries";
--> statement-breakpoint
DROP TRIGGER "runtime_publishing_delivery_events_insert_only"
ON "runtime_publishing_delivery_events";
--> statement-breakpoint
DROP TRIGGER "runtime_publishing_delivery_cancellations_insert_only"
ON "runtime_publishing_delivery_cancellations";
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_effect_identities" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"generation" integer NOT NULL,
	"effect_key" text NOT NULL,
	"intent_digest" text,
	"provider_adapter_contract_digest" text,
	"parent_effect_key" text,
	"parent_generation" integer,
	"derivation" text NOT NULL,
	"source_evidence_digest" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_delivery_effect_identities_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_delivery_effect_identities_identity_check" CHECK ("runtime_publishing_delivery_effect_identities"."id" ~ '^pdei_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_effect_identities"."generation" > 0
        and length("runtime_publishing_delivery_effect_identities"."effect_key") between 1 and 500
        and "runtime_publishing_delivery_effect_identities"."effect_key" = btrim("runtime_publishing_delivery_effect_identities"."effect_key")
        and "runtime_publishing_delivery_effect_identities"."effect_key" !~ '[[:cntrl:]]'
        and (("runtime_publishing_delivery_effect_identities"."intent_digest" is null and "runtime_publishing_delivery_effect_identities"."provider_adapter_contract_digest" is null)
          or ("runtime_publishing_delivery_effect_identities"."intent_digest" ~ '^sha256:[a-f0-9]{64}$'
            and "runtime_publishing_delivery_effect_identities"."provider_adapter_contract_digest" ~ '^sha256:[a-f0-9]{64}$'))
        and ("runtime_publishing_delivery_effect_identities"."source_evidence_digest" is null or "runtime_publishing_delivery_effect_identities"."source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$')
        and (("runtime_publishing_delivery_effect_identities"."derivation" = 'release' and "runtime_publishing_delivery_effect_identities"."generation" = 1
          and "runtime_publishing_delivery_effect_identities"."parent_effect_key" is null and "runtime_publishing_delivery_effect_identities"."parent_generation" is null
          and "runtime_publishing_delivery_effect_identities"."source_evidence_digest" is null)
          or ("runtime_publishing_delivery_effect_identities"."derivation" = 'retry_provider_failed_known' and "runtime_publishing_delivery_effect_identities"."generation" > 1
            and "runtime_publishing_delivery_effect_identities"."parent_effect_key" is not null
            and "runtime_publishing_delivery_effect_identities"."parent_generation" = "runtime_publishing_delivery_effect_identities"."generation" - 1
            and "runtime_publishing_delivery_effect_identities"."source_evidence_digest" is not null)))
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_effect_receipts" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"effect_generation" integer NOT NULL,
	"effect_attempt" integer NOT NULL,
	"effect_key" text NOT NULL,
	"intent_digest" text,
	"provider_adapter_contract_digest" text,
	"mode" text NOT NULL,
	"execution_fence" bigint NOT NULL,
	"result" text NOT NULL,
	"effect_disposition" text NOT NULL,
	"failure_class" text,
	"failure_retryable" boolean,
	"provider_operation_ref" text,
	"evidence_digest" text NOT NULL,
	"failure_code" text,
	"event_sequence" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_delivery_effect_receipts_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_delivery_effect_receipts_identity_check" CHECK ("runtime_publishing_delivery_effect_receipts"."id" ~ '^pder_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_effect_receipts"."effect_generation" > 0 and "runtime_publishing_delivery_effect_receipts"."effect_attempt" > 0
        and "runtime_publishing_delivery_effect_receipts"."execution_fence" > 0 and "runtime_publishing_delivery_effect_receipts"."event_sequence" > 0
        and length("runtime_publishing_delivery_effect_receipts"."effect_key") between 1 and 500
        and (("runtime_publishing_delivery_effect_receipts"."intent_digest" is null and "runtime_publishing_delivery_effect_receipts"."provider_adapter_contract_digest" is null
            and "runtime_publishing_delivery_effect_receipts"."effect_disposition" = 'not_created')
          or ("runtime_publishing_delivery_effect_receipts"."intent_digest" ~ '^sha256:[a-f0-9]{64}$'
            and "runtime_publishing_delivery_effect_receipts"."provider_adapter_contract_digest" ~ '^sha256:[a-f0-9]{64}$'))
        and "runtime_publishing_delivery_effect_receipts"."evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and ("runtime_publishing_delivery_effect_receipts"."provider_operation_ref" is null or (
          length("runtime_publishing_delivery_effect_receipts"."provider_operation_ref") between 1 and 500
          and "runtime_publishing_delivery_effect_receipts"."provider_operation_ref" = btrim("runtime_publishing_delivery_effect_receipts"."provider_operation_ref")
          and "runtime_publishing_delivery_effect_receipts"."provider_operation_ref" !~ '[[:cntrl:]]'))
        and ("runtime_publishing_delivery_effect_receipts"."failure_code" is null or "runtime_publishing_delivery_effect_receipts"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,79}$')),
	CONSTRAINT "runtime_publishing_delivery_effect_receipts_result_check" CHECK ("runtime_publishing_delivery_effect_receipts"."mode" in ('launch','observe','reconcile')
        and "runtime_publishing_delivery_effect_receipts"."result" in (
          'succeeded','failed_transient','failed_terminal',
          'confirmation_pending','outcome_unknown','still_unknown','operator_required'
        )
        and "runtime_publishing_delivery_effect_receipts"."effect_disposition" in (
          'not_created','provider_failed_known','provider_accepted','unknown'
        )
        and (("runtime_publishing_delivery_effect_receipts"."result" = 'failed_transient'
            and "runtime_publishing_delivery_effect_receipts"."failure_class" = 'transient' and "runtime_publishing_delivery_effect_receipts"."failure_retryable" = true
            and "runtime_publishing_delivery_effect_receipts"."failure_code" is not null
            and "runtime_publishing_delivery_effect_receipts"."effect_disposition" in ('not_created','provider_failed_known'))
          or ("runtime_publishing_delivery_effect_receipts"."result" = 'failed_terminal'
            and "runtime_publishing_delivery_effect_receipts"."failure_class" = 'terminal' and "runtime_publishing_delivery_effect_receipts"."failure_retryable" = false
            and "runtime_publishing_delivery_effect_receipts"."failure_code" is not null
            and "runtime_publishing_delivery_effect_receipts"."effect_disposition" in ('not_created','provider_failed_known'))
          or ("runtime_publishing_delivery_effect_receipts"."result" in ('outcome_unknown','still_unknown','operator_required')
            and "runtime_publishing_delivery_effect_receipts"."failure_class" is null and "runtime_publishing_delivery_effect_receipts"."failure_retryable" is null
            and "runtime_publishing_delivery_effect_receipts"."failure_code" is not null
            and "runtime_publishing_delivery_effect_receipts"."effect_disposition" in ('provider_accepted','unknown'))
          or ("runtime_publishing_delivery_effect_receipts"."result" in ('succeeded','confirmation_pending')
            and "runtime_publishing_delivery_effect_receipts"."failure_class" is null and "runtime_publishing_delivery_effect_receipts"."failure_retryable" is null
            and "runtime_publishing_delivery_effect_receipts"."failure_code" is null
            and "runtime_publishing_delivery_effect_receipts"."effect_disposition" = 'provider_accepted')))
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_readiness_receipts" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"effect_generation" integer NOT NULL,
	"effect_attempt" integer NOT NULL,
	"effect_key" text NOT NULL,
	"intent_digest" text NOT NULL,
	"provider_adapter_contract_digest" text NOT NULL,
	"execution_fence" bigint NOT NULL,
	"principal_id" text NOT NULL,
	"key_id" text NOT NULL,
	"authorization_evidence_digest" text NOT NULL,
	"approval_request_id" text NOT NULL,
	"approval_decision_id" text NOT NULL,
	"channel_state_digest" text NOT NULL,
	"credential_state_digest" text NOT NULL,
	"validation_evidence_digest" text NOT NULL,
	"validation_current_state_digest" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_delivery_readiness_receipts_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_delivery_readiness_receipts_identity_check" CHECK ("runtime_publishing_delivery_readiness_receipts"."id" ~ '^pdrr_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_readiness_receipts"."effect_generation" > 0 and "runtime_publishing_delivery_readiness_receipts"."effect_attempt" between 1 and 8
        and "runtime_publishing_delivery_readiness_receipts"."execution_fence" > 0
        and length("runtime_publishing_delivery_readiness_receipts"."effect_key") between 1 and 500
        and "runtime_publishing_delivery_readiness_receipts"."intent_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_readiness_receipts"."provider_adapter_contract_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_readiness_receipts"."authorization_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_readiness_receipts"."channel_state_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_readiness_receipts"."credential_state_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_readiness_receipts"."validation_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_readiness_receipts"."validation_current_state_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_readiness_receipts"."expires_at" > "runtime_publishing_delivery_readiness_receipts"."checked_at")
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_reconciliation_receipts" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"reconciliation_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"source_evidence_digest" text NOT NULL,
	"result_evidence_digest" text NOT NULL,
	"effect_key" text NOT NULL,
	"effect_generation" integer NOT NULL,
	"outcome" text NOT NULL,
	"effect_disposition" text,
	"failure_class" text,
	"failure_retryable" boolean,
	"failure_code" text,
	"provider_operation_ref" text,
	"event_sequence" integer NOT NULL,
	"outbox_generation" integer,
	"reconciled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_delivery_reconciliation_receipts_pk" PRIMARY KEY("workspace_id","reconciliation_id"),
	CONSTRAINT "runtime_publishing_delivery_reconciliation_receipts_result_check" CHECK ("runtime_publishing_delivery_reconciliation_receipts"."id" ~ '^pdrer_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_reconciliation_receipts"."source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_reconciliation_receipts"."result_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_reconciliation_receipts"."result_evidence_digest" <> "runtime_publishing_delivery_reconciliation_receipts"."source_evidence_digest"
        and "runtime_publishing_delivery_reconciliation_receipts"."effect_generation" > 0 and length("runtime_publishing_delivery_reconciliation_receipts"."effect_key") between 1 and 500
        and "runtime_publishing_delivery_reconciliation_receipts"."event_sequence" > 0
        and "runtime_publishing_delivery_reconciliation_receipts"."outcome" in ('succeeded','failed_known','still_unknown','operator_required')
        and (("runtime_publishing_delivery_reconciliation_receipts"."outcome" = 'failed_known'
            and "runtime_publishing_delivery_reconciliation_receipts"."failure_class" in ('transient','terminal')
            and "runtime_publishing_delivery_reconciliation_receipts"."failure_retryable" = ("runtime_publishing_delivery_reconciliation_receipts"."failure_class" = 'transient')
            and "runtime_publishing_delivery_reconciliation_receipts"."failure_code" is not null
            and "runtime_publishing_delivery_reconciliation_receipts"."effect_disposition" in ('not_created','provider_failed_known'))
          or ("runtime_publishing_delivery_reconciliation_receipts"."outcome" in ('still_unknown','operator_required')
            and "runtime_publishing_delivery_reconciliation_receipts"."failure_class" is null and "runtime_publishing_delivery_reconciliation_receipts"."failure_retryable" is null
            and "runtime_publishing_delivery_reconciliation_receipts"."failure_code" is not null and "runtime_publishing_delivery_reconciliation_receipts"."effect_disposition" is null)
          or ("runtime_publishing_delivery_reconciliation_receipts"."outcome" = 'succeeded'
            and "runtime_publishing_delivery_reconciliation_receipts"."failure_class" is null and "runtime_publishing_delivery_reconciliation_receipts"."failure_retryable" is null
            and "runtime_publishing_delivery_reconciliation_receipts"."failure_code" is null and "runtime_publishing_delivery_reconciliation_receipts"."effect_disposition" is null))
        and "runtime_publishing_delivery_reconciliation_receipts"."outbox_generation" is null)
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_reconciliation_requests" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"principal_id" text,
	"key_id" text,
	"user_id" text,
	"capability" text NOT NULL,
	"authorization_session_id" text NOT NULL,
	"authorization_contract_digest" text NOT NULL,
	"authorization_admission_evidence_ref" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"authorization_evidence_digest" text NOT NULL,
	"authorized_resources" jsonb NOT NULL,
	"authority_grants" jsonb NOT NULL,
	"authorization_issued_at" timestamp with time zone NOT NULL,
	"authorization_expires_at" timestamp with time zone NOT NULL,
	"source_evidence_digest" text NOT NULL,
	"effect_generation" integer NOT NULL,
	"effect_key" text NOT NULL,
	"intent_digest" text NOT NULL,
	"provider_adapter_contract_digest" text NOT NULL,
	"provider_operation_ref" text,
	"event_sequence" integer NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_delivery_reconciliation_requests_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_delivery_reconciliation_requests_actor_check" CHECK (("runtime_publishing_delivery_reconciliation_requests"."actor_kind" = 'agent' and "runtime_publishing_delivery_reconciliation_requests"."actor_id" = "runtime_publishing_delivery_reconciliation_requests"."principal_id"
          and "runtime_publishing_delivery_reconciliation_requests"."principal_id" is not null and "runtime_publishing_delivery_reconciliation_requests"."key_id" is not null
          and "runtime_publishing_delivery_reconciliation_requests"."user_id" is null and jsonb_array_length("runtime_publishing_delivery_reconciliation_requests"."authority_grants") = 0)
        or ("runtime_publishing_delivery_reconciliation_requests"."actor_kind" = 'human' and "runtime_publishing_delivery_reconciliation_requests"."actor_id" = "runtime_publishing_delivery_reconciliation_requests"."user_id"
          and "runtime_publishing_delivery_reconciliation_requests"."user_id" is not null and "runtime_publishing_delivery_reconciliation_requests"."principal_id" is null
          and "runtime_publishing_delivery_reconciliation_requests"."key_id" is null and jsonb_array_length("runtime_publishing_delivery_reconciliation_requests"."authority_grants") = 1)),
	CONSTRAINT "runtime_publishing_delivery_reconciliation_requests_contract_check" CHECK ("runtime_publishing_delivery_reconciliation_requests"."id" ~ '^pdre_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_reconciliation_requests"."capability" = 'publishing_deliveries.reconcile@1'
        and length("runtime_publishing_delivery_reconciliation_requests"."authorization_session_id") between 1 and 200
        and "runtime_publishing_delivery_reconciliation_requests"."authorization_contract_digest" ~ '^sha256:[a-f0-9]{64}$'
        and length("runtime_publishing_delivery_reconciliation_requests"."authorization_admission_evidence_ref") between 1 and 200
        and length("runtime_publishing_delivery_reconciliation_requests"."authorization_evidence_ref") between 1 and 200
        and "runtime_publishing_delivery_reconciliation_requests"."authorization_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof("runtime_publishing_delivery_reconciliation_requests"."authorized_resources") = 'object'
        and jsonb_typeof("runtime_publishing_delivery_reconciliation_requests"."authority_grants") = 'array'
        and "runtime_publishing_delivery_reconciliation_requests"."authorization_expires_at" > "runtime_publishing_delivery_reconciliation_requests"."authorization_issued_at"
        and "runtime_publishing_delivery_reconciliation_requests"."requested_at" >= "runtime_publishing_delivery_reconciliation_requests"."authorization_issued_at"
        and "runtime_publishing_delivery_reconciliation_requests"."requested_at" < "runtime_publishing_delivery_reconciliation_requests"."authorization_expires_at"
        and "runtime_publishing_delivery_reconciliation_requests"."source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_reconciliation_requests"."effect_generation" > 0
        and "runtime_publishing_delivery_reconciliation_requests"."intent_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_reconciliation_requests"."provider_adapter_contract_digest" ~ '^sha256:[a-f0-9]{64}$'
        and ("runtime_publishing_delivery_reconciliation_requests"."provider_operation_ref" is null or length("runtime_publishing_delivery_reconciliation_requests"."provider_operation_ref") between 1 and 500)
        and "runtime_publishing_delivery_reconciliation_requests"."event_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_retry_approval_consumptions" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"approval_request_id" text NOT NULL,
	"approval_decision_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"source_evidence_digest" text NOT NULL,
	"requesting_principal_id" text NOT NULL,
	"requesting_key_id" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_user_id" text,
	"capability" text NOT NULL,
	"authorization_contract_digest" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"authorized_resources" jsonb NOT NULL,
	"consumed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_delivery_retry_approval_consumptions_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_delivery_retry_approval_consumptions_contract_check" CHECK ("runtime_publishing_delivery_retry_approval_consumptions"."id" ~ '^pdrc_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_retry_approval_consumptions"."capability" = 'publishing_deliveries.retry@1'
        and "runtime_publishing_delivery_retry_approval_consumptions"."source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_retry_approval_consumptions"."authorization_contract_digest" ~ '^sha256:[a-f0-9]{64}$'
        and length("runtime_publishing_delivery_retry_approval_consumptions"."authorization_evidence_ref") between 1 and 200
        and jsonb_typeof("runtime_publishing_delivery_retry_approval_consumptions"."authorized_resources") = 'object'
        and (("runtime_publishing_delivery_retry_approval_consumptions"."actor_kind" = 'agent' and "runtime_publishing_delivery_retry_approval_consumptions"."actor_id" = "runtime_publishing_delivery_retry_approval_consumptions"."requesting_principal_id"
            and "runtime_publishing_delivery_retry_approval_consumptions"."actor_user_id" is null)
          or ("runtime_publishing_delivery_retry_approval_consumptions"."actor_kind" = 'human' and "runtime_publishing_delivery_retry_approval_consumptions"."actor_id" = "runtime_publishing_delivery_retry_approval_consumptions"."actor_user_id"
            and "runtime_publishing_delivery_retry_approval_consumptions"."actor_user_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_delivery_retry_receipts" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"principal_id" text,
	"key_id" text,
	"user_id" text,
	"capability" text NOT NULL,
	"authorization_session_id" text NOT NULL,
	"authorization_contract_digest" text NOT NULL,
	"authorization_admission_evidence_ref" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"authorization_evidence_digest" text NOT NULL,
	"authorized_resources" jsonb NOT NULL,
	"authority_grants" jsonb NOT NULL,
	"authorization_issued_at" timestamp with time zone NOT NULL,
	"authorization_expires_at" timestamp with time zone NOT NULL,
	"source_evidence_digest" text NOT NULL,
	"source_effect_generation" integer NOT NULL,
	"source_effect_key" text NOT NULL,
	"source_intent_digest" text,
	"source_effect_disposition" text NOT NULL,
	"approval_request_id" text NOT NULL,
	"approval_decision_id" text NOT NULL,
	"approval_consumption_id" text NOT NULL,
	"event_sequence" integer NOT NULL,
	"outbox_generation" integer NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"retry_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_delivery_retry_receipts_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_delivery_retry_receipts_actor_check" CHECK (("runtime_publishing_delivery_retry_receipts"."actor_kind" = 'agent' and "runtime_publishing_delivery_retry_receipts"."actor_id" = "runtime_publishing_delivery_retry_receipts"."principal_id"
          and "runtime_publishing_delivery_retry_receipts"."principal_id" is not null and "runtime_publishing_delivery_retry_receipts"."key_id" is not null
          and "runtime_publishing_delivery_retry_receipts"."user_id" is null and jsonb_array_length("runtime_publishing_delivery_retry_receipts"."authority_grants") = 0)
        or ("runtime_publishing_delivery_retry_receipts"."actor_kind" = 'human' and "runtime_publishing_delivery_retry_receipts"."actor_id" = "runtime_publishing_delivery_retry_receipts"."user_id"
          and "runtime_publishing_delivery_retry_receipts"."user_id" is not null and "runtime_publishing_delivery_retry_receipts"."principal_id" is null
          and "runtime_publishing_delivery_retry_receipts"."key_id" is null and jsonb_array_length("runtime_publishing_delivery_retry_receipts"."authority_grants") = 1)),
	CONSTRAINT "runtime_publishing_delivery_retry_receipts_contract_check" CHECK ("runtime_publishing_delivery_retry_receipts"."id" ~ '^pdrt_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_retry_receipts"."capability" = 'publishing_deliveries.retry@1'
        and length("runtime_publishing_delivery_retry_receipts"."authorization_session_id") between 1 and 200
        and "runtime_publishing_delivery_retry_receipts"."authorization_contract_digest" ~ '^sha256:[a-f0-9]{64}$'
        and length("runtime_publishing_delivery_retry_receipts"."authorization_admission_evidence_ref") between 1 and 200
        and length("runtime_publishing_delivery_retry_receipts"."authorization_evidence_ref") between 1 and 200
        and "runtime_publishing_delivery_retry_receipts"."authorization_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof("runtime_publishing_delivery_retry_receipts"."authorized_resources") = 'object'
        and jsonb_typeof("runtime_publishing_delivery_retry_receipts"."authority_grants") = 'array'
        and "runtime_publishing_delivery_retry_receipts"."authorization_expires_at" > "runtime_publishing_delivery_retry_receipts"."authorization_issued_at"
        and "runtime_publishing_delivery_retry_receipts"."requested_at" >= "runtime_publishing_delivery_retry_receipts"."authorization_issued_at"
        and "runtime_publishing_delivery_retry_receipts"."requested_at" < "runtime_publishing_delivery_retry_receipts"."authorization_expires_at"
        and "runtime_publishing_delivery_retry_receipts"."source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and ("runtime_publishing_delivery_retry_receipts"."source_intent_digest" is null or "runtime_publishing_delivery_retry_receipts"."source_intent_digest" ~ '^sha256:[a-f0-9]{64}$')
        and "runtime_publishing_delivery_retry_receipts"."source_effect_generation" > 0
        and "runtime_publishing_delivery_retry_receipts"."source_effect_disposition" in ('not_created','provider_failed_known')
        and "runtime_publishing_delivery_retry_receipts"."event_sequence" > 0 and "runtime_publishing_delivery_retry_receipts"."outbox_generation" > 0
        and "runtime_publishing_delivery_retry_receipts"."retry_at" >= "runtime_publishing_delivery_retry_receipts"."requested_at")
);
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" DROP CONSTRAINT "runtime_publishing_deliveries_identity_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" DROP CONSTRAINT "runtime_publishing_deliveries_state_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" DROP CONSTRAINT "runtime_publishing_deliveries_evidence_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" DROP CONSTRAINT "runtime_publishing_deliveries_lifecycle_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_cancellations" DROP CONSTRAINT "runtime_publishing_delivery_cancellations_authorization_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_cancellations" DROP CONSTRAINT "runtime_publishing_delivery_cancellations_result_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_outbox_intents" DROP CONSTRAINT "runtime_publishing_delivery_outbox_state_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "effect_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "provider_adapter_contract_digest" text;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "failure_class" text;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "failure_retryable" boolean;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "failure_effect_disposition" text;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "next_effect_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "confirmation_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_outbox_intents" ADD COLUMN "purpose" text DEFAULT 'publish' NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_events" DROP CONSTRAINT "runtime_publishing_delivery_events_type_check";--> statement-breakpoint
-- Seal legacy prepared identities conservatively. The sentinel denotes an
-- adapter contract that cannot be assumed equal to any live adapter after the
-- upgrade; retained effects therefore remain observable/operator-owned and
-- can never be blindly relaunched.
UPDATE "runtime_publishing_deliveries"
SET "provider_adapter_contract_digest" = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
WHERE "intent_digest" IS NOT NULL
  AND "provider_adapter_contract_digest" IS NULL;--> statement-breakpoint
UPDATE "runtime_publishing_deliveries"
SET "state" = 'failed_terminal',
    "failure_class" = 'terminal',
    "failure_retryable" = false,
    "dispatch_started_at" = CASE
      WHEN "effect_contact_started_at" IS NULL THEN NULL
      ELSE "dispatch_started_at"
    END,
    "failure_effect_disposition" = CASE
      WHEN "effect_contact_started_at" IS NULL THEN 'not_created'
      ELSE 'provider_failed_known'
    END
WHERE "state" = 'failed';--> statement-breakpoint
UPDATE "runtime_publishing_delivery_cancellations"
SET "state_at_request" = 'failed_terminal'
WHERE "state_at_request" = 'failed';--> statement-breakpoint
UPDATE "runtime_publishing_delivery_events" e
SET "type" = 'publication.failed_terminal',
    "evidence" = e."evidence" || jsonb_build_object(
      'effectGeneration', 1,
      'failureClass', 'terminal',
      'retryable', false,
      'effectDisposition', CASE
        WHEN d."effect_contact_started_at" IS NULL THEN 'not_created'
        ELSE 'provider_failed_known'
      END
    )
FROM "runtime_publishing_deliveries" d
WHERE e."workspace_id" = d."workspace_id"
  AND e."delivery_id" = d."id"
  AND e."type" = 'publication.failed';--> statement-breakpoint
UPDATE "runtime_publishing_delivery_events" e
SET "evidence" = e."evidence" || jsonb_build_object(
  'effectGeneration', 1,
  'providerAdapterContractDigest', d."provider_adapter_contract_digest"
)
FROM "runtime_publishing_deliveries" d
WHERE e."workspace_id" = d."workspace_id"
  AND e."delivery_id" = d."id"
  AND e."type" = 'effect.prepared';--> statement-breakpoint
UPDATE "runtime_publishing_delivery_events" e
SET "evidence" = e."evidence" || jsonb_build_object(
  'effectGeneration', 1,
  'providerAdapterContractDigest', d."provider_adapter_contract_digest",
  'readinessEvidenceDigest', 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
)
FROM "runtime_publishing_deliveries" d
WHERE e."workspace_id" = d."workspace_id"
  AND e."delivery_id" = d."id"
  AND e."type" = 'effect.contact_started';--> statement-breakpoint
UPDATE "runtime_publishing_deliveries" d
SET "next_effect_attempt" = LEAST(9, 1 + (
      SELECT count(*)::integer
      FROM "runtime_publishing_delivery_events" e
      WHERE e."workspace_id" = d."workspace_id"
        AND e."delivery_id" = d."id"
        AND e."type" = 'publication.confirmation_pending'
    )),
    "confirmation_attempts" = LEAST(3, (
      SELECT count(*)::integer
      FROM "runtime_publishing_delivery_events" e
      WHERE e."workspace_id" = d."workspace_id"
        AND e."delivery_id" = d."id"
        AND e."type" = 'publication.confirmation_pending'
    ));--> statement-breakpoint
INSERT INTO "runtime_publishing_delivery_effect_identities" (
  "workspace_id", "id", "delivery_id", "generation", "effect_key",
  "intent_digest", "provider_adapter_contract_digest", "parent_effect_key",
  "parent_generation", "derivation", "source_evidence_digest", "created_at"
)
SELECT d."workspace_id",
  'pdei_legacy_' || md5(d."workspace_id" || ':' || d."id"),
  d."id", 1, d."effect_key", d."intent_digest",
  d."provider_adapter_contract_digest", NULL, NULL, 'release', NULL,
  d."accepted_at"
FROM "runtime_publishing_deliveries" d;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_effect_identities" ADD CONSTRAINT "runtime_publishing_delivery_effect_identities_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_effect_receipts" ADD CONSTRAINT "runtime_publishing_delivery_effect_receipts_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_readiness_receipts" ADD CONSTRAINT "runtime_publishing_delivery_readiness_receipts_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_readiness_receipts" ADD CONSTRAINT "runtime_publishing_delivery_readiness_receipts_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_readiness_receipts" ADD CONSTRAINT "runtime_publishing_delivery_readiness_receipts_key_fk" FOREIGN KEY ("principal_id","key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_reconciliation_receipts" ADD CONSTRAINT "runtime_publishing_delivery_reconciliation_receipts_request_fk" FOREIGN KEY ("workspace_id","reconciliation_id") REFERENCES "public"."runtime_publishing_delivery_reconciliation_requests"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_reconciliation_requests" ADD CONSTRAINT "runtime_publishing_delivery_reconciliation_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_reconciliation_requests" ADD CONSTRAINT "runtime_publishing_delivery_reconciliation_requests_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_reconciliation_requests" ADD CONSTRAINT "runtime_publishing_delivery_reconciliation_requests_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_reconciliation_requests" ADD CONSTRAINT "runtime_publishing_delivery_reconciliation_requests_key_fk" FOREIGN KEY ("principal_id","key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_approval_consumptions" ADD CONSTRAINT "runtime_publishing_delivery_retry_approval_consumptions_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_approval_consumptions" ADD CONSTRAINT "runtime_publishing_delivery_retry_approval_consumptions_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_approval_consumptions" ADD CONSTRAINT "runtime_publishing_delivery_retry_approval_consumptions_approval_fk" FOREIGN KEY ("workspace_id","approval_request_id","approval_decision_id") REFERENCES "public"."runtime_publishing_approval_decisions"("workspace_id","request_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_approval_consumptions" ADD CONSTRAINT "runtime_publishing_delivery_retry_approval_consumptions_principal_fk" FOREIGN KEY ("workspace_id","requesting_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_approval_consumptions" ADD CONSTRAINT "runtime_publishing_delivery_retry_approval_consumptions_key_fk" FOREIGN KEY ("requesting_principal_id","requesting_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD CONSTRAINT "runtime_publishing_delivery_retry_receipts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD CONSTRAINT "runtime_publishing_delivery_retry_receipts_delivery_fk" FOREIGN KEY ("workspace_id","delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD CONSTRAINT "runtime_publishing_delivery_retry_receipts_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD CONSTRAINT "runtime_publishing_delivery_retry_receipts_key_fk" FOREIGN KEY ("principal_id","key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD CONSTRAINT "runtime_publishing_delivery_retry_receipts_approval_consumption_fk" FOREIGN KEY ("workspace_id","approval_request_id","approval_decision_id","delivery_id","source_evidence_digest","approval_consumption_id") REFERENCES "public"."runtime_publishing_delivery_retry_approval_consumptions"("workspace_id","approval_request_id","approval_decision_id","delivery_id","source_evidence_digest","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_effect_identities_delivery_generation_unique" ON "runtime_publishing_delivery_effect_identities" USING btree ("workspace_id","delivery_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_effect_identities_effect_key_unique" ON "runtime_publishing_delivery_effect_identities" USING btree ("workspace_id","effect_key");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_effect_identities_exact_unique" ON "runtime_publishing_delivery_effect_identities" USING btree ("workspace_id","delivery_id","generation","effect_key","intent_digest","provider_adapter_contract_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_effect_receipts_attempt_unique" ON "runtime_publishing_delivery_effect_receipts" USING btree ("workspace_id","delivery_id","effect_generation","effect_attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_effect_receipts_evidence_unique" ON "runtime_publishing_delivery_effect_receipts" USING btree ("workspace_id","delivery_id","evidence_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_effect_receipts_event_unique" ON "runtime_publishing_delivery_effect_receipts" USING btree ("workspace_id","delivery_id","event_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_readiness_receipts_attempt_unique" ON "runtime_publishing_delivery_readiness_receipts" USING btree ("workspace_id","delivery_id","effect_generation","effect_attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_reconciliation_receipts_evidence_unique" ON "runtime_publishing_delivery_reconciliation_receipts" USING btree ("workspace_id","delivery_id","result_evidence_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_reconciliation_receipts_identity_unique" ON "runtime_publishing_delivery_reconciliation_receipts" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_reconciliation_requests_invocation_unique" ON "runtime_publishing_delivery_reconciliation_requests" USING btree ("workspace_id","delivery_id","source_evidence_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_retry_approval_consumptions_decision_unique" ON "runtime_publishing_delivery_retry_approval_consumptions" USING btree ("workspace_id","approval_decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_retry_approval_consumptions_exact_unique" ON "runtime_publishing_delivery_retry_approval_consumptions" USING btree ("workspace_id","approval_request_id","approval_decision_id","delivery_id","source_evidence_digest","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_retry_receipts_invocation_unique" ON "runtime_publishing_delivery_retry_receipts" USING btree ("workspace_id","delivery_id","source_evidence_digest","actor_kind","actor_id","capability");--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_identity_check" CHECK ("runtime_publishing_deliveries"."id" ~ '^pdl_[A-Za-z0-9_-]+$'
        and length("runtime_publishing_deliveries"."id") between 1 and 200
        and length("runtime_publishing_deliveries"."target_id") between 1 and 200
        and length("runtime_publishing_deliveries"."channel_id") between 1 and 200
        and "runtime_publishing_deliveries"."target_ordinal" >= 0
        and "runtime_publishing_deliveries"."plan_revision" > 0
        and "runtime_publishing_deliveries"."plan_revision_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_deliveries"."validation_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_deliveries"."target_snapshot_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_deliveries"."effect_generation" > 0
        and "runtime_publishing_deliveries"."next_effect_attempt" between 1 and 9
        and "runtime_publishing_deliveries"."confirmation_attempts" between 0 and 3
        and length("runtime_publishing_deliveries"."effect_key") between 1 and 500
        and "runtime_publishing_deliveries"."effect_key" = btrim("runtime_publishing_deliveries"."effect_key")
        and "runtime_publishing_deliveries"."effect_key" !~ '[[:cntrl:]]');--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_state_check" CHECK ("runtime_publishing_deliveries"."desired_state" in ('publish','cancel')
        and "runtime_publishing_deliveries"."state" in (
          'scheduled','dispatching','confirmation_pending',
          'succeeded','failed_transient','failed_terminal','outcome_unknown','cancelled'
        )
        and "runtime_publishing_deliveries"."next_event_sequence" >= 3
        and "runtime_publishing_deliveries"."next_outbox_generation" >= 2);--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_evidence_check" CHECK (("runtime_publishing_deliveries"."intent_digest" is null or "runtime_publishing_deliveries"."intent_digest" ~ '^sha256:[a-f0-9]{64}$')
        and ("runtime_publishing_deliveries"."provider_adapter_contract_digest" is null or "runtime_publishing_deliveries"."provider_adapter_contract_digest" ~ '^sha256:[a-f0-9]{64}$')
        and ("runtime_publishing_deliveries"."latest_effect_evidence_digest" is null or "runtime_publishing_deliveries"."latest_effect_evidence_digest" ~ '^sha256:[a-f0-9]{64}$')
        and ("runtime_publishing_deliveries"."provider_operation_ref" is null or (
          length("runtime_publishing_deliveries"."provider_operation_ref") between 1 and 500
          and "runtime_publishing_deliveries"."provider_operation_ref" = btrim("runtime_publishing_deliveries"."provider_operation_ref")
          and "runtime_publishing_deliveries"."provider_operation_ref" !~ '[[:cntrl:]]'
        ))
        and ("runtime_publishing_deliveries"."failure_code" is null or "runtime_publishing_deliveries"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,79}$')
        and ("runtime_publishing_deliveries"."failure_class" is null or "runtime_publishing_deliveries"."failure_class" in ('transient','terminal'))
        and ("runtime_publishing_deliveries"."failure_effect_disposition" is null or "runtime_publishing_deliveries"."failure_effect_disposition" in (
          'not_created','provider_failed_known','ambiguous'
        ))
        and (("runtime_publishing_deliveries"."failure_class" is null and "runtime_publishing_deliveries"."failure_retryable" is null and "runtime_publishing_deliveries"."failure_effect_disposition" is null)
          or ("runtime_publishing_deliveries"."failure_class" is not null and "runtime_publishing_deliveries"."failure_retryable" is not null
            and "runtime_publishing_deliveries"."failure_effect_disposition" in ('not_created','provider_failed_known'))
          or ("runtime_publishing_deliveries"."failure_class" is null and "runtime_publishing_deliveries"."failure_retryable" is null
            and "runtime_publishing_deliveries"."failure_effect_disposition" = 'ambiguous')));--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_lifecycle_check" CHECK (("runtime_publishing_deliveries"."state" = 'scheduled'
          and "runtime_publishing_deliveries"."desired_state" = 'publish'
          and (("runtime_publishing_deliveries"."intent_digest" is null and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is null)
            or ("runtime_publishing_deliveries"."intent_digest" is not null and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null))
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'scheduled'
          and "runtime_publishing_deliveries"."desired_state" = 'publish'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'dispatching'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'confirmation_pending'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'succeeded'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" in ('failed_transient','failed_terminal')
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."failure_class" = case when "runtime_publishing_deliveries"."state" = 'failed_transient' then 'transient' else 'terminal' end
          and "runtime_publishing_deliveries"."failure_retryable" = ("runtime_publishing_deliveries"."state" = 'failed_transient')
          and "runtime_publishing_deliveries"."failure_effect_disposition" in ('not_created','provider_failed_known')
          and (("runtime_publishing_deliveries"."failure_effect_disposition" = 'not_created'
              and "runtime_publishing_deliveries"."provider_operation_ref" is null
              and ((("runtime_publishing_deliveries"."dispatch_started_at" is null
                  and "runtime_publishing_deliveries"."effect_contact_started_at" is null)
                and (("runtime_publishing_deliveries"."intent_digest" is null and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is null)
                  or ("runtime_publishing_deliveries"."intent_digest" is not null and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null)))
                or ("runtime_publishing_deliveries"."intent_digest" is not null
                  and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
                  and "runtime_publishing_deliveries"."dispatch_started_at" is not null
                  and "runtime_publishing_deliveries"."effect_contact_started_at" is not null)))
            or ("runtime_publishing_deliveries"."failure_effect_disposition" = 'provider_failed_known'
              and "runtime_publishing_deliveries"."intent_digest" is not null
              and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
              and "runtime_publishing_deliveries"."dispatch_started_at" is not null
              and "runtime_publishing_deliveries"."effect_contact_started_at" is not null))
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" = 'outcome_unknown'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" = 'cancelled'
          and "runtime_publishing_deliveries"."desired_state" = 'cancel'
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is null
          and (("runtime_publishing_deliveries"."intent_digest" is null and "runtime_publishing_deliveries"."dispatch_started_at" is null)
            or ("runtime_publishing_deliveries"."intent_digest" is not null and "runtime_publishing_deliveries"."dispatch_started_at" is not null))
          and "runtime_publishing_deliveries"."completed_at" is not null));--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_cancellations" ADD CONSTRAINT "runtime_publishing_delivery_cancellations_authorization_check" CHECK ("runtime_publishing_delivery_cancellations"."capability" = 'publishing_deliveries.cancel@1'
        and "runtime_publishing_delivery_cancellations"."authorization_contract_digest" = 'sha256:cae0f4b46fca3c38dd014bf2c27b2b8f2a3555d24eb62da60c367e49f2e1554e'
        and length("runtime_publishing_delivery_cancellations"."authorization_admission_evidence_ref") between 1 and 200
        and length("runtime_publishing_delivery_cancellations"."authorization_evidence_ref") between 1 and 200
        and "runtime_publishing_delivery_cancellations"."authorization_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof("runtime_publishing_delivery_cancellations"."authorized_resources") = 'object'
        and "runtime_publishing_delivery_cancellations"."authorized_resources" ?& array['channelIds','artifactIds']
        and ("runtime_publishing_delivery_cancellations"."authorized_resources" - array['channelIds','artifactIds']) = '{}'::jsonb
        and jsonb_typeof("runtime_publishing_delivery_cancellations"."authorized_resources"->'channelIds') = 'array'
        and jsonb_array_length("runtime_publishing_delivery_cancellations"."authorized_resources"->'channelIds') between 1 and 50
        and jsonb_typeof("runtime_publishing_delivery_cancellations"."authorized_resources"->'artifactIds') = 'array'
        and jsonb_array_length("runtime_publishing_delivery_cancellations"."authorized_resources"->'artifactIds') between 1 and 200
        and jsonb_typeof("runtime_publishing_delivery_cancellations"."authority_grants") = 'array'
        and jsonb_array_length("runtime_publishing_delivery_cancellations"."authority_grants") between 0 and 50
        and "runtime_publishing_delivery_cancellations"."authorization_expires_at" > "runtime_publishing_delivery_cancellations"."authorization_issued_at"
        and "runtime_publishing_delivery_cancellations"."requested_at" >= "runtime_publishing_delivery_cancellations"."authorization_issued_at"
        and "runtime_publishing_delivery_cancellations"."requested_at" < "runtime_publishing_delivery_cancellations"."authorization_expires_at");--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_cancellations" ADD CONSTRAINT "runtime_publishing_delivery_cancellations_result_check" CHECK ("runtime_publishing_delivery_cancellations"."state_at_request" in (
          'scheduled','blocked','dispatching','confirmation_pending','succeeded',
          'failed_transient','failed_terminal','outcome_unknown','cancelled'
        )
        and "runtime_publishing_delivery_cancellations"."outcome" in ('prevented','conditional','unknown','too_late')
        and "runtime_publishing_delivery_cancellations"."externally_reversed" = false
        and (("runtime_publishing_delivery_cancellations"."outcome" = 'prevented' and "runtime_publishing_delivery_cancellations"."state_at_request" in ('scheduled','blocked','dispatching'))
          or ("runtime_publishing_delivery_cancellations"."outcome" = 'conditional' and "runtime_publishing_delivery_cancellations"."state_at_request" = 'confirmation_pending')
          or ("runtime_publishing_delivery_cancellations"."outcome" = 'unknown' and "runtime_publishing_delivery_cancellations"."state_at_request" in ('scheduled','dispatching','outcome_unknown'))
          or ("runtime_publishing_delivery_cancellations"."outcome" = 'too_late' and "runtime_publishing_delivery_cancellations"."state_at_request" in (
            'succeeded','failed_transient','failed_terminal'
          )))
        and (("runtime_publishing_delivery_cancellations"."outcome" in ('unknown','conditional')
            and "runtime_publishing_delivery_cancellations"."externally_completed_at_request" is null)
          or ("runtime_publishing_delivery_cancellations"."outcome" = 'prevented'
            and "runtime_publishing_delivery_cancellations"."externally_completed_at_request" = false)
          or ("runtime_publishing_delivery_cancellations"."outcome" = 'too_late'
            and "runtime_publishing_delivery_cancellations"."externally_completed_at_request" = ("runtime_publishing_delivery_cancellations"."state_at_request" = 'succeeded'))));--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_outbox_intents" ADD CONSTRAINT "runtime_publishing_delivery_outbox_state_check" CHECK ("runtime_publishing_delivery_outbox_intents"."state" in ('pending','claimed','delivered')
        and "runtime_publishing_delivery_outbox_intents"."purpose" in ('publish','reconcile'));--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_events" ADD CONSTRAINT "runtime_publishing_delivery_events_type_check" CHECK ("runtime_publishing_delivery_events"."type" in (
  'delivery.accepted','delivery.scheduled','delivery.blocked','delivery.resumed',
  'delivery.cancellation_requested','delivery.cancelled',
  'delivery.retry_requested','delivery.reconciliation_requested','delivery.reconciled',
  'effect.not_created','effect.prepared','effect.contact_started',
  'publication.confirmation_pending','publication.retry_scheduled','publication.succeeded',
  'publication.failed_transient','publication.failed_terminal','publication.outcome_unknown'
));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "runtime_publishing_delivery_event_insert_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_sequence integer;
  delivery_retry_id text;
  delivery_source_id text;
BEGIN
  SELECT "next_event_sequence", "retry_id", "source_delivery_id"
  INTO next_sequence, delivery_retry_id, delivery_source_id
  FROM "runtime_publishing_deliveries"
  WHERE "workspace_id" = NEW.workspace_id AND "id" = NEW.delivery_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publishing Delivery event has no canonical Delivery';
  END IF;
  IF delivery_retry_id IS NULL AND NEW.sequence = 1
    AND NEW.type = 'delivery.accepted' AND next_sequence = 3 THEN RETURN NEW; END IF;
  IF delivery_retry_id IS NULL AND NEW.sequence = 2
    AND NEW.type = 'delivery.scheduled' AND next_sequence = 3 THEN RETURN NEW; END IF;
  IF delivery_retry_id IS NOT NULL AND delivery_source_id IS NOT NULL
    AND next_sequence = 4 AND NEW.sequence = 1
    AND NEW.type = 'delivery.accepted' THEN RETURN NEW; END IF;
  IF delivery_retry_id IS NOT NULL AND delivery_source_id IS NOT NULL
    AND next_sequence = 4 AND NEW.sequence = 2
    AND NEW.type = 'delivery.retry_requested' THEN RETURN NEW; END IF;
  IF delivery_retry_id IS NOT NULL AND delivery_source_id IS NOT NULL
    AND next_sequence = 4 AND NEW.sequence = 3
    AND NEW.type = 'delivery.scheduled' THEN RETURN NEW; END IF;
  IF NEW.sequence = next_sequence AND NEW.type IN (
    'delivery.cancellation_requested','delivery.retry_requested','delivery.blocked','delivery.resumed',
    'delivery.reconciliation_requested','delivery.reconciled','effect.not_created',
    'effect.prepared','effect.contact_started','publication.confirmation_pending',
    'publication.retry_scheduled','publication.succeeded',
    'publication.failed_transient','publication.failed_terminal','publication.outcome_unknown'
  ) THEN RETURN NEW; END IF;
  IF NEW.sequence = next_sequence + 1 AND (
    (NEW.type = 'effect.contact_started' AND EXISTS (
      SELECT 1 FROM "runtime_publishing_delivery_events" e
      WHERE e.workspace_id = NEW.workspace_id AND e.delivery_id = NEW.delivery_id
        AND e.sequence = next_sequence AND e.type = 'delivery.resumed'
        AND e.evidence->>'readinessEvidenceDigest' = NEW.evidence->>'readinessEvidenceDigest'
    )) OR
    (NEW.type = 'delivery.cancelled' AND EXISTS (
      SELECT 1 FROM "runtime_publishing_delivery_events" e
      WHERE e.workspace_id = NEW.workspace_id AND e.delivery_id = NEW.delivery_id
        AND e.sequence = next_sequence AND e.type = 'delivery.cancellation_requested'
        AND e.evidence->>'cancellationId' = NEW.evidence->>'cancellationId'
    )) OR
    (NEW.type = 'publication.outcome_unknown'
      AND NEW.evidence->>'failureCode' = 'CANCELLED_AFTER_EFFECT_CONTACT'
      AND EXISTS (
        SELECT 1 FROM "runtime_publishing_delivery_events" e
        WHERE e.workspace_id = NEW.workspace_id AND e.delivery_id = NEW.delivery_id
          AND e.sequence = next_sequence AND e.type = 'delivery.cancellation_requested'
      ))
  ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Publishing Delivery event is out of sequence';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "runtime_publishing_delivery_effect_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Publishing Delivery effect identities are append-only';
  END IF;
  IF OLD.intent_digest IS NULL AND OLD.provider_adapter_contract_digest IS NULL
    AND NEW.intent_digest IS NOT NULL AND NEW.provider_adapter_contract_digest IS NOT NULL
    AND (to_jsonb(NEW) - ARRAY['intent_digest','provider_adapter_contract_digest']) =
        (to_jsonb(OLD) - ARRAY['intent_digest','provider_adapter_contract_digest']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Publishing Delivery effect identity is immutable after its one preparation seal';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_effect_identities_seal_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_effect_identities"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_effect_identity_guard"();--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_delivery_effect_identity_seal_commit_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "runtime_publishing_delivery_events" e
    WHERE e.workspace_id = NEW.workspace_id AND e.delivery_id = NEW.delivery_id
      AND e.type = 'effect.prepared'
      AND (e.evidence->>'effectGeneration')::integer = NEW.generation
      AND e.evidence->>'effectKey' = NEW.effect_key
      AND e.evidence->>'intentDigest' = NEW.intent_digest
      AND e.evidence->>'providerAdapterContractDigest' = NEW.provider_adapter_contract_digest
  ) THEN
    RAISE EXCEPTION 'Publishing Delivery effect identity seal requires exact prepared evidence';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "runtime_publishing_delivery_effect_identity_seal_complete"
AFTER UPDATE ON "runtime_publishing_delivery_effect_identities"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_effect_identity_seal_commit_guard"();--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_effect_receipts_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_effect_receipts"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_readiness_receipts_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_readiness_receipts"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_retry_approval_consumptions_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_retry_approval_consumptions"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_retry_receipts_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_retry_receipts"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_reconciliation_requests_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_reconciliation_requests"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_reconciliation_receipts_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_reconciliation_receipts"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "runtime_publishing_delivery_identity_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE event_delta integer;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Publishing Deliveries cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - ARRAY[
      'desired_state','state','effect_key','effect_generation','intent_digest',
      'provider_adapter_contract_digest','provider_operation_ref',
      'latest_effect_evidence_digest','failure_code','failure_class','failure_retryable',
      'failure_effect_disposition','readiness_block_code','readiness_evidence_digest',
      'readiness_blocked_at','readiness_retry_at','readiness_block_count',
      'next_effect_attempt','confirmation_attempts',
      'next_event_sequence','next_outbox_generation','dispatch_started_at',
      'effect_contact_started_at','completed_at','updated_at'
    ]) <> (to_jsonb(OLD) - ARRAY[
      'desired_state','state','effect_key','effect_generation','intent_digest',
      'provider_adapter_contract_digest','provider_operation_ref',
      'latest_effect_evidence_digest','failure_code','failure_class','failure_retryable',
      'failure_effect_disposition','readiness_block_code','readiness_evidence_digest',
      'readiness_blocked_at','readiness_retry_at','readiness_block_count',
      'next_effect_attempt','confirmation_attempts',
      'next_event_sequence','next_outbox_generation','dispatch_started_at',
      'effect_contact_started_at','completed_at','updated_at'
    ]) THEN RAISE EXCEPTION 'Publishing Delivery release identity is immutable'; END IF;
  event_delta := NEW.next_event_sequence - OLD.next_event_sequence;
  IF NEW.updated_at < OLD.updated_at OR event_delta NOT IN (1,2) THEN
    RAISE EXCEPTION 'Publishing Delivery transition must append ordered events';
  END IF;
  IF OLD.desired_state = 'cancel' AND NEW.desired_state <> 'cancel' THEN
    RAISE EXCEPTION 'Publishing Delivery cancellation is irreversible';
  END IF;
  IF NEW.effect_generation <> OLD.effect_generation OR NEW.effect_key <> OLD.effect_key THEN
    RAISE EXCEPTION 'Publishing Delivery effect identity is immutable; manual retry creates a child Delivery';
  END IF;
  IF OLD.intent_digest IS NOT NULL AND NEW.intent_digest IS DISTINCT FROM OLD.intent_digest
    AND NEW.effect_generation = OLD.effect_generation THEN
    RAISE EXCEPTION 'Publishing Delivery intent is immutable within an effect generation';
  END IF;
  IF OLD.provider_adapter_contract_digest IS NOT NULL
    AND NEW.provider_adapter_contract_digest IS DISTINCT FROM OLD.provider_adapter_contract_digest
    AND NEW.effect_generation = OLD.effect_generation THEN
    RAISE EXCEPTION 'Publishing Delivery adapter contract is immutable within an effect generation';
  END IF;
  IF OLD.effect_contact_started_at IS NOT NULL
    AND NEW.effect_contact_started_at IS DISTINCT FROM OLD.effect_contact_started_at THEN
    RAISE EXCEPTION 'Publishing Delivery provider-contact boundary is irreversible';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "runtime_publishing_delivery_events" e
    WHERE e.workspace_id = OLD.workspace_id AND e.delivery_id = OLD.id
      AND e.sequence = OLD.next_event_sequence
  ) THEN RAISE EXCEPTION 'Publishing Delivery transition event is missing'; END IF;
  IF EXISTS (
      SELECT 1 FROM "runtime_publishing_delivery_events" e
      WHERE e.workspace_id = OLD.workspace_id AND e.delivery_id = OLD.id
        AND e.sequence = OLD.next_event_sequence
        AND e.type IN ('effect.not_created','publication.confirmation_pending',
          'publication.succeeded','publication.failed_transient',
          'publication.failed_terminal','publication.outcome_unknown','delivery.reconciled')
        AND NOT (e.type = 'publication.outcome_unknown'
          AND e.evidence->>'failureCode' = 'CANCELLED_AFTER_EFFECT_CONTACT')
    ) AND NOT EXISTS (
      SELECT 1 FROM "runtime_publishing_delivery_effect_receipts" r
      WHERE r.workspace_id = OLD.workspace_id AND r.delivery_id = OLD.id
        AND r.effect_generation = OLD.effect_generation
        AND r.effect_key = OLD.effect_key
        AND r.event_sequence = OLD.next_event_sequence
        AND r.evidence_digest = NEW.latest_effect_evidence_digest
    ) THEN
    RAISE EXCEPTION 'Publishing Delivery normalized effect receipt is missing';
  END IF;
  IF NEW.next_outbox_generation = OLD.next_outbox_generation + 1 AND NOT EXISTS (
    SELECT 1 FROM "runtime_publishing_delivery_outbox_intents" o
    WHERE o.workspace_id = OLD.workspace_id AND o.delivery_id = OLD.id
      AND o.generation = OLD.next_outbox_generation
  ) THEN RAISE EXCEPTION 'Publishing Delivery transition outbox is missing'; END IF;
  IF NEW.next_outbox_generation NOT IN (OLD.next_outbox_generation,
      OLD.next_outbox_generation + 1) THEN
    RAISE EXCEPTION 'Publishing Delivery outbox generations must be contiguous';
  END IF;
  IF OLD.state = 'confirmation_pending' AND NEW.state = 'outcome_unknown'
    AND NEW.failure_code = 'CONFIRMATION_ATTEMPTS_EXHAUSTED' THEN
    IF NEW.confirmation_attempts <> 3 OR NEW.provider_operation_ref IS NULL
      OR NEW.next_outbox_generation <> OLD.next_outbox_generation THEN
      RAISE EXCEPTION 'Publishing Delivery confirmation exhaustion must retain the provider reference and stop polling';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_effect_receipts" DROP CONSTRAINT "runtime_publishing_delivery_effect_receipts_identity_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_reconciliation_requests" DROP CONSTRAINT "runtime_publishing_delivery_reconciliation_requests_contract_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_approval_consumptions" DROP CONSTRAINT "runtime_publishing_delivery_retry_approval_consumptions_contract_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" DROP CONSTRAINT "runtime_publishing_delivery_retry_receipts_contract_check";--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" DROP CONSTRAINT "runtime_publishing_delivery_retry_receipts_approval_consumption_fk";
--> statement-breakpoint
DROP INDEX "runtime_publishing_delivery_retry_approval_consumptions_exact_unique";--> statement-breakpoint
DROP INDEX "runtime_publishing_delivery_retry_receipts_invocation_unique";--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ALTER COLUMN "release_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_requests" ADD COLUMN "retry_source_delivery_id" text;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_requests" ADD COLUMN "retry_source_evidence_digest" text;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "source_delivery_id" text;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "retry_id" text;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "requesting_principal_id" text;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "requesting_key_id" text;--> statement-breakpoint
UPDATE "runtime_publishing_deliveries" AS delivery
SET "requesting_principal_id" = approval."requesting_principal_id",
    "requesting_key_id" = approval."requesting_key_id"
FROM "runtime_publishing_approval_requests" AS approval
WHERE approval."workspace_id" = delivery."workspace_id"
  AND approval."id" = delivery."approval_request_id"
  AND delivery."requesting_principal_id" IS NULL
  AND delivery."requesting_key_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "runtime_publishing_deliveries"
    WHERE "requesting_principal_id" IS NULL OR "requesting_key_id" IS NULL
  ) THEN
    RAISE EXCEPTION '0050 cannot backfill Delivery Approval requester provenance';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ALTER COLUMN "requesting_principal_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ALTER COLUMN "requesting_key_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_approval_consumptions" ADD COLUMN "source_delivery_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD COLUMN "source_delivery_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD COLUMN "source_provider_adapter_contract_digest" text;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD COLUMN "source_failure_class" text NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_source_delivery_fk" FOREIGN KEY ("workspace_id","source_delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_requesting_principal_fk" FOREIGN KEY ("workspace_id","requesting_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_requesting_key_fk" FOREIGN KEY ("requesting_principal_id","requesting_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_approval_consumptions" ADD CONSTRAINT "runtime_publishing_delivery_retry_approval_consumptions_source_delivery_fk" FOREIGN KEY ("workspace_id","source_delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD CONSTRAINT "runtime_publishing_delivery_retry_receipts_source_delivery_fk" FOREIGN KEY ("workspace_id","source_delivery_id") REFERENCES "public"."runtime_publishing_deliveries"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD CONSTRAINT "runtime_publishing_delivery_retry_receipts_approval_consumption_fk" FOREIGN KEY ("workspace_id","approval_request_id","approval_decision_id","source_delivery_id","delivery_id","source_evidence_digest","approval_consumption_id") REFERENCES "public"."runtime_publishing_delivery_retry_approval_consumptions"("workspace_id","approval_request_id","approval_decision_id","source_delivery_id","delivery_id","source_evidence_digest","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_requests_retry_source_idx" ON "runtime_publishing_approval_requests" USING btree ("workspace_id","retry_source_delivery_id","retry_source_evidence_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_deliveries_retry_origin_unique" ON "runtime_publishing_deliveries" USING btree ("workspace_id","retry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_retry_approval_consumptions_exact_unique" ON "runtime_publishing_delivery_retry_approval_consumptions" USING btree ("workspace_id","approval_request_id","approval_decision_id","source_delivery_id","delivery_id","source_evidence_digest","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_retry_receipts_invocation_unique" ON "runtime_publishing_delivery_retry_receipts" USING btree ("workspace_id","source_delivery_id","source_evidence_digest");--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_requests" ADD CONSTRAINT "runtime_publishing_approval_requests_retry_source_check" CHECK ((("runtime_publishing_approval_requests"."retry_source_delivery_id" is null and "runtime_publishing_approval_requests"."retry_source_evidence_digest" is null)
        or ("runtime_publishing_approval_requests"."retry_source_delivery_id" is not null
          and length("runtime_publishing_approval_requests"."retry_source_delivery_id") between 1 and 200
          and "runtime_publishing_approval_requests"."retry_source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$')));--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_origin_check" CHECK ((("runtime_publishing_deliveries"."release_id" is not null and "runtime_publishing_deliveries"."source_delivery_id" is null and "runtime_publishing_deliveries"."retry_id" is null)
        or ("runtime_publishing_deliveries"."release_id" is null and "runtime_publishing_deliveries"."source_delivery_id" is not null and "runtime_publishing_deliveries"."retry_id" is not null)));--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_effect_receipts" ADD CONSTRAINT "runtime_publishing_delivery_effect_receipts_identity_check" CHECK ("runtime_publishing_delivery_effect_receipts"."id" ~ '^pder_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_effect_receipts"."effect_generation" > 0 and "runtime_publishing_delivery_effect_receipts"."effect_attempt" between 1 and 8
        and "runtime_publishing_delivery_effect_receipts"."execution_fence" > 0 and "runtime_publishing_delivery_effect_receipts"."event_sequence" > 0
        and length("runtime_publishing_delivery_effect_receipts"."effect_key") between 1 and 500
        and (("runtime_publishing_delivery_effect_receipts"."intent_digest" is null and "runtime_publishing_delivery_effect_receipts"."provider_adapter_contract_digest" is null
            and "runtime_publishing_delivery_effect_receipts"."effect_disposition" = 'not_created')
          or ("runtime_publishing_delivery_effect_receipts"."intent_digest" ~ '^sha256:[a-f0-9]{64}$'
            and "runtime_publishing_delivery_effect_receipts"."provider_adapter_contract_digest" ~ '^sha256:[a-f0-9]{64}$'))
        and "runtime_publishing_delivery_effect_receipts"."evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and ("runtime_publishing_delivery_effect_receipts"."provider_operation_ref" is null or (
          length("runtime_publishing_delivery_effect_receipts"."provider_operation_ref") between 1 and 500
          and "runtime_publishing_delivery_effect_receipts"."provider_operation_ref" = btrim("runtime_publishing_delivery_effect_receipts"."provider_operation_ref")
          and "runtime_publishing_delivery_effect_receipts"."provider_operation_ref" !~ '[[:cntrl:]]'))
        and ("runtime_publishing_delivery_effect_receipts"."failure_code" is null or "runtime_publishing_delivery_effect_receipts"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,79}$'));--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_reconciliation_requests" ADD CONSTRAINT "runtime_publishing_delivery_reconciliation_requests_contract_check" CHECK ("runtime_publishing_delivery_reconciliation_requests"."id" ~ '^pdre_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_reconciliation_requests"."capability" = 'publishing_deliveries.reconcile@1'
        and length("runtime_publishing_delivery_reconciliation_requests"."authorization_session_id") between 1 and 200
        and "runtime_publishing_delivery_reconciliation_requests"."authorization_contract_digest" ~ '^sha256:[a-f0-9]{64}$'
        and length("runtime_publishing_delivery_reconciliation_requests"."authorization_admission_evidence_ref") between 1 and 200
        and length("runtime_publishing_delivery_reconciliation_requests"."authorization_evidence_ref") between 1 and 200
        and "runtime_publishing_delivery_reconciliation_requests"."authorization_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof("runtime_publishing_delivery_reconciliation_requests"."authorized_resources") = 'object'
        and jsonb_typeof("runtime_publishing_delivery_reconciliation_requests"."authority_grants") = 'array'
        and "runtime_publishing_delivery_reconciliation_requests"."authorization_expires_at" > "runtime_publishing_delivery_reconciliation_requests"."authorization_issued_at"
        and "runtime_publishing_delivery_reconciliation_requests"."requested_at" >= "runtime_publishing_delivery_reconciliation_requests"."authorization_issued_at"
        and "runtime_publishing_delivery_reconciliation_requests"."requested_at" < "runtime_publishing_delivery_reconciliation_requests"."authorization_expires_at"
        and "runtime_publishing_delivery_reconciliation_requests"."source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_reconciliation_requests"."effect_generation" > 0
        and "runtime_publishing_delivery_reconciliation_requests"."intent_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_reconciliation_requests"."provider_adapter_contract_digest" ~ '^sha256:[a-f0-9]{64}$'
        and ("runtime_publishing_delivery_reconciliation_requests"."provider_operation_ref" is null or length("runtime_publishing_delivery_reconciliation_requests"."provider_operation_ref") between 1 and 500)
        and "runtime_publishing_delivery_reconciliation_requests"."event_sequence" > 0);--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_approval_consumptions" ADD CONSTRAINT "runtime_publishing_delivery_retry_approval_consumptions_contract_check" CHECK ("runtime_publishing_delivery_retry_approval_consumptions"."id" ~ '^pdrc_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_retry_approval_consumptions"."capability" = 'publishing_deliveries.retry@1'
        and "runtime_publishing_delivery_retry_approval_consumptions"."source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_delivery_retry_approval_consumptions"."authorization_contract_digest" ~ '^sha256:[a-f0-9]{64}$'
        and length("runtime_publishing_delivery_retry_approval_consumptions"."authorization_evidence_ref") between 1 and 200
        and jsonb_typeof("runtime_publishing_delivery_retry_approval_consumptions"."authorized_resources") = 'object'
        and (("runtime_publishing_delivery_retry_approval_consumptions"."actor_kind" = 'agent' and "runtime_publishing_delivery_retry_approval_consumptions"."actor_id" = "runtime_publishing_delivery_retry_approval_consumptions"."requesting_principal_id"
            and "runtime_publishing_delivery_retry_approval_consumptions"."actor_user_id" is null)
          or ("runtime_publishing_delivery_retry_approval_consumptions"."actor_kind" = 'human' and "runtime_publishing_delivery_retry_approval_consumptions"."actor_id" = "runtime_publishing_delivery_retry_approval_consumptions"."actor_user_id"
            and "runtime_publishing_delivery_retry_approval_consumptions"."actor_user_id" is not null)));--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD CONSTRAINT "runtime_publishing_delivery_retry_receipts_contract_check" CHECK ("runtime_publishing_delivery_retry_receipts"."id" ~ '^pdrt_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_retry_receipts"."capability" = 'publishing_deliveries.retry@1'
        and length("runtime_publishing_delivery_retry_receipts"."authorization_session_id") between 1 and 200
        and "runtime_publishing_delivery_retry_receipts"."authorization_contract_digest" ~ '^sha256:[a-f0-9]{64}$'
        and length("runtime_publishing_delivery_retry_receipts"."authorization_admission_evidence_ref") between 1 and 200
        and length("runtime_publishing_delivery_retry_receipts"."authorization_evidence_ref") between 1 and 200
        and "runtime_publishing_delivery_retry_receipts"."authorization_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof("runtime_publishing_delivery_retry_receipts"."authorized_resources") = 'object'
        and jsonb_typeof("runtime_publishing_delivery_retry_receipts"."authority_grants") = 'array'
        and "runtime_publishing_delivery_retry_receipts"."authorization_expires_at" > "runtime_publishing_delivery_retry_receipts"."authorization_issued_at"
        and "runtime_publishing_delivery_retry_receipts"."requested_at" >= "runtime_publishing_delivery_retry_receipts"."authorization_issued_at"
        and "runtime_publishing_delivery_retry_receipts"."requested_at" < "runtime_publishing_delivery_retry_receipts"."authorization_expires_at"
        and "runtime_publishing_delivery_retry_receipts"."source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and ("runtime_publishing_delivery_retry_receipts"."source_intent_digest" is null or "runtime_publishing_delivery_retry_receipts"."source_intent_digest" ~ '^sha256:[a-f0-9]{64}$')
        and ("runtime_publishing_delivery_retry_receipts"."source_provider_adapter_contract_digest" is null or "runtime_publishing_delivery_retry_receipts"."source_provider_adapter_contract_digest" ~ '^sha256:[a-f0-9]{64}$')
        and (("runtime_publishing_delivery_retry_receipts"."source_intent_digest" is null and "runtime_publishing_delivery_retry_receipts"."source_provider_adapter_contract_digest" is null)
          or ("runtime_publishing_delivery_retry_receipts"."source_intent_digest" is not null and "runtime_publishing_delivery_retry_receipts"."source_provider_adapter_contract_digest" is not null))
        and "runtime_publishing_delivery_retry_receipts"."source_effect_generation" > 0
        and "runtime_publishing_delivery_retry_receipts"."source_failure_class" in ('transient','terminal')
        and "runtime_publishing_delivery_retry_receipts"."source_effect_disposition" in ('not_created','provider_failed_known')
        and "runtime_publishing_delivery_retry_receipts"."event_sequence" > 0 and "runtime_publishing_delivery_retry_receipts"."outbox_generation" > 0
        and "runtime_publishing_delivery_retry_receipts"."retry_at" >= "runtime_publishing_delivery_retry_receipts"."requested_at");
--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_deliveries_identity_immutable"
BEFORE UPDATE OR DELETE ON "runtime_publishing_deliveries"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_identity_guard"();
--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_events_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_events"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_delivery_cancellations_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_delivery_cancellations"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_delivery_reject_mutation"();
--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_effect_identities" DROP CONSTRAINT "runtime_publishing_delivery_effect_identities_identity_check";--> statement-breakpoint
CREATE INDEX "runtime_publishing_deliveries_source_delivery_idx" ON "runtime_publishing_deliveries" USING btree ("workspace_id","source_delivery_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_deliveries_requesting_principal_idx" ON "runtime_publishing_deliveries" USING btree ("workspace_id","requesting_principal_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_deliveries_requesting_key_idx" ON "runtime_publishing_deliveries" USING btree ("requesting_principal_id","requesting_key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_readiness_receipts_principal_idx" ON "runtime_publishing_delivery_readiness_receipts" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_readiness_receipts_key_idx" ON "runtime_publishing_delivery_readiness_receipts" USING btree ("principal_id","key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_reconciliation_requests_principal_idx" ON "runtime_publishing_delivery_reconciliation_requests" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_reconciliation_requests_key_idx" ON "runtime_publishing_delivery_reconciliation_requests" USING btree ("principal_id","key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_reconciliation_requests_user_idx" ON "runtime_publishing_delivery_reconciliation_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_approval_consumptions_source_idx" ON "runtime_publishing_delivery_retry_approval_consumptions" USING btree ("workspace_id","source_delivery_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_approval_consumptions_delivery_idx" ON "runtime_publishing_delivery_retry_approval_consumptions" USING btree ("workspace_id","delivery_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_approval_consumptions_approval_idx" ON "runtime_publishing_delivery_retry_approval_consumptions" USING btree ("workspace_id","approval_request_id","approval_decision_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_approval_consumptions_principal_idx" ON "runtime_publishing_delivery_retry_approval_consumptions" USING btree ("workspace_id","requesting_principal_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_approval_consumptions_key_idx" ON "runtime_publishing_delivery_retry_approval_consumptions" USING btree ("requesting_principal_id","requesting_key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_approval_consumptions_user_idx" ON "runtime_publishing_delivery_retry_approval_consumptions" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_receipts_source_idx" ON "runtime_publishing_delivery_retry_receipts" USING btree ("workspace_id","source_delivery_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_receipts_delivery_idx" ON "runtime_publishing_delivery_retry_receipts" USING btree ("workspace_id","delivery_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_receipts_principal_idx" ON "runtime_publishing_delivery_retry_receipts" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_receipts_key_idx" ON "runtime_publishing_delivery_retry_receipts" USING btree ("principal_id","key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_receipts_user_idx" ON "runtime_publishing_delivery_retry_receipts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_delivery_retry_receipts_approval_consumption_idx" ON "runtime_publishing_delivery_retry_receipts" USING btree ("workspace_id","approval_consumption_id");--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_effect_identities" ADD CONSTRAINT "runtime_publishing_delivery_effect_identities_identity_check" CHECK ("runtime_publishing_delivery_effect_identities"."id" ~ '^pdei_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_effect_identities"."generation" > 0
        and length("runtime_publishing_delivery_effect_identities"."effect_key") between 1 and 500
        and "runtime_publishing_delivery_effect_identities"."effect_key" = btrim("runtime_publishing_delivery_effect_identities"."effect_key")
        and "runtime_publishing_delivery_effect_identities"."effect_key" !~ '[[:cntrl:]]'
        and (("runtime_publishing_delivery_effect_identities"."intent_digest" is null and "runtime_publishing_delivery_effect_identities"."provider_adapter_contract_digest" is null)
          or ("runtime_publishing_delivery_effect_identities"."intent_digest" ~ '^sha256:[a-f0-9]{64}$'
            and "runtime_publishing_delivery_effect_identities"."provider_adapter_contract_digest" ~ '^sha256:[a-f0-9]{64}$'))
        and ("runtime_publishing_delivery_effect_identities"."source_evidence_digest" is null or "runtime_publishing_delivery_effect_identities"."source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$')
        and (("runtime_publishing_delivery_effect_identities"."derivation" = 'release' and "runtime_publishing_delivery_effect_identities"."generation" = 1
          and "runtime_publishing_delivery_effect_identities"."parent_effect_key" is null and "runtime_publishing_delivery_effect_identities"."parent_generation" is null
          and "runtime_publishing_delivery_effect_identities"."source_evidence_digest" is null)
          or ("runtime_publishing_delivery_effect_identities"."derivation" = 'manual_retry' and "runtime_publishing_delivery_effect_identities"."generation" = 1
            and "runtime_publishing_delivery_effect_identities"."parent_effect_key" is null and "runtime_publishing_delivery_effect_identities"."parent_generation" is null
            and "runtime_publishing_delivery_effect_identities"."source_evidence_digest" is not null)
          or ("runtime_publishing_delivery_effect_identities"."derivation" = 'retry_provider_failed_known' and "runtime_publishing_delivery_effect_identities"."generation" > 1
            and "runtime_publishing_delivery_effect_identities"."parent_effect_key" is not null
            and "runtime_publishing_delivery_effect_identities"."parent_generation" = "runtime_publishing_delivery_effect_identities"."generation" - 1
            and "runtime_publishing_delivery_effect_identities"."source_evidence_digest" is not null)));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION runtime_publishing_approval_global_single_use_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE decision_value text;
BEGIN
  IF TG_TABLE_NAME = 'runtime_publishing_approval_consumptions' THEN
    decision_value := NEW.decision_id;
  ELSE
    decision_value := NEW.approval_decision_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array('publishing-approval-consumption', NEW.workspace_id,
      decision_value)::text, 0));
  IF TG_TABLE_NAME = 'runtime_publishing_approval_consumptions' THEN
    IF EXISTS (
      SELECT 1 FROM runtime_publishing_delivery_retry_approval_consumptions
      WHERE workspace_id = NEW.workspace_id
        AND approval_decision_id = NEW.decision_id
    ) THEN
      RAISE EXCEPTION 'Approval decision already consumed by manual retry';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM runtime_publishing_approval_consumptions
      WHERE workspace_id = NEW.workspace_id
        AND decision_id = NEW.approval_decision_id
    ) THEN
      RAISE EXCEPTION 'Approval decision already consumed by release';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_consumptions_global_single_use
BEFORE INSERT ON runtime_publishing_approval_consumptions
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_global_single_use_guard();
--> statement-breakpoint
CREATE TRIGGER runtime_publishing_delivery_retry_approval_consumptions_global_single_use
BEFORE INSERT ON runtime_publishing_delivery_retry_approval_consumptions
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_global_single_use_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION runtime_publishing_delivery_retry_origin_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'runtime_publishing_deliveries' THEN
    IF NEW.retry_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM runtime_publishing_delivery_retry_receipts receipt
      WHERE receipt.workspace_id = NEW.workspace_id
        AND receipt.id = NEW.retry_id
        AND receipt.delivery_id = NEW.id
        AND receipt.source_delivery_id = NEW.source_delivery_id
        AND receipt.approval_request_id = NEW.approval_request_id
        AND receipt.approval_decision_id = NEW.approval_decision_id
    ) THEN
      RAISE EXCEPTION 'Retry-origin Delivery must match its immutable retry receipt';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM runtime_publishing_delivery_events accepted
      JOIN runtime_publishing_delivery_events requested
        ON requested.workspace_id = accepted.workspace_id
        AND requested.delivery_id = accepted.delivery_id
        AND requested.sequence = 2
        AND requested.type = 'delivery.retry_requested'
      JOIN runtime_publishing_delivery_events scheduled
        ON scheduled.workspace_id = accepted.workspace_id
        AND scheduled.delivery_id = accepted.delivery_id
        AND scheduled.sequence = 3
        AND scheduled.type = 'delivery.scheduled'
      WHERE accepted.workspace_id = NEW.workspace_id
        AND accepted.delivery_id = NEW.id
        AND accepted.sequence = 1
        AND accepted.type = 'delivery.accepted'
        AND accepted.evidence->>'origin' = 'retry'
        AND accepted.evidence ? 'releaseId'
        AND accepted.evidence->>'releaseId' IS NULL
        AND accepted.evidence->>'sourceDeliveryId' = NEW.source_delivery_id
        AND accepted.evidence->>'retryId' = NEW.retry_id
        AND accepted.evidence->>'approvalRequestId' = NEW.approval_request_id
        AND accepted.evidence->>'approvalDecisionId' = NEW.approval_decision_id
        AND accepted.evidence->>'targetSnapshotDigest' = NEW.target_snapshot_digest
        AND requested.evidence->>'retryId' = NEW.retry_id
        AND requested.evidence->>'sourceDeliveryId' = NEW.source_delivery_id
        AND requested.evidence->>'deliveryId' = NEW.id
        AND requested.evidence->>'effectKey' = NEW.effect_key
    ) THEN
      RAISE EXCEPTION 'Retry-origin Delivery requires exact accepted, retry-requested, and scheduled evidence';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM runtime_publishing_deliveries delivery
      WHERE delivery.workspace_id = NEW.workspace_id
        AND delivery.id = NEW.delivery_id
        AND delivery.retry_id = NEW.id
        AND delivery.source_delivery_id = NEW.source_delivery_id
        AND delivery.approval_request_id = NEW.approval_request_id
        AND delivery.approval_decision_id = NEW.approval_decision_id
    ) THEN
      RAISE EXCEPTION 'Retry receipt must match its immutable retry-origin Delivery';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER runtime_publishing_deliveries_retry_origin_guard
AFTER INSERT OR UPDATE ON runtime_publishing_deliveries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_delivery_retry_origin_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER runtime_publishing_delivery_retry_receipts_origin_guard
AFTER INSERT ON runtime_publishing_delivery_retry_receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_delivery_retry_origin_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION runtime_publishing_delivery_reconciliation_result_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM runtime_publishing_delivery_reconciliation_requests request
    JOIN runtime_publishing_delivery_events event
      ON event.workspace_id = NEW.workspace_id
      AND event.delivery_id = NEW.delivery_id
      AND event.sequence = NEW.event_sequence
      AND event.type = 'delivery.reconciled'
    JOIN runtime_publishing_delivery_effect_receipts effect
      ON effect.workspace_id = NEW.workspace_id
      AND effect.delivery_id = NEW.delivery_id
      AND effect.effect_generation = NEW.effect_generation
      AND effect.effect_key = NEW.effect_key
      AND effect.event_sequence = NEW.event_sequence
      AND effect.evidence_digest = NEW.result_evidence_digest
      AND effect.mode = 'reconcile'
    JOIN runtime_publishing_deliveries delivery
      ON delivery.workspace_id = NEW.workspace_id
      AND delivery.id = NEW.delivery_id
    WHERE request.workspace_id = NEW.workspace_id
      AND request.id = NEW.reconciliation_id
      AND request.delivery_id = NEW.delivery_id
      AND request.source_evidence_digest = NEW.source_evidence_digest
      AND request.effect_generation = NEW.effect_generation
      AND request.effect_key = NEW.effect_key
      AND event.evidence->>'reconciliationId' = NEW.reconciliation_id
      AND event.evidence->>'sourceEvidenceDigest' = NEW.source_evidence_digest
      AND event.evidence->>'evidenceDigest' = NEW.result_evidence_digest
      AND event.evidence->>'effectKey' = NEW.effect_key
      AND (event.evidence->>'effectGeneration')::integer = NEW.effect_generation
      AND event.evidence->>'resolution' = CASE
        WHEN NEW.outcome = 'failed_known' AND NEW.failure_class = 'transient'
          THEN 'failed_transient'
        WHEN NEW.outcome = 'failed_known' AND NEW.failure_class = 'terminal'
          THEN 'failed_terminal'
        ELSE NEW.outcome
      END
      AND event.evidence->>'providerOperationRef' IS NOT DISTINCT FROM NEW.provider_operation_ref
      AND event.evidence->>'failureCode' IS NOT DISTINCT FROM NEW.failure_code
      AND (event.evidence->>'retryable')::boolean IS NOT DISTINCT FROM NEW.failure_retryable
      AND effect.provider_operation_ref IS NOT DISTINCT FROM NEW.provider_operation_ref
      AND effect.failure_code IS NOT DISTINCT FROM NEW.failure_code
      AND effect.failure_class IS NOT DISTINCT FROM NEW.failure_class
      AND effect.failure_retryable IS NOT DISTINCT FROM NEW.failure_retryable
      AND effect.effect_disposition IS NOT DISTINCT FROM CASE
        WHEN NEW.outcome = 'succeeded' THEN 'provider_accepted'
        WHEN NEW.outcome = 'failed_known' THEN NEW.effect_disposition
        ELSE 'unknown'
      END
      AND effect.result = CASE
        WHEN NEW.outcome = 'failed_known' AND NEW.failure_class = 'transient'
          THEN 'failed_transient'
        WHEN NEW.outcome = 'failed_known' AND NEW.failure_class = 'terminal'
          THEN 'failed_terminal'
        ELSE NEW.outcome
      END
      AND delivery.effect_key = NEW.effect_key
      AND delivery.effect_generation = NEW.effect_generation
      AND delivery.latest_effect_evidence_digest = NEW.result_evidence_digest
      AND delivery.provider_operation_ref IS NOT DISTINCT FROM NEW.provider_operation_ref
      AND delivery.next_event_sequence = NEW.event_sequence + 1
      AND delivery.next_effect_attempt = effect.effect_attempt + 1
      AND delivery.completed_at IS NOT NULL
      AND (
        (NEW.outcome = 'succeeded' AND delivery.state = 'succeeded'
          AND delivery.failure_code IS NULL AND delivery.failure_class IS NULL
          AND delivery.failure_retryable IS NULL AND delivery.failure_effect_disposition IS NULL)
        OR (NEW.outcome = 'failed_known'
          AND delivery.state = CASE WHEN NEW.failure_class = 'transient'
            THEN 'failed_transient' ELSE 'failed_terminal' END
          AND delivery.failure_code = NEW.failure_code
          AND delivery.failure_class = NEW.failure_class
          AND delivery.failure_retryable = NEW.failure_retryable
          AND delivery.failure_effect_disposition = NEW.effect_disposition)
        OR (NEW.outcome IN ('still_unknown','operator_required')
          AND delivery.state = 'outcome_unknown'
          AND delivery.failure_code = NEW.failure_code
          AND delivery.failure_class IS NULL AND delivery.failure_retryable IS NULL
          AND delivery.failure_effect_disposition = 'ambiguous')
      )
  ) THEN
    RAISE EXCEPTION 'Publishing Delivery reconciliation result is incomplete or inconsistent';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER runtime_publishing_delivery_reconciliation_result_complete
AFTER INSERT ON runtime_publishing_delivery_reconciliation_receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_delivery_reconciliation_result_complete();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION runtime_publishing_delivery_reconciled_transition_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reconciliation_event record;
BEGIN
  SELECT * INTO reconciliation_event
  FROM runtime_publishing_delivery_events event
  WHERE event.workspace_id = NEW.workspace_id
    AND event.delivery_id = NEW.id
    AND event.sequence = OLD.next_event_sequence
    AND event.type = 'delivery.reconciled';
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM runtime_publishing_delivery_reconciliation_receipts result
    WHERE result.workspace_id = NEW.workspace_id
      AND result.delivery_id = NEW.id
      AND result.event_sequence = reconciliation_event.sequence
      AND result.reconciliation_id = reconciliation_event.evidence->>'reconciliationId'
      AND result.result_evidence_digest = NEW.latest_effect_evidence_digest
  ) THEN
    RAISE EXCEPTION 'Publishing Delivery reconciled transition requires its immutable result receipt';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER runtime_publishing_delivery_reconciled_transition_complete
AFTER UPDATE ON runtime_publishing_deliveries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_delivery_reconciled_transition_complete();
--> statement-breakpoint
CREATE TABLE "runtime_publishing_approval_retry_sources" (
  "workspace_id" text NOT NULL,
  "approval_request_id" text NOT NULL,
  "source_delivery_id" text NOT NULL,
  "source_evidence_digest" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "runtime_publishing_approval_retry_sources_pk"
    PRIMARY KEY("workspace_id","approval_request_id"),
  CONSTRAINT "runtime_publishing_approval_retry_sources_evidence_check"
    CHECK ("source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_retry_sources"
ADD CONSTRAINT "runtime_publishing_approval_retry_sources_request_fk"
FOREIGN KEY ("workspace_id","approval_request_id")
REFERENCES "runtime_publishing_approval_requests"("workspace_id","id")
ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_retry_sources"
ADD CONSTRAINT "runtime_publishing_approval_retry_sources_delivery_fk"
FOREIGN KEY ("workspace_id","source_delivery_id")
REFERENCES "runtime_publishing_deliveries"("workspace_id","id")
ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_retry_sources_source_idx"
ON "runtime_publishing_approval_retry_sources" USING btree
("workspace_id","source_delivery_id");
--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_retry_sources_insert_only
BEFORE UPDATE OR DELETE ON runtime_publishing_approval_retry_sources
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_delivery_reject_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION runtime_publishing_approval_retry_source_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'runtime_publishing_approval_requests' THEN
    IF NEW.retry_source_delivery_id IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM runtime_publishing_approval_retry_sources source
        WHERE source.workspace_id = NEW.workspace_id
          AND source.approval_request_id = NEW.id
      ) THEN RAISE EXCEPTION 'Non-retry Approval cannot have retry-source provenance'; END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM runtime_publishing_approval_retry_sources source
      WHERE source.workspace_id = NEW.workspace_id
        AND source.approval_request_id = NEW.id
        AND source.source_delivery_id = NEW.retry_source_delivery_id
        AND source.source_evidence_digest = NEW.retry_source_evidence_digest
    ) THEN
      RAISE EXCEPTION 'Retry Approval requires exact Delivery provenance';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM runtime_publishing_approval_requests request
      WHERE request.workspace_id = NEW.workspace_id
        AND request.id = NEW.approval_request_id
        AND request.retry_source_delivery_id = NEW.source_delivery_id
        AND request.retry_source_evidence_digest = NEW.source_evidence_digest
    ) THEN
      RAISE EXCEPTION 'Retry-source provenance must match its Approval request';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER runtime_publishing_approval_requests_retry_source_complete
AFTER INSERT OR UPDATE ON runtime_publishing_approval_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_retry_source_complete();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER runtime_publishing_approval_retry_sources_complete
AFTER INSERT ON runtime_publishing_approval_retry_sources
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_retry_source_complete();
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" DROP CONSTRAINT "runtime_publishing_deliveries_identity_check";
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" DROP CONSTRAINT "runtime_publishing_deliveries_state_check";
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" DROP CONSTRAINT "runtime_publishing_deliveries_lifecycle_check";
--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" DROP CONSTRAINT "runtime_publishing_delivery_retry_receipts_contract_check";
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "readiness_block_code" text;
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "readiness_evidence_digest" text;
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "readiness_blocked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "readiness_retry_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD COLUMN "readiness_block_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD COLUMN "idempotency_key" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD COLUMN "request_fingerprint" text NOT NULL;
--> statement-breakpoint
CREATE INDEX "runtime_publishing_deliveries_readiness_due_idx" ON "runtime_publishing_deliveries" USING btree ("state","readiness_retry_at","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_delivery_retry_receipts_mutation_unique" ON "runtime_publishing_delivery_retry_receipts" USING btree ("workspace_id","actor_kind","actor_id","capability","idempotency_key");
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_readiness_check" CHECK ((("runtime_publishing_deliveries"."state" = 'blocked'
          and "runtime_publishing_deliveries"."readiness_block_code" in (
            'EXECUTION_AUTHORIZATION_REVOKED','APPROVAL_NO_LONGER_VALID',
            'CHANNEL_UNAVAILABLE','CREDENTIAL_UNAVAILABLE','VALIDATION_STALE'
          )
          and "runtime_publishing_deliveries"."readiness_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
          and "runtime_publishing_deliveries"."readiness_blocked_at" is not null
          and "runtime_publishing_deliveries"."readiness_retry_at" > "runtime_publishing_deliveries"."readiness_blocked_at"
          and "runtime_publishing_deliveries"."readiness_block_count" between 1 and 2147483647)
        or ("runtime_publishing_deliveries"."state" <> 'blocked'
          and "runtime_publishing_deliveries"."readiness_block_code" is null
          and "runtime_publishing_deliveries"."readiness_evidence_digest" is null
          and "runtime_publishing_deliveries"."readiness_blocked_at" is null
          and "runtime_publishing_deliveries"."readiness_retry_at" is null
          and "runtime_publishing_deliveries"."readiness_block_count" = 0)));
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_identity_check" CHECK ("runtime_publishing_deliveries"."id" ~ '^pdl_[A-Za-z0-9_-]+$'
        and length("runtime_publishing_deliveries"."id") between 1 and 200
        and length("runtime_publishing_deliveries"."target_id") between 1 and 200
        and length("runtime_publishing_deliveries"."channel_id") between 1 and 200
        and "runtime_publishing_deliveries"."target_ordinal" >= 0
        and "runtime_publishing_deliveries"."plan_revision" > 0
        and "runtime_publishing_deliveries"."plan_revision_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_deliveries"."validation_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_deliveries"."target_snapshot_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_deliveries"."effect_generation" > 0
        and "runtime_publishing_deliveries"."next_effect_attempt" between 1 and 9
        and "runtime_publishing_deliveries"."confirmation_attempts" between 0 and 3
        and "runtime_publishing_deliveries"."readiness_block_count" between 0 and 2147483647
        and length("runtime_publishing_deliveries"."effect_key") between 1 and 500
        and "runtime_publishing_deliveries"."effect_key" = btrim("runtime_publishing_deliveries"."effect_key")
        and "runtime_publishing_deliveries"."effect_key" !~ '[[:cntrl:]]');
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_state_check" CHECK ("runtime_publishing_deliveries"."desired_state" in ('publish','cancel')
        and "runtime_publishing_deliveries"."state" in (
          'scheduled','blocked','dispatching','confirmation_pending',
          'succeeded','failed_transient','failed_terminal','outcome_unknown','cancelled'
        )
        and "runtime_publishing_deliveries"."next_event_sequence" >= 3
        and "runtime_publishing_deliveries"."next_outbox_generation" >= 2);
--> statement-breakpoint
ALTER TABLE "runtime_publishing_deliveries" ADD CONSTRAINT "runtime_publishing_deliveries_lifecycle_check" CHECK (("runtime_publishing_deliveries"."state" = 'scheduled'
          and "runtime_publishing_deliveries"."desired_state" = 'publish'
          and (("runtime_publishing_deliveries"."intent_digest" is null and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is null)
            or ("runtime_publishing_deliveries"."intent_digest" is not null and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null))
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'blocked'
          and "runtime_publishing_deliveries"."desired_state" = 'publish'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."failure_class" is null
          and "runtime_publishing_deliveries"."failure_retryable" is null
          and "runtime_publishing_deliveries"."failure_effect_disposition" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'scheduled'
          and "runtime_publishing_deliveries"."desired_state" = 'publish'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'dispatching'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'confirmation_pending'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is null)
        or ("runtime_publishing_deliveries"."state" = 'succeeded'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
          and "runtime_publishing_deliveries"."provider_operation_ref" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" in ('failed_transient','failed_terminal')
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."failure_class" = case when "runtime_publishing_deliveries"."state" = 'failed_transient' then 'transient' else 'terminal' end
          and "runtime_publishing_deliveries"."failure_retryable" = ("runtime_publishing_deliveries"."state" = 'failed_transient')
          and "runtime_publishing_deliveries"."failure_effect_disposition" in ('not_created','provider_failed_known')
          and (("runtime_publishing_deliveries"."failure_effect_disposition" = 'not_created'
              and "runtime_publishing_deliveries"."provider_operation_ref" is null
              and ((("runtime_publishing_deliveries"."dispatch_started_at" is null
                  and "runtime_publishing_deliveries"."effect_contact_started_at" is null)
                and (("runtime_publishing_deliveries"."intent_digest" is null and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is null)
                  or ("runtime_publishing_deliveries"."intent_digest" is not null and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null)))
                or ("runtime_publishing_deliveries"."intent_digest" is not null
                  and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
                  and "runtime_publishing_deliveries"."dispatch_started_at" is not null
                  and "runtime_publishing_deliveries"."effect_contact_started_at" is not null)))
            or ("runtime_publishing_deliveries"."failure_effect_disposition" = 'provider_failed_known'
              and "runtime_publishing_deliveries"."intent_digest" is not null
              and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
              and "runtime_publishing_deliveries"."dispatch_started_at" is not null
              and "runtime_publishing_deliveries"."effect_contact_started_at" is not null))
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" = 'outcome_unknown'
          and "runtime_publishing_deliveries"."intent_digest" is not null
          and "runtime_publishing_deliveries"."provider_adapter_contract_digest" is not null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is not null
          and "runtime_publishing_deliveries"."failure_code" is not null
          and "runtime_publishing_deliveries"."dispatch_started_at" is not null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is not null
          and "runtime_publishing_deliveries"."completed_at" is not null)
        or ("runtime_publishing_deliveries"."state" = 'cancelled'
          and "runtime_publishing_deliveries"."desired_state" = 'cancel'
          and "runtime_publishing_deliveries"."provider_operation_ref" is null
          and "runtime_publishing_deliveries"."latest_effect_evidence_digest" is null
          and "runtime_publishing_deliveries"."failure_code" is null
          and "runtime_publishing_deliveries"."effect_contact_started_at" is null
          and (("runtime_publishing_deliveries"."intent_digest" is null and "runtime_publishing_deliveries"."dispatch_started_at" is null)
            or ("runtime_publishing_deliveries"."intent_digest" is not null and "runtime_publishing_deliveries"."dispatch_started_at" is not null))
          and "runtime_publishing_deliveries"."completed_at" is not null));
--> statement-breakpoint
ALTER TABLE "runtime_publishing_delivery_retry_receipts" ADD CONSTRAINT "runtime_publishing_delivery_retry_receipts_contract_check" CHECK ("runtime_publishing_delivery_retry_receipts"."id" ~ '^pdrt_[A-Za-z0-9_-]+$'
        and "runtime_publishing_delivery_retry_receipts"."capability" = 'publishing_deliveries.retry@1'
        and length("runtime_publishing_delivery_retry_receipts"."idempotency_key") between 8 and 200
        and "runtime_publishing_delivery_retry_receipts"."idempotency_key" ~ '^[!-~]+$'
        and "runtime_publishing_delivery_retry_receipts"."request_fingerprint" ~ '^sha256:[a-f0-9]{64}$'
        and length("runtime_publishing_delivery_retry_receipts"."authorization_session_id") between 1 and 200
        and "runtime_publishing_delivery_retry_receipts"."authorization_contract_digest" ~ '^sha256:[a-f0-9]{64}$'
        and length("runtime_publishing_delivery_retry_receipts"."authorization_admission_evidence_ref") between 1 and 200
        and length("runtime_publishing_delivery_retry_receipts"."authorization_evidence_ref") between 1 and 200
        and "runtime_publishing_delivery_retry_receipts"."authorization_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof("runtime_publishing_delivery_retry_receipts"."authorized_resources") = 'object'
        and jsonb_typeof("runtime_publishing_delivery_retry_receipts"."authority_grants") = 'array'
        and "runtime_publishing_delivery_retry_receipts"."authorization_expires_at" > "runtime_publishing_delivery_retry_receipts"."authorization_issued_at"
        and "runtime_publishing_delivery_retry_receipts"."requested_at" >= "runtime_publishing_delivery_retry_receipts"."authorization_issued_at"
        and "runtime_publishing_delivery_retry_receipts"."requested_at" < "runtime_publishing_delivery_retry_receipts"."authorization_expires_at"
        and "runtime_publishing_delivery_retry_receipts"."source_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and ("runtime_publishing_delivery_retry_receipts"."source_intent_digest" is null or "runtime_publishing_delivery_retry_receipts"."source_intent_digest" ~ '^sha256:[a-f0-9]{64}$')
        and ("runtime_publishing_delivery_retry_receipts"."source_provider_adapter_contract_digest" is null or "runtime_publishing_delivery_retry_receipts"."source_provider_adapter_contract_digest" ~ '^sha256:[a-f0-9]{64}$')
        and (("runtime_publishing_delivery_retry_receipts"."source_intent_digest" is null and "runtime_publishing_delivery_retry_receipts"."source_provider_adapter_contract_digest" is null)
          or ("runtime_publishing_delivery_retry_receipts"."source_intent_digest" is not null and "runtime_publishing_delivery_retry_receipts"."source_provider_adapter_contract_digest" is not null))
        and "runtime_publishing_delivery_retry_receipts"."source_effect_generation" > 0
        and "runtime_publishing_delivery_retry_receipts"."source_failure_class" in ('transient','terminal')
        and "runtime_publishing_delivery_retry_receipts"."source_effect_disposition" in ('not_created','provider_failed_known')
        and "runtime_publishing_delivery_retry_receipts"."event_sequence" > 0 and "runtime_publishing_delivery_retry_receipts"."outbox_generation" > 0
        and "runtime_publishing_delivery_retry_receipts"."retry_at" >= "runtime_publishing_delivery_retry_receipts"."requested_at");
