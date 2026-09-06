import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { getDb } from "@/lib/db";
import * as coreSchema from "@/lib/db/schema";
import type { ContentModelPolicy } from "@/lib/product-surfaces/content-model-policy";
import { persistCurrentContentModelPolicy } from "../content-model-policy-repository";
import * as modelRoutingSchema from "../db-schema";

const TEST_DATABASE_NAME = /(?:^|[_-])(?:test|ci|tmp|ephemeral)(?:[_-]|$)/i;
const CHILD_DATABASE_NAME = /^node_banana_policy_test_[a-f0-9]{24}$/;

function guardedTestDatabaseUrl(): URL | null {
  const configured = process.env.TEST_DATABASE_URL?.trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    return ["postgres:", "postgresql:"].includes(parsed.protocol) && TEST_DATABASE_NAME.test(databaseName)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function quotedIdentifier(value: string): string {
  if (!CHILD_DATABASE_NAME.test(value)) throw new TypeError("Refusing to operate on a non-test database name.");
  return `"${value}"`;
}

function policy(id: string, revision: number): ContentModelPolicy {
  const model = {
    provider: "replicate" as const,
    model: "prunaai/p-video",
    version: "pinned-version-1",
    inputSchemaDigest: `sha256:${"a".repeat(64)}`,
  };
  const unsigned = {
    schema: "content-model-policy/v1" as const,
    id,
    revision,
    format: "slideshow" as const,
    region: "replicate-us" as const,
    defaultModel: model,
    compatibleModels: [model],
    overrides: {
      mode: "explicit_exact_allowlist" as const,
      allowedFields: ["model"] as const,
      requireRequote: true as const,
    },
  };
  return { ...unsigned, digest: canonicalDigest(unsigned) as `sha256:${string}` };
}

const configuredUrl = guardedTestDatabaseUrl();
const describePostgres = configuredUrl ? describe : describe.skip;

describePostgres("Content Model Policy existing-tenant upgrade", () => {
  let adminPool: Pool;
  let databasePool: Pool;
  let childDatabaseName: string;
  let migrationsFolder: string;

  beforeAll(async () => {
    if (!configuredUrl) throw new TypeError("Disposable test database is required.");
    adminPool = new Pool({ connectionString: configuredUrl.toString(), max: 2 });
    const expectedDatabase = decodeURIComponent(configuredUrl.pathname.slice(1));
    const current = await adminPool.query<{ database_name: string }>("select current_database() as database_name");
    if (current.rows[0]?.database_name !== expectedDatabase) throw new TypeError("TEST_DATABASE_URL did not select its guarded database.");

    childDatabaseName = `node_banana_policy_test_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    migrationsFolder = await mkdtemp(join(tmpdir(), "node-banana-policy-upgrade-"));
    await mkdir(join(migrationsFolder, "meta"));
    await adminPool.query(`create database ${quotedIdentifier(childDatabaseName)}`);
    const childUrl = new URL(configuredUrl);
    childUrl.pathname = `/${childDatabaseName}`;
    databasePool = new Pool({ connectionString: childUrl.toString(), max: 3 });
  }, 30_000);

  afterAll(async () => {
    await databasePool?.end();
    if (adminPool && childDatabaseName) {
      await adminPool.query(`drop database if exists ${quotedIdentifier(childDatabaseName)} with (force)`);
    }
    await adminPool?.end();
    if (migrationsFolder) await rm(migrationsFolder, { recursive: true, force: true });
  }, 30_000);

  it("keeps v4 current until first v5 admission, then records one immutable v4-to-v5 supersession", async () => {
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number }>;
    };
    const migrationFiles = (await readdir("drizzle")).filter((name) => /^\d{4}_.+\.sql$/.test(name));
    for (const name of migrationFiles.filter((name) => Number(name.slice(0, 4)) <= 109)) {
      await copyFile(join("drizzle", name), join(migrationsFolder, name));
    }
    await writeFile(join(migrationsFolder, "meta/_journal.json"), JSON.stringify({
      ...journal,
      entries: journal.entries.filter(({ idx }) => idx <= 109),
    }));
    await migrate(drizzle(databasePool), { migrationsFolder });

    const suffix = randomUUID().replaceAll("-", "");
    const userId = `user_policy_upgrade_${suffix}`;
    const workspaceId = `workspace_policy_upgrade_${suffix}`;
    const v4 = policy("content.slideshow.v4", 4);
    await databasePool.query(
      `insert into "user" ("id","email") values ($1,$2)`,
      [userId, `${suffix}@policy-upgrade.test`],
    );
    await databasePool.query(
      `insert into "workspaces" ("id","name","slug","owner_user_id") values ($1,$2,$3,$4)`,
      [workspaceId, "Policy upgrade", `policy-upgrade-${suffix}`, userId],
    );
    await databasePool.query(
      `insert into "content_model_policy_revisions" ("workspace_id","id","revision","format","status","policy","policy_digest","created_at") values ($1,$2,$3,$4,'active',$5::jsonb,$6,$7)`,
      [workspaceId, v4.id, v4.revision, v4.format, JSON.stringify(v4), v4.digest, new Date("2026-09-04T09:00:00Z")],
    );

    const db = drizzle(databasePool, { schema: { ...coreSchema, ...modelRoutingSchema } }) as unknown as ReturnType<typeof getDb>;
    const before = await databasePool.query(`select "policy_id","policy_revision" from "content_model_policy_currents" where "workspace_id"=$1 and "format"='slideshow'`, [workspaceId]);
    expect(before.rows).toEqual([{ policy_id: v4.id, policy_revision: 4 }]);

    const v5 = policy("content.slideshow.v5", 5);
    await expect(persistCurrentContentModelPolicy(db, workspaceId, { ...v5, digest: `sha256:${"0".repeat(64)}` })).resolves.toBe(false);
    await expect(persistCurrentContentModelPolicy(db, workspaceId, v5, new Date("2026-09-04T11:00:00Z"))).resolves.toBe(true);
    await expect(persistCurrentContentModelPolicy(db, workspaceId, v5, new Date("2026-09-04T11:00:00Z"))).resolves.toBe(true);
    await expect(persistCurrentContentModelPolicy(db, workspaceId, v4)).resolves.toBe(false);

    const evidence = await databasePool.query(`select "id","revision","policy_digest" from "content_model_policy_revisions" where "workspace_id"=$1 and "format"='slideshow' order by "revision"`, [workspaceId]);
    expect(evidence.rows).toEqual([
      { id: v4.id, revision: 4, policy_digest: v4.digest },
      { id: v5.id, revision: 5, policy_digest: v5.digest },
    ]);
    const currentPolicy = await databasePool.query(`select "policy_id","policy_revision","policy_digest" from "content_model_policy_currents" where "workspace_id"=$1 and "format"='slideshow'`, [workspaceId]);
    expect(currentPolicy.rows).toEqual([{ policy_id: v5.id, policy_revision: 5, policy_digest: v5.digest }]);
    const supersessions = await databasePool.query(`select "predecessor_policy_id","predecessor_policy_revision","successor_policy_id","successor_policy_revision" from "content_model_policy_supersessions" where "workspace_id"=$1`, [workspaceId]);
    expect(supersessions.rows).toEqual([{ predecessor_policy_id: v4.id, predecessor_policy_revision: 4, successor_policy_id: v5.id, successor_policy_revision: 5 }]);

    await expect(databasePool.query(`update "content_model_policy_revisions" set "status"='retired' where "workspace_id"=$1 and "id"=$2`, [workspaceId, v4.id])).rejects.toThrow(/immutable/);
    await expect(databasePool.query(`delete from "content_model_policy_supersessions" where "workspace_id"=$1`, [workspaceId])).rejects.toThrow(/immutable/);
  }, 120_000);
});
