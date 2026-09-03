import { check, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user, workspaces } from "@/lib/db/schema";
import type { ExactModelRef, FallbackAuthorization, GenerationIntent, InspirationRightsSnapshot } from "./types";

export const modelFallbackAuthorizations = pgTable("model_fallback_authorizations", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), revision: integer("revision").notNull(),
  status: text("status").notNull(), authorization: jsonb("authorization").$type<FallbackAuthorization>().notNull(), sourceProvider: text("source_provider").notNull(), sourceModel: text("source_model").notNull(), capability: text("capability").notNull(),
  maxTotalCostUsd: numeric("max_total_cost_usd", { precision: 12, scale: 6 }).notNull(), issuedByUserId: text("issued_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => ({ pk: primaryKey({ name: "model_fallback_authorizations_pk", columns: [table.workspaceId, table.id] }), activeIdx: index("model_fallback_authorizations_active_idx").on(table.workspaceId, table.status, table.expiresAt), revisionCheck: check("model_fallback_authorizations_revision_check", sql`${table.revision} > 0 and ${table.status} in ('active','revoked') and ${table.maxTotalCostUsd}::numeric > 0`) }));

export const generationIntents = pgTable("generation_intents", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), intent: jsonb("intent").$type<GenerationIntent>().notNull(),
  brandProfileId: text("brand_profile_id").notNull(), brandRevision: integer("brand_revision").notNull(), promptDigest: text("prompt_digest").notNull(), selectedProvider: text("selected_provider").notNull(), selectedModel: text("selected_model").notNull(), reservationId: text("reservation_id").notNull(),
  rightsSnapshotId: text("rights_snapshot_id"), rightsSnapshotRevision: integer("rights_snapshot_revision"), remixBriefDigest: text("remix_brief_digest"), outputContract: jsonb("output_contract").$type<GenerationIntent["outputContract"]>(),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "generation_intents_pk", columns: [table.workspaceId, table.id] }), brandIdx: index("generation_intents_brand_idx").on(table.workspaceId, table.brandProfileId, table.brandRevision), digestCheck: check("generation_intents_digest_check", sql`${table.promptDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.brandRevision} > 0`) }));

export const modelRoutingMutationReceipts = pgTable("model_routing_mutation_receipts", {
  workspaceId: text("workspace_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), requestDigest: text("request_digest").notNull(), resourceKind: text("resource_kind").notNull(), resourceId: text("resource_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "model_routing_mutation_receipts_pk", columns: [table.workspaceId, table.idempotencyKey] }), digestCheck: check("model_routing_mutation_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.resourceKind} in ('fallback_authorization','generation_intent') and length(${table.idempotencyKey}) between 8 and 200`) }));

export const replicatePredictionIdentities = pgTable("replicate_prediction_identities", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), intentId: text("intent_id").notNull(), predictionId: text("prediction_id").notNull(), model: jsonb("model").$type<ExactModelRef>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "replicate_prediction_identities_pk", columns: [table.workspaceId, table.intentId] }), predictionUnique: uniqueIndex("replicate_prediction_identities_prediction_unique").on(table.predictionId), predictionCheck: check("replicate_prediction_identities_prediction_check", sql`length(${table.predictionId}) between 1 and 200`) }));

export const modelFallbackSpendReservations = pgTable("model_fallback_spend_reservations", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  authorizationId: text("authorization_id").notNull(), intentId: text("intent_id").notNull(),
  amountUsd: numeric("amount_usd", { precision: 12, scale: 6 }).notNull(), status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), releasedAt: timestamp("released_at", { withTimezone: true }),
}, (table) => ({
  pk: primaryKey({ name: "model_fallback_spend_reservations_pk", columns: [table.workspaceId, table.authorizationId, table.intentId] }),
  grantFk: check("model_fallback_spend_reservations_status_check", sql`${table.amountUsd}::numeric > 0 and ${table.status} in ('held','released')`),
  activeIdx: index("model_fallback_spend_reservations_active_idx").on(table.workspaceId, table.authorizationId, table.status),
}));

export const modelProviderEffectClaims = pgTable("model_provider_effect_claims", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  intentId: text("intent_id").notNull(), provider: text("provider").notNull(), state: text("state").notNull(),
  claimToken: text("claim_token").notNull(), predictionId: text("prediction_id"),
  providerStatus: text("provider_status").notNull(), nextPollAt: timestamp("next_poll_at", { withTimezone: true }).notNull(), pollAttempts: integer("poll_attempts").notNull(), leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
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

export const modelGenerationBudgetReservations = pgTable("model_generation_budget_reservations", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  intentId: text("intent_id").notNull(), policyId: text("policy_id").notNull(), policyRevisionId: text("policy_revision_id").notNull(),
  periodStartsAt: timestamp("period_starts_at", { withTimezone: true }).notNull(), periodEndsAt: timestamp("period_ends_at", { withTimezone: true }),
  amountUsd: numeric("amount_usd", { precision: 12, scale: 6 }).notNull(), status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "model_generation_budget_reservations_pk", columns: [table.workspaceId, table.intentId] }),
  periodIdx: index("model_generation_budget_reservations_period_idx").on(table.workspaceId, table.policyId, table.periodStartsAt, table.status),
  valueCheck: check("model_generation_budget_reservations_value_check", sql`${table.amountUsd}::numeric > 0 and ${table.status} in ('held','released','settled','outcome_unknown')`),
}));
