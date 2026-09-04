CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
DO $roles$
DECLARE role_row record;
BEGIN
  SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls INTO role_row
    FROM pg_catalog.pg_roles WHERE rolname = 'tasmeemai_generation_rights_eraser_owner';
  IF NOT FOUND THEN
    CREATE ROLE tasmeemai_generation_rights_eraser_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSIF role_row.rolcanlogin OR role_row.rolsuper OR role_row.rolcreatedb OR role_row.rolcreaterole OR role_row.rolinherit OR role_row.rolreplication OR role_row.rolbypassrls THEN
    RAISE EXCEPTION 'generation rights eraser owner role is not least-privilege';
  END IF;
  SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls INTO role_row
    FROM pg_catalog.pg_roles WHERE rolname = 'tasmeemai_workspace_closure_worker';
  IF NOT FOUND THEN
    CREATE ROLE tasmeemai_workspace_closure_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSIF role_row.rolcanlogin OR role_row.rolsuper OR role_row.rolcreatedb OR role_row.rolcreaterole OR role_row.rolinherit OR role_row.rolreplication OR role_row.rolbypassrls THEN
    RAISE EXCEPTION 'workspace closure worker role is not least-privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE r.rolname='tasmeemai_generation_rights_eraser_owner') THEN
    RAISE EXCEPTION 'generation rights eraser owner role must not have members';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname IN ('tasmeemai_generation_rights_eraser_owner','tasmeemai_workspace_closure_worker')) THEN
    RAISE EXCEPTION 'generation rights erasure roles must not inherit parent-role authority';
  END IF;
END;
$roles$;
--> statement-breakpoint
-- Bind the extension function by its authoritative installation schema once;
-- SECURITY DEFINER code below calls only this schema-qualified wrapper.
DO $crypto$
DECLARE extension_schema text;
BEGIN
  SELECT n.nspname INTO extension_schema FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto';
  IF extension_schema IS NULL THEN RAISE EXCEPTION 'trusted pgcrypto extension unavailable'; END IF;
  EXECUTE pg_catalog.format(
    'CREATE OR REPLACE FUNCTION public.tasmeemai_pgcrypto_hmac_sha256(bytea, bytea) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS %L',
    pg_catalog.format('SELECT %I.hmac($1, $2, ''sha256'')', extension_schema)
  );
  EXECUTE pg_catalog.format('GRANT USAGE ON SCHEMA %I TO tasmeemai_generation_rights_eraser_owner', extension_schema);
  EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %I.hmac(bytea,bytea,text) TO tasmeemai_generation_rights_eraser_owner', extension_schema);
END;
$crypto$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.tasmeemai_try_timestamptz(value text) RETURNS timestamptz
LANGUAGE plpgsql STABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
DECLARE parsed timestamptz;
BEGIN
  parsed:=value::timestamptz;
  IF NOT pg_catalog.isfinite(parsed) THEN RETURN NULL; END IF;
  RETURN parsed;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.tasmeemai_try_positive_integer(value text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
DECLARE parsed bigint;
BEGIN
  parsed:=value::bigint;
  IF parsed<1 OR parsed>2147483647 THEN RETURN NULL; END IF;
  RETURN parsed::integer;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.tasmeemai_try_nonnegative_integer(value text) RETURNS integer
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
DECLARE parsed bigint;
BEGIN
  parsed:=value::bigint;
  IF parsed<0 OR parsed>2147483647 THEN RETURN NULL; END IF;
  RETURN parsed::integer;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TABLE "generation_rights_erasure_tombstones" (
  "workspace_id" text PRIMARY KEY, "closure_id" text NOT NULL, "schema_version" text NOT NULL,
  "evidence_row_count" bigint NOT NULL, "snapshot_row_count" bigint NOT NULL,
  "retention_policy_revision" integer NOT NULL, "retention_rule_digest" text NOT NULL,
  "erasure_manifest_mac" text NOT NULL, "audit_sequence" integer NOT NULL, "audit_event_id" text NOT NULL,
  "signing_key_id" text NOT NULL, "erased_at" timestamptz NOT NULL, "tombstone_digest" text NOT NULL, "tombstone_mac" text NOT NULL,
  CONSTRAINT "generation_rights_erasure_tombstones_values_check" CHECK (
    "schema_version"='generation-rights-erasure-tombstone/v1' AND "closure_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
    AND "evidence_row_count">=0 AND "snapshot_row_count">=0 AND "retention_policy_revision">0
    AND "retention_rule_digest" ~ '^sha256:[a-f0-9]{64}$' AND "erasure_manifest_mac" ~ '^hmac-sha256:[a-f0-9]{64}$'
    AND "audit_sequence">0 AND "audit_event_id" ~ '^rights_erasure_[a-f0-9]{32}$'
    AND "signing_key_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
    AND "tombstone_digest" ~ '^sha256:[a-f0-9]{64}$' AND "tombstone_mac" ~ '^hmac-sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "generation_rights_erasure_attempts" (
  "workspace_id" text NOT NULL, "closure_id" text NOT NULL, "lease_id" text NOT NULL, "lease_fence" integer NOT NULL, "outcome_code" text NOT NULL,
  "eligible_at" timestamptz, "audit_sequence" integer NOT NULL, "audit_event_id" text NOT NULL,
  "signing_key_id" text NOT NULL, "occurred_at" timestamptz NOT NULL, "attempt_digest" text NOT NULL, "attempt_mac" text NOT NULL,
  CONSTRAINT "generation_rights_erasure_attempts_pk" PRIMARY KEY ("workspace_id","closure_id","lease_id","lease_fence","outcome_code"),
  CONSTRAINT "generation_rights_erasure_attempts_values_check" CHECK (
    "lease_id" ~ '^lease_[A-Za-z0-9]+$' AND "lease_fence">0 AND "outcome_code" IN ('blocked_access_revocation','blocked_export','blocked_deletion_receipts','blocked_retention_policy','blocked_retention_hold','blocked_retention_period','blocked_dependencies')
    AND "audit_sequence">0 AND "audit_event_id" ~ '^rights_erasure_attempt_[a-f0-9]{32}$'
    AND "signing_key_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
    AND "attempt_digest" ~ '^sha256:[a-f0-9]{64}$' AND "attempt_mac" ~ '^hmac-sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_generation_rights_erasure_proof_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$ BEGIN RAISE EXCEPTION 'generation rights erasure proof is append-only'; END; $$;
CREATE TRIGGER "generation_rights_erasure_tombstones_append_only" BEFORE UPDATE OR DELETE ON "generation_rights_erasure_tombstones"
FOR EACH ROW EXECUTE FUNCTION public.prevent_generation_rights_erasure_proof_mutation();
CREATE TRIGGER "generation_rights_erasure_attempts_append_only" BEFORE UPDATE OR DELETE ON "generation_rights_erasure_attempts"
FOR EACH ROW EXECUTE FUNCTION public.prevent_generation_rights_erasure_proof_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_inspiration_rights_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace-governance:' || NEW."workspace_id",0));
    IF NOT EXISTS (SELECT 1 FROM public."workspaces" WHERE "id"=NEW."workspace_id" AND "deleted_at" IS NULL)
      OR EXISTS (SELECT 1 FROM public."workspace_governance_resources" WHERE "workspace_id"=NEW."workspace_id" AND "kind"='workspace_closure' AND "status" IN ('cooling_off','erasure_queued','erasure_running','waiting_retention_policy','waiting_external_effects','waiting_erasure','waiting_export','closed','closed_retained'))
    THEN RAISE EXCEPTION 'workspace closure blocks new inspiration rights evidence'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND current_user='tasmeemai_generation_rights_eraser_owner'
    AND pg_catalog.current_setting('app.generation_rights_erasure_context',true)=OLD."workspace_id" || ':' || pg_catalog.current_setting('app.generation_rights_erasure_closure',true)
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'inspiration rights evidence is immutable';
END; $$;
DROP TRIGGER "inspiration_rights_evidence_immutable" ON "inspiration_rights_evidence";
CREATE TRIGGER "inspiration_rights_evidence_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "inspiration_rights_evidence"
FOR EACH ROW EXECUTE FUNCTION public.prevent_inspiration_rights_evidence_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_inspiration_rights_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace-governance:' || NEW."workspace_id",0));
    IF NOT EXISTS (SELECT 1 FROM public."workspaces" WHERE "id"=NEW."workspace_id" AND "deleted_at" IS NULL)
      OR EXISTS (SELECT 1 FROM public."workspace_governance_resources" WHERE "workspace_id"=NEW."workspace_id" AND "kind"='workspace_closure' AND "status" IN ('cooling_off','erasure_queued','erasure_running','waiting_retention_policy','waiting_external_effects','waiting_erasure','waiting_export','closed','closed_retained'))
    THEN RAISE EXCEPTION 'workspace closure blocks new inspiration rights snapshots'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND current_user='tasmeemai_generation_rights_eraser_owner'
    AND pg_catalog.current_setting('app.generation_rights_erasure_context',true)=OLD."workspace_id" || ':' || pg_catalog.current_setting('app.generation_rights_erasure_closure',true)
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'inspiration rights snapshots are immutable';
END; $$;
CREATE TRIGGER "inspiration_rights_snapshots_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "inspiration_rights_snapshots"
FOR EACH ROW EXECUTE FUNCTION public.prevent_inspiration_rights_snapshot_mutation();
--> statement-breakpoint
-- generation_intents.intent embeds the full rights snapshot, including the
-- evidence JSON. Its nullable/legacy FK cannot be the concurrency boundary.
CREATE OR REPLACE FUNCTION public.guard_generation_intent_during_workspace_closure() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id" THEN
    RAISE EXCEPTION 'generation intent Workspace identity is immutable';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace-governance:' || NEW."workspace_id",0));
  IF NOT EXISTS (SELECT 1 FROM public."workspaces" WHERE "id"=NEW."workspace_id" AND "deleted_at" IS NULL)
    OR EXISTS (SELECT 1 FROM public."workspace_governance_resources" WHERE "workspace_id"=NEW."workspace_id" AND "kind"='workspace_closure' AND "status" IN ('cooling_off','erasure_queued','erasure_running','waiting_retention_policy','waiting_external_effects','waiting_erasure','waiting_export','closed','closed_retained'))
  THEN RAISE EXCEPTION 'workspace closure blocks new or changed generation intents'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "generation_intents_closure_guard" BEFORE INSERT OR UPDATE ON "generation_intents"
FOR EACH ROW EXECUTE FUNCTION public.guard_generation_intent_during_workspace_closure();
--> statement-breakpoint
CREATE FUNCTION public.record_generation_rights_erasure_attempt(p_workspace_id text,p_closure_id text,p_lease_id text,p_lease_fence integer,p_outcome_code text,p_eligible_at timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $attempt$
DECLARE
  v_now timestamptz:=pg_catalog.clock_timestamp(); v_key text:=pg_catalog.current_setting('app.generation_rights_erasure_hmac_key',true);
  v_key_id text:=pg_catalog.current_setting('app.generation_rights_erasure_hmac_key_id',true); v_sequence integer; v_event_id text;
  v_unsigned jsonb; v_digest text; v_mac text; v_receipt_key text; v_expected_audit jsonb; v_expected_result jsonb; v_existing public."generation_rights_erasure_attempts"%ROWTYPE;
BEGIN
  IF v_key IS NULL OR pg_catalog.octet_length(v_key)<32 OR v_key_id IS NULL THEN RAISE EXCEPTION 'generation rights erasure signing authority unavailable'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace-governance:' || p_workspace_id,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace-audit:' || p_workspace_id,0));
  v_now:=pg_catalog.clock_timestamp();
  SELECT * INTO v_existing FROM public."generation_rights_erasure_attempts" WHERE "workspace_id"=p_workspace_id AND "closure_id"=p_closure_id AND "lease_id"=p_lease_id AND "lease_fence"=p_lease_fence AND "outcome_code"=p_outcome_code;
  IF FOUND THEN
    v_unsigned:=pg_catalog.jsonb_build_object('schema','generation-rights-erasure-attempt/v1','workspaceId',v_existing."workspace_id",'closureId',v_existing."closure_id",'leaseId',v_existing."lease_id",'leaseFence',v_existing."lease_fence",'outcome',v_existing."outcome_code",'eligibleAt',CASE WHEN v_existing."eligible_at" IS NULL THEN NULL ELSE pg_catalog.to_char(v_existing."eligible_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'auditSequence',v_existing."audit_sequence",'auditEventId',v_existing."audit_event_id",'signingKeyId',v_existing."signing_key_id",'occurredAt',pg_catalog.to_char(v_existing."occurred_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
    v_digest:='sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_unsigned::text,'UTF8')),'hex');
    v_mac:='hmac-sha256:' || pg_catalog.encode(public.tasmeemai_pgcrypto_hmac_sha256(pg_catalog.convert_to('generation-rights-erasure-attempt-mac/v1:' || v_digest,'UTF8'),pg_catalog.convert_to(v_key,'UTF8')),'hex');
    v_receipt_key:='rights-attempt-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_closure_id || ':' || p_lease_id,'UTF8')),'hex'),1,24) || '-' || p_lease_fence::text || '-' || p_outcome_code;
    v_expected_result:=pg_catalog.jsonb_build_object('schema','generation-rights-erasure-attempt-result/v1','closureId',p_closure_id,'leaseId',p_lease_id,'outcome',p_outcome_code,'attemptDigest',v_digest);
    v_expected_audit:=pg_catalog.jsonb_build_object('schema','workspace-audit-event/v1','id',v_existing."audit_event_id",'workspaceId',p_workspace_id,'sequence',v_existing."audit_sequence",'actor',pg_catalog.jsonb_build_object('kind','system','id','tasmeemai:workspace-closure-worker@1'),'capability','workspace_closures.erase_generation_rights@1','action','erase_generation_rights_evidence','resource',pg_catalog.jsonb_build_object('kind','workspace_closure','id',p_closure_id),'outcome','failed','redactedDetails',pg_catalog.jsonb_build_object('reasonCode',p_outcome_code,'attemptDigest',v_digest,'signingKeyId',v_existing."signing_key_id"),'occurredAt',pg_catalog.to_char(v_existing."occurred_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
    IF v_existing."signing_key_id"<>v_key_id OR v_existing."attempt_digest"<>v_digest OR v_existing."attempt_mac"<>v_mac
      OR NOT EXISTS (SELECT 1 FROM public."workspace_audit_trail_events" WHERE "workspace_id"=p_workspace_id AND "sequence"=v_existing."audit_sequence" AND "id"=v_existing."audit_event_id" AND "event"=v_expected_audit AND "occurred_at"=v_existing."occurred_at")
      OR NOT EXISTS (SELECT 1 FROM public."workspace_governance_mutation_receipts" WHERE "workspace_id"=p_workspace_id AND "capability"='workspace_closures.erase_generation_rights_attempt@1' AND "idempotency_key"=v_receipt_key AND "request_digest"=v_digest AND "actor_identity" IS NULL AND "auth_context_digest" IS NULL AND "result"=v_expected_result AND "created_at"=v_existing."occurred_at")
    THEN RAISE EXCEPTION 'generation rights erasure attempt replay proof invalid'; END IF;
    RETURN v_existing."attempt_digest";
  END IF;
  SELECT coalesce(pg_catalog.max("sequence"),0)+1 INTO v_sequence FROM public."workspace_audit_trail_events" WHERE "workspace_id"=p_workspace_id;
  v_event_id:='rights_erasure_attempt_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_workspace_id || ':' || p_closure_id || ':' || p_lease_id || ':' || p_lease_fence::text || ':' || p_outcome_code,'UTF8')),'hex'),1,32);
  v_unsigned:=pg_catalog.jsonb_build_object('schema','generation-rights-erasure-attempt/v1','workspaceId',p_workspace_id,'closureId',p_closure_id,'leaseId',p_lease_id,'leaseFence',p_lease_fence,'outcome',p_outcome_code,'eligibleAt',CASE WHEN p_eligible_at IS NULL THEN NULL ELSE pg_catalog.to_char(p_eligible_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'auditSequence',v_sequence,'auditEventId',v_event_id,'signingKeyId',v_key_id,'occurredAt',pg_catalog.to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  v_digest:='sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_unsigned::text,'UTF8')),'hex');
  v_mac:='hmac-sha256:' || pg_catalog.encode(public.tasmeemai_pgcrypto_hmac_sha256(pg_catalog.convert_to('generation-rights-erasure-attempt-mac/v1:' || v_digest,'UTF8'),pg_catalog.convert_to(v_key,'UTF8')),'hex');
  INSERT INTO public."generation_rights_erasure_attempts" VALUES (p_workspace_id,p_closure_id,p_lease_id,p_lease_fence,p_outcome_code,p_eligible_at,v_sequence,v_event_id,v_key_id,v_now,v_digest,v_mac);
  INSERT INTO public."workspace_governance_mutation_receipts" ("workspace_id","capability","idempotency_key","request_digest","actor_identity","auth_context_digest","result","created_at") VALUES
    (p_workspace_id,'workspace_closures.erase_generation_rights_attempt@1','rights-attempt-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_closure_id || ':' || p_lease_id,'UTF8')),'hex'),1,24) || '-' || p_lease_fence::text || '-' || p_outcome_code,v_digest,NULL,NULL,pg_catalog.jsonb_build_object('schema','generation-rights-erasure-attempt-result/v1','closureId',p_closure_id,'leaseId',p_lease_id,'outcome',p_outcome_code,'attemptDigest',v_digest),v_now);
  INSERT INTO public."workspace_audit_trail_events" ("workspace_id","sequence","id","event","occurred_at") VALUES
    (p_workspace_id,v_sequence,v_event_id,pg_catalog.jsonb_build_object('schema','workspace-audit-event/v1','id',v_event_id,'workspaceId',p_workspace_id,'sequence',v_sequence,'actor',pg_catalog.jsonb_build_object('kind','system','id','tasmeemai:workspace-closure-worker@1'),'capability','workspace_closures.erase_generation_rights@1','action','erase_generation_rights_evidence','resource',pg_catalog.jsonb_build_object('kind','workspace_closure','id',p_closure_id),'outcome','failed','redactedDetails',pg_catalog.jsonb_build_object('reasonCode',p_outcome_code,'attemptDigest',v_digest,'signingKeyId',v_key_id),'occurredAt',pg_catalog.to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),v_now);
  RETURN v_digest;
END; $attempt$;
--> statement-breakpoint
-- Non-sensitive lookup lets the isolated worker select a historical key from
-- its keyring without granting SELECT on proof tables.
CREATE FUNCTION public.generation_rights_erasure_signing_key_id(p_workspace_id text,p_closure_id text,p_lease_id text,p_lease_fence integer,p_outcome_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $lookup$
DECLARE v_key_id text; v_count integer;
BEGIN
  IF p_workspace_id IS NULL OR p_closure_id IS NULL OR p_lease_id IS NULL OR p_lease_id !~ '^lease_[A-Za-z0-9]+$' OR p_lease_fence IS NULL OR p_lease_fence<1 THEN RAISE EXCEPTION 'invalid generation rights erasure replay identity'; END IF;
  SELECT "signing_key_id" INTO v_key_id FROM public."generation_rights_erasure_tombstones" WHERE "workspace_id"=p_workspace_id AND "closure_id"=p_closure_id;
  IF FOUND THEN RETURN v_key_id; END IF;
  SELECT pg_catalog.count(DISTINCT "signing_key_id"),pg_catalog.min("signing_key_id") INTO v_count,v_key_id FROM public."generation_rights_erasure_attempts"
    WHERE "workspace_id"=p_workspace_id AND "closure_id"=p_closure_id AND "lease_id"=p_lease_id AND "lease_fence"=p_lease_fence AND "outcome_code"=p_outcome_code;
  IF v_count>1 THEN RAISE EXCEPTION 'ambiguous generation rights erasure signing key'; END IF;
  RETURN v_key_id;
END; $lookup$;
--> statement-breakpoint
CREATE FUNCTION public.erase_closed_workspace_generation_rights(p_workspace_id text,p_closure_id text,p_lease_id text,p_lease_fence integer)
RETURNS TABLE (outcome text,tombstone_digest text,evidence_row_count bigint,snapshot_row_count bigint,erased_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE
  v_now timestamptz:=pg_catalog.clock_timestamp(); v_key text:=pg_catalog.current_setting('app.generation_rights_erasure_hmac_key',true); v_key_id text:=pg_catalog.current_setting('app.generation_rights_erasure_hmac_key_id',true);
  v_closure record; v_policy record; v_revision jsonb; v_rule jsonb; v_count integer; v_duration integer; v_recoverable integer; v_floor integer;
  v_policy_created timestamptz; v_latest timestamptz; v_eligible timestamptz; v_delete_now timestamptz; v_evidence bigint; v_snapshots bigint; v_deleted_evidence bigint; v_deleted_snapshots bigint;
  v_manifest_mac text; v_rule_digest text; v_sequence integer; v_event_id text; v_unsigned jsonb; v_digest text; v_mac text; v_receipt_key text; v_expected_audit jsonb; v_expected_result jsonb;
  v_existing public."generation_rights_erasure_tombstones"%ROWTYPE;
BEGIN
  IF p_workspace_id IS NULL OR p_workspace_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' OR p_closure_id IS NULL OR p_closure_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' OR p_lease_id IS NULL OR p_lease_id !~ '^lease_[A-Za-z0-9]+$' OR p_lease_fence IS NULL OR p_lease_fence<1 THEN RAISE EXCEPTION 'invalid generation rights erasure identity'; END IF;
  IF v_key IS NULL OR pg_catalog.octet_length(v_key)<32 OR v_key_id IS NULL OR v_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' THEN RAISE EXCEPTION 'generation rights erasure signing authority unavailable'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace-governance:' || p_workspace_id,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace-audit:' || p_workspace_id,0));
  v_now:=pg_catalog.clock_timestamp();
  SELECT * INTO v_existing FROM public."generation_rights_erasure_tombstones" WHERE "workspace_id"=p_workspace_id;
  IF FOUND THEN
    IF v_existing."closure_id"<>p_closure_id OR v_existing."signing_key_id"<>v_key_id THEN RAISE EXCEPTION 'generation rights erasure replay binding mismatch'; END IF;
    v_unsigned:=pg_catalog.jsonb_build_object('schema',v_existing."schema_version",'workspaceId',v_existing."workspace_id",'closureId',v_existing."closure_id",'evidenceRowCount',v_existing."evidence_row_count",'snapshotRowCount',v_existing."snapshot_row_count",'retentionPolicyRevision',v_existing."retention_policy_revision",'retentionRuleDigest',v_existing."retention_rule_digest",'erasureManifestMac',v_existing."erasure_manifest_mac",'auditSequence',v_existing."audit_sequence",'auditEventId',v_existing."audit_event_id",'signingKeyId',v_existing."signing_key_id",'erasedAt',pg_catalog.to_char(v_existing."erased_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
    v_digest:='sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_unsigned::text,'UTF8')),'hex');
    v_mac:='hmac-sha256:' || pg_catalog.encode(public.tasmeemai_pgcrypto_hmac_sha256(pg_catalog.convert_to('generation-rights-erasure-tombstone-mac/v1:' || v_digest,'UTF8'),pg_catalog.convert_to(v_key,'UTF8')),'hex');
    v_receipt_key:='rights-erasure-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_closure_id,'UTF8')),'hex'),1,32);
    v_expected_result:=pg_catalog.jsonb_build_object('schema','generation-rights-erasure-result/v1','closureId',p_closure_id,'tombstoneDigest',v_existing."tombstone_digest",'evidenceRowCount',v_existing."evidence_row_count",'snapshotRowCount',v_existing."snapshot_row_count",'erasedAt',pg_catalog.to_char(v_existing."erased_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
    v_expected_audit:=pg_catalog.jsonb_build_object('schema','workspace-audit-event/v1','id',v_existing."audit_event_id",'workspaceId',p_workspace_id,'sequence',v_existing."audit_sequence",'actor',pg_catalog.jsonb_build_object('kind','system','id','tasmeemai:workspace-closure-worker@1'),'capability','workspace_closures.erase_generation_rights@1','action','erase_generation_rights_evidence','resource',pg_catalog.jsonb_build_object('kind','generation_rights_erasure_tombstone','id',p_workspace_id),'outcome','completed','redactedDetails',pg_catalog.jsonb_build_object('tombstoneDigest',v_existing."tombstone_digest",'evidenceRowCount',v_existing."evidence_row_count",'snapshotRowCount',v_existing."snapshot_row_count",'retentionPolicyRevision',v_existing."retention_policy_revision",'signingKeyId',v_existing."signing_key_id"),'occurredAt',pg_catalog.to_char(v_existing."erased_at" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
    IF v_existing."tombstone_digest"<>v_digest OR v_existing."tombstone_mac"<>v_mac
      OR NOT EXISTS (SELECT 1 FROM public."workspace_audit_trail_events" WHERE "workspace_id"=p_workspace_id AND "sequence"=v_existing."audit_sequence" AND "id"=v_existing."audit_event_id" AND "event"=v_expected_audit AND "occurred_at"=v_existing."erased_at")
      OR NOT EXISTS (SELECT 1 FROM public."workspace_governance_mutation_receipts" WHERE "workspace_id"=p_workspace_id AND "capability"='workspace_closures.erase_generation_rights@1' AND "idempotency_key"=v_receipt_key AND "request_digest"=v_existing."tombstone_digest" AND "actor_identity" IS NULL AND "auth_context_digest" IS NULL AND "result"=v_expected_result AND "created_at"=v_existing."erased_at")
    THEN RAISE EXCEPTION 'generation rights erasure replay proof invalid'; END IF;
    RETURN QUERY SELECT 'replayed'::text,v_existing."tombstone_digest",v_existing."evidence_row_count",v_existing."snapshot_row_count",v_existing."erased_at"; RETURN;
  END IF;
  SELECT "status","body","version" INTO v_closure FROM public."workspace_governance_resources" WHERE "workspace_id"=p_workspace_id AND "kind"='workspace_closure' AND "id"=p_closure_id FOR UPDATE;
  IF NOT FOUND OR v_closure."status" IS DISTINCT FROM 'erasure_running' OR v_closure."body"->>'erasureScheduled' IS DISTINCT FROM 'true' OR pg_catalog.jsonb_typeof(v_closure."body"->'lease') IS DISTINCT FROM 'object' OR v_closure."body"->'lease'->>'id' IS DISTINCT FROM p_lease_id OR public.tasmeemai_try_positive_integer(v_closure."body"->'lease'->>'fence') IS DISTINCT FROM p_lease_fence OR public.tasmeemai_try_timestamptz(v_closure."body"->'lease'->>'expiresAt') IS NULL OR public.tasmeemai_try_timestamptz(v_closure."body"->'lease'->>'expiresAt')<=v_now THEN RAISE EXCEPTION 'current fenced workspace closure lease required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."workspaces" WHERE "id"=p_workspace_id AND "deleted_at" IS NULL FOR SHARE) THEN RAISE EXCEPTION 'open canonical workspace required during closure erasure'; END IF;
  IF pg_catalog.jsonb_typeof(v_closure."body"->'accessRevocationEvidence') IS DISTINCT FROM 'object' OR v_closure."body"->'accessRevocationEvidence'->>'schema' IS DISTINCT FROM 'workspace-access-revocation-evidence/v1' OR pg_catalog.jsonb_typeof(v_closure."body"->'accessRevocationEvidence'->'externalEffects') IS DISTINCT FROM 'array' OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_closure."body"->'accessRevocationEvidence'->'externalEffects') effect WHERE pg_catalog.jsonb_typeof(effect) IS DISTINCT FROM 'object' OR coalesce(effect->>'state','') NOT IN ('deleted','not_found') OR coalesce(effect->>'evidenceRef','')='') THEN
    PERFORM public.record_generation_rights_erasure_attempt(p_workspace_id,p_closure_id,p_lease_id,p_lease_fence,'blocked_access_revocation',NULL); RETURN QUERY SELECT 'blocked_access_revocation'::text,NULL::text,0::bigint,0::bigint,NULL::timestamptz; RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."workspace_governance_resources" WHERE "workspace_id"=p_workspace_id AND "kind"='workspace_export' AND "id"=v_closure."body"->>'exportId' AND "status"='succeeded' FOR SHARE) THEN
    PERFORM public.record_generation_rights_erasure_attempt(p_workspace_id,p_closure_id,p_lease_id,p_lease_fence,'blocked_export',NULL); RETURN QUERY SELECT 'blocked_export'::text,NULL::text,0::bigint,0::bigint,NULL::timestamptz; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public."workspace_governance_resources" WHERE "workspace_id"=p_workspace_id AND "kind"='deletion_receipt' AND "body"->>'closureId'=p_closure_id AND "status" NOT IN ('completed','completed_hold') FOR SHARE) THEN
    PERFORM public.record_generation_rights_erasure_attempt(p_workspace_id,p_closure_id,p_lease_id,p_lease_fence,'blocked_deletion_receipts',NULL); RETURN QUERY SELECT 'blocked_deletion_receipts'::text,NULL::text,0::bigint,0::bigint,NULL::timestamptz; RETURN; END IF;
  SELECT "body","status" INTO v_policy FROM public."workspace_governance_resources" WHERE "workspace_id"=p_workspace_id AND "kind"='retention_policy' AND "id"='active' FOR SHARE;
  IF NOT FOUND OR v_policy."status" IS DISTINCT FROM 'active' OR pg_catalog.jsonb_typeof(v_policy."body"->'revisions') IS DISTINCT FROM 'array' OR public.tasmeemai_try_positive_integer(v_policy."body"->>'activeRevision') IS NULL THEN
    PERFORM public.record_generation_rights_erasure_attempt(p_workspace_id,p_closure_id,p_lease_id,p_lease_fence,'blocked_retention_policy',NULL); RETURN QUERY SELECT 'blocked_retention_policy'::text,NULL::text,0::bigint,0::bigint,NULL::timestamptz; RETURN; END IF;
  SELECT pg_catalog.count(*) INTO v_count FROM pg_catalog.jsonb_array_elements(v_policy."body"->'revisions') revision WHERE revision->>'revision'=v_policy."body"->>'activeRevision';
  SELECT revision INTO v_revision FROM pg_catalog.jsonb_array_elements(v_policy."body"->'revisions') revision WHERE revision->>'revision'=v_policy."body"->>'activeRevision' LIMIT 1;
  IF v_count<>1 OR v_revision->>'schema' IS DISTINCT FROM 'retention-policy-revision/v2' OR v_revision->>'legalFloorSource' IS DISTINCT FROM 'deployment_trusted/v2' OR pg_catalog.jsonb_typeof(v_revision->'rules') IS DISTINCT FROM 'array' OR public.tasmeemai_try_timestamptz(v_revision->>'createdAt') IS NULL THEN
    PERFORM public.record_generation_rights_erasure_attempt(p_workspace_id,p_closure_id,p_lease_id,p_lease_fence,'blocked_retention_policy',NULL); RETURN QUERY SELECT 'blocked_retention_policy'::text,NULL::text,0::bigint,0::bigint,NULL::timestamptz; RETURN; END IF;
  v_policy_created:=public.tasmeemai_try_timestamptz(v_revision->>'createdAt');
  SELECT pg_catalog.count(*) INTO v_count FROM pg_catalog.jsonb_array_elements(v_revision->'rules') rule WHERE rule->>'retentionClass'='generation_rights_evidence';
  SELECT rule INTO v_rule FROM pg_catalog.jsonb_array_elements(v_revision->'rules') rule WHERE rule->>'retentionClass'='generation_rights_evidence' LIMIT 1;
  IF v_count<>1 OR public.tasmeemai_try_nonnegative_integer(v_rule->>'durationDays') IS NULL OR public.tasmeemai_try_nonnegative_integer(v_rule->>'recoverableDays') IS NULL OR public.tasmeemai_try_nonnegative_integer(v_rule->>'legalFloorDays') IS NULL THEN
    PERFORM public.record_generation_rights_erasure_attempt(p_workspace_id,p_closure_id,p_lease_id,p_lease_fence,'blocked_retention_policy',NULL); RETURN QUERY SELECT 'blocked_retention_policy'::text,NULL::text,0::bigint,0::bigint,NULL::timestamptz; RETURN; END IF;
  v_duration:=public.tasmeemai_try_nonnegative_integer(v_rule->>'durationDays'); v_recoverable:=public.tasmeemai_try_nonnegative_integer(v_rule->>'recoverableDays'); v_floor:=public.tasmeemai_try_nonnegative_integer(v_rule->>'legalFloorDays');
  IF v_floor<>365 OR v_duration<v_floor OR v_duration>36500 OR v_recoverable<0 OR v_recoverable>v_duration THEN
    PERFORM public.record_generation_rights_erasure_attempt(p_workspace_id,p_closure_id,p_lease_id,p_lease_fence,'blocked_retention_policy',NULL); RETURN QUERY SELECT 'blocked_retention_policy'::text,NULL::text,0::bigint,0::bigint,NULL::timestamptz; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public."workspace_governance_resources" hold WHERE hold."workspace_id"=p_workspace_id AND hold."kind"='retention_hold' AND hold."status"='active'
    AND (hold."body"->>'expiresAt' IS NULL OR public.tasmeemai_try_timestamptz(hold."body"->>'expiresAt') IS NULL OR public.tasmeemai_try_timestamptz(hold."body"->>'expiresAt')>v_now)
    AND (pg_catalog.jsonb_typeof(hold."body"->'retentionClasses') IS DISTINCT FROM 'array' OR hold."body"->'retentionClasses' @> '["generation_rights_evidence"]'::jsonb
      OR pg_catalog.jsonb_typeof(hold."body"->'scopeReview') IS DISTINCT FROM 'object' OR hold."body"->'scopeReview'->>'schema' IS DISTINCT FROM 'retention-hold-scope-review/v2'
      OR hold."body"->'scopeReview'->>'reviewedAgainstPolicyRevision' IS DISTINCT FROM v_policy."body"->>'activeRevision' OR hold."body"->'scopeReview'->>'generationRightsEvidence' IS DISTINCT FROM 'not_applicable') FOR SHARE) THEN
    PERFORM public.record_generation_rights_erasure_attempt(p_workspace_id,p_closure_id,p_lease_id,p_lease_fence,'blocked_retention_hold',NULL); RETURN QUERY SELECT 'blocked_retention_hold'::text,NULL::text,0::bigint,0::bigint,NULL::timestamptz; RETURN; END IF;
  SELECT pg_catalog.max("created_at") INTO v_latest FROM (SELECT "created_at" FROM public."inspiration_rights_evidence" WHERE "workspace_id"=p_workspace_id UNION ALL SELECT "created_at" FROM public."inspiration_rights_snapshots" WHERE "workspace_id"=p_workspace_id) rights_rows;
  IF v_latest IS NOT NULL THEN v_eligible:=v_latest+pg_catalog.make_interval(days=>greatest(v_duration,v_recoverable,v_floor)); IF v_eligible>v_now THEN
    PERFORM public.record_generation_rights_erasure_attempt(p_workspace_id,p_closure_id,p_lease_id,p_lease_fence,'blocked_retention_period',v_eligible); RETURN QUERY SELECT 'blocked_retention_period'::text,NULL::text,0::bigint,0::bigint,v_eligible; RETURN; END IF; END IF;
  IF EXISTS (SELECT 1 FROM public."generation_intents" WHERE "workspace_id"=p_workspace_id FOR SHARE) THEN
    PERFORM public.record_generation_rights_erasure_attempt(p_workspace_id,p_closure_id,p_lease_id,p_lease_fence,'blocked_dependencies',NULL); RETURN QUERY SELECT 'blocked_dependencies'::text,NULL::text,0::bigint,0::bigint,NULL::timestamptz; RETURN; END IF;
  SELECT pg_catalog.count(*) INTO v_evidence FROM public."inspiration_rights_evidence" WHERE "workspace_id"=p_workspace_id;
  SELECT pg_catalog.count(*) INTO v_snapshots FROM public."inspiration_rights_snapshots" WHERE "workspace_id"=p_workspace_id;
  SELECT 'hmac-sha256:' || pg_catalog.encode(public.tasmeemai_pgcrypto_hmac_sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object('purpose','generation-rights-erasure-manifest/v1','workspaceId',p_workspace_id,'closureId',p_closure_id,'commitments',coalesce(pg_catalog.jsonb_agg(commitment ORDER BY kind,identity),'[]'::jsonb))::text,'UTF8'),pg_catalog.convert_to(v_key,'UTF8')),'hex') INTO v_manifest_mac FROM (
    SELECT 'evidence'::text kind,"id" identity,pg_catalog.jsonb_build_object('kind','evidence','identity',"id",'recordDigest',"digest") commitment FROM public."inspiration_rights_evidence" WHERE "workspace_id"=p_workspace_id UNION ALL
    SELECT 'snapshot'::text,"id" || ':' || "revision"::text,pg_catalog.jsonb_build_object('kind','snapshot','identity',"id" || ':' || "revision"::text,'recordDigest',"digest") FROM public."inspiration_rights_snapshots" WHERE "workspace_id"=p_workspace_id) commitments;
  v_rule_digest:='sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_rule::text,'UTF8')),'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace-audit:' || p_workspace_id,0));
  SELECT coalesce(pg_catalog.max("sequence"),0)+1 INTO v_sequence FROM public."workspace_audit_trail_events" WHERE "workspace_id"=p_workspace_id;
  v_event_id:='rights_erasure_' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_workspace_id || ':' || p_closure_id,'UTF8')),'hex'),1,32);
  v_now:=pg_catalog.clock_timestamp();
  v_unsigned:=pg_catalog.jsonb_build_object('schema','generation-rights-erasure-tombstone/v1','workspaceId',p_workspace_id,'closureId',p_closure_id,'evidenceRowCount',v_evidence,'snapshotRowCount',v_snapshots,'retentionPolicyRevision',(v_policy."body"->>'activeRevision')::integer,'retentionRuleDigest',v_rule_digest,'erasureManifestMac',v_manifest_mac,'auditSequence',v_sequence,'auditEventId',v_event_id,'signingKeyId',v_key_id,'erasedAt',pg_catalog.to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  v_digest:='sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_unsigned::text,'UTF8')),'hex'); v_mac:='hmac-sha256:' || pg_catalog.encode(public.tasmeemai_pgcrypto_hmac_sha256(pg_catalog.convert_to('generation-rights-erasure-tombstone-mac/v1:' || v_digest,'UTF8'),pg_catalog.convert_to(v_key,'UTF8')),'hex');
  v_delete_now:=pg_catalog.clock_timestamp();
  IF v_closure."status" IS DISTINCT FROM 'erasure_running' OR v_closure."body"->'lease'->>'id' IS DISTINCT FROM p_lease_id OR public.tasmeemai_try_positive_integer(v_closure."body"->'lease'->>'fence') IS DISTINCT FROM p_lease_fence OR public.tasmeemai_try_timestamptz(v_closure."body"->'lease'->>'expiresAt') IS NULL OR public.tasmeemai_try_timestamptz(v_closure."body"->'lease'->>'expiresAt')<=v_delete_now THEN RAISE EXCEPTION 'current fenced workspace closure lease required immediately before erasure'; END IF;
  PERFORM pg_catalog.set_config('app.generation_rights_erasure_closure',p_closure_id,true); PERFORM pg_catalog.set_config('app.generation_rights_erasure_context',p_workspace_id || ':' || p_closure_id,true);
  DELETE FROM public."inspiration_rights_evidence" WHERE "workspace_id"=p_workspace_id; GET DIAGNOSTICS v_deleted_evidence=ROW_COUNT;
  DELETE FROM public."inspiration_rights_snapshots" WHERE "workspace_id"=p_workspace_id; GET DIAGNOSTICS v_deleted_snapshots=ROW_COUNT;
  PERFORM pg_catalog.set_config('app.generation_rights_erasure_context','',true); PERFORM pg_catalog.set_config('app.generation_rights_erasure_closure','',true);
  IF v_deleted_evidence<>v_evidence OR v_deleted_snapshots<>v_snapshots THEN RAISE EXCEPTION 'generation rights erasure row count changed concurrently'; END IF;
  INSERT INTO public."generation_rights_erasure_tombstones" VALUES (p_workspace_id,p_closure_id,'generation-rights-erasure-tombstone/v1',v_evidence,v_snapshots,(v_policy."body"->>'activeRevision')::integer,v_rule_digest,v_manifest_mac,v_sequence,v_event_id,v_key_id,v_now,v_digest,v_mac);
  v_receipt_key:='rights-erasure-' || pg_catalog.substr(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_closure_id,'UTF8')),'hex'),1,32);
  INSERT INTO public."workspace_governance_mutation_receipts" ("workspace_id","capability","idempotency_key","request_digest","actor_identity","auth_context_digest","result","created_at") VALUES (p_workspace_id,'workspace_closures.erase_generation_rights@1',v_receipt_key,v_digest,NULL,NULL,pg_catalog.jsonb_build_object('schema','generation-rights-erasure-result/v1','closureId',p_closure_id,'tombstoneDigest',v_digest,'evidenceRowCount',v_evidence,'snapshotRowCount',v_snapshots,'erasedAt',pg_catalog.to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),v_now);
  INSERT INTO public."workspace_audit_trail_events" ("workspace_id","sequence","id","event","occurred_at") VALUES (p_workspace_id,v_sequence,v_event_id,pg_catalog.jsonb_build_object('schema','workspace-audit-event/v1','id',v_event_id,'workspaceId',p_workspace_id,'sequence',v_sequence,'actor',pg_catalog.jsonb_build_object('kind','system','id','tasmeemai:workspace-closure-worker@1'),'capability','workspace_closures.erase_generation_rights@1','action','erase_generation_rights_evidence','resource',pg_catalog.jsonb_build_object('kind','generation_rights_erasure_tombstone','id',p_workspace_id),'outcome','completed','redactedDetails',pg_catalog.jsonb_build_object('tombstoneDigest',v_digest,'evidenceRowCount',v_evidence,'snapshotRowCount',v_snapshots,'retentionPolicyRevision',(v_policy."body"->>'activeRevision')::integer,'signingKeyId',v_key_id),'occurredAt',pg_catalog.to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),v_now);
  RETURN QUERY SELECT 'erased'::text,v_digest,v_evidence,v_snapshots,v_now;
END; $function$;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tasmeemai_pgcrypto_hmac_sha256(bytea,bytea), public.tasmeemai_try_timestamptz(text), public.tasmeemai_try_positive_integer(text), public.tasmeemai_try_nonnegative_integer(text), public.prevent_generation_rights_erasure_proof_mutation(), public.prevent_inspiration_rights_evidence_mutation(), public.prevent_inspiration_rights_snapshot_mutation(), public.guard_generation_intent_during_workspace_closure(), public.record_generation_rights_erasure_attempt(text,text,text,integer,text,timestamptz), public.generation_rights_erasure_signing_key_id(text,text,text,integer,text), public.erase_closed_workspace_generation_rights(text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON TABLE "generation_rights_erasure_tombstones", "generation_rights_erasure_attempts" FROM PUBLIC;
REVOKE UPDATE, DELETE ON TABLE "inspiration_rights_evidence", "inspiration_rights_snapshots" FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO tasmeemai_generation_rights_eraser_owner;
GRANT USAGE ON SCHEMA public TO tasmeemai_workspace_closure_worker;
GRANT SELECT ON TABLE "workspaces", "workspace_governance_resources", "workspace_governance_mutation_receipts", "workspace_audit_trail_events", "generation_intents" TO tasmeemai_generation_rights_eraser_owner;
GRANT SELECT, DELETE ON TABLE "inspiration_rights_evidence", "inspiration_rights_snapshots" TO tasmeemai_generation_rights_eraser_owner;
GRANT SELECT, INSERT ON TABLE "generation_rights_erasure_tombstones", "generation_rights_erasure_attempts", "workspace_governance_mutation_receipts", "workspace_audit_trail_events" TO tasmeemai_generation_rights_eraser_owner;
GRANT EXECUTE ON FUNCTION public.tasmeemai_pgcrypto_hmac_sha256(bytea,bytea), public.tasmeemai_try_timestamptz(text), public.tasmeemai_try_positive_integer(text), public.tasmeemai_try_nonnegative_integer(text) TO tasmeemai_generation_rights_eraser_owner;
GRANT EXECUTE ON FUNCTION public.erase_closed_workspace_generation_rights(text,text,text,integer) TO tasmeemai_workspace_closure_worker;
GRANT EXECUTE ON FUNCTION public.generation_rights_erasure_signing_key_id(text,text,text,integer,text) TO tasmeemai_workspace_closure_worker;
REVOKE ALL ON TABLE "generation_rights_erasure_tombstones", "generation_rights_erasure_attempts", "inspiration_rights_evidence", "inspiration_rights_snapshots", "generation_intents", "workspace_governance_resources", "workspace_governance_mutation_receipts", "workspace_audit_trail_events", "workspaces" FROM tasmeemai_workspace_closure_worker;
--> statement-breakpoint
DO $ownership$
DECLARE had_membership boolean:=pg_catalog.pg_has_role(CURRENT_USER,'tasmeemai_generation_rights_eraser_owner','MEMBER');
BEGIN
  IF NOT had_membership THEN GRANT tasmeemai_generation_rights_eraser_owner TO CURRENT_USER; END IF;
  GRANT CREATE ON SCHEMA public TO tasmeemai_generation_rights_eraser_owner;
  ALTER FUNCTION public.record_generation_rights_erasure_attempt(text,text,text,integer,text,timestamptz) OWNER TO tasmeemai_generation_rights_eraser_owner;
  ALTER FUNCTION public.generation_rights_erasure_signing_key_id(text,text,text,integer,text) OWNER TO tasmeemai_generation_rights_eraser_owner;
  ALTER FUNCTION public.erase_closed_workspace_generation_rights(text,text,text,integer) OWNER TO tasmeemai_generation_rights_eraser_owner;
  REVOKE CREATE ON SCHEMA public FROM tasmeemai_generation_rights_eraser_owner;
  IF NOT had_membership THEN REVOKE tasmeemai_generation_rights_eraser_owner FROM CURRENT_USER; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE r.rolname='tasmeemai_generation_rights_eraser_owner') THEN
    RAISE EXCEPTION 'generation rights eraser owner role retained an unexpected member';
  END IF;
END;
$ownership$;
--> statement-breakpoint
DO $final_role_posture$
BEGIN
  IF pg_catalog.has_schema_privilege('tasmeemai_generation_rights_eraser_owner','public','CREATE')
    OR pg_catalog.has_schema_privilege('tasmeemai_workspace_closure_worker','public','CREATE') THEN
    RAISE EXCEPTION 'generation rights erasure roles must not create objects in public';
  END IF;
END;
$final_role_posture$;
