import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "@/lib/db/schema";
import type { OperationActor, OperationEvent } from "./types";

export const runtimeOperations = pgTable("runtime_operations", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  id: text("id").notNull(), kind: text("kind").notNull(), resourceId: text("resource_id").notNull(),
  state: text("state").notNull(), stage: text("stage"), revision: integer("revision").notNull(),
  actor: jsonb("actor").$type<OperationActor>().notNull(),
  metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull(),
  retryOfOperationId: text("retry_of_operation_id"), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "runtime_operations_pk", columns: [table.workspaceId, table.id] }),
  workspaceStateTimeIdx: index("runtime_operations_workspace_state_time_idx").on(table.workspaceId, table.state, table.updatedAt, table.id),
  resourceIdx: index("runtime_operations_resource_idx").on(table.workspaceId, table.kind, table.resourceId),
  identityCheck: check("runtime_operations_identity_check", sql`${table.id} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and ${table.resourceId} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' and ${table.revision} > 0`),
  stateCheck: check("runtime_operations_state_check", sql`${table.state} in ('queued','admitted','running','waiting_user','waiting_provider','waiting_quota','waiting_time','blocked','cancelling','cancelled','succeeded','failed_known','outcome_unknown')`),
  stageCheck: check("runtime_operations_stage_check", sql`(${table.state} = 'running' and ${table.stage} ~ '^[a-z][a-z0-9_.-]{0,79}$') or (${table.state} <> 'running' and ${table.stage} is null)`),
  metadataSizeCheck: check("runtime_operations_metadata_size_check", sql`octet_length(${table.metadata}::text) <= 16384`),
}));

export const runtimeOperationEvents = pgTable("runtime_operation_events", {
  workspaceId: text("workspace_id").notNull(), operationId: text("operation_id").notNull(), revision: integer("revision").notNull(), id: text("id").notNull(),
  event: jsonb("event").$type<OperationEvent>().notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "runtime_operation_events_pk", columns: [table.workspaceId, table.operationId, table.revision] }),
  idUnique: uniqueIndex("runtime_operation_events_id_unique").on(table.workspaceId, table.id),
  operationFk: index("runtime_operation_events_operation_idx").on(table.workspaceId, table.operationId, table.occurredAt),
  revisionCheck: check("runtime_operation_events_revision_check", sql`${table.revision} > 0 and octet_length(${table.event}::text) <= 16384`),
}));

export const runtimeOperationMutationReceipts = pgTable("runtime_operation_mutation_receipts", {
  workspaceId: text("workspace_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), requestDigest: text("request_digest").notNull(), operationId: text("operation_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  pk: primaryKey({ name: "runtime_operation_mutation_receipts_pk", columns: [table.workspaceId, table.idempotencyKey] }),
  digestCheck: check("runtime_operation_mutation_receipts_digest_check", sql`${table.requestDigest} ~ '^sha256:[a-f0-9]{64}$' and length(${table.idempotencyKey}) between 8 and 200`),
}));

export const runtimeOperationProjectionLeases = pgTable("runtime_operation_projection_leases", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  lastProjectedAt: timestamp("last_projected_at", { withTimezone: true }), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ dueIdx: index("runtime_operation_projection_leases_due_idx").on(table.leaseExpiresAt, table.workspaceId) }));
