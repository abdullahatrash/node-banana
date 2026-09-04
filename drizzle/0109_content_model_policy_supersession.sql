DROP INDEX "content_model_policy_revisions_active_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "content_model_policy_revisions_exact_identity_unique" ON "content_model_policy_revisions" ("workspace_id","id","revision","format","policy_digest");
--> statement-breakpoint
CREATE INDEX "content_model_policy_revisions_status_idx" ON "content_model_policy_revisions" ("workspace_id","format","status","revision");
--> statement-breakpoint
ALTER TABLE "content_model_policy_revisions" ADD CONSTRAINT "content_model_policy_revisions_document_binding_check" CHECK (
  "policy"->>'id' = "id"
  AND ("policy"->>'revision')::integer = "revision"
  AND "policy"->>'format' = "format"
  AND "policy"->>'digest' = "policy_digest"
);
--> statement-breakpoint
CREATE TABLE "content_model_policy_currents" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "format" text NOT NULL,
  "policy_id" text NOT NULL,
  "policy_revision" integer NOT NULL,
  "policy_digest" text NOT NULL,
  "promoted_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "content_model_policy_currents_pk" PRIMARY KEY ("workspace_id","format"),
  CONSTRAINT "content_model_policy_currents_revision_check" CHECK ("policy_revision" > 0 AND "policy_digest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "content_model_policy_currents_policy_fk" FOREIGN KEY ("workspace_id","policy_id","policy_revision","format","policy_digest") REFERENCES "content_model_policy_revisions" ("workspace_id","id","revision","format","policy_digest") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE "content_model_policy_supersessions" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  "format" text NOT NULL,
  "predecessor_policy_id" text NOT NULL,
  "predecessor_policy_revision" integer NOT NULL,
  "predecessor_policy_digest" text NOT NULL,
  "successor_policy_id" text NOT NULL,
  "successor_policy_revision" integer NOT NULL,
  "successor_policy_digest" text NOT NULL,
  "superseded_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "content_model_policy_supersessions_pk" PRIMARY KEY ("workspace_id","format","successor_policy_id","successor_policy_revision"),
  CONSTRAINT "content_model_policy_supersessions_predecessor_unique" UNIQUE ("workspace_id","format","predecessor_policy_id","predecessor_policy_revision"),
  CONSTRAINT "content_model_policy_supersessions_revision_check" CHECK ("successor_policy_revision" > "predecessor_policy_revision" AND "predecessor_policy_digest" ~ '^sha256:[a-f0-9]{64}$' AND "successor_policy_digest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "content_model_policy_supersessions_predecessor_fk" FOREIGN KEY ("workspace_id","predecessor_policy_id","predecessor_policy_revision","format","predecessor_policy_digest") REFERENCES "content_model_policy_revisions" ("workspace_id","id","revision","format","policy_digest") ON DELETE RESTRICT,
  CONSTRAINT "content_model_policy_supersessions_successor_fk" FOREIGN KEY ("workspace_id","successor_policy_id","successor_policy_revision","format","successor_policy_digest") REFERENCES "content_model_policy_revisions" ("workspace_id","id","revision","format","policy_digest") ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO "content_model_policy_currents" ("workspace_id","format","policy_id","policy_revision","policy_digest","promoted_at")
SELECT "workspace_id","format","id","revision","policy_digest","created_at"
FROM (
  SELECT evidence.*, row_number() OVER (PARTITION BY "workspace_id","format" ORDER BY "revision" DESC,"created_at" DESC,"id" DESC) AS current_rank
  FROM "content_model_policy_revisions" evidence
  WHERE "status" = 'active'
) ranked
WHERE current_rank = 1;
--> statement-breakpoint
CREATE FUNCTION guard_content_model_policy_current_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'current content model policy pointers cannot be deleted';
  END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.format <> OLD.format THEN
    RAISE EXCEPTION 'content model policy current identity is immutable';
  END IF;
  IF NEW.policy_revision <= OLD.policy_revision THEN
    RAISE EXCEPTION 'content model policy supersession must advance monotonically';
  END IF;
  INSERT INTO "content_model_policy_supersessions" (
    "workspace_id","format","predecessor_policy_id","predecessor_policy_revision","predecessor_policy_digest","successor_policy_id","successor_policy_revision","successor_policy_digest","superseded_at"
  ) VALUES (
    OLD.workspace_id,OLD.format,OLD.policy_id,OLD.policy_revision,OLD.policy_digest,NEW.policy_id,NEW.policy_revision,NEW.policy_digest,clock_timestamp()
  );
  NEW.promoted_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "content_model_policy_currents_transition_guard" BEFORE UPDATE OR DELETE ON "content_model_policy_currents" FOR EACH ROW EXECUTE FUNCTION guard_content_model_policy_current_transition();
--> statement-breakpoint
CREATE FUNCTION promote_inserted_content_model_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  selected_policy_id text;
  selected_policy_revision integer;
  selected_policy_digest text;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  INSERT INTO "content_model_policy_currents" ("workspace_id","format","policy_id","policy_revision","policy_digest","promoted_at")
  VALUES (NEW.workspace_id,NEW.format,NEW.id,NEW.revision,NEW.policy_digest,clock_timestamp())
  ON CONFLICT ("workspace_id","format") DO UPDATE SET
    "policy_id" = EXCLUDED."policy_id",
    "policy_revision" = EXCLUDED."policy_revision",
    "policy_digest" = EXCLUDED."policy_digest"
  WHERE "content_model_policy_currents"."policy_revision" < EXCLUDED."policy_revision";

  SELECT "policy_id","policy_revision","policy_digest"
  INTO selected_policy_id,selected_policy_revision,selected_policy_digest
  FROM "content_model_policy_currents"
  WHERE "workspace_id" = NEW.workspace_id AND "format" = NEW.format;

  IF selected_policy_id <> NEW.id OR selected_policy_revision <> NEW.revision OR selected_policy_digest <> NEW.policy_digest THEN
    RAISE EXCEPTION 'stale content model policy cannot become current';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "content_model_policy_revisions_promote_current" AFTER INSERT ON "content_model_policy_revisions" FOR EACH ROW EXECUTE FUNCTION promote_inserted_content_model_policy();
--> statement-breakpoint
CREATE FUNCTION prevent_content_model_policy_supersession_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'content model policy supersession evidence is immutable'; END; $$;
--> statement-breakpoint
CREATE TRIGGER "content_model_policy_supersessions_immutable" BEFORE UPDATE OR DELETE ON "content_model_policy_supersessions" FOR EACH ROW EXECUTE FUNCTION prevent_content_model_policy_supersession_mutation();
