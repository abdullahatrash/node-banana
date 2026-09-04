CREATE FUNCTION valid_workflow_run_studio_asset_references(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  RETURN jsonb_array_length(value) <= 100
    AND jsonb_array_length(value) = (
      SELECT count(DISTINCT item->>'assetId') FROM jsonb_array_elements(value) item
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) item
      WHERE jsonb_typeof(item) <> 'object'
        OR NOT (item ?& ARRAY['assetId','digest','type','mediaType','sizeBytes','width','height','durationSeconds'])
        OR (item - ARRAY['assetId','digest','type','mediaType','sizeBytes','width','height','durationSeconds']) <> '{}'::jsonb
        OR jsonb_typeof(item->'assetId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'digest') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'type') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'mediaType') IS DISTINCT FROM 'string'
        OR NOT (item->>'assetId' ~ '^[a-zA-Z0-9_-]{1,200}$')
        OR NOT (item->>'digest' ~ '^sha256:[0-9a-f]{64}$')
        OR item->>'type' NOT IN ('image','video','audio','model3d','workflow')
        OR length(item->>'mediaType') NOT BETWEEN 1 AND 200
        OR CASE
          WHEN jsonb_typeof(item->'sizeBytes') = 'number' AND item->>'sizeBytes' ~ '^(0|[1-9][0-9]*)$'
            THEN (item->>'sizeBytes')::numeric > 9007199254740991
          ELSE true
        END
        OR NOT (jsonb_typeof(item->'width') = 'null' OR (jsonb_typeof(item->'width') = 'number' AND item->>'width' ~ '^[1-9][0-9]*$'))
        OR NOT (jsonb_typeof(item->'height') = 'null' OR (jsonb_typeof(item->'height') = 'number' AND item->>'height' ~ '^[1-9][0-9]*$'))
        OR NOT (jsonb_typeof(item->'durationSeconds') = 'null' OR (jsonb_typeof(item->'durationSeconds') = 'number' AND item->>'durationSeconds' ~ '^(0|[1-9][0-9]*)$'))
    );
END;
$$;
--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_snapshot_check";
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_snapshot_check" CHECK (
  jsonb_typeof("start_snapshot") = 'object'
  AND "start_snapshot"->>'schema' IN ('workflow-run-start-snapshot/v1', 'workflow-run-start-snapshot/v2', 'workflow-run-start-snapshot/v3')
  AND (
    "start_snapshot"->>'schema' = 'workflow-run-start-snapshot/v1'
    OR (
      jsonb_typeof("start_snapshot"->'providerResolutions') = 'array'
      AND jsonb_array_length("start_snapshot"->'providerResolutions') > 0
    )
  )
  AND (
    "start_snapshot"->>'schema' <> 'workflow-run-start-snapshot/v3'
    OR valid_workflow_run_studio_asset_references("start_snapshot"->'studioAssetReferences')
  )
  AND "start_snapshot"->>'workflowId' = "workflow_id"
  AND "start_snapshot"->>'workflowRevisionId' = "workflow_revision_id"
  AND "start_snapshot"->'authorization'->>'principalId' = "principal_id"
  AND "start_snapshot"->'authorization'->>'keyId' = "key_id"
  AND "start_snapshot"->'authorization'->>'evidenceRef' = "authorization_evidence_ref"
  AND octet_length("start_snapshot"::text) <= 1048576
);
