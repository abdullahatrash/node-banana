// @vitest-environment node
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { buildCreativeBrief } from "../brief";
import { PostgresCreativeSessionStore } from "../repository";
import type { CreativeSession } from "../session";
import { brand, request } from "./fixtures";

const enabled = process.env.RUN_CREATIVE_POSTGRES_TESTS === "1";
describe.skipIf(!enabled)("creative revisions on an isolated local Postgres schema", () => {
  const schemaName = `creative_test_${randomBytes(8).toString("hex")}`;
  let pool: Pool;
  let store: PostgresCreativeSessionStore;
  let created = false;
  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(connectionString).hostname)) throw new Error("Creative integration tests require an explicitly configured local Postgres database.");
    pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schemaName}` });
    await pool.query(`CREATE SCHEMA ${schemaName}`); created = true;
    await pool.query('CREATE TABLE workspaces(id text PRIMARY KEY); CREATE TABLE "user"(id text PRIMARY KEY);');
    await pool.query(await readFile(resolve("drizzle/0140_arabic_safe_creative_sessions.sql"), "utf8"));
    await pool.query("INSERT INTO workspaces(id) VALUES ('workspace-1'), ('workspace-2'); INSERT INTO \"user\"(id) VALUES ('user-1');");
    const database = drizzle(pool, { schema }); store = new PostgresCreativeSessionStore(() => database);
  });
  afterAll(async () => {
    try { if (created) await pool.query(`DROP SCHEMA ${schemaName} CASCADE`); } finally { await pool?.end(); }
  });
  function session(): CreativeSession {
    const input = request(); const at = "2026-09-05T00:00:00Z";
    return { schema: "creative-session/v1", id: "creative-pg-test", workspaceId: "workspace-1", revision: 1, request: input, brief: buildCreativeBrief(input, { workspaceId: "workspace-1", profileId: "brand-1", revision: 3, acceptedAt: at, profile: brand }), copy: null, copyApproval: null, composition: null, stages: [], plate: null, visualReview: null, output: null, publicationReview: null, cancellationRequestedAt: null, createdByUserId: "user-1", createdAt: at, updatedAt: at };
  }
  it("serializes concurrent creation, replays exact revisions, and rejects drift", async () => {
    const value = session(); const digest = canonicalDigest(value.request);
    const rows = await Promise.all(Array.from({ length: 4 }, () => store.create(value, "pg-create-key", digest)));
    expect(rows.every((row) => row.revision === 1)).toBe(true);
    expect(Number((await pool.query("SELECT count(*) FROM creative_generation_sessions")).rows[0].count)).toBe(1);
    const command = { workspaceId: "workspace-1", id: value.id, userId: "user-1", expectedRevision: 1, idempotencyKey: "pg-edit-key", requestDigest: canonicalDigest({ cancel: true }) };
    const updated = await store.mutate(command, (current) => ({ ...current, cancellationRequestedAt: "2026-09-05T01:00:00Z" }));
    expect(updated.revision).toBe(2);
    expect(await store.mutate(command, () => { throw new Error("replay must not invoke mutation"); })).toEqual(updated);
    expect(await store.create(value, "pg-create-key", digest)).toEqual(rows[0]);
    await expect(store.create(value, "pg-create-key", canonicalDigest("different"))).rejects.toThrow("creative.errors.idempotencyConflict");
    await expect(store.mutate({ ...command, idempotencyKey: "pg-stale-key" }, (current) => current)).rejects.toThrow("creative.errors.revisionConflict");
    expect(await store.get("workspace-2", value.id)).toBeNull();
    expect((await pool.query("SELECT count(*) FROM creative_generation_revisions")).rows[0].count).toBe("2");
  });
  it("enforces immutable historical revisions and receipts in PostgreSQL", async () => {
    await expect(pool.query("UPDATE creative_generation_revisions SET revision=revision+100")).rejects.toThrow("immutable");
    await expect(pool.query("DELETE FROM creative_generation_command_receipts")).rejects.toThrow("immutable");
  });
});
