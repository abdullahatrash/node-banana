import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user, workspaces } from "@/lib/db/schema";

export const releaseControlRecords = pgTable("release_control_records", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  id: text("id").notNull(),
  revision: integer("revision").notNull(),
  buildId: text("build_id"),
  document: jsonb("document").$type<Record<string, unknown>>().notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => ({
  pk: primaryKey({ name: "release_control_records_pk", columns: [table.workspaceId, table.kind, table.id, table.revision] }),
  currentIdx: index("release_control_records_current_idx").on(table.workspaceId, table.kind, table.id, table.revision),
  buildIdx: index("release_control_records_build_idx").on(table.workspaceId, table.buildId, table.kind),
  identityCheck: check("release_control_records_identity_check", sql`${table.id} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and ${table.revision} > 0 and octet_length(${table.document}::text) <= 131072`),
  kindCheck: check("release_control_records_kind_check", sql`${table.kind} in ('evidence','flag','incident','recovery_objective','restore_drill','contract_migration','parity_requirement','experiment')`),
}));

export const productTelemetryEvents = pgTable("product_telemetry_events", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  eventId: text("event_id").notNull(),
  workspacePseudonym: text("workspace_pseudonym").notNull(),
  sessionPseudonym: text("session_pseudonym").notNull(),
  name: text("name").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  event: jsonb("event").$type<Record<string, unknown>>().notNull(),
}, (table) => ({
  pk: primaryKey({ name: "product_telemetry_events_pk", columns: [table.workspaceId, table.eventId] }),
  pseudonymTimeIdx: index("product_telemetry_events_pseudonym_time_idx").on(table.workspacePseudonym, table.occurredAt),
  nameTimeIdx: index("product_telemetry_events_name_time_idx").on(table.name, table.occurredAt),
  workspacePseudonymCheck: check("product_telemetry_events_workspace_pseudonym_check", sql`${table.workspacePseudonym} ~ '^wsp_[a-f0-9]{32,64}$' and ${table.sessionPseudonym} ~ '^ses_[a-f0-9]{32,64}$' and octet_length(${table.event}::text) <= 8192`),
}));

export const releaseControlMutationReceipts = pgTable("release_control_mutation_receipts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestDigest: text("request_digest").notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "release_control_mutation_receipts_pk", columns: [table.workspaceId, table.idempotencyKey] }),
  requestDigestUnique: uniqueIndex("release_control_mutation_receipts_request_unique").on(table.workspaceId, table.idempotencyKey, table.requestDigest),
  digestCheck: check("release_control_mutation_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and length(${table.idempotencyKey}) between 8 and 200`),
}));
