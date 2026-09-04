import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describePostgres = databaseUrl ? describe : describe.skip;
const key = "integration-generation-rights-key-material-0001";

describePostgres("generation-rights erasure PostgreSQL contract", () => {
  it("applies 0114 and proves privilege, retention, fencing, locking, erasure, tamper and replay behavior", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const schema = `rights_erase_${suffix}`;
    const ownerRole = `rights_owner_${suffix}`;
    const workerRole = `rights_worker_${suffix}`;
    const ordinaryRole = `rights_plain_${suffix}`;
    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    const admin = await pool.connect();
    const q = (identifier: string) => `"${identifier}"`;

    const seedWorkspace = async (client: PoolClient, id: string, options: { floor?: number; hold?: "legacy" | "stale" | "rights" } = {}) => {
      const now = Date.now();
      const policyCreated = new Date(now - 86_400_000);
      const evidenceCreated = new Date(now - 400 * 86_400_000);
      await client.query(`INSERT INTO ${q(schema)}.workspaces (id) VALUES ($1)`, [id]);
      await client.query(`INSERT INTO ${q(schema)}.inspiration_rights_evidence (workspace_id,id,digest,created_at) VALUES ($1,'evidence-a',$2,$3)`, [id, `sha256:${"a".repeat(64)}`, evidenceCreated]);
      await client.query(`INSERT INTO ${q(schema)}.inspiration_rights_snapshots (workspace_id,id,revision,digest,created_at) VALUES ($1,'snapshot-a',1,$2,$3)`, [id, `sha256:${"b".repeat(64)}`, evidenceCreated]);
      const revision = { schema: "retention-policy-revision/v2", revision: 1, legalFloorSource: "deployment_trusted/v2", createdAt: policyCreated.toISOString(), rules: [{ retentionClass: "generation_rights_evidence", durationDays: 365, recoverableDays: 0, legalFloorDays: options.floor ?? 365 }] };
      const closure = { erasureScheduled: true, exportId: "export-a", accessRevocationEvidence: { schema: "workspace-access-revocation-evidence/v1", externalEffects: [] }, lease: { id: "lease_fixture", fence: 1, expiresAt: new Date(now + 3_600_000).toISOString() } };
      await client.query(`INSERT INTO ${q(schema)}.workspace_governance_resources VALUES ($1,'retention_policy','active',1,'active',$2,NULL,now(),now()),($1,'workspace_export','export-a',1,'succeeded','{}',NULL,now(),now()),($1,'workspace_closure','closure-a',1,'erasure_running',$3,NULL,now(),now())`, [id, JSON.stringify({ revisions: [revision], activeRevision: 1 }), JSON.stringify(closure)]);
      if (options.hold) {
        const classes = options.hold === "rights" ? ["generation_rights_evidence"] : ["consent_evidence"];
        const created = options.hold === "legacy" ? new Date(policyCreated.getTime() - 86_400_000) : new Date(policyCreated.getTime() + 1_000);
        await client.query(`INSERT INTO ${q(schema)}.workspace_governance_resources VALUES ($1,'retention_hold','hold-a',1,'active',$2,NULL,$3,$3)`, [id, JSON.stringify({ retentionClasses: classes, expiresAt: null }), created]);
      }
    };

    const invoke = async (workspaceId: string, fence = 1, signingKey = key, signingKeyId = "integration-key-1", closureId = "closure-a", leaseId = "lease_fixture") => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL ROLE ${q(workerRole)}`);
        await client.query("SELECT set_config('app.generation_rights_erasure_hmac_key',$1,true), set_config('app.generation_rights_erasure_hmac_key_id',$2,true)", [signingKey, signingKeyId]);
        const result = await client.query(`SELECT * FROM ${q(schema)}.erase_closed_workspace_generation_rights($1,$2,$3,$4)`, [workspaceId, closureId, leaseId, fence]);
        await client.query("COMMIT");
        return result.rows[0] as { outcome: string; tombstone_digest: string | null };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };

    try {
      await admin.query(`CREATE SCHEMA ${q(schema)}`);
      await admin.query(`SET search_path TO ${q(schema)}, pg_catalog`);
      await admin.query(`
        CREATE TABLE workspaces (id text PRIMARY KEY, deleted_at timestamptz);
        CREATE TABLE workspace_governance_resources (workspace_id text, kind text, id text, version integer, status text, body jsonb, created_by_user_id text, created_at timestamptz, updated_at timestamptz, PRIMARY KEY(workspace_id,kind,id));
        CREATE TABLE workspace_governance_mutation_receipts (workspace_id text, capability text, idempotency_key text, request_digest text, actor_identity text, auth_context_digest text, result jsonb, created_at timestamptz, PRIMARY KEY(workspace_id,capability,idempotency_key));
        CREATE TABLE workspace_audit_trail_events (workspace_id text, sequence integer, id text, event jsonb, occurred_at timestamptz, PRIMARY KEY(workspace_id,sequence));
        CREATE TABLE generation_intents (workspace_id text);
        CREATE TABLE inspiration_rights_evidence (workspace_id text, id text, digest text, created_at timestamptz, PRIMARY KEY(workspace_id,id));
        CREATE TABLE inspiration_rights_snapshots (workspace_id text, id text, revision integer, digest text, created_at timestamptz, PRIMARY KEY(workspace_id,id,revision));
        CREATE FUNCTION legacy_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;
        CREATE TRIGGER inspiration_rights_evidence_immutable BEFORE UPDATE OR DELETE ON inspiration_rights_evidence FOR EACH ROW EXECUTE FUNCTION legacy_immutable();
      `);
      for (const [id, options] of [["success", {}], ["lease-wait", {}], ["weak-floor", { floor: 30 }], ["oversized-policy", {}], ["multi-closure", { floor: 30 }], ["multi-lease", { floor: 30 }], ["legacy-hold", { hold: "legacy" }], ["stale-hold", { hold: "stale" }], ["rights-hold", { hold: "rights" }]] as const) await seedWorkspace(admin, id, options);
      await admin.query(`UPDATE ${q(schema)}.workspace_governance_resources SET body=jsonb_set(body,'{revisions,0,rules,0,durationDays}','2147483647'::jsonb) WHERE workspace_id='oversized-policy' AND kind='retention_policy'`);
      await admin.query(`INSERT INTO ${q(schema)}.workspace_governance_resources SELECT workspace_id,kind,'closure-b',version,status,body,created_by_user_id,created_at,updated_at FROM ${q(schema)}.workspace_governance_resources WHERE workspace_id='multi-closure' AND kind='workspace_closure' AND id='closure-a'`);

      const migration = readFileSync("drizzle/0114_generation_rights_evidence_erasure.sql", "utf8")
        .replaceAll("tasmeemai_generation_rights_eraser_owner", ownerRole)
        .replaceAll("tasmeemai_workspace_closure_worker", workerRole)
        .replaceAll("public.", `${q(schema)}.`)
        .replaceAll("SCHEMA public", `SCHEMA ${q(schema)}`)
        .replaceAll("'public'", `'${schema}'`);
      await admin.query(migration);
      await admin.query(`CREATE ROLE ${q(ordinaryRole)} NOLOGIN`);
      const privileges = await admin.query(`SELECT
        has_schema_privilege($1,$2,'USAGE') AS worker_schema,
        has_schema_privilege($3,n.nspname,'USAGE') AS owner_extension_schema,
        has_function_privilege($3, format('%I.hmac(bytea,bytea,text)',n.nspname),'EXECUTE') AS owner_hmac,
        has_schema_privilege($1,$2,'CREATE') AS worker_create,
        has_schema_privilege($3,$2,'CREATE') AS owner_create
        FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'`, [workerRole, schema, ownerRole]);
      expect(privileges.rows[0]).toMatchObject({ worker_schema: true, owner_extension_schema: true, owner_hmac: true, worker_create: false, owner_create: false });

      await admin.query("BEGIN");
      await admin.query(`SET LOCAL ROLE ${q(ordinaryRole)}`);
      await expect(admin.query(`SELECT * FROM ${q(schema)}.erase_closed_workspace_generation_rights('success','closure-a','lease_fixture',1)`)).rejects.toThrow(/permission denied/);
      await admin.query("ROLLBACK");

      await admin.query("BEGIN");
      await admin.query(`SET LOCAL ROLE ${q(workerRole)}`);
      await expect(admin.query(`DELETE FROM ${q(schema)}.inspiration_rights_evidence WHERE workspace_id='success'`)).rejects.toThrow(/permission denied/);
      await admin.query("ROLLBACK");

      await expect(invoke("success", 2)).rejects.toThrow(/current fenced workspace closure lease required/);
      await expect(invoke("weak-floor")).resolves.toMatchObject({ outcome: "blocked_retention_policy" });
      await expect(invoke("oversized-policy")).resolves.toMatchObject({ outcome: "blocked_retention_policy" });
      await expect(invoke("multi-closure")).resolves.toMatchObject({ outcome: "blocked_retention_policy" });
      await expect(invoke("multi-closure", 1, key, "integration-key-1", "closure-b")).resolves.toMatchObject({ outcome: "blocked_retention_policy" });
      await expect(invoke("multi-lease")).resolves.toMatchObject({ outcome: "blocked_retention_policy" });
      await admin.query(`UPDATE ${q(schema)}.workspace_governance_resources SET body=jsonb_set(jsonb_set(body,'{lease,id}',to_jsonb('lease_second'::text)),'{lease,fence}','2'::jsonb) WHERE workspace_id='multi-lease' AND kind='workspace_closure'`);
      await expect(invoke("multi-lease", 2, key, "integration-key-1", "closure-a", "lease_second")).resolves.toMatchObject({ outcome: "blocked_retention_policy" });
      await expect(invoke("legacy-hold")).resolves.toMatchObject({ outcome: "blocked_retention_hold" });
      await expect(invoke("stale-hold")).resolves.toMatchObject({ outcome: "blocked_retention_hold" });
      await expect(invoke("rights-hold")).resolves.toMatchObject({ outcome: "blocked_retention_hold" });
      expect((await admin.query(`SELECT count(*)::integer AS count FROM ${q(schema)}.generation_rights_erasure_attempts`)).rows[0].count).toBe(9);
      expect((await admin.query(`SELECT count(*)::integer AS count FROM ${q(schema)}.workspace_governance_mutation_receipts WHERE workspace_id='multi-closure' AND capability='workspace_closures.erase_generation_rights_attempt@1'`)).rows[0].count).toBe(2);

      const attemptMac = (await admin.query(`SELECT attempt_mac FROM ${q(schema)}.generation_rights_erasure_attempts WHERE workspace_id='weak-floor'`)).rows[0].attempt_mac as string;
      await admin.query("SET session_replication_role = replica");
      await admin.query(`UPDATE ${q(schema)}.generation_rights_erasure_attempts SET attempt_mac=$1 WHERE workspace_id='weak-floor'`, [`hmac-sha256:${"0".repeat(64)}`]);
      await admin.query("SET session_replication_role = origin");
      await expect(invoke("weak-floor")).rejects.toThrow(/attempt replay proof invalid/);
      await admin.query("SET session_replication_role = replica");
      await admin.query(`UPDATE ${q(schema)}.generation_rights_erasure_attempts SET attempt_mac=$1 WHERE workspace_id='weak-floor'`, [attemptMac]);
      await admin.query("SET session_replication_role = origin");

      const lockerBeforeExpiry = await pool.connect();
      try {
        await admin.query(`UPDATE ${q(schema)}.workspace_governance_resources SET body=jsonb_set(body,'{lease,expiresAt}',to_jsonb((clock_timestamp()+interval '150 milliseconds')::text)) WHERE workspace_id='lease-wait' AND kind='workspace_closure'`);
        await lockerBeforeExpiry.query("BEGIN");
        await lockerBeforeExpiry.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["workspace-governance:lease-wait"]);
        const expiresWhileWaiting = invoke("lease-wait");
        await new Promise((resolve) => setTimeout(resolve, 200));
        await lockerBeforeExpiry.query("COMMIT");
        await expect(expiresWhileWaiting).rejects.toThrow(/current fenced workspace closure lease required/);
      } finally {
        await lockerBeforeExpiry.query("ROLLBACK").catch(() => undefined);
        lockerBeforeExpiry.release();
      }

      const erased = await invoke("success");
      expect(erased).toMatchObject({ outcome: "erased", tombstone_digest: expect.stringMatching(/^sha256:/) });
      expect((await admin.query(`SELECT count(*)::integer AS count FROM ${q(schema)}.inspiration_rights_evidence WHERE workspace_id='success'`)).rows[0].count).toBe(0);
      const validMac = (await admin.query(`SELECT tombstone_mac FROM ${q(schema)}.generation_rights_erasure_tombstones WHERE workspace_id='success'`)).rows[0].tombstone_mac as string;
      await admin.query("SET session_replication_role = replica");
      await admin.query(`UPDATE ${q(schema)}.generation_rights_erasure_tombstones SET tombstone_mac=$1 WHERE workspace_id='success'`, [`hmac-sha256:${"0".repeat(64)}`]);
      await admin.query("SET session_replication_role = origin");
      await expect(invoke("success")).rejects.toThrow(/replay proof invalid/);
      await admin.query("SET session_replication_role = replica");
      await admin.query(`UPDATE ${q(schema)}.generation_rights_erasure_tombstones SET tombstone_mac=$1 WHERE workspace_id='success'`, [validMac]);
      await admin.query("SET session_replication_role = origin");
      await expect(invoke("success")).resolves.toMatchObject({ outcome: "replayed", tombstone_digest: erased.tombstone_digest });
      await admin.query("BEGIN");
      await admin.query(`SET LOCAL ROLE ${q(workerRole)}`);
      expect((await admin.query(`SELECT ${q(schema)}.generation_rights_erasure_signing_key_id('success','closure-a','lease_fixture',1,'') AS key_id`)).rows[0].key_id).toBe("integration-key-1");
      expect((await admin.query(`SELECT ${q(schema)}.generation_rights_erasure_signing_key_id('weak-floor','closure-a','lease_fixture',1,'blocked_retention_policy') AS key_id`)).rows[0].key_id).toBe("integration-key-1");
      await admin.query("ROLLBACK");

      const locker = await pool.connect();
      const inserter = await pool.connect();
      try {
        await locker.query("BEGIN");
        await locker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["workspace-governance:success"]);
        let settled = false;
        const insert = inserter.query(`INSERT INTO ${q(schema)}.inspiration_rights_evidence (workspace_id,id,digest,created_at) VALUES ('success','racing',$1,now())`, [`sha256:${"c".repeat(64)}`]).finally(() => { settled = true; });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(settled).toBe(false);
        await locker.query("COMMIT");
        await expect(insert).rejects.toThrow(/workspace closure blocks new inspiration rights evidence/);

        await locker.query("BEGIN");
        await locker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["workspace-governance:success"]);
        settled = false;
        const intentInsert = inserter.query(`INSERT INTO ${q(schema)}.generation_intents (workspace_id) VALUES ('success')`).finally(() => { settled = true; });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(settled).toBe(false);
        await locker.query("COMMIT");
        await expect(intentInsert).rejects.toThrow(/workspace closure blocks new or changed generation intents/);
      } finally {
        await locker.query("ROLLBACK").catch(() => undefined);
        locker.release();
        inserter.release();
      }
    } finally {
      await admin.query("RESET session_replication_role").catch(() => undefined);
      await admin.query(`DROP SCHEMA IF EXISTS ${q(schema)} CASCADE`).catch(() => undefined);
      await admin.query(`DROP OWNED BY ${q(ownerRole)}`).catch(() => undefined);
      await admin.query(`DROP OWNED BY ${q(workerRole)}`).catch(() => undefined);
      await admin.query(`DROP OWNED BY ${q(ordinaryRole)}`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS ${q(ordinaryRole)}`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS ${q(workerRole)}`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS ${q(ownerRole)}`).catch(() => undefined);
      admin.release();
      await pool.end();
    }
  }, 30_000);
});
