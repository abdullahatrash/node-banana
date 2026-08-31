CREATE TABLE "credential_effect_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"version_id" text NOT NULL,
	"spend_grant_id" text NOT NULL,
	"effect_ref" text NOT NULL,
	"effect_sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"failure_code" text,
	"reconciliation_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_effect_audit_events_type_check" CHECK ("credential_effect_audit_events"."event_type" in ('effect.reserved', 'effect.completed', 'effect.failed', 'effect.unknown', 'effect.reconciled', 'effect.released', 'effect.replayed')),
	CONSTRAINT "credential_effect_audit_events_sequence_check" CHECK ("credential_effect_audit_events"."effect_sequence" > 0),
	CONSTRAINT "credential_effect_audit_events_fingerprint_check" CHECK ("credential_effect_audit_events"."request_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "credential_effect_audit_events_failure_code_check" CHECK ("credential_effect_audit_events"."failure_code" is null or "credential_effect_audit_events"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,79}$')
);
--> statement-breakpoint
ALTER TABLE "credential_effect_audit_events" ADD CONSTRAINT "credential_effect_audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_effect_audit_events" ADD CONSTRAINT "credential_effect_audit_events_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_effect_audit_events" ADD CONSTRAINT "credential_effect_audit_events_workspace_profile_version_fk" FOREIGN KEY ("workspace_id","profile_id","version_id") REFERENCES "public"."credential_profile_versions"("workspace_id","profile_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_effect_audit_events" ADD CONSTRAINT "credential_effect_audit_events_workspace_grant_fk" FOREIGN KEY ("workspace_id","principal_id","profile_id","spend_grant_id") REFERENCES "public"."credential_spend_grants"("workspace_id","principal_id","profile_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
WITH spend_lifecycle_candidates AS (
	SELECT
		e."id" AS receipt_id,
		e."workspace_id",
		e."principal_id",
		e."profile_id",
		e."version_id",
		e."spend_grant_id",
		e."effect_ref",
		e."request_fingerprint",
		v.event_type,
		v.failure_code AS ledger_failure_code,
		v.reconciliation_reference AS ledger_reconciliation_reference,
		v.created_at AS ledger_created_at,
		v.ordinal,
		'spend:' || e."id" || ':' || v.event_type AS ledger_source_id
	FROM "credential_spend_events" e
	CROSS JOIN LATERAL (
		VALUES
			('effect.reserved', NULL::text, NULL::text, e."created_at", 1),
			('effect.unknown', e."failure_code", NULL::text, e."unknown_at", 2),
			('effect.reconciled', NULL::text, e."reconciliation_reference", e."reconciled_at", 3),
			(
				'effect.completed',
				NULL::text,
				NULL::text,
				CASE
					WHEN e."completed_at" IS NOT NULL AND e."reconciled_at" IS NOT NULL
						THEN e."completed_at" + interval '1 millisecond'
					ELSE e."completed_at"
				END,
				4
			),
			(
				'effect.failed',
				e."failure_code",
				NULL::text,
				CASE
					WHEN e."failed_at" IS NOT NULL AND e."reconciled_at" IS NOT NULL
						THEN e."failed_at" + interval '1 millisecond'
					ELSE e."failed_at"
				END,
				5
			),
			(
				'effect.released',
				e."failure_code",
				NULL::text,
				CASE
					WHEN e."failed_at" IS NOT NULL AND e."reconciled_at" IS NOT NULL
						THEN e."failed_at" + interval '2 milliseconds'
					WHEN e."failed_at" IS NOT NULL
						THEN e."failed_at" + interval '1 millisecond'
					ELSE NULL
				END,
				6
			)
	) AS v(event_type, failure_code, reconciliation_reference, created_at, ordinal)
	WHERE v.created_at IS NOT NULL
),
legacy_replay_candidates AS (
	SELECT
		e."id" AS receipt_id,
		e."workspace_id",
		e."principal_id",
		e."profile_id",
		e."version_id",
		e."spend_grant_id",
		e."effect_ref",
		e."request_fingerprint",
		'effect.replayed'::text AS event_type,
		NULL::text AS ledger_failure_code,
		NULL::text AS ledger_reconciliation_reference,
		legacy."created_at" AS ledger_created_at,
		7 AS ordinal,
		'legacy-replay:' || legacy."id" AS ledger_source_id
	FROM "credential_security_events" legacy
	INNER JOIN "credential_spend_events" e
		ON e."workspace_id" = legacy."workspace_id"
		AND e."effect_ref" = legacy."effect_ref"
	WHERE legacy."event_type" = 'effect.replayed'
),
lifecycle_candidates AS (
	SELECT * FROM spend_lifecycle_candidates
	UNION ALL
	SELECT * FROM legacy_replay_candidates
),
sequenced AS (
	SELECT
		*,
		row_number() OVER (
			PARTITION BY "workspace_id", "effect_ref"
			ORDER BY "ledger_created_at", "ordinal", "ledger_source_id"
		)::integer AS effect_sequence
	FROM lifecycle_candidates
)
INSERT INTO "credential_effect_audit_events" (
	"id",
	"workspace_id",
	"principal_id",
	"profile_id",
	"version_id",
	"spend_grant_id",
	"effect_ref",
	"effect_sequence",
	"event_type",
	"request_fingerprint",
	"failure_code",
	"reconciliation_reference",
	"created_at"
)
SELECT
	'backfill_' || md5("ledger_source_id" || ':' || "effect_sequence"::text),
	"workspace_id",
	"principal_id",
	"profile_id",
	"version_id",
	"spend_grant_id",
	"effect_ref",
	"effect_sequence",
	"event_type",
	"request_fingerprint",
	"ledger_failure_code",
	"ledger_reconciliation_reference",
	"ledger_created_at"
FROM sequenced;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_effect_audit_events_effect_sequence_unique" ON "credential_effect_audit_events" USING btree ("workspace_id","effect_ref","effect_sequence");--> statement-breakpoint
CREATE INDEX "credential_effect_audit_events_workspace_created_idx" ON "credential_effect_audit_events" USING btree ("workspace_id","created_at","id");
