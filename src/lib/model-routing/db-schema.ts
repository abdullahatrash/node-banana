import { bigint, check, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { assets, contentWorkflowRevisions, contentWorkflows, user, workflowRuns, workspaces, workspaceProductRecords } from "@/lib/db/schema";
import type { ExactModelRef, FallbackAuthorization, GenerationIntent, InspirationRightsEvidence, InspirationRightsSnapshot } from "./types";
import type { DurableProviderCredentialRef } from "@/lib/byok/repository";
import type { QualificationSpendReceipt } from "./qualification-ledger";
import type { ContentModelPolicy } from "@/lib/product-surfaces/content-model-policy";

export const modelFallbackAuthorizations = pgTable("model_fallback_authorizations", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), revision: integer("revision").notNull(),
  status: text("status").notNull(), authorization: jsonb("authorization").$type<FallbackAuthorization>().notNull(), sourceProvider: text("source_provider").notNull(), sourceModel: text("source_model").notNull(), capability: text("capability").notNull(),
  maxTotalCostUsd: numeric("max_total_cost_usd", { precision: 12, scale: 6 }).notNull(), issuedByUserId: text("issued_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => ({ pk: primaryKey({ name: "model_fallback_authorizations_pk", columns: [table.workspaceId, table.id] }), activeIdx: index("model_fallback_authorizations_active_idx").on(table.workspaceId, table.status, table.expiresAt), revisionCheck: check("model_fallback_authorizations_revision_check", sql`${table.revision} > 0 and ${table.status} in ('active','revoked') and ${table.maxTotalCostUsd}::numeric > 0`) }));

export const generationIntents = pgTable("generation_intents", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), intent: jsonb("intent").$type<GenerationIntent>().notNull(),
  brandProfileId: text("brand_profile_id").notNull(), brandRevision: integer("brand_revision").notNull(), promptDigest: text("prompt_digest").notNull(), selectedProvider: text("selected_provider").notNull(), selectedModel: text("selected_model").notNull(), reservationId: text("reservation_id").notNull(),
  rightsSnapshotId: text("rights_snapshot_id"), rightsSnapshotRevision: integer("rights_snapshot_revision"), remixBriefDigest: text("remix_brief_digest"), regionAdmission: jsonb("region_admission").$type<GenerationIntent["regionAdmission"]>(), outputContract: jsonb("output_contract").$type<GenerationIntent["outputContract"]>(),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "generation_intents_pk", columns: [table.workspaceId, table.id] }), brandIdx: index("generation_intents_brand_idx").on(table.workspaceId, table.brandProfileId, table.brandRevision), digestCheck: check("generation_intents_digest_check", sql`${table.promptDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.brandRevision} > 0`) }));

export const contentWorkflowGenerationRuns = pgTable("content_workflow_generation_runs", {
  workspaceId: text("workspace_id").notNull(), generationIntentId: text("generation_intent_id").notNull(), generationOperationId: text("generation_operation_id").notNull(),
  contentPieceId: text("content_piece_id").notNull(), contentPieceRevision: integer("content_piece_revision").notNull(),
  workflowId: text("workflow_id").notNull(), workflowRevisionId: text("workflow_revision_id").notNull(), workflowRunId: text("workflow_run_id").notNull(),
  recipeDigest: text("recipe_digest").notNull(), selectedModel: jsonb("selected_model").$type<ExactModelRef>().notNull(),
  initiatedByUserId: text("initiated_by_user_id").notNull(), initiatingAuthContextDigest: text("initiating_auth_context_digest").notNull(),
  dispatchReceiptArtifactId: text("dispatch_receipt_artifact_id"), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "content_workflow_generation_runs_pk", columns: [table.workspaceId, table.generationIntentId] }),
  runUnique: uniqueIndex("content_workflow_generation_runs_run_unique").on(table.workspaceId, table.workflowRunId),
  intentFk: foreignKey({ name: "content_workflow_generation_runs_intent_fk", columns: [table.workspaceId, table.generationIntentId], foreignColumns: [generationIntents.workspaceId, generationIntents.id] }).onDelete("restrict"),
  contentPieceFk: foreignKey({ name: "content_workflow_generation_runs_piece_fk", columns: [table.workspaceId, table.contentPieceId], foreignColumns: [workspaceProductRecords.workspaceId, workspaceProductRecords.id] }).onDelete("restrict"),
  workflowFk: foreignKey({ name: "content_workflow_generation_runs_workflow_fk", columns: [table.workspaceId, table.workflowId], foreignColumns: [contentWorkflows.workspaceId, contentWorkflows.id] }).onDelete("restrict"),
  workflowRevisionFk: foreignKey({ name: "content_workflow_generation_runs_revision_fk", columns: [table.workspaceId, table.workflowId, table.workflowRevisionId], foreignColumns: [contentWorkflowRevisions.workspaceId, contentWorkflowRevisions.workflowId, contentWorkflowRevisions.id] }).onDelete("restrict"),
  workflowRunFk: foreignKey({ name: "content_workflow_generation_runs_run_fk", columns: [table.workspaceId, table.workflowId, table.workflowRunId], foreignColumns: [workflowRuns.workspaceId, workflowRuns.workflowId, workflowRuns.id] }).onDelete("restrict"),
  userFk: foreignKey({ name: "content_workflow_generation_runs_user_fk", columns: [table.initiatedByUserId], foreignColumns: [user.id] }).onDelete("restrict"),
  valuesCheck: check("content_workflow_generation_runs_values_check", sql`${table.contentPieceRevision} > 0 and ${table.recipeDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.initiatingAuthContextDigest} ~ '^sha256:[a-f0-9]{64}$'`),
}));

export const contentModelPolicyRevisions = pgTable("content_model_policy_revisions", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), revision: integer("revision").notNull(), format: text("format").notNull(), status: text("status").notNull(), policy: jsonb("policy").$type<ContentModelPolicy>().notNull(), policyDigest: text("policy_digest").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "content_model_policy_revisions_pk", columns: [table.workspaceId, table.id, table.revision] }),
  exactIdentityUnique: uniqueIndex("content_model_policy_revisions_exact_identity_unique").on(table.workspaceId, table.id, table.revision, table.format, table.policyDigest),
  statusIdx: index("content_model_policy_revisions_status_idx").on(table.workspaceId, table.format, table.status, table.revision),
  valuesCheck: check("content_model_policy_revisions_values_check", sql`${table.revision} > 0 and ${table.status} in ('active','retired') and ${table.policyDigest} ~ '^sha256:[a-f0-9]{64}$'`),
  documentBindingCheck: check("content_model_policy_revisions_document_binding_check", sql`${table.policy}->>'id' = ${table.id} and (${table.policy}->>'revision')::integer = ${table.revision} and ${table.policy}->>'format' = ${table.format} and ${table.policy}->>'digest' = ${table.policyDigest}`),
}));

export const contentModelPolicyCurrents = pgTable("content_model_policy_currents", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  format: text("format").notNull(),
  policyId: text("policy_id").notNull(),
  policyRevision: integer("policy_revision").notNull(),
  policyDigest: text("policy_digest").notNull(),
  promotedAt: timestamp("promoted_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ name: "content_model_policy_currents_pk", columns: [table.workspaceId, table.format] }),
  policyFk: foreignKey({ name: "content_model_policy_currents_policy_fk", columns: [table.workspaceId, table.policyId, table.policyRevision, table.format, table.policyDigest], foreignColumns: [contentModelPolicyRevisions.workspaceId, contentModelPolicyRevisions.id, contentModelPolicyRevisions.revision, contentModelPolicyRevisions.format, contentModelPolicyRevisions.policyDigest] }).onDelete("restrict"),
  revisionCheck: check("content_model_policy_currents_revision_check", sql`${table.policyRevision} > 0 and ${table.policyDigest} ~ '^sha256:[a-f0-9]{64}$'`),
}));

export const contentModelPolicySupersessions = pgTable("content_model_policy_supersessions", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  format: text("format").notNull(),
  predecessorPolicyId: text("predecessor_policy_id").notNull(),
  predecessorPolicyRevision: integer("predecessor_policy_revision").notNull(),
  predecessorPolicyDigest: text("predecessor_policy_digest").notNull(),
  successorPolicyId: text("successor_policy_id").notNull(),
  successorPolicyRevision: integer("successor_policy_revision").notNull(),
  successorPolicyDigest: text("successor_policy_digest").notNull(),
  supersededAt: timestamp("superseded_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ name: "content_model_policy_supersessions_pk", columns: [table.workspaceId, table.format, table.successorPolicyId, table.successorPolicyRevision] }),
  predecessorUnique: uniqueIndex("content_model_policy_supersessions_predecessor_unique").on(table.workspaceId, table.format, table.predecessorPolicyId, table.predecessorPolicyRevision),
  predecessorFk: foreignKey({ name: "content_model_policy_supersessions_predecessor_fk", columns: [table.workspaceId, table.predecessorPolicyId, table.predecessorPolicyRevision, table.format, table.predecessorPolicyDigest], foreignColumns: [contentModelPolicyRevisions.workspaceId, contentModelPolicyRevisions.id, contentModelPolicyRevisions.revision, contentModelPolicyRevisions.format, contentModelPolicyRevisions.policyDigest] }).onDelete("restrict"),
  successorFk: foreignKey({ name: "content_model_policy_supersessions_successor_fk", columns: [table.workspaceId, table.successorPolicyId, table.successorPolicyRevision, table.format, table.successorPolicyDigest], foreignColumns: [contentModelPolicyRevisions.workspaceId, contentModelPolicyRevisions.id, contentModelPolicyRevisions.revision, contentModelPolicyRevisions.format, contentModelPolicyRevisions.policyDigest] }).onDelete("restrict"),
  revisionCheck: check("content_model_policy_supersessions_revision_check", sql`${table.successorPolicyRevision} > ${table.predecessorPolicyRevision} and ${table.predecessorPolicyDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.successorPolicyDigest} ~ '^sha256:[a-f0-9]{64}$'`),
}));

export const modelRoutingMutationReceipts = pgTable("model_routing_mutation_receipts", {
  workspaceId: text("workspace_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), requestDigest: text("request_digest").notNull(), resourceKind: text("resource_kind").notNull(), resourceId: text("resource_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "model_routing_mutation_receipts_pk", columns: [table.workspaceId, table.idempotencyKey] }), digestCheck: check("model_routing_mutation_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.resourceKind} in ('fallback_authorization','generation_intent') and length(${table.idempotencyKey}) between 8 and 200`) }));

export const replicatePredictionIdentities = pgTable("replicate_prediction_identities", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), intentId: text("intent_id").notNull(), predictionId: text("prediction_id").notNull(), model: jsonb("model").$type<ExactModelRef>().notNull(), executedVersion: text("executed_version"), credentialRef: jsonb("credential_ref").$type<DurableProviderCredentialRef>(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "replicate_prediction_identities_pk", columns: [table.workspaceId, table.intentId] }), predictionUnique: uniqueIndex("replicate_prediction_identities_prediction_unique").on(table.predictionId), predictionCheck: check("replicate_prediction_identities_prediction_check", sql`length(${table.predictionId}) between 1 and 200`) }));

export const modelFallbackSpendReservations = pgTable("model_fallback_spend_reservations", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  authorizationId: text("authorization_id").notNull(), intentId: text("intent_id").notNull(),
  amountUsd: numeric("amount_usd", { precision: 12, scale: 6 }).notNull(), quotedAmountUsd: numeric("quoted_amount_usd", { precision: 12, scale: 6 }).notNull(), actualAmountUsd: numeric("actual_amount_usd", { precision: 12, scale: 6 }), releasedAmountUsd: numeric("released_amount_usd", { precision: 12, scale: 6 }).notNull(), status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), releasedAt: timestamp("released_at", { withTimezone: true }),
}, (table) => ({
  pk: primaryKey({ name: "model_fallback_spend_reservations_pk", columns: [table.workspaceId, table.authorizationId, table.intentId] }),
  grantFk: check("model_fallback_spend_reservations_status_check", sql`${table.amountUsd}::numeric > 0 and ${table.quotedAmountUsd}::numeric > 0 and ${table.releasedAmountUsd}::numeric >= 0 and (${table.actualAmountUsd} is null or ${table.actualAmountUsd}::numeric >= 0) and ${table.status} in ('held','released','settled','outcome_unknown')`),
  activeIdx: index("model_fallback_spend_reservations_active_idx").on(table.workspaceId, table.authorizationId, table.status),
}));

export const modelProviderEffectClaims = pgTable("model_provider_effect_claims", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  intentId: text("intent_id").notNull(), provider: text("provider").notNull(), state: text("state").notNull(),
  claimToken: text("claim_token").notNull(), predictionId: text("prediction_id"),
  providerStatus: text("provider_status").notNull(), nextPollAt: timestamp("next_poll_at", { withTimezone: true }).notNull(), pollAttempts: integer("poll_attempts").notNull(), leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }).notNull(), credentialRef: jsonb("credential_ref").$type<DurableProviderCredentialRef>(), executedVersion: text("executed_version"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "model_provider_effect_claims_pk", columns: [table.workspaceId, table.intentId] }),
  stateCheck: check("model_provider_effect_claims_state_check", sql`${table.provider} = 'replicate' and ${table.state} in ('claimed','submitted','outcome_unknown','succeeded','failed_known','cancelled') and length(${table.claimToken}) between 16 and 200 and ${table.pollAttempts} >= 0`),
  predictionUnique: uniqueIndex("model_provider_effect_claims_prediction_unique").on(table.predictionId),
}));

export const inspirationRightsSnapshots = pgTable("inspiration_rights_snapshots", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), revision: integer("revision").notNull(),
  snapshot: jsonb("snapshot").$type<InspirationRightsSnapshot>().notNull(), digest: text("digest").notNull(), basis: text("basis").notNull(), permittedRemix: text("permitted_remix").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "inspiration_rights_snapshots_pk", columns: [table.workspaceId, table.id, table.revision] }), digestCheck: check("inspiration_rights_snapshots_digest_check", sql`${table.digest} ~ '^sha256:[a-f0-9]{64}$' and ${table.revision} > 0 and ${table.basis} in ('owned','licensed','public_domain','consented') and ${table.permittedRemix} in ('reference_only','transform','derivative')`) }));

export const inspirationRightsEvidence = pgTable("inspiration_rights_evidence", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(),
  sourceAssetId: text("source_asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }), sourceDigest: text("source_digest").notNull(),
  evidence: jsonb("evidence").$type<InspirationRightsEvidence>().notNull(), digest: text("digest").notNull(), basis: text("basis").notNull(), permittedRemix: text("permitted_remix").notNull(),
  evidenceDocumentAssetId: text("evidence_document_asset_id").references(() => assets.id, { onDelete: "restrict" }), issuerType: text("issuer_type").notNull(), issuerId: text("issuer_id").notNull(),
  verifiedByUserId: text("verified_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(), verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "inspiration_rights_evidence_pk", columns: [table.workspaceId, table.id] }),
  sourceIdx: index("inspiration_rights_evidence_source_idx").on(table.workspaceId, table.sourceAssetId, table.expiresAt),
  digestUnique: uniqueIndex("inspiration_rights_evidence_digest_unique").on(table.workspaceId, table.digest),
  valuesCheck: check("inspiration_rights_evidence_values_check", sql`${table.sourceDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.digest} ~ '^sha256:[a-f0-9]{64}$' and ${table.basis} in ('owned','licensed','public_domain','consented') and ${table.permittedRemix} in ('reference_only','transform','derivative') and ${table.issuerType} in ('workspace_asset_owner','license_authority','rights_holder','public_registry') and ${table.verifiedAt} >= ${table.issuedAt} and (${table.expiresAt} is null or ${table.expiresAt} > ${table.verifiedAt})`),
}));

/** Non-content closure proof. The database erasure function is the sole writer;
 * it retains counts and signed aggregate commitments, never rights documents,
 * source identities, issuer identities, URLs, or per-record commitments. */
export const generationRightsErasureTombstones = pgTable("generation_rights_erasure_tombstones", {
  workspaceId: text("workspace_id").primaryKey(),
  closureId: text("closure_id").notNull(),
  schemaVersion: text("schema_version").notNull(),
  evidenceRowCount: bigint("evidence_row_count", { mode: "number" }).notNull(),
  snapshotRowCount: bigint("snapshot_row_count", { mode: "number" }).notNull(),
  retentionPolicyRevision: integer("retention_policy_revision").notNull(),
  retentionRuleDigest: text("retention_rule_digest").notNull(),
  erasureManifestMac: text("erasure_manifest_mac").notNull(),
  auditSequence: integer("audit_sequence").notNull(),
  auditEventId: text("audit_event_id").notNull(),
  signingKeyId: text("signing_key_id").notNull(),
  erasedAt: timestamp("erased_at", { withTimezone: true }).notNull(),
  tombstoneDigest: text("tombstone_digest").notNull(),
  tombstoneMac: text("tombstone_mac").notNull(),
}, (table) => ({
  valuesCheck: check("generation_rights_erasure_tombstones_values_check", sql`${table.schemaVersion} = 'generation-rights-erasure-tombstone/v1' and ${table.closureId} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and ${table.evidenceRowCount} >= 0 and ${table.snapshotRowCount} >= 0 and ${table.retentionPolicyRevision} > 0 and ${table.retentionRuleDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.erasureManifestMac} ~ '^hmac-sha256:[a-f0-9]{64}$' and ${table.auditSequence} > 0 and ${table.auditEventId} ~ '^rights_erasure_[a-f0-9]{32}$' and ${table.signingKeyId} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and ${table.tombstoneDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.tombstoneMac} ~ '^hmac-sha256:[a-f0-9]{64}$'`),
}));

export const generationRightsErasureAttempts = pgTable("generation_rights_erasure_attempts", {
  workspaceId: text("workspace_id").notNull(),
  closureId: text("closure_id").notNull(),
  leaseId: text("lease_id").notNull(),
  leaseFence: integer("lease_fence").notNull(),
  outcomeCode: text("outcome_code").notNull(),
  eligibleAt: timestamp("eligible_at", { withTimezone: true }),
  auditSequence: integer("audit_sequence").notNull(),
  auditEventId: text("audit_event_id").notNull(),
  signingKeyId: text("signing_key_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  attemptDigest: text("attempt_digest").notNull(),
  attemptMac: text("attempt_mac").notNull(),
}, (table) => ({
  pk: primaryKey({ name: "generation_rights_erasure_attempts_pk", columns: [table.workspaceId, table.closureId, table.leaseId, table.leaseFence, table.outcomeCode] }),
  valuesCheck: check("generation_rights_erasure_attempts_values_check", sql`${table.leaseId} ~ '^lease_[A-Za-z0-9]+$' and ${table.leaseFence} > 0 and ${table.outcomeCode} in ('blocked_access_revocation','blocked_export','blocked_deletion_receipts','blocked_retention_policy','blocked_retention_hold','blocked_retention_period','blocked_dependencies') and ${table.auditSequence} > 0 and ${table.auditEventId} ~ '^rights_erasure_attempt_[a-f0-9]{32}$' and ${table.signingKeyId} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and ${table.attemptDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.attemptMac} ~ '^hmac-sha256:[a-f0-9]{64}$'`),
}));

export const modelGenerationBudgetReservations = pgTable("model_generation_budget_reservations", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  intentId: text("intent_id").notNull(), policyId: text("policy_id").notNull(), policyRevisionId: text("policy_revision_id").notNull(),
  periodStartsAt: timestamp("period_starts_at", { withTimezone: true }).notNull(), periodEndsAt: timestamp("period_ends_at", { withTimezone: true }),
  amountUsd: numeric("amount_usd", { precision: 12, scale: 6 }).notNull(), quotedAmountUsd: numeric("quoted_amount_usd", { precision: 12, scale: 6 }).notNull(), actualAmountUsd: numeric("actual_amount_usd", { precision: 12, scale: 6 }), releasedAmountUsd: numeric("released_amount_usd", { precision: 12, scale: 6 }).notNull(), status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "model_generation_budget_reservations_pk", columns: [table.workspaceId, table.intentId] }),
  periodIdx: index("model_generation_budget_reservations_period_idx").on(table.workspaceId, table.policyId, table.periodStartsAt, table.status),
  valueCheck: check("model_generation_budget_reservations_value_check", sql`${table.amountUsd}::numeric > 0 and ${table.quotedAmountUsd}::numeric > 0 and ${table.releasedAmountUsd}::numeric >= 0 and (${table.actualAmountUsd} is null or ${table.actualAmountUsd}::numeric >= 0) and ${table.status} in ('held','released','settled','outcome_unknown')`),
}));

export const modelArtifactIngestionReceipts = pgTable("model_artifact_ingestion_receipts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  predictionId: text("prediction_id").notNull().references(() => replicatePredictionIdentities.predictionId, { onDelete: "restrict" }), outputIndex: integer("output_index").notNull(), intentId: text("intent_id").notNull(),
  status: text("status").notNull(), storageKey: text("storage_key").notNull(), assetId: text("asset_id").references(() => assets.id, { onDelete: "restrict" }),
  leaseOwner: text("lease_owner"), leaseEpoch: integer("lease_epoch").notNull().default(1), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  mimeType: text("mime_type"), sizeBytes: bigint("size_bytes", { mode: "number" }), width: integer("width"), height: integer("height"), durationSeconds: numeric("duration_seconds", { precision: 12, scale: 3 }), fps: numeric("fps", { precision: 8, scale: 3 }), contentDigest: text("content_digest"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "model_artifact_ingestion_receipts_pk", columns: [table.workspaceId, table.predictionId, table.outputIndex] }),
  intentFk: foreignKey({ name: "model_artifact_ingestion_receipts_intent_fk", columns: [table.workspaceId, table.intentId], foreignColumns: [generationIntents.workspaceId, generationIntents.id] }).onDelete("restrict"),
  assetUnique: uniqueIndex("model_artifact_ingestion_receipts_asset_unique").on(table.assetId).where(sql`${table.assetId} is not null`),
  valueCheck: check("model_artifact_ingestion_receipts_value_check", sql`${table.outputIndex} >= 0 and ${table.leaseEpoch} > 0 and ${table.status} in ('claimed','ready') and (${table.status} <> 'ready' or (${table.assetId} is not null and ${table.contentDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.sizeBytes} > 0 and ${table.width} > 0 and ${table.height} > 0))`),
}));

export const modelTextOutputReceipts = pgTable("model_text_output_receipts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  id: text("id").notNull(), predictionId: text("prediction_id").notNull().references(() => replicatePredictionIdentities.predictionId, { onDelete: "restrict" }), outputIndex: integer("output_index").notNull(), intentId: text("intent_id").notNull(),
  content: text("content").notNull(), contentDigest: text("content_digest").notNull(), byteLength: integer("byte_length").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "model_text_output_receipts_pk", columns: [table.workspaceId, table.id] }),
  predictionOutputUnique: uniqueIndex("model_text_output_receipts_prediction_output_unique").on(table.workspaceId, table.predictionId, table.outputIndex),
  intentIdx: index("model_text_output_receipts_intent_idx").on(table.workspaceId, table.intentId, table.createdAt),
  intentFk: foreignKey({ name: "model_text_output_receipts_intent_fk", columns: [table.workspaceId, table.intentId], foreignColumns: [generationIntents.workspaceId, generationIntents.id] }).onDelete("restrict"),
  valuesCheck: check("model_text_output_receipts_values_check", sql`${table.id} ~ '^text_[a-f0-9]{32}$' and ${table.outputIndex} >= 0 and ${table.byteLength} > 0 and ${table.byteLength} <= 100000 and ${table.contentDigest} ~ '^sha256:[a-f0-9]{64}$'`),
}));

export const modelProviderWebhookReceipts = pgTable("model_provider_webhook_receipts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), provider: text("provider").notNull(), eventId: text("event_id").notNull(), predictionId: text("prediction_id").notNull().references(() => replicatePredictionIdentities.predictionId, { onDelete: "restrict" }),
  payloadDigest: text("payload_digest").notNull(), status: text("status").notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull(), processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => ({ pk: primaryKey({ name: "model_provider_webhook_receipts_pk", columns: [table.provider, table.eventId] }), predictionIdx: index("model_provider_webhook_receipts_prediction_idx").on(table.workspaceId, table.predictionId, table.receivedAt), valuesCheck: check("model_provider_webhook_receipts_values_check", sql`${table.provider} = 'replicate' and length(${table.eventId}) between 8 and 200 and ${table.payloadDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.status} in ('received','processed','failed')`) }));

export const modelQualificationRuns = pgTable("model_qualification_runs", {
  id: text("id").primaryKey(), matrixId: text("matrix_id").notNull(), providerAccountId: text("provider_account_id").notNull(), credentialFingerprint: text("credential_fingerprint").notNull(), requestDigest: text("request_digest").notNull(), provider: text("provider").notNull(), model: text("model").notNull(), modelVersion: text("model_version").notNull(), signingKeyId: text("signing_key_id").notNull(), state: text("state").notNull(), hardCapUsd: numeric("hard_cap_usd", { precision: 8, scale: 6 }).notNull(), reservedSpendUsd: numeric("reserved_spend_usd", { precision: 8, scale: 6 }).notNull(), observedSpendUsd: numeric("observed_spend_usd", { precision: 14, scale: 6 }).notNull(), result: jsonb("result").$type<Record<string, unknown>>(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({
  valuesCheck: check("model_qualification_runs_values_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.credentialFingerprint} ~ '^sha256:[a-f0-9]{64}$' and ${table.provider} = 'replicate' and ${table.state} in ('running','completed','blocked') and ${table.hardCapUsd}::numeric = 0.4 and ${table.reservedSpendUsd}::numeric > 0 and ${table.reservedSpendUsd}::numeric < ${table.hardCapUsd}::numeric and ${table.observedSpendUsd}::numeric >= 0`),
  recoveryIdx: index("model_qualification_runs_recovery_idx").on(table.state, table.updatedAt, table.id),
  accountMatrixIdx: index("model_qualification_runs_account_matrix_idx").on(table.provider, table.providerAccountId, table.matrixId, table.state),
}));

export const modelQualificationCases = pgTable("model_qualification_cases", {
  runId: text("run_id").notNull().references(() => modelQualificationRuns.id, { onDelete: "restrict" }), caseId: text("case_id").notNull(), requestDigest: text("request_digest").notNull(), state: text("state").notNull(), maximumSpendUsd: numeric("maximum_spend_usd", { precision: 8, scale: 6 }).notNull(), spendAuthorizationId: text("spend_authorization_id").notNull(), spendAuthorizationDigest: text("spend_authorization_digest").notNull(), observedSpendUsd: numeric("observed_spend_usd", { precision: 14, scale: 6 }), spendReceiptId: text("spend_receipt_id"), spendReceiptDigest: text("spend_receipt_digest"), submissionKey: text("submission_key").notNull(), predictionId: text("prediction_id"), executedVersion: text("executed_version"), terminalStatus: text("terminal_status"), result: jsonb("result").$type<Record<string, unknown>>(), leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => ({
  pk: primaryKey({ name: "model_qualification_cases_pk", columns: [table.runId, table.caseId] }),
  submissionUnique: uniqueIndex("model_qualification_cases_submission_unique").on(table.submissionKey),
  predictionUnique: uniqueIndex("model_qualification_cases_prediction_unique").on(table.predictionId),
  valuesCheck: check("model_qualification_cases_values_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.spendAuthorizationDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.state} in ('reserved','submitting','submitted','outcome_unknown','completed') and ${table.maximumSpendUsd}::numeric > 0 and ${table.maximumSpendUsd}::numeric < 0.4 and (${table.observedSpendUsd} is null or ${table.observedSpendUsd}::numeric >= 0) and (${table.spendReceiptDigest} is null or ${table.spendReceiptDigest} ~ '^sha256:[a-f0-9]{64}$') and length(${table.submissionKey}) between 16 and 300 and (${table.state} <> 'completed' or (${table.predictionId} is not null and ${table.terminalStatus} in ('succeeded','failed','canceled','aborted') and ${table.result} is not null and ${table.spendReceiptId} is not null and ${table.observedSpendUsd} is not null and ${table.completedAt} is not null))`),
  recoveryIdx: index("model_qualification_cases_recovery_idx").on(table.state, table.leaseExpiresAt, table.updatedAt, table.runId, table.caseId),
}));

export const modelQualificationSpendReceipts = pgTable("model_qualification_spend_receipts", {
  receiptId: text("receipt_id").primaryKey(), runId: text("run_id").notNull(), caseId: text("case_id").notNull(), matrixId: text("matrix_id").notNull(), provider: text("provider").notNull(), providerAccountId: text("provider_account_id").notNull(), credentialFingerprint: text("credential_fingerprint").notNull(), predictionId: text("prediction_id").notNull(), model: text("model").notNull(), modelVersion: text("model_version").notNull(), currency: text("currency").notNull(), amountUsd: numeric("amount_usd", { precision: 14, scale: 6 }).notNull(), payloadDigest: text("payload_digest").notNull(), signingKeyId: text("signing_key_id").notNull(), receipt: jsonb("receipt").$type<QualificationSpendReceipt>().notNull(), providerObservedAt: timestamp("provider_observed_at", { withTimezone: true }).notNull(), receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
}, (table) => ({
  caseFk: foreignKey({ name: "model_qualification_spend_receipts_case_fk", columns: [table.runId, table.caseId], foreignColumns: [modelQualificationCases.runId, modelQualificationCases.caseId] }).onDelete("restrict"),
  predictionUnique: uniqueIndex("model_qualification_spend_receipts_prediction_unique").on(table.provider, table.predictionId),
  accountMatrixIdx: index("model_qualification_spend_receipts_account_matrix_idx").on(table.provider, table.providerAccountId, table.matrixId, table.providerObservedAt),
  valuesCheck: check("model_qualification_spend_receipts_values_check", sql`${table.provider} = 'replicate' and ${table.currency} = 'USD' and ${table.amountUsd}::numeric >= 0 and ${table.credentialFingerprint} ~ '^sha256:[a-f0-9]{64}$' and ${table.payloadDigest} ~ '^sha256:[a-f0-9]{64}$'`),
}));
