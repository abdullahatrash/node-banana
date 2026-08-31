CREATE TABLE "runtime_publishing_plan_mutation_receipts" (
	"workspace_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"key_id" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"capability" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"plan_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"validation_session_id" text NOT NULL,
	"validation_submitted_draft_digest" text NOT NULL,
	"validation_definition_digest" text NOT NULL,
	"validation_current_state_digest" text NOT NULL,
	"validation_issued_at" timestamp with time zone NOT NULL,
	"validation_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_publishing_plan_mutation_receipts_pk" PRIMARY KEY("workspace_id","principal_id","capability","idempotency_key"),
	CONSTRAINT "runtime_publishing_plan_mutation_receipts_capability_check" CHECK ("runtime_publishing_plan_mutation_receipts"."capability" = 'publishing_plan_revisions.create@1'),
	CONSTRAINT "runtime_publishing_plan_mutation_receipts_idempotency_key_check" CHECK (length("runtime_publishing_plan_mutation_receipts"."idempotency_key") between 8 and 200 and "runtime_publishing_plan_mutation_receipts"."idempotency_key" ~ '^[!-~]+$'),
	CONSTRAINT "runtime_publishing_plan_mutation_receipts_fingerprint_check" CHECK ("runtime_publishing_plan_mutation_receipts"."request_fingerprint" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "runtime_publishing_plan_mutation_receipts_validation_session_check" CHECK (length("runtime_publishing_plan_mutation_receipts"."validation_session_id") between 1 and 200
        and "runtime_publishing_plan_mutation_receipts"."validation_session_id" ~ '^ppvs_[A-Za-z0-9_-]+$'
        and "runtime_publishing_plan_mutation_receipts"."validation_submitted_draft_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_plan_mutation_receipts"."validation_definition_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_plan_mutation_receipts"."validation_current_state_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_plan_mutation_receipts"."validation_expires_at" > "runtime_publishing_plan_mutation_receipts"."validation_issued_at"),
	CONSTRAINT "runtime_publishing_plan_mutation_receipts_evidence_check" CHECK (length("runtime_publishing_plan_mutation_receipts"."key_id") between 1 and 200
        and length("runtime_publishing_plan_mutation_receipts"."authorization_evidence_ref") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_plan_revisions" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"plan_id" text NOT NULL,
	"revision" integer NOT NULL,
	"definition_digest" text NOT NULL,
	"definition" jsonb NOT NULL,
	"validation_evidence_digest" text NOT NULL,
	"validation_evidence" jsonb NOT NULL,
	"author_principal_id" text NOT NULL,
	"author_key_id" text NOT NULL,
	"creation_authorization_evidence_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_publishing_plan_revisions_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_plan_revisions_revision_check" CHECK ("runtime_publishing_plan_revisions"."revision" > 0),
	CONSTRAINT "runtime_publishing_plan_revisions_identity_check" CHECK (length("runtime_publishing_plan_revisions"."id") between 1 and 200
        and "runtime_publishing_plan_revisions"."id" ~ '^[A-Za-z0-9_-]+$'
        and length("runtime_publishing_plan_revisions"."plan_id") between 1 and 200
        and "runtime_publishing_plan_revisions"."plan_id" ~ '^[A-Za-z0-9_-]+$'),
	CONSTRAINT "runtime_publishing_plan_revisions_digest_check" CHECK ("runtime_publishing_plan_revisions"."definition_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_plan_revisions"."validation_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "runtime_publishing_plan_revisions_definition_check" CHECK (jsonb_typeof("runtime_publishing_plan_revisions"."definition") = 'object'
        and "runtime_publishing_plan_revisions"."definition" ?& array['schema','planId','channelIds','artifactIds','targets']
        and ("runtime_publishing_plan_revisions"."definition" - array['schema','planId','channelIds','artifactIds','targets']) = '{}'::jsonb
        and "runtime_publishing_plan_revisions"."definition"->>'schema' = 'publishing-plan-revision-definition/v1'
        and "runtime_publishing_plan_revisions"."definition"->>'planId' = "runtime_publishing_plan_revisions"."plan_id"
        and jsonb_typeof("runtime_publishing_plan_revisions"."definition"->'channelIds') = 'array'
        and jsonb_array_length("runtime_publishing_plan_revisions"."definition"->'channelIds') between 1 and 50
        and jsonb_typeof("runtime_publishing_plan_revisions"."definition"->'artifactIds') = 'array'
        and jsonb_array_length("runtime_publishing_plan_revisions"."definition"->'artifactIds') between 1 and 200
        and jsonb_typeof("runtime_publishing_plan_revisions"."definition"->'targets') = 'array'
        and jsonb_array_length("runtime_publishing_plan_revisions"."definition"->'targets') between 1 and 50
        and octet_length("runtime_publishing_plan_revisions"."definition"::text) <= 2097152),
	CONSTRAINT "runtime_publishing_plan_revisions_validation_evidence_check" CHECK (jsonb_typeof("runtime_publishing_plan_revisions"."validation_evidence") = 'object'
        and "runtime_publishing_plan_revisions"."validation_evidence" ?& array['schema','submittedDraftDigest','definitionDigest','currentStateDigest','evaluatedAt','context','runtimePolicy','targets','authorizesExecution']
        and ("runtime_publishing_plan_revisions"."validation_evidence" - array['schema','submittedDraftDigest','definitionDigest','currentStateDigest','evaluatedAt','context','runtimePolicy','targets','authorizesExecution']) = '{}'::jsonb
        and "runtime_publishing_plan_revisions"."validation_evidence"->>'schema' = 'publishing-plan-validation-evidence/v1'
        and "runtime_publishing_plan_revisions"."validation_evidence"->>'submittedDraftDigest' ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_plan_revisions"."validation_evidence"->>'definitionDigest' = "runtime_publishing_plan_revisions"."definition_digest"
        and "runtime_publishing_plan_revisions"."validation_evidence"->>'currentStateDigest' ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_plan_revisions"."validation_evidence"->'authorizesExecution' = 'false'::jsonb
        and jsonb_typeof("runtime_publishing_plan_revisions"."validation_evidence"->'context') = 'object'
        and ("runtime_publishing_plan_revisions"."validation_evidence"->'context') ?& array['contextId','contextDigest','issuedAt','expiresAt','capability','keyId','authorizationEvidenceRef','authorizationContractDigest','resources']
        and (("runtime_publishing_plan_revisions"."validation_evidence"->'context') - array['contextId','contextDigest','issuedAt','expiresAt','capability','keyId','authorizationEvidenceRef','authorizationContractDigest','resources']) = '{}'::jsonb
        and "runtime_publishing_plan_revisions"."validation_evidence"->'context'->>'contextDigest' ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_plan_revisions"."validation_evidence"->'context'->>'authorizationContractDigest' = 'sha256:542668629b3974c08f2262f4a23c6a8ca495b30361129d2e1c3677934d5a8378'
        and "runtime_publishing_plan_revisions"."validation_evidence"->'context'->>'capability' = 'publishing_plan_revisions.create@1'
        and "runtime_publishing_plan_revisions"."validation_evidence"->'context'->>'keyId' = "runtime_publishing_plan_revisions"."author_key_id"
        and "runtime_publishing_plan_revisions"."validation_evidence"->'context'->>'authorizationEvidenceRef' = "runtime_publishing_plan_revisions"."creation_authorization_evidence_ref"
        and jsonb_typeof("runtime_publishing_plan_revisions"."validation_evidence"->'context'->'resources') = 'object'
        and ("runtime_publishing_plan_revisions"."validation_evidence"->'context'->'resources') ?& array['channelIds','artifactIds']
        and (("runtime_publishing_plan_revisions"."validation_evidence"->'context'->'resources') - array['channelIds','artifactIds']) = '{}'::jsonb
        and jsonb_typeof("runtime_publishing_plan_revisions"."validation_evidence"->'context'->'resources'->'channelIds') = 'array'
        and jsonb_typeof("runtime_publishing_plan_revisions"."validation_evidence"->'context'->'resources'->'artifactIds') = 'array'
        and ("runtime_publishing_plan_revisions"."validation_evidence"->'context'->>'expiresAt')::timestamptz > ("runtime_publishing_plan_revisions"."validation_evidence"->'context'->>'issuedAt')::timestamptz
        and ("runtime_publishing_plan_revisions"."validation_evidence"->>'evaluatedAt')::timestamptz >= ("runtime_publishing_plan_revisions"."validation_evidence"->'context'->>'issuedAt')::timestamptz
        and ("runtime_publishing_plan_revisions"."validation_evidence"->>'evaluatedAt')::timestamptz < ("runtime_publishing_plan_revisions"."validation_evidence"->'context'->>'expiresAt')::timestamptz
        and jsonb_typeof("runtime_publishing_plan_revisions"."validation_evidence"->'runtimePolicy') = 'object'
        and ("runtime_publishing_plan_revisions"."validation_evidence"->'runtimePolicy') ?& array['identity','contractDigest']
        and (("runtime_publishing_plan_revisions"."validation_evidence"->'runtimePolicy') - array['identity','contractDigest']) = '{}'::jsonb
        and "runtime_publishing_plan_revisions"."validation_evidence"->'runtimePolicy'->>'contractDigest' ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof("runtime_publishing_plan_revisions"."validation_evidence"->'targets') = 'array'
        and jsonb_array_length("runtime_publishing_plan_revisions"."validation_evidence"->'targets') = jsonb_array_length("runtime_publishing_plan_revisions"."definition"->'targets')
        and octet_length("runtime_publishing_plan_revisions"."validation_evidence"::text) <= 2097152),
	CONSTRAINT "runtime_publishing_plan_revisions_authorization_evidence_check" CHECK (length("runtime_publishing_plan_revisions"."author_key_id") between 1 and 200
        and length("runtime_publishing_plan_revisions"."creation_authorization_evidence_ref") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_plans" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"created_by_principal_id" text NOT NULL,
	"created_by_key_id" text NOT NULL,
	"creation_authorization_evidence_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_publishing_plans_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_plans_current_revision_check" CHECK ("runtime_publishing_plans"."current_revision" >= 0),
	CONSTRAINT "runtime_publishing_plans_identity_check" CHECK (length("runtime_publishing_plans"."id") between 1 and 200 and "runtime_publishing_plans"."id" ~ '^[A-Za-z0-9_-]+$'),
	CONSTRAINT "runtime_publishing_plans_evidence_check" CHECK (length("runtime_publishing_plans"."created_by_key_id") between 1 and 200
        and length("runtime_publishing_plans"."creation_authorization_evidence_ref") between 1 and 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_plan_revisions_workspace_plan_revision_unique" ON "runtime_publishing_plan_revisions" USING btree ("workspace_id","plan_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_plan_revisions_workspace_plan_id_unique" ON "runtime_publishing_plan_revisions" USING btree ("workspace_id","plan_id","id");--> statement-breakpoint
ALTER TABLE "runtime_publishing_plan_mutation_receipts" ADD CONSTRAINT "runtime_publishing_plan_mutation_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plan_mutation_receipts" ADD CONSTRAINT "runtime_publishing_plan_mutation_receipts_workspace_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plan_mutation_receipts" ADD CONSTRAINT "runtime_publishing_plan_mutation_receipts_key_fk" FOREIGN KEY ("principal_id","key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plan_mutation_receipts" ADD CONSTRAINT "runtime_publishing_plan_mutation_receipts_authorization_evidence_fk" FOREIGN KEY ("workspace_id","principal_id","key_id","authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plan_mutation_receipts" ADD CONSTRAINT "runtime_publishing_plan_mutation_receipts_revision_fk" FOREIGN KEY ("workspace_id","plan_id","revision_id") REFERENCES "public"."runtime_publishing_plan_revisions"("workspace_id","plan_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plan_revisions" ADD CONSTRAINT "runtime_publishing_plan_revisions_workspace_plan_fk" FOREIGN KEY ("workspace_id","plan_id") REFERENCES "public"."runtime_publishing_plans"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plan_revisions" ADD CONSTRAINT "runtime_publishing_plan_revisions_workspace_author_fk" FOREIGN KEY ("workspace_id","author_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plan_revisions" ADD CONSTRAINT "runtime_publishing_plan_revisions_author_key_fk" FOREIGN KEY ("author_principal_id","author_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plan_revisions" ADD CONSTRAINT "runtime_publishing_plan_revisions_creation_authorization_evidence_fk" FOREIGN KEY ("workspace_id","author_principal_id","author_key_id","creation_authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plans" ADD CONSTRAINT "runtime_publishing_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plans" ADD CONSTRAINT "runtime_publishing_plans_workspace_creator_fk" FOREIGN KEY ("workspace_id","created_by_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plans" ADD CONSTRAINT "runtime_publishing_plans_creator_key_fk" FOREIGN KEY ("created_by_principal_id","created_by_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_plans" ADD CONSTRAINT "runtime_publishing_plans_creation_authorization_evidence_fk" FOREIGN KEY ("workspace_id","created_by_principal_id","created_by_key_id","creation_authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_publishing_plan_mutation_receipts_key_idx" ON "runtime_publishing_plan_mutation_receipts" USING btree ("principal_id","key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_plan_mutation_receipts_authorization_evidence_idx" ON "runtime_publishing_plan_mutation_receipts" USING btree ("workspace_id","principal_id","key_id","authorization_evidence_ref");--> statement-breakpoint
CREATE INDEX "runtime_publishing_plan_mutation_receipts_revision_idx" ON "runtime_publishing_plan_mutation_receipts" USING btree ("workspace_id","plan_id","revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_plan_mutation_receipts_validation_session_unique" ON "runtime_publishing_plan_mutation_receipts" USING btree ("workspace_id","validation_session_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_plan_mutation_receipts_workspace_created_idx" ON "runtime_publishing_plan_mutation_receipts" USING btree ("workspace_id","created_at","idempotency_key");--> statement-breakpoint
CREATE INDEX "runtime_publishing_plan_revisions_workspace_created_idx" ON "runtime_publishing_plan_revisions" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runtime_publishing_plan_revisions_workspace_plan_created_idx" ON "runtime_publishing_plan_revisions" USING btree ("workspace_id","plan_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runtime_publishing_plan_revisions_workspace_author_idx" ON "runtime_publishing_plan_revisions" USING btree ("workspace_id","author_principal_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_plan_revisions_author_key_idx" ON "runtime_publishing_plan_revisions" USING btree ("author_principal_id","author_key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_plan_revisions_creation_authorization_evidence_idx" ON "runtime_publishing_plan_revisions" USING btree ("workspace_id","author_principal_id","author_key_id","creation_authorization_evidence_ref");--> statement-breakpoint
CREATE INDEX "runtime_publishing_plans_workspace_updated_idx" ON "runtime_publishing_plans" USING btree ("workspace_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runtime_publishing_plans_workspace_creator_idx" ON "runtime_publishing_plans" USING btree ("workspace_id","created_by_principal_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_plans_creator_key_idx" ON "runtime_publishing_plans" USING btree ("created_by_principal_id","created_by_key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_plans_creation_authorization_evidence_idx" ON "runtime_publishing_plans" USING btree ("workspace_id","created_by_principal_id","created_by_key_id","creation_authorization_evidence_ref");--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_plan_history_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_plan_revisions_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_plan_revisions"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_plan_history_guard"();--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_plan_mutation_receipts_insert_only"
BEFORE UPDATE OR DELETE ON "runtime_publishing_plan_mutation_receipts"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_plan_history_guard"();--> statement-breakpoint
CREATE FUNCTION "runtime_publishing_plan_head_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'Publishing Plan identities cannot be deleted';
	END IF;
	IF (to_jsonb(NEW) - ARRAY['current_revision', 'updated_at'])
		<> (to_jsonb(OLD) - ARRAY['current_revision', 'updated_at']) THEN
		RAISE EXCEPTION 'Publishing Plan provenance is immutable';
	END IF;
	IF NEW.current_revision <> OLD.current_revision + 1 THEN
		RAISE EXCEPTION 'Publishing Plan revision must advance by exactly one';
	END IF;
	IF NEW.updated_at < OLD.updated_at THEN
		RAISE EXCEPTION 'Publishing Plan updated_at cannot move backward';
	END IF;
	IF NOT EXISTS (
		SELECT 1
		FROM "runtime_publishing_plan_revisions" AS revision
		WHERE revision."workspace_id" = NEW.workspace_id
			AND revision."plan_id" = NEW.id
			AND revision."revision" = NEW.current_revision
	) THEN
		RAISE EXCEPTION 'Publishing Plan head must reference an immutable revision';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "runtime_publishing_plans_identity_immutable"
BEFORE UPDATE OR DELETE ON "runtime_publishing_plans"
FOR EACH ROW EXECUTE FUNCTION "runtime_publishing_plan_head_guard"();
