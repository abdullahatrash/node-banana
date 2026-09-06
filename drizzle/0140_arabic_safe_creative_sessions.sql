CREATE TABLE IF NOT EXISTS creative_generation_sessions (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT creative_generation_sessions_binding CHECK (
    snapshot->>'workspaceId' = workspace_id AND snapshot->>'id' = id
    AND (snapshot->>'revision')::integer = revision
  )
);

CREATE TABLE IF NOT EXISTS creative_generation_revisions (
  workspace_id text NOT NULL,
  id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL,
  author_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, id, revision),
  FOREIGN KEY (workspace_id, id) REFERENCES creative_generation_sessions(workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS creative_generation_command_receipts (
  workspace_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  session_id text NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, session_id, revision) REFERENCES creative_generation_revisions(workspace_id, id, revision) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION prevent_creative_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Creative generation revisions and command receipts are immutable';
END;
$$;
CREATE TRIGGER creative_revisions_immutable BEFORE UPDATE OR DELETE ON creative_generation_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_creative_revision_mutation();
CREATE TRIGGER creative_receipts_immutable BEFORE UPDATE OR DELETE ON creative_generation_command_receipts
FOR EACH ROW EXECUTE FUNCTION prevent_creative_revision_mutation();
