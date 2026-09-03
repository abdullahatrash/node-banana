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
  subjectPseudonym: text("subject_pseudonym").notNull(),
  regionClassification: text("region_classification").notNull(),
  name: text("name").notNull(),
  experimentId: text("experiment_id"),
  assignmentRevision: integer("assignment_revision"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  event: jsonb("event").$type<Record<string, unknown>>().notNull(),
}, (table) => ({
  pk: primaryKey({ name: "product_telemetry_events_pk", columns: [table.workspaceId, table.eventId] }),
  pseudonymTimeIdx: index("product_telemetry_events_pseudonym_time_idx").on(table.workspacePseudonym, table.occurredAt),
  nameTimeIdx: index("product_telemetry_events_name_time_idx").on(table.name, table.occurredAt),
  expiryIdx: index("product_telemetry_events_expiry_idx").on(table.expiresAt),
  experimentIdx: index("product_telemetry_events_experiment_idx").on(table.workspaceId, table.experimentId, table.subjectPseudonym, table.assignmentRevision, table.name),
  workspacePseudonymCheck: check("product_telemetry_events_workspace_pseudonym_check", sql`${table.workspacePseudonym} ~ '^wsp_[a-f0-9]{32,64}$' and ${table.sessionPseudonym} ~ '^ses_[a-f0-9]{32,64}$' and ${table.subjectPseudonym} ~ '^sub_[a-f0-9]{64}$' and ${table.regionClassification} in ('mena','non_mena','unknown') and ${table.expiresAt} > ${table.receivedAt} and octet_length(${table.event}::text) <= 8192`),
}));

export const experimentAssignments = pgTable("experiment_assignments", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  experimentId: text("experiment_id").notNull(),
  subjectPseudonym: text("subject_pseudonym").notNull(),
  assignmentRevision: integer("assignment_revision").notNull(),
  variant: text("variant").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "experiment_assignments_pk", columns: [table.workspaceId, table.experimentId, table.subjectPseudonym, table.assignmentRevision] }),
  activeIdx: index("experiment_assignments_active_idx").on(table.workspaceId, table.experimentId, table.subjectPseudonym, table.expiresAt),
  valuesCheck: check("experiment_assignments_values_check", sql`${table.experimentId} ~ '^exp_[A-Za-z0-9_-]{4,80}$' and ${table.subjectPseudonym} ~ '^sub_[a-f0-9]{64}$' and ${table.assignmentRevision} > 0 and ${table.expiresAt} > ${table.assignedAt}`),
}));

export const productTelemetryConsents = pgTable("product_telemetry_consents", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  purpose: text("purpose").notNull(),
  status: text("status").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "product_telemetry_consents_pk", columns: [table.workspaceId, table.userId, table.revision] }),
  activeIdx: index("product_telemetry_consents_active_idx").on(table.workspaceId, table.userId, table.status, table.expiresAt),
  valuesCheck: check("product_telemetry_consents_values_check", sql`${table.revision} > 0 and ${table.purpose} = 'product_analytics' and ${table.status} in ('active','revoked') and ${table.expiresAt} > ${table.issuedAt}`),
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
