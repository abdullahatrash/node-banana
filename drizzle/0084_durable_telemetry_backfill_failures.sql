-- The 0080 function raises after journaling an error, which rolls that journal
-- update back with the caller transaction. This wrapper catches the original
-- error in a subtransaction, commits a durable failure record, and returns a
-- failed result so the external runner can report a non-success status.
CREATE OR REPLACE FUNCTION run_product_telemetry_privacy_backfill(p_limit integer DEFAULT 500)
RETURNS TABLE(processed integer, remaining bigint, status text, last_workspace_id text, last_event_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_remaining bigint;
  v_last_workspace_id text;
  v_last_event_id text;
BEGIN
  BEGIN
    RETURN QUERY
      SELECT result.processed, result.remaining, result.status, result.last_workspace_id, result.last_event_id
      FROM backfill_product_telemetry_privacy_fields(p_limit) AS result;
    RETURN;
  EXCEPTION WHEN OTHERS THEN
    -- The nested block rolls back the failing batch. This update occurs outside
    -- that subtransaction and is returned normally, so PostgreSQL can commit it.
    SELECT progress."remaining_count", progress."last_workspace_id", progress."last_event_id"
    INTO v_remaining, v_last_workspace_id, v_last_event_id
    FROM "product_telemetry_backfill_progress" AS progress
    WHERE progress."job_key" = 'privacy_fields_v1'
    FOR UPDATE;

    UPDATE "product_telemetry_backfill_progress"
    SET "status" = 'failed',
        "failure_count" = "failure_count" + 1,
        "last_error_code" = SQLSTATE,
        "updated_at" = statement_timestamp(),
        "completed_at" = NULL
    WHERE "job_key" = 'privacy_fields_v1';

    RETURN QUERY SELECT 0, v_remaining, 'failed'::text, v_last_workspace_id, v_last_event_id;
    RETURN;
  END;
END;
$$;

-- Application callers must use the durable wrapper, not the legacy raising function.
REVOKE EXECUTE ON FUNCTION backfill_product_telemetry_privacy_fields(integer) FROM PUBLIC;
