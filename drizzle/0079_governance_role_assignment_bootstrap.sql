-- Canonical Workspace Role activation: backfill every existing member before
-- application authorization stops consulting the legacy membership role.
INSERT INTO "workspace_governance_resources" (
  "workspace_id", "kind", "id", "version", "status", "body",
  "created_by_user_id", "created_at", "updated_at"
)
SELECT
  wm."workspace_id",
  'member_role_assignment',
  wm."user_id",
  1,
  'active',
  jsonb_build_object(
    'userId', wm."user_id",
    'binding', jsonb_build_object(
      'kind', 'built_in',
      'role', CASE wm."role"
        WHEN 'owner' THEN 'owner'
        WHEN 'admin' THEN 'admin'
        ELSE 'creator'
      END
    ),
    'assignedByUserId', wm."user_id",
    'assignedAt', wm."created_at"
  ),
  wm."user_id",
  wm."created_at",
  wm."updated_at"
FROM "workspace_members" wm
JOIN "workspaces" w ON w."id" = wm."workspace_id" AND w."deleted_at" IS NULL
ON CONFLICT ("workspace_id", "kind", "id") DO NOTHING;

-- Every future canonical membership insertion provisions its immutable initial
-- built-in role binding in the same database transaction. Explicit Custom Role
-- assignments are never overwritten by this trigger.
CREATE OR REPLACE FUNCTION governance_provision_member_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "workspace_governance_resources" (
    "workspace_id", "kind", "id", "version", "status", "body",
    "created_by_user_id", "created_at", "updated_at"
  ) VALUES (
    NEW."workspace_id",
    'member_role_assignment',
    NEW."user_id",
    1,
    'active',
    jsonb_build_object(
      'userId', NEW."user_id",
      'binding', jsonb_build_object(
        'kind', 'built_in',
        'role', CASE NEW."role"
          WHEN 'owner' THEN 'owner'
          WHEN 'admin' THEN 'admin'
          ELSE 'creator'
        END
      ),
      'assignedByUserId', NEW."user_id",
      'assignedAt', NEW."created_at"
    ),
    NEW."user_id",
    NEW."created_at",
    NEW."updated_at"
  )
  ON CONFLICT ("workspace_id", "kind", "id") DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "workspace_members_governance_role_assignment" ON "workspace_members";
CREATE TRIGGER "workspace_members_governance_role_assignment"
AFTER INSERT ON "workspace_members"
FOR EACH ROW EXECUTE FUNCTION governance_provision_member_role_assignment();
