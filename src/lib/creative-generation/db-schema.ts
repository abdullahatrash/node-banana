import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user, workspaces } from "@/lib/db/schema";
import type { CreativeSession } from "./session";

export const creativeSessions = pgTable("creative_generation_sessions", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
  id: text("id").notNull(),
  revision: integer("revision").notNull(),
  snapshot: jsonb("snapshot").$type<CreativeSession>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.workspaceId, table.id] }), binding: check("creative_generation_sessions_binding", sql`${table.revision} > 0 and ${table.snapshot}->>'workspaceId' = ${table.workspaceId} and ${table.snapshot}->>'id' = ${table.id} and (${table.snapshot}->>'revision')::integer = ${table.revision}`) }));

export const creativeRevisions = pgTable("creative_generation_revisions", {
  workspaceId: text("workspace_id").notNull(), id: text("id").notNull(), revision: integer("revision").notNull(),
  snapshot: jsonb("snapshot").$type<CreativeSession>().notNull(),
  authorUserId: text("author_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.workspaceId, table.id, table.revision] }), session: foreignKey({ columns: [table.workspaceId, table.id], foreignColumns: [creativeSessions.workspaceId, creativeSessions.id] }).onDelete("restrict") }));

export const creativeReceipts = pgTable("creative_generation_command_receipts", {
  workspaceId: text("workspace_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), requestDigest: text("request_digest").notNull(),
  sessionId: text("session_id").notNull(), revision: integer("revision").notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.workspaceId, table.idempotencyKey] }), revision: foreignKey({ columns: [table.workspaceId, table.sessionId, table.revision], foreignColumns: [creativeRevisions.workspaceId, creativeRevisions.id, creativeRevisions.revision] }).onDelete("restrict") }));
