CREATE FUNCTION runtime_contract_evidence_canonical_json(value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  rendered text;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT string_agg(to_jsonb(entry.key)::text || ':' || runtime_contract_evidence_canonical_json(entry.value), ',' ORDER BY entry.key)
      INTO rendered
      FROM jsonb_each(value) AS entry;
      RETURN '{' || coalesce(rendered, '') || '}';
    WHEN 'array' THEN
      SELECT string_agg(runtime_contract_evidence_canonical_json(entry.value), ',' ORDER BY entry.ordinality)
      INTO rendered
      FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(value, ordinality);
      RETURN '[' || coalesce(rendered, '') || ']';
    ELSE
      RETURN value::text;
  END CASE;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION runtime_contract_evidence_resource_reference_digest(
  workspace_id text,
  resource_kind text,
  resource_id text
)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT 'sha256:' || encode(sha256(convert_to(runtime_contract_evidence_canonical_json(
    jsonb_build_object(
      'schema', 'contract-evidence-resource-reference/v1',
      'workspaceId', workspace_id,
      'resourceKind', resource_kind,
      'resourceId', resource_id
    )
  ), 'UTF8')), 'hex')
$$;
--> statement-breakpoint
CREATE FUNCTION runtime_contract_evidence_projection_is_valid(
  resource_kind text,
  resource_id text,
  projection_kind text,
  projection jsonb
)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  timestamp_pattern constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$';
  decimal_pattern constant text := '^(0|[1-9][0-9]*)(\.[0-9]+)?$';
  digest_pattern constant text := '^sha256:[a-f0-9]{64}$';
  identity_pattern constant text := '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$';
  run_id_pattern constant text := '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$';
  timezone_pattern constant text := '^[A-Za-z0-9][A-Za-z0-9._+:/-]{0,127}$';
  exact_keys text[];
BEGIN
  IF jsonb_typeof(projection) IS DISTINCT FROM 'object'
    OR octet_length(projection::text) NOT BETWEEN 1 AND 65536
    OR projection::text ~* '"[^"\n]*(prompt|content|secret|token|password|ciphertext|credential|signed[_-]?url|authorization|headers?|provider[_-]?body)[^"\n]*"\s*:'
    OR jsonb_typeof(projection->'id') IS DISTINCT FROM 'string'
    OR projection->>'id' IS DISTINCT FROM resource_id
    OR resource_id !~ identity_pattern
  THEN
    RETURN false;
  END IF;

  IF resource_kind = 'run' AND projection_kind = 'run_summary' THEN
    exact_keys := ARRAY['schema','id','workflowId','workflowRevisionId','state','startSnapshotDigest','finalSnapshotDigest','sourceRunId','rootRunId','derivationDepth','resumeAt','failureCode','acceptedAt','startedAt','completedAt','updatedAt'];
    RETURN coalesce((resource_id ~ run_id_pattern
      AND projection ?& exact_keys
      AND (projection - exact_keys) = '{}'::jsonb
      AND projection->>'schema' = 'support-run-summary/v1'
      AND jsonb_typeof(projection->'workflowId') = 'string'
      AND projection->>'workflowId' ~ identity_pattern
      AND jsonb_typeof(projection->'workflowRevisionId') = 'string'
      AND projection->>'workflowRevisionId' ~ identity_pattern
      AND jsonb_typeof(projection->'state') = 'string' AND projection->>'state' IN ('accepted','running','waiting','outcome_unknown','completed','failed')
      AND jsonb_typeof(projection->'startSnapshotDigest') = 'string'
      AND projection->>'startSnapshotDigest' ~ digest_pattern
      AND (
        jsonb_typeof(projection->'finalSnapshotDigest') = 'null'
        OR (jsonb_typeof(projection->'finalSnapshotDigest') = 'string' AND projection->>'finalSnapshotDigest' ~ digest_pattern)
      )
      AND (
        jsonb_typeof(projection->'sourceRunId') = 'null'
        OR (jsonb_typeof(projection->'sourceRunId') = 'string' AND projection->>'sourceRunId' ~ run_id_pattern)
      )
      AND (
        jsonb_typeof(projection->'rootRunId') = 'null'
        OR (jsonb_typeof(projection->'rootRunId') = 'string' AND projection->>'rootRunId' ~ run_id_pattern)
      )
      AND jsonb_typeof(projection->'derivationDepth') = 'number'
      AND projection->>'derivationDepth' ~ '^(0|[1-9][0-9]{0,8})$'
      AND (
        jsonb_typeof(projection->'resumeAt') = 'null'
        OR (jsonb_typeof(projection->'resumeAt') = 'string' AND projection->>'resumeAt' ~ timestamp_pattern AND (projection->>'resumeAt')::timestamptz IS NOT NULL)
      )
      AND (
        jsonb_typeof(projection->'failureCode') = 'null'
        OR (jsonb_typeof(projection->'failureCode') = 'string' AND projection->>'failureCode' ~ '^[A-Z][A-Z0-9_]{0,79}$')
      )
      AND jsonb_typeof(projection->'acceptedAt') = 'string' AND projection->>'acceptedAt' ~ timestamp_pattern AND (projection->>'acceptedAt')::timestamptz IS NOT NULL
      AND (jsonb_typeof(projection->'startedAt') = 'null' OR (jsonb_typeof(projection->'startedAt') = 'string' AND projection->>'startedAt' ~ timestamp_pattern AND (projection->>'startedAt')::timestamptz IS NOT NULL))
      AND (jsonb_typeof(projection->'completedAt') = 'null' OR (jsonb_typeof(projection->'completedAt') = 'string' AND projection->>'completedAt' ~ timestamp_pattern AND (projection->>'completedAt')::timestamptz IS NOT NULL))
      AND jsonb_typeof(projection->'updatedAt') = 'string' AND projection->>'updatedAt' ~ timestamp_pattern AND (projection->>'updatedAt')::timestamptz IS NOT NULL), false);
  END IF;

  IF resource_kind = 'budget_reservation' AND projection_kind = 'budget_summary' THEN
    exact_keys := ARRAY['schema','id','runId','policyId','policyRevisionId','scope','period','currency','reservedAmount','heldAmount','settledAmount','releasedAmount','state','pricingSnapshotIds','createdAt','updatedAt'];
    IF NOT (projection ?& exact_keys AND (projection - exact_keys) = '{}'::jsonb)
      OR jsonb_typeof(projection->'period') IS DISTINCT FROM 'object'
      OR NOT ((projection->'period') ?& ARRAY['kind','timezone','startsAt','endsAt'])
      OR ((projection->'period') - ARRAY['kind','timezone','startsAt','endsAt']) <> '{}'::jsonb
      OR jsonb_typeof(projection->'pricingSnapshotIds') IS DISTINCT FROM 'array'
    THEN
      RETURN false;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(projection->'pricingSnapshotIds') AS item
      WHERE jsonb_typeof(item) IS DISTINCT FROM 'string' OR (item #>> '{}') !~ identity_pattern
    ) THEN RETURN false; END IF;
    RETURN coalesce((projection->>'schema' = 'support-budget-summary/v1'
      AND jsonb_typeof(projection->'runId') = 'string' AND projection->>'runId' ~ identity_pattern
      AND jsonb_typeof(projection->'policyId') = 'string' AND projection->>'policyId' ~ identity_pattern
      AND jsonb_typeof(projection->'policyRevisionId') = 'string' AND projection->>'policyRevisionId' ~ identity_pattern
      AND jsonb_typeof(projection->'scope') = 'string' AND projection->>'scope' IN ('workspace','principal')
      AND jsonb_typeof(projection->'period'->'kind') = 'string' AND projection->'period'->>'kind' IN ('calendar_day','calendar_week','calendar_month','lifetime')
      AND jsonb_typeof(projection->'period'->'timezone') = 'string' AND projection->'period'->>'timezone' ~ timezone_pattern
      AND jsonb_typeof(projection->'period'->'startsAt') = 'string' AND projection->'period'->>'startsAt' ~ timestamp_pattern AND (projection->'period'->>'startsAt')::timestamptz IS NOT NULL
      AND (jsonb_typeof(projection->'period'->'endsAt') = 'null' OR (jsonb_typeof(projection->'period'->'endsAt') = 'string' AND projection->'period'->>'endsAt' ~ timestamp_pattern AND (projection->'period'->>'endsAt')::timestamptz IS NOT NULL))
      AND jsonb_typeof(projection->'currency') = 'string' AND projection->>'currency' ~ '^[A-Z]{3}$'
      AND jsonb_typeof(projection->'reservedAmount') = 'string' AND length(projection->>'reservedAmount') <= 81 AND projection->>'reservedAmount' ~ decimal_pattern
      AND jsonb_typeof(projection->'heldAmount') = 'string' AND length(projection->>'heldAmount') <= 81 AND projection->>'heldAmount' ~ decimal_pattern
      AND jsonb_typeof(projection->'settledAmount') = 'string' AND length(projection->>'settledAmount') <= 81 AND projection->>'settledAmount' ~ decimal_pattern
      AND jsonb_typeof(projection->'releasedAmount') = 'string' AND length(projection->>'releasedAmount') <= 81 AND projection->>'releasedAmount' ~ decimal_pattern
      AND jsonb_typeof(projection->'state') = 'string' AND projection->>'state' IN ('held','settled','released','outcome_unknown','held_unknown_cost')
      AND jsonb_typeof(projection->'createdAt') = 'string' AND projection->>'createdAt' ~ timestamp_pattern AND (projection->>'createdAt')::timestamptz IS NOT NULL
      AND jsonb_typeof(projection->'updatedAt') = 'string' AND projection->>'updatedAt' ~ timestamp_pattern AND (projection->>'updatedAt')::timestamptz IS NOT NULL), false);
  END IF;

  IF resource_kind = 'quota_reservation' AND projection_kind = 'quota_reservation_summary' THEN
    exact_keys := ARRAY['schema','id','runId','transitionKey','boundary','subject','policyId','policyRevisionId','scope','kind','dimension','unit','window','reservationRule','reservedAmount','heldAmount','settledAmount','releasedAmount','overageAmount','state','createdAt','updatedAt'];
    IF NOT (projection ?& exact_keys AND (projection - exact_keys) = '{}'::jsonb)
      OR jsonb_typeof(projection->'subject') IS DISTINCT FROM 'object'
      OR NOT ((projection->'subject') ?& ARRAY['kind','id'])
      OR ((projection->'subject') - ARRAY['kind','id']) <> '{}'::jsonb
      OR jsonb_typeof(projection->'window') IS DISTINCT FROM 'object'
      OR NOT ((projection->'window') ?& ARRAY['kind','timezone','startsAt','endsAt'])
      OR ((projection->'window') - ARRAY['kind','timezone','startsAt','endsAt']) <> '{}'::jsonb
    THEN
      RETURN false;
    END IF;
    RETURN coalesce((projection->>'schema' = 'support-quota-reservation-summary/v1'
      AND (jsonb_typeof(projection->'runId') = 'null' OR (jsonb_typeof(projection->'runId') = 'string' AND projection->>'runId' ~ identity_pattern))
      AND jsonb_typeof(projection->'transitionKey') = 'string' AND projection->>'transitionKey' ~ identity_pattern
      AND jsonb_typeof(projection->'boundary') = 'string' AND projection->>'boundary' IN ('run_admission','run_concurrency','provider_effect','artifact_storage','usage_settlement')
      AND jsonb_typeof(projection->'subject'->'kind') = 'string' AND projection->'subject'->>'kind' IN ('run','step_attempt','artifact','usage_settlement')
      AND jsonb_typeof(projection->'subject'->'id') = 'string' AND projection->'subject'->>'id' ~ identity_pattern
      AND jsonb_typeof(projection->'policyId') = 'string' AND projection->>'policyId' ~ identity_pattern
      AND jsonb_typeof(projection->'policyRevisionId') = 'string' AND projection->>'policyRevisionId' ~ identity_pattern
      AND jsonb_typeof(projection->'scope') = 'string' AND projection->>'scope' IN ('workspace','principal')
      AND jsonb_typeof(projection->'kind') = 'string' AND projection->>'kind' IN ('admission','concurrency','rate','storage','usage')
      AND jsonb_typeof(projection->'dimension') = 'string' AND projection->>'dimension' ~ '^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$'
      AND jsonb_typeof(projection->'unit') = 'string' AND projection->>'unit' IN ('count','byte','millisecond','megapixel')
      AND jsonb_typeof(projection->'window'->'kind') = 'string' AND projection->'window'->>'kind' IN ('concurrent','calendar_minute','calendar_hour','calendar_day','calendar_week','calendar_month','lifetime')
      AND jsonb_typeof(projection->'window'->'timezone') = 'string' AND projection->'window'->>'timezone' ~ timezone_pattern
      AND jsonb_typeof(projection->'window'->'startsAt') = 'string' AND projection->'window'->>'startsAt' ~ timestamp_pattern AND (projection->'window'->>'startsAt')::timestamptz IS NOT NULL
      AND (jsonb_typeof(projection->'window'->'endsAt') = 'null' OR (jsonb_typeof(projection->'window'->'endsAt') = 'string' AND projection->'window'->>'endsAt' ~ timestamp_pattern AND (projection->'window'->>'endsAt')::timestamptz IS NOT NULL))
      AND jsonb_typeof(projection->'reservationRule') = 'string' AND projection->>'reservationRule' IN ('consume','release_on_terminal','release_on_transition')
      AND jsonb_typeof(projection->'reservedAmount') = 'string' AND length(projection->>'reservedAmount') <= 81 AND projection->>'reservedAmount' ~ decimal_pattern
      AND jsonb_typeof(projection->'heldAmount') = 'string' AND length(projection->>'heldAmount') <= 81 AND projection->>'heldAmount' ~ decimal_pattern
      AND jsonb_typeof(projection->'settledAmount') = 'string' AND length(projection->>'settledAmount') <= 81 AND projection->>'settledAmount' ~ decimal_pattern
      AND jsonb_typeof(projection->'releasedAmount') = 'string' AND length(projection->>'releasedAmount') <= 81 AND projection->>'releasedAmount' ~ decimal_pattern
      AND jsonb_typeof(projection->'overageAmount') = 'string' AND length(projection->>'overageAmount') <= 81 AND projection->>'overageAmount' ~ decimal_pattern
      AND jsonb_typeof(projection->'state') = 'string' AND projection->>'state' IN ('held','settled','released')
      AND jsonb_typeof(projection->'createdAt') = 'string' AND projection->>'createdAt' ~ timestamp_pattern AND (projection->>'createdAt')::timestamptz IS NOT NULL
      AND jsonb_typeof(projection->'updatedAt') = 'string' AND projection->>'updatedAt' ~ timestamp_pattern AND (projection->>'updatedAt')::timestamptz IS NOT NULL), false);
  END IF;

  IF resource_kind = 'quota_wait' AND projection_kind = 'quota_wait_summary' THEN
    exact_keys := ARRAY['schema','id','runId','transitionKey','boundary','subject','claims','reasonCode','eligibleAt','state','resumedBy','resolutionReservationIds','createdAt','resolvedAt'];
    IF NOT (projection ?& exact_keys AND (projection - exact_keys) = '{}'::jsonb)
      OR jsonb_typeof(projection->'subject') IS DISTINCT FROM 'object'
      OR NOT ((projection->'subject') ?& ARRAY['kind','id'])
      OR ((projection->'subject') - ARRAY['kind','id']) <> '{}'::jsonb
      OR jsonb_typeof(projection->'claims') IS DISTINCT FROM 'array'
      OR jsonb_typeof(projection->'resolutionReservationIds') IS DISTINCT FROM 'array'
    THEN
      RETURN false;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(projection->'claims') AS claim
      WHERE jsonb_typeof(claim) IS DISTINCT FROM 'object'
        OR NOT (claim ?& ARRAY['dimension','unit','amount'])
        OR (claim - ARRAY['dimension','unit','amount']) <> '{}'::jsonb
        OR jsonb_typeof(claim->'dimension') IS DISTINCT FROM 'string'
        OR claim->>'dimension' !~ '^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$'
        OR jsonb_typeof(claim->'unit') IS DISTINCT FROM 'string'
        OR claim->>'unit' NOT IN ('count','byte','millisecond','megapixel')
        OR jsonb_typeof(claim->'amount') IS DISTINCT FROM 'string'
        OR length(claim->>'amount') > 81
        OR claim->>'amount' !~ decimal_pattern
    ) THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(projection->'resolutionReservationIds') AS item
      WHERE jsonb_typeof(item) IS DISTINCT FROM 'string' OR (item #>> '{}') !~ identity_pattern
    ) THEN RETURN false; END IF;
    RETURN coalesce((projection->>'schema' = 'support-quota-wait-summary/v1'
      AND jsonb_typeof(projection->'runId') = 'string' AND projection->>'runId' ~ identity_pattern
      AND jsonb_typeof(projection->'transitionKey') = 'string' AND projection->>'transitionKey' ~ identity_pattern
      AND jsonb_typeof(projection->'boundary') = 'string' AND projection->>'boundary' IN ('run_admission','run_concurrency','provider_effect','artifact_storage','usage_settlement')
      AND jsonb_typeof(projection->'subject'->'kind') = 'string' AND projection->'subject'->>'kind' IN ('run','step_attempt','artifact','usage_settlement')
      AND jsonb_typeof(projection->'subject'->'id') = 'string' AND projection->'subject'->>'id' ~ identity_pattern
      AND jsonb_typeof(projection->'reasonCode') = 'string' AND projection->>'reasonCode' = 'QUOTA_RENEWABLE_CAPACITY_EXHAUSTED'
      AND (jsonb_typeof(projection->'eligibleAt') = 'null' OR (jsonb_typeof(projection->'eligibleAt') = 'string' AND projection->>'eligibleAt' ~ timestamp_pattern AND (projection->>'eligibleAt')::timestamptz IS NOT NULL))
      AND projection->>'state' IN ('waiting','resumed','cancelled')
      AND (
        jsonb_typeof(projection->'resumedBy') = 'null'
        OR (
          jsonb_typeof(projection->'resumedBy') = 'object'
          AND projection->'resumedBy' ?& ARRAY['kind']
          AND (projection->'resumedBy' - ARRAY['kind']) = '{}'::jsonb
          AND jsonb_typeof(projection->'resumedBy'->'kind') = 'string'
          AND projection->'resumedBy'->>'kind' IN ('human','principal','system')
        )
      )
      AND jsonb_typeof(projection->'createdAt') = 'string' AND projection->>'createdAt' ~ timestamp_pattern AND (projection->>'createdAt')::timestamptz IS NOT NULL
      AND (jsonb_typeof(projection->'resolvedAt') = 'null' OR (jsonb_typeof(projection->'resolvedAt') = 'string' AND projection->>'resolvedAt' ~ timestamp_pattern AND (projection->>'resolvedAt')::timestamptz IS NOT NULL))), false);
  END IF;

  RETURN false;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;
--> statement-breakpoint
CREATE TABLE "runtime_contract_evidence_versions" (
	"workspace_id" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"run_owner_id" text GENERATED ALWAYS AS (case when "resource_kind" = 'run' then "resource_id" else null end) STORED,
	"budget_reservation_owner_id" text GENERATED ALWAYS AS (case when "resource_kind" = 'budget_reservation' then "resource_id" else null end) STORED,
	"quota_reservation_owner_id" text GENERATED ALWAYS AS (case when "resource_kind" = 'quota_reservation' then "resource_id" else null end) STORED,
	"quota_wait_owner_id" text GENERATED ALWAYS AS (case when "resource_kind" = 'quota_wait' then "resource_id" else null end) STORED,
	"version" integer NOT NULL,
	"canonical_digest" text NOT NULL,
	"projection_kind" text NOT NULL,
	"projection" jsonb NOT NULL,
	"projection_digest" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_contract_evidence_versions_pk" PRIMARY KEY("workspace_id","resource_kind","resource_id","version"),
	CONSTRAINT "runtime_contract_evidence_versions_version_check" CHECK ("runtime_contract_evidence_versions"."version" > 0),
	CONSTRAINT "runtime_contract_evidence_versions_digest_check" CHECK ("runtime_contract_evidence_versions"."canonical_digest" ~ '^sha256:[a-f0-9]{64}$' and "runtime_contract_evidence_versions"."projection_digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "runtime_contract_evidence_versions_kind_check" CHECK ((
      ("runtime_contract_evidence_versions"."resource_kind" = 'run' and "runtime_contract_evidence_versions"."projection_kind" = 'run_summary' and "runtime_contract_evidence_versions"."projection"->>'schema' = 'support-run-summary/v1' and "runtime_contract_evidence_versions"."projection"->>'id' = "runtime_contract_evidence_versions"."resource_id") or
      ("runtime_contract_evidence_versions"."resource_kind" = 'budget_reservation' and "runtime_contract_evidence_versions"."projection_kind" = 'budget_summary' and "runtime_contract_evidence_versions"."projection"->>'schema' = 'support-budget-summary/v1' and "runtime_contract_evidence_versions"."projection"->>'id' = "runtime_contract_evidence_versions"."resource_id") or
      ("runtime_contract_evidence_versions"."resource_kind" = 'quota_reservation' and "runtime_contract_evidence_versions"."projection_kind" = 'quota_reservation_summary' and "runtime_contract_evidence_versions"."projection"->>'schema' = 'support-quota-reservation-summary/v1' and "runtime_contract_evidence_versions"."projection"->>'id' = "runtime_contract_evidence_versions"."resource_id") or
      ("runtime_contract_evidence_versions"."resource_kind" = 'quota_wait' and "runtime_contract_evidence_versions"."projection_kind" = 'quota_wait_summary' and "runtime_contract_evidence_versions"."projection"->>'schema' = 'support-quota-wait-summary/v1' and "runtime_contract_evidence_versions"."projection"->>'id' = "runtime_contract_evidence_versions"."resource_id")
    )),
	CONSTRAINT "runtime_contract_evidence_versions_owner_check" CHECK (
      num_nonnulls("run_owner_id", "budget_reservation_owner_id", "quota_reservation_owner_id", "quota_wait_owner_id") = 1
      and (
        ("resource_kind" = 'run' and "run_owner_id" = "resource_id") or
        ("resource_kind" = 'budget_reservation' and "budget_reservation_owner_id" = "resource_id") or
        ("resource_kind" = 'quota_reservation' and "quota_reservation_owner_id" = "resource_id") or
        ("resource_kind" = 'quota_wait' and "quota_wait_owner_id" = "resource_id")
      )
    ),
	CONSTRAINT "runtime_contract_evidence_versions_projection_check" CHECK (runtime_contract_evidence_projection_is_valid("resource_kind", "resource_id", "projection_kind", "projection"))
);
--> statement-breakpoint
CREATE TABLE "runtime_contract_evidence_backfill_quarantine" (
	"workspace_id" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_reference_digest" text NOT NULL,
	"canonical_owner_digest" text NOT NULL,
	"reason_code" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_contract_evidence_backfill_quarantine_pk" PRIMARY KEY("workspace_id","resource_kind","resource_reference_digest"),
	CONSTRAINT "runtime_contract_evidence_backfill_quarantine_kind_check" CHECK ("resource_kind" in ('run','budget_reservation','quota_reservation','quota_wait')),
	CONSTRAINT "runtime_contract_evidence_backfill_quarantine_digest_check" CHECK ("resource_reference_digest" ~ '^sha256:[a-f0-9]{64}$' and "canonical_owner_digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "runtime_contract_evidence_backfill_quarantine_reason_check" CHECK ("reason_code" = 'LEGACY_PROJECTION_INVALID')
);
--> statement-breakpoint
CREATE TABLE "runtime_diagnostic_trace_access_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"operator_trace_ref" text NOT NULL,
	"operator_id" text NOT NULL,
	"outcome" text NOT NULL,
	"audit" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_diagnostic_trace_access_audits_outcome_check" CHECK ("runtime_diagnostic_trace_access_audits"."outcome" in ('granted','denied','not_found'))
);
--> statement-breakpoint
CREATE TABLE "runtime_diagnostic_traces" (
	"operator_trace_ref" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"trace" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_diagnostic_traces_ref_check" CHECK ("runtime_diagnostic_traces"."operator_trace_ref" ~ '^otr_[a-f0-9]{32}$'),
	CONSTRAINT "runtime_diagnostic_traces_leakage_check" CHECK (jsonb_typeof("trace") = 'object' and "trace" ?& array['schema','operatorTraceRef','workspaceId','category','severity','code','stage','outcome','providerFamily','httpStatus','retryable','durationMs','attempt','createdAt','expiresAt'] and ("trace" - array['schema','operatorTraceRef','workspaceId','category','severity','code','stage','outcome','providerFamily','httpStatus','retryable','durationMs','attempt','createdAt','expiresAt']) = '{}'::jsonb and "trace"->>'schema' = 'diagnostic-trace/v1' and "trace"->>'operatorTraceRef' = "operator_trace_ref" and "trace"->>'workspaceId' = "workspace_id" and "trace"->>'category' in ('authorization','provider','persistence','quota','budget','artifact','runtime') and "trace"->>'severity' in ('info','warning','error') and "trace"->>'stage' in ('admission','planning','execution','settlement','reconciliation','storage') and "trace"->>'outcome' in ('succeeded','failed','unknown','denied','waiting') and "trace"->>'providerFamily' in ('google','openai','kie','internal','unknown') and "trace"->>'code' ~ '^[A-Z][A-Z0-9_]{0,79}$' and case when jsonb_typeof("trace"->'httpStatus') = 'number' then ("trace"->>'httpStatus')::integer between 100 and 599 else jsonb_typeof("trace"->'httpStatus') = 'null' end and jsonb_typeof("trace"->'retryable') in ('boolean','null') and case when jsonb_typeof("trace"->'durationMs') = 'number' then ("trace"->>'durationMs')::bigint >= 0 else jsonb_typeof("trace"->'durationMs') = 'null' end and case when jsonb_typeof("trace"->'attempt') = 'number' then ("trace"->>'attempt')::integer >= 1 else jsonb_typeof("trace"->'attempt') = 'null' end and jsonb_typeof("trace"->'createdAt') = 'string' and ("trace"->>'createdAt')::timestamptz = "created_at" and jsonb_typeof("trace"->'expiresAt') = 'string' and ("trace"->>'expiresAt')::timestamptz = "expires_at")
);
--> statement-breakpoint
CREATE TABLE "runtime_observability_admin_receipts" (
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_observability_admin_receipts_pk" PRIMARY KEY("workspace_id","idempotency_key"),
	CONSTRAINT "runtime_observability_admin_receipts_digest_check" CHECK ("runtime_observability_admin_receipts"."request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_observability_retention_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"current_revision_id" text NOT NULL,
	"status" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_observability_retention_policies_workspace_id_unique" UNIQUE("workspace_id"),
	CONSTRAINT "runtime_observability_retention_policies_state_check" CHECK ("runtime_observability_retention_policies"."status" in ('active','expired'))
);
--> statement-breakpoint
CREATE TABLE "runtime_observability_retention_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"revision" integer NOT NULL,
	"metric_ttl_seconds" integer NOT NULL,
	"trace_ttl_seconds" integer NOT NULL,
	"support_bundle_ttl_seconds" integer NOT NULL,
	"revision_record" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_observability_retention_revisions_ttl_check" CHECK ("runtime_observability_retention_revisions"."metric_ttl_seconds" between 60 and 31536000 and "runtime_observability_retention_revisions"."trace_ttl_seconds" between 60 and 2592000 and "runtime_observability_retention_revisions"."support_bundle_ttl_seconds" between 60 and 604800)
);
--> statement-breakpoint
CREATE TABLE "runtime_operational_metric_delta_receipts" (
	"workspace_id" text NOT NULL,
	"event_id" text NOT NULL,
	"request_digest" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_operational_metric_delta_receipts_pk" PRIMARY KEY("workspace_id","event_id"),
	CONSTRAINT "runtime_operational_metric_delta_receipts_digest_check" CHECK ("runtime_operational_metric_delta_receipts"."request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_operational_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"metric" jsonb NOT NULL,
	"window_starts_at" timestamp with time zone NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_operational_metrics_name_check" CHECK ("runtime_operational_metrics"."name" in ('runtime.run.count','runtime.provider.effect.count','runtime.quota.decision.count','runtime.artifact.bytes','runtime.queue.wait_ms')),
	CONSTRAINT "runtime_operational_metrics_leakage_check" CHECK ("runtime_operational_metrics"."metric"::text !~* '(prompt|content|secret|token|password|ciphertext|signed[_-]?url|authorization|headers?|provider[_-]?body|resourceId|runId|artifactId|principalId)')
);
--> statement-breakpoint
CREATE TABLE "runtime_support_bundle_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"bundle_id" text NOT NULL,
	"event_type" text NOT NULL,
	"audit" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_support_bundle_audit_events_event_check" CHECK ("event_type" in ('bundle.stored','bundle.expired','bundle.revoked'))
);
--> statement-breakpoint
CREATE TABLE "runtime_support_bundle_access_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"bundle_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"outcome" text NOT NULL,
	"audit" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_support_bundle_access_audits_outcome_check" CHECK ("outcome" in ('granted','denied','not_found'))
);
--> statement-breakpoint
CREATE TABLE "runtime_support_bundle_receipts" (
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"bundle_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_support_bundle_receipts_pk" PRIMARY KEY("workspace_id","idempotency_key"),
	CONSTRAINT "runtime_support_bundle_receipts_digest_check" CHECK ("runtime_support_bundle_receipts"."request_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_support_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"state" text NOT NULL,
	"bundle" jsonb NOT NULL,
	"storage_key" text,
	"content_digest" text,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"stored_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_support_bundles_state_check" CHECK ("runtime_support_bundles"."state" in ('stored','expired','revoked')),
	CONSTRAINT "runtime_support_bundles_digest_check" CHECK ("runtime_support_bundles"."content_digest" is null or "runtime_support_bundles"."content_digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "runtime_support_bundles_size_check" CHECK ("runtime_support_bundles"."size_bytes" between 1 and 10000000)
);
--> statement-breakpoint
CREATE TABLE "runtime_support_bundle_bind_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"state" text NOT NULL,
	"selections" jsonb NOT NULL,
	"consent" jsonb NOT NULL,
	"content_digest" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"payload_json" text,
	"bundle_id" text,
	"consent_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_support_bundle_bind_intents_digest_check" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$' and "content_digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "runtime_support_bundle_bind_intents_size_check" CHECK ("size_bytes" between 1 and 10000000 and ("payload_json" is null or octet_length("payload_json") between 1 and 10000000)),
	CONSTRAINT "runtime_support_bundle_bind_intents_state_check" CHECK (("state" = 'pending' and "payload_json" is not null and "bundle_id" is null) or ("state" in ('bound','cleanup') and "payload_json" is null and "bundle_id" is not null) or ("state" = 'abandoned' and "payload_json" is null and "bundle_id" is null))
);
--> statement-breakpoint
CREATE TABLE "runtime_telemetry_operator_grant_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"event_type" text NOT NULL,
	"audit" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_telemetry_operator_grant_audits_event_check" CHECK ("runtime_telemetry_operator_grant_audits"."event_type" in ('grant.issued','grant.revoked','grant.expired'))
);
--> statement-breakpoint
CREATE TABLE "runtime_telemetry_operator_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"status" text NOT NULL,
	"grant" jsonb NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "runtime_telemetry_operator_grants_state_check" CHECK ("runtime_telemetry_operator_grants"."status" in ('active','revoked','expired'))
);
--> statement-breakpoint
ALTER TABLE "runtime_observability_retention_policies" ADD CONSTRAINT "runtime_observability_retention_policies_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_contract_evidence_versions" ADD CONSTRAINT "runtime_contract_evidence_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_contract_evidence_backfill_quarantine" ADD CONSTRAINT "runtime_contract_evidence_backfill_quarantine_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_contract_evidence_versions" ADD CONSTRAINT "runtime_contract_evidence_versions_run_owner_fk" FOREIGN KEY ("workspace_id","run_owner_id") REFERENCES "public"."workflow_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_contract_evidence_versions" ADD CONSTRAINT "runtime_contract_evidence_versions_budget_reservation_owner_fk" FOREIGN KEY ("workspace_id","budget_reservation_owner_id") REFERENCES "public"."runtime_budget_reservations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_contract_evidence_versions" ADD CONSTRAINT "runtime_contract_evidence_versions_quota_reservation_owner_fk" FOREIGN KEY ("workspace_id","quota_reservation_owner_id") REFERENCES "public"."runtime_quota_reservations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_contract_evidence_versions" ADD CONSTRAINT "runtime_contract_evidence_versions_quota_wait_owner_fk" FOREIGN KEY ("workspace_id","quota_wait_owner_id") REFERENCES "public"."runtime_quota_waits"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_observability_retention_revisions" ADD CONSTRAINT "runtime_observability_retention_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_observability_admin_receipts" ADD CONSTRAINT "runtime_observability_admin_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_operational_metrics" ADD CONSTRAINT "runtime_operational_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_operational_metric_delta_receipts" ADD CONSTRAINT "runtime_operational_metric_delta_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_diagnostic_traces" ADD CONSTRAINT "runtime_diagnostic_traces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_diagnostic_trace_access_audits" ADD CONSTRAINT "runtime_diagnostic_trace_access_audits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_telemetry_operator_grants" ADD CONSTRAINT "runtime_telemetry_operator_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_telemetry_operator_grant_audits" ADD CONSTRAINT "runtime_telemetry_operator_grant_audits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_support_bundles" ADD CONSTRAINT "runtime_support_bundles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_support_bundle_bind_intents" ADD CONSTRAINT "runtime_support_bundle_bind_intents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_support_bundle_audit_events" ADD CONSTRAINT "runtime_support_bundle_audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_support_bundle_access_audits" ADD CONSTRAINT "runtime_support_bundle_access_audits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_support_bundle_receipts" ADD CONSTRAINT "runtime_support_bundle_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_observability_retention_revisions" ADD CONSTRAINT "runtime_observability_retention_revisions_policy_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."runtime_observability_retention_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_operational_metric_delta_receipts" ADD CONSTRAINT "runtime_operational_metric_delta_receipts_aggregate_fk" FOREIGN KEY ("aggregate_id") REFERENCES "public"."runtime_operational_metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_support_bundle_audit_events" ADD CONSTRAINT "runtime_support_bundle_audit_events_bundle_fk" FOREIGN KEY ("workspace_id","bundle_id") REFERENCES "public"."runtime_support_bundles"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_support_bundle_bind_intents" ADD CONSTRAINT "runtime_support_bundle_bind_intents_bundle_fk" FOREIGN KEY ("workspace_id","bundle_id") REFERENCES "public"."runtime_support_bundles"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_telemetry_operator_grant_audits" ADD CONSTRAINT "runtime_telemetry_operator_grant_audits_grant_fk" FOREIGN KEY ("workspace_id","grant_id") REFERENCES "public"."runtime_telemetry_operator_grants"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_diagnostic_trace_access_audits_occurred_idx" ON "runtime_diagnostic_trace_access_audits" USING btree ("workspace_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "runtime_contract_evidence_versions_latest_idx" ON "runtime_contract_evidence_versions" USING btree ("workspace_id","resource_kind","resource_id","version");--> statement-breakpoint
CREATE INDEX "runtime_diagnostic_traces_expiry_idx" ON "runtime_diagnostic_traces" USING btree ("expires_at","operator_trace_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_observability_retention_revisions_policy_revision_unique" ON "runtime_observability_retention_revisions" USING btree ("workspace_id","policy_id","revision");--> statement-breakpoint
CREATE INDEX "runtime_operational_metrics_expiry_idx" ON "runtime_operational_metrics" USING btree ("expires_at","id");--> statement-breakpoint
CREATE INDEX "runtime_support_bundle_audit_events_occurred_idx" ON "runtime_support_bundle_audit_events" USING btree ("workspace_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "runtime_support_bundle_access_audits_occurred_idx" ON "runtime_support_bundle_access_audits" USING btree ("workspace_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_support_bundles_workspace_id_unique" ON "runtime_support_bundles" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "runtime_support_bundles_expiry_idx" ON "runtime_support_bundles" USING btree ("expires_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_support_bundle_bind_intents_workspace_key_unique" ON "runtime_support_bundle_bind_intents" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "runtime_support_bundle_bind_intents_pending_idx" ON "runtime_support_bundle_bind_intents" USING btree ("state","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_telemetry_operator_grants_workspace_id_unique" ON "runtime_telemetry_operator_grants" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "runtime_telemetry_operator_grants_active_idx" ON "runtime_telemetry_operator_grants" USING btree ("workspace_id","operator_id","status","expires_at");
--> statement-breakpoint
-- Historical mutable owners predate Contract Evidence producers. Projection digests
-- use the application-compatible canonical JSON serializer. Canonical source digests
-- use the persisted owner JSON for budget/quota records and a documented legacy
-- DB-row representation for Runs, because no application source snapshot was stored.
WITH source AS (
  SELECT
    run.workspace_id,
    run.id AS resource_id,
    run.updated_at AS created_at,
    to_jsonb(run) AS canonical_source,
    jsonb_build_object(
      'schema', 'support-run-summary/v1',
      'id', run.id,
      'workflowId', run.workflow_id,
      'workflowRevisionId', run.workflow_revision_id,
      'state', run.state,
      'startSnapshotDigest', run.start_snapshot_digest,
      'finalSnapshotDigest', run.final_snapshot_digest,
      'sourceRunId', coalesce(run.source_run_id, run.derivation->>'sourceRunId'),
      'rootRunId', coalesce(run.root_run_id, run.derivation->>'rootRunId'),
      'derivationDepth', run.derivation_depth,
      'resumeAt', CASE WHEN run.resume_at IS NULL THEN NULL ELSE to_char(run.resume_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'failureCode', CASE WHEN run.failure_code IS NULL OR run.failure_code ~ '^[A-Z][A-Z0-9_]{0,79}$' THEN run.failure_code ELSE 'RUN_FAILURE_UNKNOWN' END,
      'acceptedAt', to_char(run.accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'startedAt', CASE WHEN run.started_at IS NULL THEN NULL ELSE to_char(run.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'completedAt', CASE WHEN run.completed_at IS NULL THEN NULL ELSE to_char(run.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'updatedAt', to_char(run.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) AS projection
  FROM workflow_runs AS run
), prepared AS (
  SELECT source.*,
    'sha256:' || encode(sha256(convert_to(runtime_contract_evidence_canonical_json(source.canonical_source), 'UTF8')), 'hex') AS canonical_digest,
    'sha256:' || encode(sha256(convert_to(runtime_contract_evidence_canonical_json(source.projection), 'UTF8')), 'hex') AS projection_digest,
    runtime_contract_evidence_resource_reference_digest(source.workspace_id, 'run', source.resource_id) AS resource_reference_digest
  FROM source
), evidence_insert AS (
  INSERT INTO runtime_contract_evidence_versions (
    workspace_id, resource_kind, resource_id, version, canonical_digest,
    projection_kind, projection, projection_digest, created_at
  )
  SELECT
    workspace_id, 'run', resource_id, 1, canonical_digest,
    'run_summary', projection, projection_digest, created_at
  FROM prepared
  WHERE runtime_contract_evidence_projection_is_valid('run', resource_id, 'run_summary', projection)
  RETURNING workspace_id
)
INSERT INTO runtime_contract_evidence_backfill_quarantine (
  workspace_id, resource_kind, resource_reference_digest,
  canonical_owner_digest, reason_code, recorded_at
)
SELECT
  workspace_id, 'run', resource_reference_digest,
  canonical_digest, 'LEGACY_PROJECTION_INVALID', created_at
FROM prepared
WHERE NOT runtime_contract_evidence_projection_is_valid('run', resource_id, 'run_summary', projection);
--> statement-breakpoint
WITH source AS (
  SELECT
    reservation.workspace_id,
    reservation.id AS resource_id,
    reservation.updated_at AS created_at,
    reservation.reservation AS canonical_source,
    jsonb_build_object(
      'schema', 'support-budget-summary/v1',
      'id', reservation.id,
      'runId', reservation.run_id,
      'policyId', reservation.policy_id,
      'policyRevisionId', reservation.policy_revision_id,
      'scope', reservation.scope,
      'period', jsonb_build_object(
        'kind', period.kind,
        'timezone', period.timezone,
        'startsAt', to_char(period.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'endsAt', CASE WHEN period.ends_at IS NULL THEN NULL ELSE to_char(period.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
      ),
      'currency', reservation.currency,
      'reservedAmount', reservation.reserved_amount,
      'heldAmount', reservation.held_amount,
      'settledAmount', reservation.settled_amount,
      'releasedAmount', reservation.released_amount,
      'state', reservation.state,
      'pricingSnapshotIds', coalesce((
        SELECT jsonb_agg(item.value ORDER BY item.ordinality)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(reservation.pricing_snapshot_ids) = 'array' THEN reservation.pricing_snapshot_ids ELSE '[]'::jsonb END)
          WITH ORDINALITY AS item(value, ordinality)
        WHERE item.ordinality <= 64
          AND jsonb_typeof(item.value) = 'string'
          AND (item.value #>> '{}') ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$'
      ), '[]'::jsonb),
      'createdAt', to_char(reservation.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(reservation.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) AS projection
  FROM runtime_budget_reservations AS reservation
  INNER JOIN runtime_budget_periods AS period
    ON period.workspace_id = reservation.workspace_id AND period.id = reservation.period_id
), prepared AS (
  SELECT source.*,
    'sha256:' || encode(sha256(convert_to(runtime_contract_evidence_canonical_json(source.canonical_source), 'UTF8')), 'hex') AS canonical_digest,
    'sha256:' || encode(sha256(convert_to(runtime_contract_evidence_canonical_json(source.projection), 'UTF8')), 'hex') AS projection_digest,
    runtime_contract_evidence_resource_reference_digest(source.workspace_id, 'budget_reservation', source.resource_id) AS resource_reference_digest
  FROM source
), evidence_insert AS (
  INSERT INTO runtime_contract_evidence_versions (
    workspace_id, resource_kind, resource_id, version, canonical_digest,
    projection_kind, projection, projection_digest, created_at
  )
  SELECT
    workspace_id, 'budget_reservation', resource_id, 1, canonical_digest,
    'budget_summary', projection, projection_digest, created_at
  FROM prepared
  WHERE runtime_contract_evidence_projection_is_valid('budget_reservation', resource_id, 'budget_summary', projection)
  RETURNING workspace_id
)
INSERT INTO runtime_contract_evidence_backfill_quarantine (
  workspace_id, resource_kind, resource_reference_digest,
  canonical_owner_digest, reason_code, recorded_at
)
SELECT
  workspace_id, 'budget_reservation', resource_reference_digest,
  canonical_digest, 'LEGACY_PROJECTION_INVALID', created_at
FROM prepared
WHERE NOT runtime_contract_evidence_projection_is_valid('budget_reservation', resource_id, 'budget_summary', projection);
--> statement-breakpoint
WITH source AS (
  SELECT
    reservation.workspace_id,
    reservation.id AS resource_id,
    reservation.updated_at AS created_at,
    reservation.reservation AS canonical_source,
    jsonb_build_object(
      'schema', 'support-quota-reservation-summary/v1',
      'id', reservation.id,
      'runId', reservation.run_id,
      'transitionKey', reservation.transition_key,
      'boundary', reservation.boundary,
      'subject', jsonb_build_object('kind', reservation.subject_kind, 'id', reservation.subject_id),
      'policyId', reservation.policy_id,
      'policyRevisionId', reservation.policy_revision_id,
      'scope', reservation.scope,
      'kind', reservation.kind,
      'dimension', reservation.dimension,
      'unit', reservation.unit,
      'window', jsonb_build_object(
        'kind', window.kind,
        'timezone', window.timezone,
        'startsAt', to_char(window.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'endsAt', CASE WHEN window.ends_at IS NULL THEN NULL ELSE to_char(window.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
      ),
      'reservationRule', reservation.reservation_rule,
      'reservedAmount', reservation.reserved_amount,
      'heldAmount', reservation.held_amount,
      'settledAmount', reservation.settled_amount,
      'releasedAmount', reservation.released_amount,
      'overageAmount', reservation.overage_amount,
      'state', reservation.state,
      'createdAt', to_char(reservation.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(reservation.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) AS projection
  FROM runtime_quota_reservations AS reservation
  INNER JOIN runtime_quota_windows AS window
    ON window.workspace_id = reservation.workspace_id AND window.id = reservation.window_id
), prepared AS (
  SELECT source.*,
    'sha256:' || encode(sha256(convert_to(runtime_contract_evidence_canonical_json(source.canonical_source), 'UTF8')), 'hex') AS canonical_digest,
    'sha256:' || encode(sha256(convert_to(runtime_contract_evidence_canonical_json(source.projection), 'UTF8')), 'hex') AS projection_digest,
    runtime_contract_evidence_resource_reference_digest(source.workspace_id, 'quota_reservation', source.resource_id) AS resource_reference_digest
  FROM source
), evidence_insert AS (
  INSERT INTO runtime_contract_evidence_versions (
    workspace_id, resource_kind, resource_id, version, canonical_digest,
    projection_kind, projection, projection_digest, created_at
  )
  SELECT
    workspace_id, 'quota_reservation', resource_id, 1, canonical_digest,
    'quota_reservation_summary', projection, projection_digest, created_at
  FROM prepared
  WHERE runtime_contract_evidence_projection_is_valid('quota_reservation', resource_id, 'quota_reservation_summary', projection)
  RETURNING workspace_id
)
INSERT INTO runtime_contract_evidence_backfill_quarantine (
  workspace_id, resource_kind, resource_reference_digest,
  canonical_owner_digest, reason_code, recorded_at
)
SELECT
  workspace_id, 'quota_reservation', resource_reference_digest,
  canonical_digest, 'LEGACY_PROJECTION_INVALID', created_at
FROM prepared
WHERE NOT runtime_contract_evidence_projection_is_valid('quota_reservation', resource_id, 'quota_reservation_summary', projection);
--> statement-breakpoint
WITH source AS (
  SELECT
    wait.workspace_id,
    wait.id AS resource_id,
    coalesce(wait.resolved_at, wait.created_at) AS created_at,
    wait.wait AS canonical_source,
    jsonb_build_object(
      'schema', 'support-quota-wait-summary/v1',
      'id', wait.id,
      'runId', wait.run_id,
      'transitionKey', wait.transition_key,
      'boundary', CASE WHEN wait.wait->>'boundary' IN ('run_admission','run_concurrency','provider_effect','artifact_storage','usage_settlement') THEN wait.wait->>'boundary' ELSE 'run_admission' END,
      'subject', CASE
        WHEN jsonb_typeof(wait.wait->'subject') = 'object'
          AND wait.wait->'subject'->>'kind' IN ('run','step_attempt','artifact','usage_settlement')
          AND jsonb_typeof(wait.wait->'subject'->'id') = 'string'
          AND wait.wait->'subject'->>'id' ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$'
        THEN jsonb_build_object('kind', wait.wait->'subject'->>'kind', 'id', wait.wait->'subject'->>'id')
        ELSE jsonb_build_object('kind', 'run', 'id', wait.run_id)
      END,
      'claims', CASE WHEN jsonb_typeof(wait.wait->'claims') = 'array' THEN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'dimension', claim.value->>'dimension',
          'unit', claim.value->>'unit',
          'amount', claim.value->>'amount'
        ) ORDER BY claim.ordinality)
        FROM jsonb_array_elements(wait.wait->'claims') WITH ORDINALITY AS claim(value, ordinality)
        WHERE claim.ordinality <= 64
          AND jsonb_typeof(claim.value) = 'object'
          AND jsonb_typeof(claim.value->'dimension') = 'string'
          AND claim.value->>'dimension' ~ '^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$'
          AND claim.value->>'unit' IN ('count','byte','millisecond','megapixel')
          AND jsonb_typeof(claim.value->'amount') = 'string'
          AND length(claim.value->>'amount') <= 81
          AND claim.value->>'amount' ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      ), '[]'::jsonb) ELSE '[]'::jsonb END,
      'reasonCode', 'QUOTA_RENEWABLE_CAPACITY_EXHAUSTED',
      'eligibleAt', CASE WHEN wait.eligible_at IS NULL THEN NULL ELSE to_char(wait.eligible_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'state', wait.state,
      'resumedBy', CASE
        WHEN jsonb_typeof(wait.wait->'resumedBy') = 'object' AND wait.wait->'resumedBy'->>'kind' IN ('human','principal','system')
        THEN jsonb_build_object('kind', wait.wait->'resumedBy'->>'kind')
        ELSE NULL
      END,
      'resolutionReservationIds', CASE WHEN jsonb_typeof(wait.wait->'resolutionReservationIds') = 'array' THEN coalesce((
        SELECT jsonb_agg(item.value ORDER BY item.ordinality)
        FROM jsonb_array_elements(wait.wait->'resolutionReservationIds') WITH ORDINALITY AS item(value, ordinality)
        WHERE item.ordinality <= 64
          AND jsonb_typeof(item.value) = 'string'
          AND (item.value #>> '{}') ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$'
      ), '[]'::jsonb) ELSE '[]'::jsonb END,
      'createdAt', to_char(wait.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'resolvedAt', CASE WHEN wait.resolved_at IS NULL THEN NULL ELSE to_char(wait.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
    ) AS projection
  FROM runtime_quota_waits AS wait
), prepared AS (
  SELECT source.*,
    'sha256:' || encode(sha256(convert_to(runtime_contract_evidence_canonical_json(source.canonical_source), 'UTF8')), 'hex') AS canonical_digest,
    'sha256:' || encode(sha256(convert_to(runtime_contract_evidence_canonical_json(source.projection), 'UTF8')), 'hex') AS projection_digest,
    runtime_contract_evidence_resource_reference_digest(source.workspace_id, 'quota_wait', source.resource_id) AS resource_reference_digest
  FROM source
), evidence_insert AS (
  INSERT INTO runtime_contract_evidence_versions (
    workspace_id, resource_kind, resource_id, version, canonical_digest,
    projection_kind, projection, projection_digest, created_at
  )
  SELECT
    workspace_id, 'quota_wait', resource_id, 1, canonical_digest,
    'quota_wait_summary', projection, projection_digest, created_at
  FROM prepared
  WHERE runtime_contract_evidence_projection_is_valid('quota_wait', resource_id, 'quota_wait_summary', projection)
  RETURNING workspace_id
)
INSERT INTO runtime_contract_evidence_backfill_quarantine (
  workspace_id, resource_kind, resource_reference_digest,
  canonical_owner_digest, reason_code, recorded_at
)
SELECT
  workspace_id, 'quota_wait', resource_reference_digest,
  canonical_digest, 'LEGACY_PROJECTION_INVALID', created_at
FROM prepared
WHERE NOT runtime_contract_evidence_projection_is_valid('quota_wait', resource_id, 'quota_wait_summary', projection);
--> statement-breakpoint
CREATE FUNCTION runtime_observability_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'runtime observability evidence is append-only' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION runtime_contract_evidence_versions_append_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner_exists boolean := true;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    CASE OLD.resource_kind
      WHEN 'run' THEN
        SELECT EXISTS (
          SELECT 1 FROM workflow_runs
          WHERE workspace_id = OLD.workspace_id AND id = OLD.run_owner_id
        ) INTO owner_exists;
      WHEN 'budget_reservation' THEN
        SELECT EXISTS (
          SELECT 1 FROM runtime_budget_reservations
          WHERE workspace_id = OLD.workspace_id AND id = OLD.budget_reservation_owner_id
        ) INTO owner_exists;
      WHEN 'quota_reservation' THEN
        SELECT EXISTS (
          SELECT 1 FROM runtime_quota_reservations
          WHERE workspace_id = OLD.workspace_id AND id = OLD.quota_reservation_owner_id
        ) INTO owner_exists;
      WHEN 'quota_wait' THEN
        SELECT EXISTS (
          SELECT 1 FROM runtime_quota_waits
          WHERE workspace_id = OLD.workspace_id AND id = OLD.quota_wait_owner_id
        ) INTO owner_exists;
      ELSE
        owner_exists := true;
    END CASE;
    IF NOT owner_exists THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'runtime Contract Evidence is append-only' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER runtime_observability_retention_revisions_append_only BEFORE UPDATE OR DELETE ON runtime_observability_retention_revisions FOR EACH ROW EXECUTE FUNCTION runtime_observability_reject_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_contract_evidence_versions_append_only BEFORE UPDATE OR DELETE ON runtime_contract_evidence_versions FOR EACH ROW EXECUTE FUNCTION runtime_contract_evidence_versions_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER runtime_contract_evidence_backfill_quarantine_append_only BEFORE UPDATE OR DELETE ON runtime_contract_evidence_backfill_quarantine FOR EACH ROW EXECUTE FUNCTION runtime_observability_reject_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_observability_admin_receipts_append_only BEFORE UPDATE OR DELETE ON runtime_observability_admin_receipts FOR EACH ROW EXECUTE FUNCTION runtime_observability_reject_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_diagnostic_trace_access_audits_append_only BEFORE UPDATE OR DELETE ON runtime_diagnostic_trace_access_audits FOR EACH ROW EXECUTE FUNCTION runtime_observability_reject_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_telemetry_operator_grant_audits_append_only BEFORE UPDATE OR DELETE ON runtime_telemetry_operator_grant_audits FOR EACH ROW EXECUTE FUNCTION runtime_observability_reject_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_support_bundle_audit_events_append_only BEFORE UPDATE OR DELETE ON runtime_support_bundle_audit_events FOR EACH ROW EXECUTE FUNCTION runtime_observability_reject_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_support_bundle_access_audits_append_only BEFORE UPDATE OR DELETE ON runtime_support_bundle_access_audits FOR EACH ROW EXECUTE FUNCTION runtime_observability_reject_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER runtime_support_bundle_receipts_append_only BEFORE UPDATE OR DELETE ON runtime_support_bundle_receipts FOR EACH ROW EXECUTE FUNCTION runtime_observability_reject_append_only_mutation();
--> statement-breakpoint
CREATE FUNCTION runtime_support_bundle_bind_intent_transition_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NOT (
      OLD.state = 'pending' AND NEW.state in ('pending','bound','abandoned')
      OR OLD.state = 'bound' AND NEW.state = 'cleanup'
      OR OLD.state = 'cleanup' AND NEW.state = 'cleanup'
      OR OLD.state = 'abandoned' AND NEW.state = 'abandoned'
    )
    OR NOT (
      (NEW.state = 'bound' AND NEW.payload_json IS NULL AND NEW.bundle_id IS NOT NULL)
      OR (NEW.state = 'pending' AND NEW.payload_json IS NOT DISTINCT FROM OLD.payload_json AND NEW.bundle_id IS NULL)
      OR (NEW.state = 'cleanup' AND NEW.payload_json IS NULL AND NEW.bundle_id IS NOT NULL)
      OR (NEW.state = 'abandoned' AND NEW.payload_json IS NULL AND NEW.bundle_id IS NULL)
    )
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.selections IS DISTINCT FROM OLD.selections
    OR NEW.consent IS DISTINCT FROM OLD.consent
    OR NEW.content_digest IS DISTINCT FROM OLD.content_digest
    OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
    OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
    OR NEW.consent_expires_at IS DISTINCT FROM OLD.consent_expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.state in ('bound','cleanup','abandoned') AND NEW.bundle_id IS DISTINCT FROM OLD.bundle_id)
    OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'support bundle bind intent transition is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER runtime_support_bundle_bind_intents_transition_guard BEFORE UPDATE OR DELETE ON runtime_support_bundle_bind_intents FOR EACH ROW EXECUTE FUNCTION runtime_support_bundle_bind_intent_transition_guard();
