CREATE TABLE "runtime_publishing_approval_authority_grants" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"subject_role_at_issue" text NOT NULL,
	"channel_id" text NOT NULL,
	"action" text NOT NULL,
	"issued_by_user_id" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "runtime_publishing_approval_authority_grants_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_approval_authority_grants_identity_check" CHECK (length("runtime_publishing_approval_authority_grants"."id") between 1 and 200
        and "runtime_publishing_approval_authority_grants"."id" ~ '^paag_[A-Za-z0-9_-]+$'),
	CONSTRAINT "runtime_publishing_approval_authority_grants_action_check" CHECK ("runtime_publishing_approval_authority_grants"."action" = 'publish'
        and "runtime_publishing_approval_authority_grants"."subject_role_at_issue" in ('owner','admin')),
	CONSTRAINT "runtime_publishing_approval_authority_grants_expiry_check" CHECK ("runtime_publishing_approval_authority_grants"."expires_at" is null or "runtime_publishing_approval_authority_grants"."expires_at" > "runtime_publishing_approval_authority_grants"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_approval_authority_mutation_receipts" (
	"workspace_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"capability" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"grant_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_approval_authority_mutation_receipts_pk" PRIMARY KEY("workspace_id","actor_user_id","capability","idempotency_key"),
	CONSTRAINT "runtime_publishing_approval_authority_mutation_receipts_capability_check" CHECK ("runtime_publishing_approval_authority_mutation_receipts"."capability" in (
        'publishing_approval_authority.issue@1',
        'publishing_approval_authority.revoke@1'
      )),
	CONSTRAINT "runtime_publishing_approval_authority_mutation_receipts_idempotency_check" CHECK (length("runtime_publishing_approval_authority_mutation_receipts"."idempotency_key") between 8 and 200
        and "runtime_publishing_approval_authority_mutation_receipts"."idempotency_key" ~ '^[!-~]+$'
        and "runtime_publishing_approval_authority_mutation_receipts"."request_fingerprint" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_approval_authority_revocations" (
	"workspace_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"revoked_by_user_id" text NOT NULL,
	"revoked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_approval_authority_revocations_pk" PRIMARY KEY("workspace_id","grant_id")
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_approval_consumptions" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"approval_request_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"consuming_principal_id" text NOT NULL,
	"consuming_key_id" text NOT NULL,
	"capability" text NOT NULL,
	"authorization_contract_digest" text NOT NULL,
	"authorization_evidence_ref" text NOT NULL,
	"authorized_resources" jsonb NOT NULL,
	"authorization_issued_at" timestamp with time zone NOT NULL,
	"authorization_expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_approval_consumptions_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_approval_consumptions_identity_check" CHECK (length("runtime_publishing_approval_consumptions"."id") between 1 and 200
        and "runtime_publishing_approval_consumptions"."id" ~ '^pac_[A-Za-z0-9_-]+$'),
	CONSTRAINT "runtime_publishing_approval_consumptions_authorization_check" CHECK ("runtime_publishing_approval_consumptions"."capability" = 'publishing_plan_revisions.release@1'
        and "runtime_publishing_approval_consumptions"."authorization_contract_digest" = 'sha256:487fcf4d881ef927ada89e11c1851b402bf414c1083c8d6618644d503aa1e80e'
        and length("runtime_publishing_approval_consumptions"."authorization_evidence_ref") between 1 and 200
        and jsonb_typeof("runtime_publishing_approval_consumptions"."authorized_resources") = 'object'
        and "runtime_publishing_approval_consumptions"."authorized_resources" ?& array['channelIds','artifactIds']
        and ("runtime_publishing_approval_consumptions"."authorized_resources" - array['channelIds','artifactIds']) = '{}'::jsonb
        and jsonb_typeof("runtime_publishing_approval_consumptions"."authorized_resources"->'channelIds') = 'array'
        and jsonb_array_length("runtime_publishing_approval_consumptions"."authorized_resources"->'channelIds') between 1 and 50
        and jsonb_typeof("runtime_publishing_approval_consumptions"."authorized_resources"->'artifactIds') = 'array'
        and jsonb_array_length("runtime_publishing_approval_consumptions"."authorized_resources"->'artifactIds') between 1 and 200
        and "runtime_publishing_approval_consumptions"."authorization_expires_at" > "runtime_publishing_approval_consumptions"."authorization_issued_at"
        and "runtime_publishing_approval_consumptions"."consumed_at" >= "runtime_publishing_approval_consumptions"."authorization_issued_at"
        and "runtime_publishing_approval_consumptions"."consumed_at" < "runtime_publishing_approval_consumptions"."authorization_expires_at")
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_approval_decisions" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"request_id" text NOT NULL,
	"outcome" text NOT NULL,
	"decided_by_user_id" text NOT NULL,
	"authority_evidence_ref" text NOT NULL,
	"authority_evidence_digest" text NOT NULL,
	"authority_grants" jsonb NOT NULL,
	"inspection_digest" text NOT NULL,
	"authorizes_execution" boolean DEFAULT false NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_approval_decisions_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_approval_decisions_identity_check" CHECK (length("runtime_publishing_approval_decisions"."id") between 1 and 200
        and "runtime_publishing_approval_decisions"."id" ~ '^pad_[A-Za-z0-9_-]+$'
        and length("runtime_publishing_approval_decisions"."authority_evidence_ref") between 1 and 200),
	CONSTRAINT "runtime_publishing_approval_decisions_outcome_check" CHECK ("runtime_publishing_approval_decisions"."outcome" in ('approved','denied')),
	CONSTRAINT "runtime_publishing_approval_decisions_authority_check" CHECK ("runtime_publishing_approval_decisions"."authority_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_approval_decisions"."inspection_digest" ~ '^sha256:[a-f0-9]{64}$'
        and jsonb_typeof("runtime_publishing_approval_decisions"."authority_grants") = 'array'
        and jsonb_array_length("runtime_publishing_approval_decisions"."authority_grants") between 1 and 50
        and octet_length("runtime_publishing_approval_decisions"."authority_grants"::text) <= 16384),
	CONSTRAINT "runtime_publishing_approval_decisions_no_execution_authority_check" CHECK ("runtime_publishing_approval_decisions"."authorizes_execution" = false)
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_approval_mutation_receipts" (
	"workspace_id" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"capability" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"principal_id" text,
	"key_id" text,
	"authorization_evidence_ref" text,
	"user_id" text,
	"approval_request_id" text NOT NULL,
	"decision_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_approval_mutation_receipts_pk" PRIMARY KEY("workspace_id","actor_kind","actor_id","capability","idempotency_key"),
	CONSTRAINT "runtime_publishing_approval_mutation_receipts_actor_check" CHECK (("runtime_publishing_approval_mutation_receipts"."actor_kind" = 'agent'
          and "runtime_publishing_approval_mutation_receipts"."actor_id" = "runtime_publishing_approval_mutation_receipts"."principal_id"
          and "runtime_publishing_approval_mutation_receipts"."principal_id" is not null
          and "runtime_publishing_approval_mutation_receipts"."key_id" is not null
          and "runtime_publishing_approval_mutation_receipts"."authorization_evidence_ref" is not null
          and "runtime_publishing_approval_mutation_receipts"."user_id" is null)
        or ("runtime_publishing_approval_mutation_receipts"."actor_kind" = 'human'
          and "runtime_publishing_approval_mutation_receipts"."actor_id" = "runtime_publishing_approval_mutation_receipts"."user_id"
          and "runtime_publishing_approval_mutation_receipts"."user_id" is not null
          and "runtime_publishing_approval_mutation_receipts"."principal_id" is null
          and "runtime_publishing_approval_mutation_receipts"."key_id" is null
          and "runtime_publishing_approval_mutation_receipts"."authorization_evidence_ref" is null)),
	CONSTRAINT "runtime_publishing_approval_mutation_receipts_capability_check" CHECK ("runtime_publishing_approval_mutation_receipts"."capability" in (
          'publishing_approvals.request@1',
          'publishing_approvals.decide@1'
        )),
	CONSTRAINT "runtime_publishing_approval_mutation_receipts_idempotency_key_check" CHECK (length("runtime_publishing_approval_mutation_receipts"."idempotency_key") between 8 and 200
        and "runtime_publishing_approval_mutation_receipts"."idempotency_key" ~ '^[!-~]+$'),
	CONSTRAINT "runtime_publishing_approval_mutation_receipts_digest_check" CHECK ("runtime_publishing_approval_mutation_receipts"."request_fingerprint" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "runtime_publishing_approval_mutation_receipts_result_check" CHECK (length("runtime_publishing_approval_mutation_receipts"."approval_request_id") between 1 and 200
        and ("runtime_publishing_approval_mutation_receipts"."decision_id" is null or length("runtime_publishing_approval_mutation_receipts"."decision_id") between 1 and 200)
        and (("runtime_publishing_approval_mutation_receipts"."capability" = 'publishing_approvals.request@1' and "runtime_publishing_approval_mutation_receipts"."decision_id" is null)
          or ("runtime_publishing_approval_mutation_receipts"."capability" = 'publishing_approvals.decide@1' and "runtime_publishing_approval_mutation_receipts"."decision_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "runtime_publishing_approval_requests" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_revision_id" text NOT NULL,
	"plan_revision" integer NOT NULL,
	"plan_revision_digest" text NOT NULL,
	"action" text NOT NULL,
	"target_ids" jsonb NOT NULL,
	"target_set_digest" text NOT NULL,
	"channel_ids" jsonb NOT NULL,
	"artifact_ids" jsonb NOT NULL,
	"requesting_principal_id" text NOT NULL,
	"requesting_key_id" text NOT NULL,
	"request_authorization_capability" text NOT NULL,
	"request_authorization_contract_digest" text NOT NULL,
	"request_authorization_evidence_ref" text NOT NULL,
	"validation_evidence_digest" text NOT NULL,
	"validation_current_state_digest" text NOT NULL,
	"validation_context_id" text NOT NULL,
	"validation_context_digest" text NOT NULL,
	"validation_evaluated_at" timestamp with time zone NOT NULL,
	"validation_expires_at" timestamp with time zone NOT NULL,
	"validation_runtime_policy_identity" text NOT NULL,
	"validation_runtime_policy_contract_digest" text NOT NULL,
	"decision_policy_mode" text NOT NULL,
	"decision_policy_expires_at" timestamp with time zone NOT NULL,
	"authorizes_execution" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtime_publishing_approval_requests_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "runtime_publishing_approval_requests_identity_check" CHECK (length("runtime_publishing_approval_requests"."id") between 1 and 200
        and "runtime_publishing_approval_requests"."id" ~ '^par_[A-Za-z0-9_-]+$'
        and "runtime_publishing_approval_requests"."plan_revision" > 0),
	CONSTRAINT "runtime_publishing_approval_requests_action_check" CHECK ("runtime_publishing_approval_requests"."action" = 'publish'),
	CONSTRAINT "runtime_publishing_approval_requests_digest_check" CHECK ("runtime_publishing_approval_requests"."plan_revision_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_approval_requests"."target_set_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_approval_requests"."request_authorization_contract_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_approval_requests"."validation_evidence_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_approval_requests"."validation_current_state_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_approval_requests"."validation_context_digest" ~ '^sha256:[a-f0-9]{64}$'
        and "runtime_publishing_approval_requests"."validation_runtime_policy_contract_digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "runtime_publishing_approval_requests_target_set_check" CHECK (jsonb_typeof("runtime_publishing_approval_requests"."target_ids") = 'array'
        and jsonb_array_length("runtime_publishing_approval_requests"."target_ids") between 1 and 50
        and octet_length("runtime_publishing_approval_requests"."target_ids"::text) <= 16384
        and jsonb_typeof("runtime_publishing_approval_requests"."channel_ids") = 'array'
        and jsonb_array_length("runtime_publishing_approval_requests"."channel_ids") between 1 and 50
        and octet_length("runtime_publishing_approval_requests"."channel_ids"::text) <= 16384
        and jsonb_typeof("runtime_publishing_approval_requests"."artifact_ids") = 'array'
        and jsonb_array_length("runtime_publishing_approval_requests"."artifact_ids") between 1 and 200
        and octet_length("runtime_publishing_approval_requests"."artifact_ids"::text) <= 65536),
	CONSTRAINT "runtime_publishing_approval_requests_validation_check" CHECK (length("runtime_publishing_approval_requests"."validation_context_id") between 1 and 200
        and "runtime_publishing_approval_requests"."validation_runtime_policy_identity" = 'publishing-runtime-policy/default@1'
        and "runtime_publishing_approval_requests"."validation_runtime_policy_contract_digest" = 'sha256:c372d0a34f6b1ca086ef4cad760db2bbffab1ac5c668fede7f256106305b7cf1'
        and "runtime_publishing_approval_requests"."validation_expires_at" > "runtime_publishing_approval_requests"."validation_evaluated_at"),
	CONSTRAINT "runtime_publishing_approval_requests_request_authorization_check" CHECK ("runtime_publishing_approval_requests"."request_authorization_capability" = 'publishing_approvals.request@1'
        and "runtime_publishing_approval_requests"."request_authorization_contract_digest" = 'sha256:9d46d813238045c0ba3924966834418c9f508741890f3aa81c5a494227e42892'
        and length("runtime_publishing_approval_requests"."request_authorization_evidence_ref") between 1 and 200),
	CONSTRAINT "runtime_publishing_approval_requests_decision_policy_check" CHECK ("runtime_publishing_approval_requests"."decision_policy_mode" = 'expires_at'
        and "runtime_publishing_approval_requests"."decision_policy_expires_at" > "runtime_publishing_approval_requests"."created_at"
        and "runtime_publishing_approval_requests"."decision_policy_expires_at" <= "runtime_publishing_approval_requests"."validation_expires_at"),
	CONSTRAINT "runtime_publishing_approval_requests_no_execution_authority_check" CHECK ("runtime_publishing_approval_requests"."authorizes_execution" = false)
);
--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_authority_grants" ADD CONSTRAINT "runtime_publishing_approval_authority_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_authority_grants" ADD CONSTRAINT "runtime_publishing_approval_authority_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_authority_grants" ADD CONSTRAINT "runtime_publishing_approval_authority_grants_issued_by_user_id_user_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_authority_mutation_receipts" ADD CONSTRAINT "runtime_publishing_approval_authority_mutation_receipts_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_authority_mutation_receipts" ADD CONSTRAINT "runtime_publishing_approval_authority_mutation_receipts_grant_fk" FOREIGN KEY ("workspace_id","grant_id") REFERENCES "public"."runtime_publishing_approval_authority_grants"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_authority_revocations" ADD CONSTRAINT "runtime_publishing_approval_authority_revocations_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_authority_revocations" ADD CONSTRAINT "runtime_publishing_approval_authority_revocations_grant_fk" FOREIGN KEY ("workspace_id","grant_id") REFERENCES "public"."runtime_publishing_approval_authority_grants"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_consumptions" ADD CONSTRAINT "runtime_publishing_approval_consumptions_request_fk" FOREIGN KEY ("workspace_id","approval_request_id") REFERENCES "public"."runtime_publishing_approval_requests"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_approval_decisions_request_identity_unique" ON "runtime_publishing_approval_decisions" USING btree ("workspace_id","request_id","id");--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_consumptions" ADD CONSTRAINT "runtime_publishing_approval_consumptions_decision_fk" FOREIGN KEY ("workspace_id","approval_request_id","decision_id") REFERENCES "public"."runtime_publishing_approval_decisions"("workspace_id","request_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_consumptions" ADD CONSTRAINT "runtime_publishing_approval_consumptions_principal_fk" FOREIGN KEY ("workspace_id","consuming_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_consumptions" ADD CONSTRAINT "runtime_publishing_approval_consumptions_key_fk" FOREIGN KEY ("consuming_principal_id","consuming_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_consumptions" ADD CONSTRAINT "runtime_publishing_approval_consumptions_authorization_evidence_fk" FOREIGN KEY ("workspace_id","consuming_principal_id","consuming_key_id","authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_decisions" ADD CONSTRAINT "runtime_publishing_approval_decisions_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_decisions" ADD CONSTRAINT "runtime_publishing_approval_decisions_request_fk" FOREIGN KEY ("workspace_id","request_id") REFERENCES "public"."runtime_publishing_approval_requests"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_mutation_receipts" ADD CONSTRAINT "runtime_publishing_approval_mutation_receipts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_mutation_receipts" ADD CONSTRAINT "runtime_publishing_approval_mutation_receipts_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_mutation_receipts" ADD CONSTRAINT "runtime_publishing_approval_mutation_receipts_key_fk" FOREIGN KEY ("principal_id","key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_mutation_receipts" ADD CONSTRAINT "runtime_publishing_approval_mutation_receipts_authorization_evidence_fk" FOREIGN KEY ("workspace_id","principal_id","key_id","authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_mutation_receipts" ADD CONSTRAINT "runtime_publishing_approval_mutation_receipts_request_fk" FOREIGN KEY ("workspace_id","approval_request_id") REFERENCES "public"."runtime_publishing_approval_requests"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_mutation_receipts" ADD CONSTRAINT "runtime_publishing_approval_mutation_receipts_decision_fk" FOREIGN KEY ("workspace_id","approval_request_id","decision_id") REFERENCES "public"."runtime_publishing_approval_decisions"("workspace_id","request_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_plan_revisions_approval_identity_unique" ON "runtime_publishing_plan_revisions" USING btree ("workspace_id","plan_id","id","revision","definition_digest","validation_evidence_digest");--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_requests" ADD CONSTRAINT "runtime_publishing_approval_requests_revision_fk" FOREIGN KEY ("workspace_id","plan_id","plan_revision_id","plan_revision","plan_revision_digest","validation_evidence_digest") REFERENCES "public"."runtime_publishing_plan_revisions"("workspace_id","plan_id","id","revision","definition_digest","validation_evidence_digest") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_requests" ADD CONSTRAINT "runtime_publishing_approval_requests_requester_fk" FOREIGN KEY ("workspace_id","requesting_principal_id") REFERENCES "public"."agent_principals"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_requests" ADD CONSTRAINT "runtime_publishing_approval_requests_requester_key_fk" FOREIGN KEY ("requesting_principal_id","requesting_key_id") REFERENCES "public"."agent_keys"("principal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_publishing_approval_requests" ADD CONSTRAINT "runtime_publishing_approval_requests_authorization_evidence_fk" FOREIGN KEY ("workspace_id","requesting_principal_id","requesting_key_id","request_authorization_evidence_ref") REFERENCES "public"."agent_authorization_decisions"("workspace_id","principal_id","key_id","operator_trace_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_authority_grants_subject_scope_idx" ON "runtime_publishing_approval_authority_grants" USING btree ("workspace_id","user_id","action","channel_id","expires_at","id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_authority_grants_subject_user_idx" ON "runtime_publishing_approval_authority_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_authority_grants_issuer_idx" ON "runtime_publishing_approval_authority_grants" USING btree ("issued_by_user_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_authority_grants_channel_idx" ON "runtime_publishing_approval_authority_grants" USING btree ("workspace_id","channel_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_authority_mutation_receipts_actor_idx" ON "runtime_publishing_approval_authority_mutation_receipts" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_authority_mutation_receipts_grant_idx" ON "runtime_publishing_approval_authority_mutation_receipts" USING btree ("workspace_id","grant_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_authority_revocations_revoker_idx" ON "runtime_publishing_approval_authority_revocations" USING btree ("revoked_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_approval_consumptions_decision_unique" ON "runtime_publishing_approval_consumptions" USING btree ("workspace_id","decision_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_consumptions_request_idx" ON "runtime_publishing_approval_consumptions" USING btree ("workspace_id","approval_request_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_consumptions_decision_binding_idx" ON "runtime_publishing_approval_consumptions" USING btree ("workspace_id","approval_request_id","decision_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_consumptions_principal_idx" ON "runtime_publishing_approval_consumptions" USING btree ("workspace_id","consuming_principal_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_consumptions_key_idx" ON "runtime_publishing_approval_consumptions" USING btree ("consuming_principal_id","consuming_key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_consumptions_authorization_evidence_idx" ON "runtime_publishing_approval_consumptions" USING btree ("workspace_id","consuming_principal_id","consuming_key_id","authorization_evidence_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_publishing_approval_decisions_request_unique" ON "runtime_publishing_approval_decisions" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_decisions_decider_idx" ON "runtime_publishing_approval_decisions" USING btree ("decided_by_user_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_decisions_workspace_decided_idx" ON "runtime_publishing_approval_decisions" USING btree ("workspace_id","decided_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_mutation_receipts_principal_idx" ON "runtime_publishing_approval_mutation_receipts" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_mutation_receipts_key_idx" ON "runtime_publishing_approval_mutation_receipts" USING btree ("principal_id","key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_mutation_receipts_authorization_evidence_idx" ON "runtime_publishing_approval_mutation_receipts" USING btree ("workspace_id","principal_id","key_id","authorization_evidence_ref");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_mutation_receipts_user_idx" ON "runtime_publishing_approval_mutation_receipts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_mutation_receipts_request_idx" ON "runtime_publishing_approval_mutation_receipts" USING btree ("workspace_id","approval_request_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_mutation_receipts_decision_idx" ON "runtime_publishing_approval_mutation_receipts" USING btree ("workspace_id","approval_request_id","decision_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_requests_revision_idx" ON "runtime_publishing_approval_requests" USING btree ("workspace_id","plan_id","plan_revision_id","plan_revision","plan_revision_digest","validation_evidence_digest");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_requests_requester_idx" ON "runtime_publishing_approval_requests" USING btree ("workspace_id","requesting_principal_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_requests_requester_key_idx" ON "runtime_publishing_approval_requests" USING btree ("requesting_principal_id","requesting_key_id");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_requests_authorization_evidence_idx" ON "runtime_publishing_approval_requests" USING btree ("workspace_id","requesting_principal_id","requesting_key_id","request_authorization_evidence_ref");--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_requests_workspace_created_idx" ON "runtime_publishing_approval_requests" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runtime_publishing_approval_requests_workspace_expiry_idx" ON "runtime_publishing_approval_requests" USING btree ("workspace_id","decision_policy_expires_at","id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION runtime_publishing_approval_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Publishing Approval history is append-only';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION runtime_publishing_approval_stamp_authority_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'runtime_publishing_approval_authority_grants' THEN
    NEW.issued_at := clock_timestamp();
  ELSIF TG_TABLE_NAME = 'runtime_publishing_approval_authority_revocations' THEN
    NEW.revoked_at := clock_timestamp();
  ELSE
    NEW.created_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_authority_grants_stamp_time
BEFORE INSERT ON runtime_publishing_approval_authority_grants
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_stamp_authority_time();--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_authority_revocations_stamp_time
BEFORE INSERT ON runtime_publishing_approval_authority_revocations
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_stamp_authority_time();--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_authority_receipts_stamp_time
BEFORE INSERT ON runtime_publishing_approval_authority_mutation_receipts
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_stamp_authority_time();--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_authority_grants_insert_only
BEFORE UPDATE OR DELETE ON runtime_publishing_approval_authority_grants
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_reject_mutation();--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_authority_revocations_insert_only
BEFORE UPDATE OR DELETE ON runtime_publishing_approval_authority_revocations
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_reject_mutation();--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_authority_receipts_insert_only
BEFORE UPDATE OR DELETE ON runtime_publishing_approval_authority_mutation_receipts
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_reject_mutation();--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_requests_insert_only
BEFORE UPDATE OR DELETE ON runtime_publishing_approval_requests
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_reject_mutation();--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_decisions_insert_only
BEFORE UPDATE OR DELETE ON runtime_publishing_approval_decisions
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_reject_mutation();--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_mutation_receipts_insert_only
BEFORE UPDATE OR DELETE ON runtime_publishing_approval_mutation_receipts
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_reject_mutation();--> statement-breakpoint
CREATE TRIGGER runtime_publishing_approval_consumptions_insert_only
BEFORE UPDATE OR DELETE ON runtime_publishing_approval_consumptions
FOR EACH ROW EXECUTE FUNCTION runtime_publishing_approval_reject_mutation();
