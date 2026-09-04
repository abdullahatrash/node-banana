CREATE TABLE "runtime_cost_valuation_pricing_snapshots" (
	"workspace_id" text NOT NULL,
	"cost_valuation_id" text NOT NULL,
	"pricing_workspace_id" text,
	"pricing_snapshot_id" text NOT NULL,
	"pricing_source" text NOT NULL,
	CONSTRAINT "runtime_cost_valuation_pricing_snapshots_pk" PRIMARY KEY("workspace_id","cost_valuation_id","pricing_snapshot_id"),
	CONSTRAINT "runtime_cost_valuation_pricing_snapshots_workspace_scope_check" CHECK (("runtime_cost_valuation_pricing_snapshots"."pricing_source" = 'builtin_catalog' and "runtime_cost_valuation_pricing_snapshots"."pricing_workspace_id" is null)
        or ("runtime_cost_valuation_pricing_snapshots"."pricing_source" = 'workspace_override' and "runtime_cost_valuation_pricing_snapshots"."pricing_workspace_id" = "runtime_cost_valuation_pricing_snapshots"."workspace_id"))
);
--> statement-breakpoint
CREATE TABLE "runtime_cost_valuation_usage_records" (
	"workspace_id" text NOT NULL,
	"settlement_id" text NOT NULL,
	"cost_valuation_id" text NOT NULL,
	"usage_record_id" text NOT NULL,
	CONSTRAINT "runtime_cost_valuation_usage_records_pk" PRIMARY KEY("workspace_id","cost_valuation_id","usage_record_id")
);
--> statement-breakpoint
CREATE TABLE "runtime_cost_valuations" (
	"id" text PRIMARY KEY NOT NULL,
	"settlement_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_attempt_id" text NOT NULL,
	"source" text NOT NULL,
	"amount" text,
	"currency" text,
	"supersedes_cost_valuation_id" text,
	"valuation" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_cost_valuations_supersedes_self_check" CHECK ("runtime_cost_valuations"."supersedes_cost_valuation_id" is null or "runtime_cost_valuations"."supersedes_cost_valuation_id" <> "runtime_cost_valuations"."id"),
	CONSTRAINT "runtime_cost_valuations_state_check" CHECK (("runtime_cost_valuations"."source" = 'unknown' and "runtime_cost_valuations"."amount" is null and "runtime_cost_valuations"."currency" is null)
        or ("runtime_cost_valuations"."source" in ('provider_reported', 'workspace_override', 'builtin_catalog', 'mixed')
          and "runtime_cost_valuations"."amount" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
          and "runtime_cost_valuations"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "runtime_cost_valuations_payload_check" CHECK (jsonb_typeof("runtime_cost_valuations"."valuation") is not distinct from 'object'
        and "runtime_cost_valuations"."valuation" ?& array['schema', 'id', 'settlementId', 'workspaceId', 'principalId', 'runId', 'stepAttemptId', 'usageRecordIds', 'basis', 'pricingSource', 'amount', 'currency', 'providerCostEvidenceRef', 'pricingSnapshotIds', 'pricingSnapshots', 'fxSnapshotId', 'supersedesCostValuationId', 'recordedAt']
        and ("runtime_cost_valuations"."valuation"->>'schema') is not distinct from 'cost-valuation/v1'
        and ("runtime_cost_valuations"."valuation"->>'id') is not distinct from "runtime_cost_valuations"."id"
        and ("runtime_cost_valuations"."valuation"->>'settlementId') is not distinct from "runtime_cost_valuations"."settlement_id"
        and ("runtime_cost_valuations"."valuation"->>'workspaceId') is not distinct from "runtime_cost_valuations"."workspace_id"
        and ("runtime_cost_valuations"."valuation"->>'principalId') is not distinct from "runtime_cost_valuations"."principal_id"
        and ("runtime_cost_valuations"."valuation"->>'runId') is not distinct from "runtime_cost_valuations"."run_id"
        and ("runtime_cost_valuations"."valuation"->>'stepAttemptId') is not distinct from "runtime_cost_valuations"."step_attempt_id"
        and ("runtime_cost_valuations"."valuation"->>'pricingSource') is not distinct from "runtime_cost_valuations"."source"
        and ("runtime_cost_valuations"."valuation"->>'amount') is not distinct from "runtime_cost_valuations"."amount"
        and ("runtime_cost_valuations"."valuation"->>'currency') is not distinct from "runtime_cost_valuations"."currency"
        and ("runtime_cost_valuations"."valuation"->>'supersedesCostValuationId') is not distinct from "runtime_cost_valuations"."supersedes_cost_valuation_id"
        and ("runtime_cost_valuations"."valuation"->>'recordedAt')::timestamptz is not distinct from "runtime_cost_valuations"."recorded_at"
        and jsonb_typeof("runtime_cost_valuations"."valuation"->'usageRecordIds') is not distinct from 'array'
        and jsonb_typeof("runtime_cost_valuations"."valuation"->'pricingSnapshotIds') is not distinct from 'array'
        and jsonb_typeof("runtime_cost_valuations"."valuation"->'pricingSnapshots') is not distinct from 'array'
        and (
          ("runtime_cost_valuations"."source" = 'unknown' and ("runtime_cost_valuations"."valuation"->>'basis') is not distinct from 'unknown')
          or ("runtime_cost_valuations"."source" = 'provider_reported' and ("runtime_cost_valuations"."valuation"->>'basis') is not distinct from 'provider_reported')
          or ("runtime_cost_valuations"."source" in ('workspace_override', 'builtin_catalog', 'mixed') and ("runtime_cost_valuations"."valuation"->>'basis') is not distinct from 'runtime_calculated')
        )
        and (
          "runtime_cost_valuations"."source" <> 'provider_reported'
          or ("runtime_cost_valuations"."valuation"->>'providerCostEvidenceRef' ~ '^evidence:sha256:[a-f0-9]{64}$') is true
        )
        and octet_length("runtime_cost_valuations"."valuation"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "runtime_fx_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate" text NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_fx_snapshots_currency_check" CHECK ("runtime_fx_snapshots"."base_currency" ~ '^[A-Z]{3}$'
        and "runtime_fx_snapshots"."quote_currency" ~ '^[A-Z]{3}$'
        and "runtime_fx_snapshots"."base_currency" <> "runtime_fx_snapshots"."quote_currency"),
	CONSTRAINT "runtime_fx_snapshots_rate_check" CHECK ("runtime_fx_snapshots"."rate" ~ '^[1-9][0-9]*(\.[0-9]+)?$|^0\.[0-9]*[1-9][0-9]*$'),
	CONSTRAINT "runtime_fx_snapshots_payload_check" CHECK (jsonb_typeof("runtime_fx_snapshots"."snapshot") is not distinct from 'object'
        and "runtime_fx_snapshots"."snapshot" ?& array['schema', 'id', 'baseCurrency', 'quoteCurrency', 'rate', 'source', 'observedAt', 'recordedAt']
        and ("runtime_fx_snapshots"."snapshot"->>'schema') is not distinct from 'fx-snapshot/v1'
        and ("runtime_fx_snapshots"."snapshot"->>'id') is not distinct from "runtime_fx_snapshots"."id"
        and ("runtime_fx_snapshots"."snapshot"->>'baseCurrency') is not distinct from "runtime_fx_snapshots"."base_currency"
        and ("runtime_fx_snapshots"."snapshot"->>'quoteCurrency') is not distinct from "runtime_fx_snapshots"."quote_currency"
        and ("runtime_fx_snapshots"."snapshot"->>'rate') is not distinct from "runtime_fx_snapshots"."rate"
        and ("runtime_fx_snapshots"."snapshot"->>'source') is not distinct from "runtime_fx_snapshots"."source"
        and ("runtime_fx_snapshots"."snapshot"->>'observedAt')::timestamptz is not distinct from "runtime_fx_snapshots"."observed_at"
        and ("runtime_fx_snapshots"."snapshot"->>'recordedAt')::timestamptz is not distinct from "runtime_fx_snapshots"."recorded_at"
        and octet_length("runtime_fx_snapshots"."snapshot"::text) <= 16384)
);
--> statement-breakpoint
CREATE TABLE "runtime_pricing_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"source" text NOT NULL,
	"provider" text NOT NULL,
	"provider_operation" text NOT NULL,
	"model" text NOT NULL,
	"dimension" text NOT NULL,
	"unit" text NOT NULL,
	"price" text NOT NULL,
	"currency" text NOT NULL,
	"per_quantity" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"snapshot" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_pricing_snapshots_source_check" CHECK ("runtime_pricing_snapshots"."source" in ('workspace_override', 'builtin_catalog')),
	CONSTRAINT "runtime_pricing_snapshots_decimal_check" CHECK ("runtime_pricing_snapshots"."price" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
        and "runtime_pricing_snapshots"."per_quantity" ~ '^[1-9][0-9]*(\.[0-9]+)?$'),
	CONSTRAINT "runtime_pricing_snapshots_currency_check" CHECK ("runtime_pricing_snapshots"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "runtime_pricing_snapshots_interval_check" CHECK ("runtime_pricing_snapshots"."effective_to" is null or "runtime_pricing_snapshots"."effective_to" > "runtime_pricing_snapshots"."effective_from"),
	CONSTRAINT "runtime_pricing_snapshots_payload_check" CHECK (jsonb_typeof("runtime_pricing_snapshots"."snapshot") is not distinct from 'object'
        and "runtime_pricing_snapshots"."snapshot" ?& array['schema', 'id', 'workspaceId', 'source', 'provider', 'providerOperation', 'model', 'dimension', 'unit', 'price', 'currency', 'perQuantity', 'version', 'sourceUrl', 'effectiveFrom', 'effectiveTo', 'recordedAt']
        and ("runtime_pricing_snapshots"."snapshot"->>'schema') is not distinct from 'pricing-snapshot/v1'
        and ("runtime_pricing_snapshots"."snapshot"->>'id') is not distinct from "runtime_pricing_snapshots"."id"
        and ("runtime_pricing_snapshots"."snapshot"->>'workspaceId') is not distinct from "runtime_pricing_snapshots"."workspace_id"
        and ("runtime_pricing_snapshots"."snapshot"->>'source') is not distinct from "runtime_pricing_snapshots"."source"
        and ("runtime_pricing_snapshots"."snapshot"->>'provider') is not distinct from "runtime_pricing_snapshots"."provider"
        and ("runtime_pricing_snapshots"."snapshot"->>'providerOperation') is not distinct from "runtime_pricing_snapshots"."provider_operation"
        and ("runtime_pricing_snapshots"."snapshot"->>'model') is not distinct from "runtime_pricing_snapshots"."model"
        and ("runtime_pricing_snapshots"."snapshot"->>'dimension') is not distinct from "runtime_pricing_snapshots"."dimension"
        and ("runtime_pricing_snapshots"."snapshot"->>'unit') is not distinct from "runtime_pricing_snapshots"."unit"
        and ("runtime_pricing_snapshots"."snapshot"->>'price') is not distinct from "runtime_pricing_snapshots"."price"
        and ("runtime_pricing_snapshots"."snapshot"->>'currency') is not distinct from "runtime_pricing_snapshots"."currency"
        and ("runtime_pricing_snapshots"."snapshot"->>'perQuantity') is not distinct from "runtime_pricing_snapshots"."per_quantity"
        and ("runtime_pricing_snapshots"."snapshot"->>'effectiveFrom')::timestamptz is not distinct from "runtime_pricing_snapshots"."effective_from"
        and ("runtime_pricing_snapshots"."snapshot"->>'effectiveTo')::timestamptz is not distinct from "runtime_pricing_snapshots"."effective_to"
        and ("runtime_pricing_snapshots"."snapshot"->>'recordedAt')::timestamptz is not distinct from "runtime_pricing_snapshots"."recorded_at"
        and octet_length("runtime_pricing_snapshots"."snapshot"::text) <= 32768)
);
--> statement-breakpoint
CREATE TABLE "runtime_usage_artifact_attributions" (
	"id" text PRIMARY KEY NOT NULL,
	"settlement_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_attempt_id" text NOT NULL,
	"effect_key" text NOT NULL,
	"output_name" text NOT NULL,
	"basis" text NOT NULL,
	"attribution" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_usage_artifact_attributions_basis_check" CHECK ("runtime_usage_artifact_attributions"."basis" = 'single_output'),
	CONSTRAINT "runtime_usage_artifact_attributions_payload_check" CHECK (jsonb_typeof("runtime_usage_artifact_attributions"."attribution") is not distinct from 'object'
        and "runtime_usage_artifact_attributions"."attribution" ?& array['schema', 'id', 'settlementId', 'workspaceId', 'artifactId', 'runId', 'stepAttemptId', 'effectKey', 'outputName', 'basis', 'recordedAt']
        and ("runtime_usage_artifact_attributions"."attribution"->>'schema') is not distinct from 'usage-artifact-attribution/v1'
        and ("runtime_usage_artifact_attributions"."attribution"->>'id') is not distinct from "runtime_usage_artifact_attributions"."id"
        and ("runtime_usage_artifact_attributions"."attribution"->>'settlementId') is not distinct from "runtime_usage_artifact_attributions"."settlement_id"
        and ("runtime_usage_artifact_attributions"."attribution"->>'workspaceId') is not distinct from "runtime_usage_artifact_attributions"."workspace_id"
        and ("runtime_usage_artifact_attributions"."attribution"->>'artifactId') is not distinct from "runtime_usage_artifact_attributions"."artifact_id"
        and ("runtime_usage_artifact_attributions"."attribution"->>'runId') is not distinct from "runtime_usage_artifact_attributions"."run_id"
        and ("runtime_usage_artifact_attributions"."attribution"->>'stepAttemptId') is not distinct from "runtime_usage_artifact_attributions"."step_attempt_id"
        and ("runtime_usage_artifact_attributions"."attribution"->>'effectKey') is not distinct from "runtime_usage_artifact_attributions"."effect_key"
        and ("runtime_usage_artifact_attributions"."attribution"->>'outputName') is not distinct from "runtime_usage_artifact_attributions"."output_name"
        and ("runtime_usage_artifact_attributions"."attribution"->>'basis') is not distinct from "runtime_usage_artifact_attributions"."basis"
        and ("runtime_usage_artifact_attributions"."attribution"->>'recordedAt')::timestamptz is not distinct from "runtime_usage_artifact_attributions"."recorded_at"
        and octet_length("runtime_usage_artifact_attributions"."attribution"::text) <= 16384)
);
--> statement-breakpoint
CREATE TABLE "runtime_usage_metering_events" (
	"id" text PRIMARY KEY NOT NULL,
	"settlement_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_attempt_id" text NOT NULL,
	"effect_key" text NOT NULL,
	"event_type" text NOT NULL,
	"event" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_usage_metering_events_type_check" CHECK ("runtime_usage_metering_events"."event_type" in ('usage.settled', 'usage.corrected', 'cost.valued', 'artifact.attributed')),
	CONSTRAINT "runtime_usage_metering_events_payload_check" CHECK (jsonb_typeof("runtime_usage_metering_events"."event") is not distinct from 'object'
        and "runtime_usage_metering_events"."event" ?& array['schema', 'id', 'settlementId', 'workspaceId', 'principalId', 'runId', 'stepAttemptId', 'effectKey', 'type', 'usageRecordIds', 'costValuationId', 'measurements', 'details', 'occurredAt']
        and ("runtime_usage_metering_events"."event"->>'schema') is not distinct from 'usage-metering-event/v1'
        and ("runtime_usage_metering_events"."event"->>'id') is not distinct from "runtime_usage_metering_events"."id"
        and ("runtime_usage_metering_events"."event"->>'settlementId') is not distinct from "runtime_usage_metering_events"."settlement_id"
        and ("runtime_usage_metering_events"."event"->>'workspaceId') is not distinct from "runtime_usage_metering_events"."workspace_id"
        and ("runtime_usage_metering_events"."event"->>'principalId') is not distinct from "runtime_usage_metering_events"."principal_id"
        and ("runtime_usage_metering_events"."event"->>'runId') is not distinct from "runtime_usage_metering_events"."run_id"
        and ("runtime_usage_metering_events"."event"->>'stepAttemptId') is not distinct from "runtime_usage_metering_events"."step_attempt_id"
        and ("runtime_usage_metering_events"."event"->>'effectKey') is not distinct from "runtime_usage_metering_events"."effect_key"
        and ("runtime_usage_metering_events"."event"->>'type') is not distinct from "runtime_usage_metering_events"."event_type"
        and jsonb_typeof("runtime_usage_metering_events"."event"->'measurements') is not distinct from 'array'
        and ("runtime_usage_metering_events"."event"->>'occurredAt')::timestamptz is not distinct from "runtime_usage_metering_events"."occurred_at"
        and octet_length("runtime_usage_metering_events"."event"::text) <= 16384
        and "runtime_usage_metering_events"."event"::text !~* '"[^"\n]*(secret|token|password|ciphertext|prompt|content)[^"\n]*"\s*:')
);
--> statement-breakpoint
CREATE TABLE "runtime_usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"settlement_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_attempt_id" text NOT NULL,
	"step_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"effect_key" text NOT NULL,
	"provider" text NOT NULL,
	"provider_operation" text NOT NULL,
	"provider_operation_ref" text,
	"model" text NOT NULL,
	"interval_started_at" timestamp with time zone NOT NULL,
	"interval_ended_at" timestamp with time zone NOT NULL,
	"dimension" text NOT NULL,
	"unit" text NOT NULL,
	"source" text NOT NULL,
	"quantity" text,
	"outcome" text NOT NULL,
	"supersedes_usage_record_id" text,
	"record" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_usage_records_decimal_check" CHECK (("runtime_usage_records"."source" = 'unknown' and "runtime_usage_records"."quantity" is null)
        or ("runtime_usage_records"."source" in ('reported', 'measured', 'estimated')
          and "runtime_usage_records"."quantity" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$')),
	CONSTRAINT "runtime_usage_records_dimension_check" CHECK ("runtime_usage_records"."dimension" ~ '^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$'),
	CONSTRAINT "runtime_usage_records_unit_check" CHECK ("runtime_usage_records"."unit" in ('count', 'byte', 'millisecond', 'megapixel')),
	CONSTRAINT "runtime_usage_records_outcome_check" CHECK ("runtime_usage_records"."outcome" in ('succeeded', 'failed_known', 'outcome_unknown')),
	CONSTRAINT "runtime_usage_records_interval_check" CHECK ("runtime_usage_records"."interval_ended_at" >= "runtime_usage_records"."interval_started_at"),
	CONSTRAINT "runtime_usage_records_attempt_check" CHECK ("runtime_usage_records"."attempt" > 0),
	CONSTRAINT "runtime_usage_records_supersedes_self_check" CHECK ("runtime_usage_records"."supersedes_usage_record_id" is null or "runtime_usage_records"."supersedes_usage_record_id" <> "runtime_usage_records"."id"),
	CONSTRAINT "runtime_usage_records_payload_check" CHECK (jsonb_typeof("runtime_usage_records"."record") is not distinct from 'object'
        and "runtime_usage_records"."record" ?& array['schema', 'id', 'settlementId', 'binding', 'interval', 'dimension', 'unit', 'source', 'quantity', 'outcome', 'evidence', 'directArtifactId', 'lineageArtifactIds', 'supersedesUsageRecordId', 'correctionReason', 'recordedAt']
        and jsonb_typeof("runtime_usage_records"."record"->'binding') is not distinct from 'object'
        and "runtime_usage_records"."record"->'binding' ?& array['workspaceId', 'principalId', 'workflowId', 'runId', 'stepAttemptId', 'stepId', 'attempt', 'effectKey', 'provider', 'providerOperation', 'providerOperationRef', 'model']
        and jsonb_typeof("runtime_usage_records"."record"->'interval') is not distinct from 'object'
        and "runtime_usage_records"."record"->'interval' ?& array['startedAt', 'endedAt']
        and ("runtime_usage_records"."record"->>'schema') is not distinct from 'usage-record/v1'
        and ("runtime_usage_records"."record"->>'id') is not distinct from "runtime_usage_records"."id"
        and ("runtime_usage_records"."record"->>'settlementId') is not distinct from "runtime_usage_records"."settlement_id"
        and ("runtime_usage_records"."record"->'binding'->>'workspaceId') is not distinct from "runtime_usage_records"."workspace_id"
        and ("runtime_usage_records"."record"->'binding'->>'principalId') is not distinct from "runtime_usage_records"."principal_id"
        and ("runtime_usage_records"."record"->'binding'->>'workflowId') is not distinct from "runtime_usage_records"."workflow_id"
        and ("runtime_usage_records"."record"->'binding'->>'runId') is not distinct from "runtime_usage_records"."run_id"
        and ("runtime_usage_records"."record"->'binding'->>'stepAttemptId') is not distinct from "runtime_usage_records"."step_attempt_id"
        and ("runtime_usage_records"."record"->'binding'->>'stepId') is not distinct from "runtime_usage_records"."step_id"
        and (("runtime_usage_records"."record"->'binding'->>'attempt')::integer) is not distinct from "runtime_usage_records"."attempt"
        and ("runtime_usage_records"."record"->'binding'->>'effectKey') is not distinct from "runtime_usage_records"."effect_key"
        and ("runtime_usage_records"."record"->'binding'->>'provider') is not distinct from "runtime_usage_records"."provider"
        and ("runtime_usage_records"."record"->'binding'->>'providerOperation') is not distinct from "runtime_usage_records"."provider_operation"
        and ("runtime_usage_records"."record"->'binding'->>'providerOperationRef') is not distinct from "runtime_usage_records"."provider_operation_ref"
        and ("runtime_usage_records"."record"->'binding'->>'model') is not distinct from "runtime_usage_records"."model"
        and (("runtime_usage_records"."record"->'interval'->>'startedAt')::timestamptz) is not distinct from "runtime_usage_records"."interval_started_at"
        and (("runtime_usage_records"."record"->'interval'->>'endedAt')::timestamptz) is not distinct from "runtime_usage_records"."interval_ended_at"
        and ("runtime_usage_records"."record"->>'dimension') is not distinct from "runtime_usage_records"."dimension"
        and ("runtime_usage_records"."record"->>'unit') is not distinct from "runtime_usage_records"."unit"
        and ("runtime_usage_records"."record"->>'source') is not distinct from "runtime_usage_records"."source"
        and ("runtime_usage_records"."record"->>'quantity') is not distinct from "runtime_usage_records"."quantity"
        and ("runtime_usage_records"."record"->>'outcome') is not distinct from "runtime_usage_records"."outcome"
        and ("runtime_usage_records"."record"->>'supersedesUsageRecordId') is not distinct from "runtime_usage_records"."supersedes_usage_record_id"
        and ("runtime_usage_records"."record"->>'recordedAt')::timestamptz is not distinct from "runtime_usage_records"."recorded_at"
        and ("runtime_usage_records"."record"->>'directArtifactId') is null
        and jsonb_typeof("runtime_usage_records"."record"->'lineageArtifactIds') is not distinct from 'array'
        and jsonb_typeof("runtime_usage_records"."record"->'evidence') is not distinct from 'object'
        and octet_length("runtime_usage_records"."record"::text) <= 65536
        and "runtime_usage_records"."record"::text !~* '"[^"\n]*(secret|token|password|ciphertext|prompt|content)[^"\n]*"\s*:')
);
--> statement-breakpoint
CREATE TABLE "usage_ledger_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"request_digest" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "usage_ledger_receipts_digest_check" CHECK ("usage_ledger_receipts"."request_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "usage_ledger_receipts_kind_check" CHECK ("usage_ledger_receipts"."kind" in ('settlement', 'correction', 'attribution'))
);
--> statement-breakpoint
ALTER TABLE "artifact_generated_origins" DROP CONSTRAINT "artifact_generated_origins_provider_metadata_redaction_check";--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" DROP CONSTRAINT "workflow_step_attempts_payload_check";--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_cost_valuations_superseded_unique" ON "runtime_cost_valuations" USING btree ("supersedes_cost_valuation_id") WHERE "runtime_cost_valuations"."supersedes_cost_valuation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_cost_valuations_chain_target_unique" ON "runtime_cost_valuations" USING btree ("workspace_id","settlement_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_cost_valuations_workspace_id_unique" ON "runtime_cost_valuations" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "runtime_cost_valuations_workspace_recorded_idx" ON "runtime_cost_valuations" USING btree ("workspace_id","recorded_at","id");--> statement-breakpoint
CREATE INDEX "runtime_fx_snapshots_pair_observed_idx" ON "runtime_fx_snapshots" USING btree ("base_currency","quote_currency","observed_at");--> statement-breakpoint
CREATE INDEX "runtime_pricing_snapshots_lookup_idx" ON "runtime_pricing_snapshots" USING btree ("workspace_id","provider","provider_operation","model","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_pricing_snapshots_workspace_id_unique" ON "runtime_pricing_snapshots" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_pricing_snapshots_id_source_unique" ON "runtime_pricing_snapshots" USING btree ("id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_usage_artifact_attributions_settlement_unique" ON "runtime_usage_artifact_attributions" USING btree ("workspace_id","settlement_id");--> statement-breakpoint
CREATE INDEX "runtime_usage_metering_events_workspace_occurred_idx" ON "runtime_usage_metering_events" USING btree ("workspace_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_usage_records_settlement_dimension_unique" ON "runtime_usage_records" USING btree ("settlement_id","dimension","unit") WHERE "runtime_usage_records"."supersedes_usage_record_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_usage_records_superseded_unique" ON "runtime_usage_records" USING btree ("supersedes_usage_record_id") WHERE "runtime_usage_records"."supersedes_usage_record_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_usage_records_chain_target_unique" ON "runtime_usage_records" USING btree ("workspace_id","settlement_id","dimension","unit","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_usage_records_workspace_id_unique" ON "runtime_usage_records" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_usage_records_workspace_settlement_id_unique" ON "runtime_usage_records" USING btree ("workspace_id","settlement_id","id");--> statement-breakpoint
CREATE INDEX "runtime_usage_records_workspace_recorded_idx" ON "runtime_usage_records" USING btree ("workspace_id","recorded_at","id");--> statement-breakpoint
CREATE INDEX "runtime_usage_records_run_idx" ON "runtime_usage_records" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE INDEX "runtime_usage_records_attempt_idx" ON "runtime_usage_records" USING btree ("workspace_id","step_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_receipts_workspace_id_unique" ON "usage_ledger_receipts" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_generated_origins_workspace_generation_identity_unique" ON "artifact_generated_origins" USING btree ("workspace_id","artifact_id","run_id","step_attempt_id","effect_key","output_name");--> statement-breakpoint
ALTER TABLE "runtime_cost_valuation_pricing_snapshots" ADD CONSTRAINT "runtime_cost_valuation_pricing_snapshots_valuation_fk" FOREIGN KEY ("workspace_id","cost_valuation_id") REFERENCES "public"."runtime_cost_valuations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cost_valuation_pricing_snapshots" ADD CONSTRAINT "runtime_cost_valuation_pricing_snapshots_workspace_pricing_fk" FOREIGN KEY ("pricing_workspace_id","pricing_snapshot_id") REFERENCES "public"."runtime_pricing_snapshots"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cost_valuation_pricing_snapshots" ADD CONSTRAINT "runtime_cost_valuation_pricing_snapshots_identity_fk" FOREIGN KEY ("pricing_snapshot_id","pricing_source") REFERENCES "public"."runtime_pricing_snapshots"("id","source") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cost_valuation_usage_records" ADD CONSTRAINT "runtime_cost_valuation_usage_records_valuation_fk" FOREIGN KEY ("workspace_id","settlement_id","cost_valuation_id") REFERENCES "public"."runtime_cost_valuations"("workspace_id","settlement_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cost_valuation_usage_records" ADD CONSTRAINT "runtime_cost_valuation_usage_records_usage_record_fk" FOREIGN KEY ("workspace_id","settlement_id","usage_record_id") REFERENCES "public"."runtime_usage_records"("workspace_id","settlement_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cost_valuations" ADD CONSTRAINT "runtime_cost_valuations_settlement_fk" FOREIGN KEY ("workspace_id","settlement_id") REFERENCES "public"."usage_ledger_receipts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cost_valuations" ADD CONSTRAINT "runtime_cost_valuations_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cost_valuations" ADD CONSTRAINT "runtime_cost_valuations_workspace_attempt_fk" FOREIGN KEY ("workspace_id","run_id","step_attempt_id") REFERENCES "public"."workflow_step_attempts"("workspace_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cost_valuations" ADD CONSTRAINT "runtime_cost_valuations_supersedes_fk" FOREIGN KEY ("workspace_id","settlement_id","supersedes_cost_valuation_id") REFERENCES "public"."runtime_cost_valuations"("workspace_id","settlement_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_pricing_snapshots" ADD CONSTRAINT "runtime_pricing_snapshots_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_artifact_attributions" ADD CONSTRAINT "runtime_usage_artifact_attributions_settlement_fk" FOREIGN KEY ("workspace_id","settlement_id") REFERENCES "public"."usage_ledger_receipts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_artifact_attributions" ADD CONSTRAINT "runtime_usage_artifact_attributions_workspace_artifact_fk" FOREIGN KEY ("workspace_id","artifact_id") REFERENCES "public"."artifacts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_artifact_attributions" ADD CONSTRAINT "runtime_usage_artifact_attributions_generated_origin_fk" FOREIGN KEY ("workspace_id","artifact_id","run_id","step_attempt_id","effect_key","output_name") REFERENCES "public"."artifact_generated_origins"("workspace_id","artifact_id","run_id","step_attempt_id","effect_key","output_name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_metering_events" ADD CONSTRAINT "runtime_usage_metering_events_settlement_fk" FOREIGN KEY ("workspace_id","settlement_id") REFERENCES "public"."usage_ledger_receipts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_metering_events" ADD CONSTRAINT "runtime_usage_metering_events_workspace_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_metering_events" ADD CONSTRAINT "runtime_usage_metering_events_workspace_attempt_fk" FOREIGN KEY ("workspace_id","run_id","step_attempt_id") REFERENCES "public"."workflow_step_attempts"("workspace_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_records" ADD CONSTRAINT "runtime_usage_records_settlement_fk" FOREIGN KEY ("workspace_id","settlement_id") REFERENCES "public"."usage_ledger_receipts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_records" ADD CONSTRAINT "runtime_usage_records_workspace_run_fk" FOREIGN KEY ("workspace_id","workflow_id","run_id") REFERENCES "public"."workflow_runs"("workspace_id","workflow_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_records" ADD CONSTRAINT "runtime_usage_records_workspace_attempt_fk" FOREIGN KEY ("workspace_id","run_id","step_attempt_id") REFERENCES "public"."workflow_step_attempts"("workspace_id","run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_records" ADD CONSTRAINT "runtime_usage_records_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_records" ADD CONSTRAINT "runtime_usage_records_supersedes_fk" FOREIGN KEY ("workspace_id","settlement_id","dimension","unit","supersedes_usage_record_id") REFERENCES "public"."runtime_usage_records"("workspace_id","settlement_id","dimension","unit","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger_receipts" ADD CONSTRAINT "usage_ledger_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_ledger_receipts_workspace_created_idx" ON "usage_ledger_receipts" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
ALTER TABLE "artifact_generated_origins" ADD CONSTRAINT "artifact_generated_origins_provider_metadata_redaction_check" CHECK ("artifact_generated_origins"."provider_metadata" is null or (
        "artifact_generated_origins"."provider_metadata"::text !~* '"[^"]*(secret|token|password|ciphertext)[^"]*"\s*:'
        and (
          not ("artifact_generated_origins"."provider_metadata" ? 'reportedCost')
          or "artifact_generated_origins"."provider_metadata"->'reportedCost' = 'null'::jsonb
          or ("artifact_generated_origins"."provider_metadata"->'reportedCost'->>'evidenceRef' ~ '^evidence:sha256:[a-f0-9]{64}$') is true
        )
      ));--> statement-breakpoint
ALTER TABLE "workflow_step_attempts" ADD CONSTRAINT "workflow_step_attempts_payload_check" CHECK (jsonb_typeof("workflow_step_attempts"."inputs") = 'array'
        and octet_length("workflow_step_attempts"."inputs"::text) <= 262144
        and (
          "workflow_step_attempts"."outputs" is null
          or (
            jsonb_typeof("workflow_step_attempts"."outputs") = 'object'
            and octet_length("workflow_step_attempts"."outputs"::text) <= 262144
          )
        )
        and (
          "workflow_step_attempts"."outcome" is null
          or (
            jsonb_typeof("workflow_step_attempts"."outcome") = 'object'
            and octet_length("workflow_step_attempts"."outcome"::text) <= 4096
          )
        )
        and (
          "workflow_step_attempts"."reconciliation" is null
          or (
            jsonb_typeof("workflow_step_attempts"."reconciliation") = 'object'
            and octet_length("workflow_step_attempts"."reconciliation"::text) <= 4096
          )
        )
        and (
          "workflow_step_attempts"."provider_metadata" is null
          or (
            jsonb_typeof("workflow_step_attempts"."provider_metadata") = 'object'
            and octet_length("workflow_step_attempts"."provider_metadata"::text) <= 65536
            and (
              not ("workflow_step_attempts"."provider_metadata" ? 'reportedCost')
              or "workflow_step_attempts"."provider_metadata"->'reportedCost' = 'null'::jsonb
              or ("workflow_step_attempts"."provider_metadata"->'reportedCost'->>'evidenceRef' ~ '^evidence:sha256:[a-f0-9]{64}$') is true
            )
          )
        ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_runtime_usage_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'runtime usage ledger rows are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER usage_ledger_receipts_immutable BEFORE UPDATE OR DELETE ON usage_ledger_receipts FOR EACH ROW EXECUTE FUNCTION reject_runtime_usage_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_usage_records_immutable BEFORE UPDATE OR DELETE ON runtime_usage_records FOR EACH ROW EXECUTE FUNCTION reject_runtime_usage_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_pricing_snapshots_immutable BEFORE UPDATE OR DELETE ON runtime_pricing_snapshots FOR EACH ROW EXECUTE FUNCTION reject_runtime_usage_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_fx_snapshots_immutable BEFORE UPDATE OR DELETE ON runtime_fx_snapshots FOR EACH ROW EXECUTE FUNCTION reject_runtime_usage_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_cost_valuations_immutable BEFORE UPDATE OR DELETE ON runtime_cost_valuations FOR EACH ROW EXECUTE FUNCTION reject_runtime_usage_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_cost_valuation_usage_records_immutable BEFORE UPDATE OR DELETE ON runtime_cost_valuation_usage_records FOR EACH ROW EXECUTE FUNCTION reject_runtime_usage_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_cost_valuation_pricing_snapshots_immutable BEFORE UPDATE OR DELETE ON runtime_cost_valuation_pricing_snapshots FOR EACH ROW EXECUTE FUNCTION reject_runtime_usage_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_usage_artifact_attributions_immutable BEFORE UPDATE OR DELETE ON runtime_usage_artifact_attributions FOR EACH ROW EXECUTE FUNCTION reject_runtime_usage_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_usage_metering_events_immutable BEFORE UPDATE OR DELETE ON runtime_usage_metering_events FOR EACH ROW EXECUTE FUNCTION reject_runtime_usage_ledger_mutation();
