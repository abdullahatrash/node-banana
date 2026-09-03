import { check, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user, workspaces } from "@/lib/db/schema";
import type { ExactModelRef, FallbackAuthorization, GenerationIntent } from "./types";

export const modelFallbackAuthorizations = pgTable("model_fallback_authorizations", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), revision: integer("revision").notNull(),
  status: text("status").notNull(), authorization: jsonb("authorization").$type<FallbackAuthorization>().notNull(), sourceProvider: text("source_provider").notNull(), sourceModel: text("source_model").notNull(), capability: text("capability").notNull(),
  maxTotalCostUsd: numeric("max_total_cost_usd", { precision: 12, scale: 6 }).notNull(), issuedByUserId: text("issued_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => ({ pk: primaryKey({ name: "model_fallback_authorizations_pk", columns: [table.workspaceId, table.id] }), activeIdx: index("model_fallback_authorizations_active_idx").on(table.workspaceId, table.status, table.expiresAt), revisionCheck: check("model_fallback_authorizations_revision_check", sql`${table.revision} > 0 and ${table.status} in ('active','revoked') and ${table.maxTotalCostUsd}::numeric > 0`) }));

export const generationIntents = pgTable("generation_intents", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), id: text("id").notNull(), intent: jsonb("intent").$type<GenerationIntent>().notNull(),
  brandProfileId: text("brand_profile_id").notNull(), brandRevision: integer("brand_revision").notNull(), promptDigest: text("prompt_digest").notNull(), selectedProvider: text("selected_provider").notNull(), selectedModel: text("selected_model").notNull(), reservationId: text("reservation_id").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "generation_intents_pk", columns: [table.workspaceId, table.id] }), brandIdx: index("generation_intents_brand_idx").on(table.workspaceId, table.brandProfileId, table.brandRevision), digestCheck: check("generation_intents_digest_check", sql`${table.promptDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.brandRevision} > 0`) }));

export const modelRoutingMutationReceipts = pgTable("model_routing_mutation_receipts", {
  workspaceId: text("workspace_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), requestDigest: text("request_digest").notNull(), resourceKind: text("resource_kind").notNull(), resourceId: text("resource_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "model_routing_mutation_receipts_pk", columns: [table.workspaceId, table.idempotencyKey] }), digestCheck: check("model_routing_mutation_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and ${table.resourceKind} in ('fallback_authorization','generation_intent') and length(${table.idempotencyKey}) between 8 and 200`) }));

export const replicatePredictionIdentities = pgTable("replicate_prediction_identities", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }), intentId: text("intent_id").notNull(), predictionId: text("prediction_id").notNull(), model: jsonb("model").$type<ExactModelRef>().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ name: "replicate_prediction_identities_pk", columns: [table.workspaceId, table.intentId] }), predictionUnique: uniqueIndex("replicate_prediction_identities_prediction_unique").on(table.predictionId), predictionCheck: check("replicate_prediction_identities_prediction_check", sql`length(${table.predictionId}) between 1 and 200`) }));
