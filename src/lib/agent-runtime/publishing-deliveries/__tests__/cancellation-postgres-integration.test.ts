import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { DrizzlePublishingDeliveryRepository } from "../postgres-repository";
import type {
  PublishingDeliveryCancellationAuthorizationSession,
  PublishingDeliveryExecutionReadinessSession,
  PublishingDeliveryRecord,
} from "../types";
import { setupPublishingDeliveries } from "./fixtures";

type Db = ReturnType<typeof getDb>;

const TEST_DATABASE_NAME = /(?:^|[_-])(?:test|ci|tmp|ephemeral)(?:[_-]|$)/i;
const CHILD_DATABASE_NAME = /^node_banana_cancel_test_[a-f0-9]{24}$/;
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const authorizationContractDigest =
  "sha256:cae0f4b46fca3c38dd014bf2c27b2b8f2a3555d24eb62da60c367e49f2e1554e";

function guardedTestDatabaseUrl(): URL | null {
  const configured = process.env.TEST_DATABASE_URL?.trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    if (
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !databaseName ||
      !TEST_DATABASE_NAME.test(databaseName)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function quotedIdentifier(value: string): string {
  if (!CHILD_DATABASE_NAME.test(value)) {
    throw new TypeError("Refusing to operate on a non-test database name.");
  }
  return `"${value}"`;
}

const configuredUrl = guardedTestDatabaseUrl();
const describePostgres = configuredUrl ? describe : describe.skip;

interface DeliveryFixture {
  workspaceId: string;
  deliveryId: string;
  channelId: string;
  artifactId: string;
  effectKey: string;
  intentDigest: string | null;
  nextEventSequence: number;
}

async function seedDelivery(
  pool: Pool,
  state: "scheduled" | "dispatching",
): Promise<DeliveryFixture> {
  const suffix = randomUUID().replaceAll("-", "");
  const workspaceId = `workspace_cancel_pg_${suffix}`;
  const deliveryId = `pdl_cancel_pg_${suffix}`;
  const channelId = `channel_cancel_pg_${suffix}`;
  const artifactId = `artifact:cancel.pg.${suffix}`;
  const effectKey = `publishing-effect:v1:${workspaceId}:${deliveryId}`;
  const intentDigest = state === "dispatching" ? digest("b") : null;
  const nextEventSequence = state === "dispatching" ? 4 : 3;
  const acceptedAt = new Date(Date.now() - 60_000);
  const snapshot = {
    schema: "publishing-delivery-target-snapshot/v1",
    target: { targetId: `target_${suffix}`, channelId },
    targetDigest: digest("c"),
  };
  const client = await pool.connect();
  try {
    await client.query("begin");
    // The fresh child database is deliberately disposable. Replica mode is
    // scoped to this seed transaction so synthetic #167 prerequisite rows do
    // not require rebuilding the full approval graph. CHECK constraints remain
    // active; every #168 trigger is active again for the exercised transition.
    await client.query("set local session_replication_role = replica");
    await client.query(
      `insert into "runtime_publishing_deliveries" (
         "workspace_id", "id", "release_id", "plan_id",
         "plan_revision_id", "plan_revision", "plan_revision_digest",
         "validation_evidence_digest", "approval_request_id",
         "approval_decision_id", "requesting_principal_id",
         "requesting_key_id", "target_ordinal", "target_id",
         "channel_id", "artifact_ids", "target_snapshot",
         "target_snapshot_digest", "publish_at", "desired_state", "state",
         "effect_key", "intent_digest", "provider_adapter_contract_digest",
         "provider_operation_ref",
         "latest_effect_evidence_digest", "failure_code",
         "next_event_sequence", "next_outbox_generation", "accepted_at",
         "scheduled_at", "dispatch_started_at", "effect_contact_started_at",
         "completed_at", "updated_at"
       ) values (
         $1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $22, $23, 0, $10, $11,
         $12::jsonb, $13::jsonb, $14, $15, 'publish', $16, $17, $18, $19,
         null, null, null, $20, 2, $15, $15, $21, null, null, $15
       )`,
      [
        workspaceId,
        deliveryId,
        `pdr_${suffix}`,
        `plan_${suffix}`,
        `plan_revision_${suffix}`,
        digest("d"),
        digest("e"),
        `approval_request_${suffix}`,
        `approval_decision_${suffix}`,
        snapshot.target.targetId,
        channelId,
        JSON.stringify([artifactId]),
        JSON.stringify(snapshot),
        digest("f"),
        acceptedAt,
        state,
        effectKey,
        intentDigest,
        state === "dispatching" ? digest("a") : null,
        nextEventSequence,
        state === "dispatching" ? acceptedAt : null,
        `principal_cancel_pg_${suffix}`,
        `key_cancel_pg_${suffix}`,
      ],
    );
    const events = [
      { sequence: 1, type: "delivery.accepted", evidence: {} },
      { sequence: 2, type: "delivery.scheduled", evidence: {} },
      ...(state === "dispatching"
        ? [{
            sequence: 3,
            type: "effect.prepared",
            evidence: {
              effectKey,
              effectGeneration: 1,
              intentDigest,
              providerAdapterContractDigest: digest("a"),
            },
          }]
        : []),
    ];
    for (const event of events) {
      await client.query(
        `insert into "runtime_publishing_delivery_events" (
           "workspace_id", "id", "delivery_id", "sequence", "type",
           "evidence", "occurred_at"
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          workspaceId,
          `pde_${suffix}_${event.sequence}`,
          deliveryId,
          event.sequence,
          event.type,
          JSON.stringify(event.evidence),
          acceptedAt,
        ],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return {
    workspaceId,
    deliveryId,
    channelId,
    artifactId,
    effectKey,
    intentDigest,
    nextEventSequence,
  };
}

async function waitForCancellationAdvisoryLock(observer: Pool): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ blocked: boolean }>(
      `select exists (
         select 1 from pg_stat_activity
         where datname = current_database()
           and wait_event_type = 'Lock'
           and query like '%pg_advisory_xact_lock%'
           and pid <> pg_backend_pid()
       ) as blocked`,
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Cancellation transaction did not reach its advisory lock.");
}

interface RepositoryFixture {
  repository: DrizzlePublishingDeliveryRepository;
  delivery: PublishingDeliveryRecord;
  authorizationSession: PublishingDeliveryCancellationAuthorizationSession;
  cancellationId: string;
}

async function seedRepositoryDelivery(pool: Pool): Promise<RepositoryFixture> {
  const memory = await setupPublishingDeliveries();
  const accepted = await memory.service.release(memory.releaseInput());
  const original = await memory.repository.getDelivery({
    workspaceId: "workspace_1",
    deliveryId: accepted.deliveries[0]!.id,
  });
  if (!original) throw new TypeError("Canonical Delivery fixture is missing.");
  const suffix = randomUUID().replaceAll("-", "");
  const intentDigest = digest("7");
  const providerAdapterContractDigest = digest("8");
  const dispatchStartedAt = new Date();
  const delivery: PublishingDeliveryRecord = {
    ...structuredClone(original),
    publishAt: new Date(dispatchStartedAt.getTime() - 1_000),
    state: "dispatching",
    intentDigest,
    providerAdapterContractDigest,
    nextEventSequence: 4,
    dispatchStartedAt,
    updatedAt: dispatchStartedAt,
  };
  const actor = {
    kind: "agent" as const,
    principalId: `principal_cancel_pg_${suffix}`,
    keyId: `key_cancel_pg_${suffix}`,
  };
  const evidenceRef = `cancel_agent_trace_${suffix}`;
  const issuedAt = new Date(dispatchStartedAt.getTime() - 1_000);
  const expiresAt = new Date(issuedAt.getTime() + 15 * 60_000);
  const resources = {
    channelIds: [delivery.channelId],
    artifactIds: [...delivery.artifactIds],
  };
  const evidenceDigest = canonicalDigest({
    schema: "publishing-delivery-cancellation-authority-evidence/v1",
    workspaceId: delivery.workspaceId,
    actor,
    capability: "publishing_deliveries.cancel@1",
    contractDigest: authorizationContractDigest,
    admissionEvidenceRef: evidenceRef,
    evidenceRef,
    resources,
    humanGrants: [],
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const authorizationSession: PublishingDeliveryCancellationAuthorizationSession = {
    schema: "publishing-delivery-cancellation-authorization-session/v1",
    id: `pdcas_${evidenceDigest.slice("sha256:".length)}`,
    workspaceId: delivery.workspaceId,
    actor,
    capability: "publishing_deliveries.cancel@1",
    contractDigest: authorizationContractDigest,
    admissionEvidenceRef: evidenceRef,
    evidenceRef,
    evidenceDigest,
    resources,
    humanGrants: [],
    issuedAt,
    expiresAt,
  };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(
      `insert into "agent_principals" (
         "id", "workspace_id", "name", "requested_access", "status"
       ) values ($1, $2, $3, '[]'::jsonb, 'active')`,
      [actor.principalId, delivery.workspaceId, `Cancel test ${suffix}`],
    );
    await client.query(
      `insert into "agent_keys" (
         "id", "principal_id", "name", "lookup_prefix", "secret_hash"
       ) values ($1, $2, $3, $4, $5)`,
      [
        actor.keyId,
        actor.principalId,
        `Cancel key ${suffix}`,
        `cancel_${suffix}`,
        digest("6"),
      ],
    );
    await client.query(
      `insert into "agent_authorization_decisions" (
         "id", "workspace_id", "principal_id", "key_id", "capability_name",
         "capability_version", "authorization_contract_digest", "outcome",
         "reason", "operator_trace_ref", "resources", "created_at"
       ) values (
         $1, $2, $3, $4, 'publishing_deliveries.cancel', 1, $5,
         'allowed', 'allowed', $6, $7::jsonb, $8
       )`,
      [
        `decision_cancel_pg_${suffix}`,
        delivery.workspaceId,
        actor.principalId,
        actor.keyId,
        authorizationContractDigest,
        evidenceRef,
        JSON.stringify([
          { kind: "channel", id: delivery.channelId },
          ...delivery.artifactIds.map((id) => ({ kind: "artifact", id })),
        ]),
        issuedAt,
      ],
    );
    await client.query(
      `insert into "runtime_publishing_deliveries" (
         "workspace_id", "id", "release_id", "plan_id",
         "plan_revision_id", "plan_revision", "plan_revision_digest",
         "validation_evidence_digest", "approval_request_id",
         "approval_decision_id", "requesting_principal_id", "requesting_key_id",
         "target_ordinal", "target_id", "channel_id",
         "artifact_ids", "target_snapshot", "target_snapshot_digest",
         "publish_at", "desired_state", "state", "effect_key", "intent_digest",
         "provider_adapter_contract_digest", "provider_operation_ref",
         "latest_effect_evidence_digest", "failure_code",
         "next_event_sequence", "next_outbox_generation", "accepted_at",
         "scheduled_at", "dispatch_started_at", "effect_contact_started_at",
         "completed_at", "updated_at"
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $23, $24, 0, $11, $12,
         $13::jsonb, $14::jsonb, $15, $16, 'publish', 'dispatching', $17,
         $18, $19, null, null, null, 4, 2, $20, $21, $22, null, null, $22
       )`,
      [
        delivery.workspaceId,
        delivery.id,
        delivery.releaseId,
        delivery.planId,
        delivery.planRevisionId,
        delivery.planRevision,
        delivery.planRevisionDigest,
        memory.rawApproval.validation.evidenceDigest,
        delivery.approvalRequestId,
        delivery.approvalDecisionId,
        delivery.targetId,
        delivery.channelId,
        JSON.stringify(delivery.artifactIds),
        JSON.stringify(delivery.targetSnapshot),
        delivery.targetSnapshotDigest,
        delivery.publishAt,
        delivery.effectKey,
        intentDigest,
        providerAdapterContractDigest,
        delivery.acceptedAt,
        delivery.scheduledAt,
        dispatchStartedAt,
        delivery.requestingPrincipalId,
        delivery.requestingKeyId,
      ],
    );
    for (const event of [
      { sequence: 1, type: "delivery.accepted", evidence: {} },
      { sequence: 2, type: "delivery.scheduled", evidence: {} },
      {
        sequence: 3,
        type: "effect.prepared",
        evidence: {
          effectKey: delivery.effectKey,
          effectGeneration: 1,
          intentDigest,
          providerAdapterContractDigest,
        },
      },
    ]) {
      await client.query(
        `insert into "runtime_publishing_delivery_events" (
           "workspace_id", "id", "delivery_id", "sequence", "type",
           "evidence", "occurred_at"
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          delivery.workspaceId,
          `pde_cancel_pg_${suffix}_${event.sequence}`,
          delivery.id,
          event.sequence,
          event.type,
          JSON.stringify(event.evidence),
          dispatchStartedAt,
        ],
      );
    }
    await client.query(
      `insert into "runtime_publishing_delivery_outbox_intents" (
         "id", "workspace_id", "delivery_id", "dedupe_key", "generation",
         "state", "available_at", "delivery_token", "delivery_attempts",
         "claimed_at", "delivered_at"
       ) values ($1, $2, $3, $4, 1, 'delivered', $5, null, 1, $5, $5)`,
      [
        `pdo_cancel_pg_${suffix}`,
        delivery.workspaceId,
        delivery.id,
        `publishing-delivery:${delivery.workspaceId}:${delivery.id}:v1`,
        delivery.publishAt,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  const database = drizzle(pool, { schema });
  return {
    repository: new DrizzlePublishingDeliveryRepository(
      () => database as Db,
    ),
    delivery,
    authorizationSession,
    cancellationId: `pdc_cancel_pg_${suffix}`,
  };
}

describePostgres("Publishing Delivery cancellation with real PostgreSQL", () => {
  let adminPool: Pool;
  let databasePool: Pool;
  let childDatabaseName: string;
  let childCreated = false;

  async function dropChildDatabase(): Promise<void> {
    if (!childCreated || !CHILD_DATABASE_NAME.test(childDatabaseName)) return;
    await adminPool.query(
      `select pg_terminate_backend(pid)
       from pg_stat_activity
       where datname = $1 and pid <> pg_backend_pid()`,
      [childDatabaseName],
    );
    await adminPool.query(`drop database ${quotedIdentifier(childDatabaseName)}`);
    childCreated = false;
  }

  beforeAll(async () => {
    if (!configuredUrl) throw new TypeError("Disposable test database is required.");
    adminPool = new Pool({ connectionString: configuredUrl.toString(), max: 2 });
    const expectedDatabase = decodeURIComponent(configuredUrl.pathname.slice(1));
    const current = await adminPool.query<{ database_name: string }>(
      "select current_database() as database_name",
    );
    if (current.rows[0]?.database_name !== expectedDatabase) {
      throw new TypeError("TEST_DATABASE_URL did not select its guarded database.");
    }
    childDatabaseName = `node_banana_cancel_test_${randomUUID()
      .replaceAll("-", "")
      .slice(0, 24)}`;
    try {
      await adminPool.query(`create database ${quotedIdentifier(childDatabaseName)}`);
      childCreated = true;
      const childUrl = new URL(configuredUrl);
      childUrl.pathname = `/${childDatabaseName}`;
      databasePool = new Pool({ connectionString: childUrl.toString(), max: 6 });
      await migrate(drizzle(databasePool), { migrationsFolder: "./drizzle" });
    } catch (error) {
      await databasePool?.end().catch(() => undefined);
      await dropChildDatabase().catch(() => undefined);
      await adminPool.end();
      throw error;
    }
  }, 120_000);

  afterAll(async () => {
    await databasePool?.end();
    await dropChildDatabase();
    await adminPool?.end();
  }, 30_000);

  it("installs the #169 recovery checks, indexes, and global Approval guard", async () => {
    const constraints = await databasePool.query<{ name: string; definition: string }>(
      `select conname as name, pg_get_constraintdef(oid) as definition
       from pg_constraint
       where conname in (
         'runtime_publishing_deliveries_origin_check',
         'runtime_publishing_delivery_effect_receipts_identity_check',
         'runtime_publishing_delivery_retry_receipts_contract_check'
       )
       order by conname`,
    );
    expect(constraints.rows).toHaveLength(3);
    expect(constraints.rows.find(({ name }) =>
      name === "runtime_publishing_delivery_effect_receipts_identity_check")
      ?.definition).toContain("effect_attempt >= 1");
    expect(constraints.rows.find(({ name }) =>
      name === "runtime_publishing_delivery_retry_receipts_contract_check")
      ?.definition).toContain("source_failure_class");

    const triggers = await databasePool.query<{ name: string }>(
      `select tgname as name from pg_trigger
       where not tgisinternal and tgname like '%global_single_use%'
       order by tgname`,
    );
    expect(triggers.rows.map(({ name }) => name)).toEqual([
      "runtime_publishing_approval_consumptions_global_single_use",
      "runtime_publishing_delivery_retry_approval_consumptions_global_single_use",
    ]);

    const indexes = await databasePool.query<{ indexname: string }>(
      `select indexname from pg_indexes
       where indexname in (
         'runtime_publishing_deliveries_source_delivery_idx',
         'runtime_publishing_delivery_retry_receipts_invocation_unique',
         'runtime_publishing_delivery_retry_receipts_approval_consumption_idx'
       )`,
    );
    expect(indexes.rows).toHaveLength(3);
  });

  it("upgrades a non-empty 0049 Delivery through the transitional 0050 guards", async () => {
    const upgradeDatabaseName = `node_banana_cancel_test_${randomUUID()
      .replaceAll("-", "").slice(0, 24)}`;
    const migrationsFolder = await mkdtemp(join(tmpdir(), "node-banana-0049-upgrade-"));
    let upgradePool: Pool | undefined;
    let upgradeCreated = false;
    try {
      await mkdir(join(migrationsFolder, "meta"));
      const migrationFiles = (await readdir("drizzle"))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name))
        .filter((name) => Number(name.slice(0, 4)) <= 49);
      await Promise.all(migrationFiles.map((name) => copyFile(
        join("drizzle", name), join(migrationsFolder, name),
      )));
      const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
        version: string;
        dialect: string;
        entries: Array<{ idx: number }>;
      };
      await writeFile(join(migrationsFolder, "meta/_journal.json"), JSON.stringify({
        ...journal,
        entries: journal.entries.filter(({ idx }) => idx <= 49),
      }));
      await adminPool.query(`create database ${quotedIdentifier(upgradeDatabaseName)}`);
      upgradeCreated = true;
      const upgradeUrl = new URL(configuredUrl!);
      upgradeUrl.pathname = `/${upgradeDatabaseName}`;
      upgradePool = new Pool({ connectionString: upgradeUrl.toString(), max: 2 });
      await migrate(drizzle(upgradePool), { migrationsFolder });

      const suffix = randomUUID().replaceAll("-", "");
      const workspaceId = `workspace_upgrade_${suffix}`;
      const principalId = `principal_upgrade_${suffix}`;
      const keyId = `key_upgrade_${suffix}`;
      const approvalId = `par_upgrade_${suffix}`;
      const deliveryId = `pdl_upgrade_${suffix}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60 * 60_000);
      const targetId = `target_upgrade_${suffix}`;
      const channelId = `channel_upgrade_${suffix}`;
      const artifactId = `artifact:upgrade.${suffix}`;
      const snapshot = {
        schema: "publishing-delivery-target-snapshot/v1",
        target: { targetId, channelId },
        targetDigest: digest("4"),
      };
      const client = await upgradePool.connect();
      try {
        await client.query("begin");
        await client.query("set local session_replication_role = replica");
        await client.query(
          `insert into agent_principals (id,workspace_id,name,requested_access,status)
           values ($1,$2,'upgrade principal','[]'::jsonb,'active')`,
          [principalId, workspaceId],
        );
        await client.query(
          `insert into agent_keys (id,principal_id,name,lookup_prefix,secret_hash)
           values ($1,$2,'upgrade key',$3,$4)`,
          [keyId, principalId, `upgrade_${suffix}`, digest("3")],
        );
        await client.query(
          `insert into runtime_publishing_approval_requests (
             workspace_id,id,plan_id,plan_revision_id,plan_revision,
             plan_revision_digest,action,target_ids,target_set_digest,channel_ids,
             artifact_ids,requesting_principal_id,requesting_key_id,
             request_authorization_capability,request_authorization_contract_digest,
             request_authorization_evidence_ref,validation_evidence_digest,
             validation_current_state_digest,validation_context_id,
             validation_context_digest,validation_evaluated_at,validation_expires_at,
             validation_runtime_policy_identity,validation_runtime_policy_contract_digest,
             decision_policy_mode,decision_policy_expires_at,authorizes_execution,created_at
           ) values ($1,$2,$3,$4,1,$5,'publish',$6::jsonb,$7,$8::jsonb,$9::jsonb,
             $10,$11,'publishing_approvals.request@1',
             'sha256:9d46d813238045c0ba3924966834418c9f508741890f3aa81c5a494227e42892',
             $12,$13,$14,$15,$16,$17,$18,
             'publishing-runtime-policy/default@1',
             'sha256:c372d0a34f6b1ca086ef4cad760db2bbffab1ac5c668fede7f256106305b7cf1',
             'expires_at',$19,false,$17)`,
          [workspaceId, approvalId, `plan_${suffix}`, `revision_${suffix}`, digest("1"),
            JSON.stringify([targetId]), digest("2"), JSON.stringify([channelId]),
            JSON.stringify([artifactId]), principalId, keyId, `trace_${suffix}`,
            digest("5"), digest("6"), `validation_${suffix}`, digest("7"), now,
            expiresAt, new Date(now.getTime() + 30 * 60_000)],
        );
        await client.query(
          `insert into runtime_publishing_deliveries (
             workspace_id,id,release_id,plan_id,plan_revision_id,plan_revision,
             plan_revision_digest,validation_evidence_digest,approval_request_id,
             approval_decision_id,target_ordinal,target_id,channel_id,artifact_ids,
             target_snapshot,target_snapshot_digest,publish_at,desired_state,state,
             effect_key,intent_digest,provider_operation_ref,latest_effect_evidence_digest,
             failure_code,next_event_sequence,next_outbox_generation,accepted_at,
             scheduled_at,dispatch_started_at,effect_contact_started_at,completed_at,updated_at
           ) values ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,0,$10,$11,$12::jsonb,$13::jsonb,
             $14,$15,'publish','scheduled',$16,null,null,null,null,3,2,$15,$15,null,null,null,$15)`,
          [workspaceId, deliveryId, `pdr_upgrade_${suffix}`, `plan_${suffix}`,
            `revision_${suffix}`, digest("1"), digest("5"), approvalId,
            `pad_upgrade_${suffix}`, targetId, channelId, JSON.stringify([artifactId]),
            JSON.stringify(snapshot), digest("8"), now,
            `publishing-effect:v1:${workspaceId}:${deliveryId}`],
        );
        await client.query("commit");
      } finally {
        client.release();
      }

      await copyFile("drizzle/0050_runtime_publishing_delivery_recovery.sql",
        join(migrationsFolder, "0050_runtime_publishing_delivery_recovery.sql"));
      await writeFile(join(migrationsFolder, "meta/_journal.json"), JSON.stringify(journal));
      await migrate(drizzle(upgradePool), { migrationsFolder });
      const upgraded = await upgradePool.query<{
        requesting_principal_id: string;
        requesting_key_id: string;
      }>(
        `select requesting_principal_id,requesting_key_id
         from runtime_publishing_deliveries where workspace_id=$1 and id=$2`,
        [workspaceId, deliveryId],
      );
      expect(upgraded.rows).toEqual([{
        requesting_principal_id: principalId,
        requesting_key_id: keyId,
      }]);
    } finally {
      await upgradePool?.end();
      if (upgradeCreated) {
        await adminPool.query(`drop database ${quotedIdentifier(upgradeDatabaseName)}`);
      }
      await rm(migrationsFolder, { recursive: true, force: true });
    }
  }, 120_000);

  it("commits the production manual-retry child bootstrap through the real event guards", async () => {
    const source = await seedDelivery(databasePool, "scheduled");
    const suffix = randomUUID().replaceAll("-", "");
    const childId = `pdl_retry_pg_${suffix}`;
    const retryId = `pdrt_${suffix}`;
    const consumptionId = `pdrc_${suffix}`;
    const effectKey = `publishing-effect:v1:${source.workspaceId}:${childId}`;
    const sourceEvidenceDigest = digest("9");
    const authorizationDigest = digest("8");
    const authorizationContract = digest("7");
    const now = new Date();
    const issuedAt = new Date(now.getTime() - 60_000);
    const expiresAt = new Date(now.getTime() + 14 * 60_000);
    const sourceRow = await databasePool.query<{
      approval_request_id: string;
      approval_decision_id: string;
      requesting_principal_id: string;
      requesting_key_id: string;
      target_snapshot_digest: string;
    }>(
      `select approval_request_id, approval_decision_id,
         requesting_principal_id, requesting_key_id, target_snapshot_digest
       from runtime_publishing_deliveries
       where workspace_id = $1 and id = $2`,
      [source.workspaceId, source.deliveryId],
    );
    const origin = sourceRow.rows[0]!;
    const resources = {
      channelIds: [source.channelId],
      artifactIds: [source.artifactId],
    };
    const client = await databasePool.connect();
    try {
      await client.query("begin");
      await client.query("set local session_replication_role = replica");
      await client.query(
        `insert into agent_principals (id, workspace_id, name, requested_access, status)
         values ($1, $2, 'retry bootstrap', '[]'::jsonb, 'active')`,
        [origin.requesting_principal_id, source.workspaceId],
      );
      await client.query(
        `insert into agent_keys (id, principal_id, name, lookup_prefix, secret_hash)
         values ($1, $2, 'retry bootstrap', $3, $4)`,
        [origin.requesting_key_id, origin.requesting_principal_id,
          `retry_${suffix}`, digest("6")],
      );
      await client.query(
        `insert into runtime_publishing_delivery_retry_approval_consumptions (
           workspace_id, id, approval_request_id, approval_decision_id,
           source_delivery_id, delivery_id, source_evidence_digest,
           requesting_principal_id, requesting_key_id, actor_kind, actor_id,
           actor_user_id, capability, authorization_contract_digest,
           authorization_evidence_ref, authorized_resources, consumed_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'agent',$8,null,
           'publishing_deliveries.retry@1',$10,$11,$12::jsonb,$13)`,
        [source.workspaceId, consumptionId, origin.approval_request_id,
          origin.approval_decision_id, source.deliveryId, childId,
          sourceEvidenceDigest, origin.requesting_principal_id,
          origin.requesting_key_id, authorizationContract,
          `retry_trace_${suffix}`, JSON.stringify(resources), now],
      );
      await client.query(
        `insert into runtime_publishing_delivery_retry_receipts (
           workspace_id,id,source_delivery_id,delivery_id,actor_kind,actor_id,
           idempotency_key,request_fingerprint,principal_id,key_id,user_id,
           capability,authorization_session_id,
           authorization_contract_digest,authorization_admission_evidence_ref,
           authorization_evidence_ref,authorization_evidence_digest,
           authorized_resources,authority_grants,authorization_issued_at,
           authorization_expires_at,source_evidence_digest,source_effect_generation,
           source_effect_key,source_intent_digest,source_provider_adapter_contract_digest,
           source_failure_class,source_effect_disposition,approval_request_id,
           approval_decision_id,approval_consumption_id,event_sequence,
           outbox_generation,requested_at,retry_at
         ) values ($1,$2,$3,$4,'agent',$5,$7,$8,$5,$6,null,
           'publishing_deliveries.retry@1',$9,$10,$11,$11,$12,$13::jsonb,'[]'::jsonb,
           $14,$15,$16,1,$17,null,null,'transient','not_created',$18,$19,$20,2,1,$21,$21)`,
        [source.workspaceId, retryId, source.deliveryId, childId,
          origin.requesting_principal_id, origin.requesting_key_id,
          `retry-key-${suffix}`, digest("5"), `pdras_${suffix}`,
          authorizationContract, `retry_trace_${suffix}`,
          authorizationDigest, JSON.stringify(resources), issuedAt, expiresAt,
          sourceEvidenceDigest, source.effectKey, origin.approval_request_id,
          origin.approval_decision_id, consumptionId, now],
      );
      await client.query("set local session_replication_role = origin");
      await client.query(
        `insert into runtime_publishing_deliveries (
           workspace_id,id,release_id,source_delivery_id,retry_id,plan_id,
           plan_revision_id,plan_revision,plan_revision_digest,
           validation_evidence_digest,approval_request_id,approval_decision_id,
           requesting_principal_id,requesting_key_id,target_ordinal,target_id,
           channel_id,artifact_ids,target_snapshot,target_snapshot_digest,publish_at,
           desired_state,state,effect_key,effect_generation,intent_digest,
           provider_adapter_contract_digest,provider_operation_ref,
           latest_effect_evidence_digest,failure_code,failure_class,failure_retryable,
           failure_effect_disposition,next_effect_attempt,confirmation_attempts,
           next_event_sequence,next_outbox_generation,accepted_at,scheduled_at,
           dispatch_started_at,effect_contact_started_at,completed_at,updated_at
         ) select workspace_id,$3,null,id,$4,plan_id,plan_revision_id,plan_revision,
           plan_revision_digest,validation_evidence_digest,approval_request_id,
           approval_decision_id,requesting_principal_id,requesting_key_id,0,target_id,
           channel_id,artifact_ids,target_snapshot,target_snapshot_digest,$5,'publish',
           'scheduled',$6,1,intent_digest,provider_adapter_contract_digest,null,null,
           null,null,null,null,1,0,4,2,$5,$5,null,null,null,$5
         from runtime_publishing_deliveries where workspace_id=$1 and id=$2`,
        [source.workspaceId, source.deliveryId, childId, retryId, now, effectKey],
      );
      await client.query(
        `insert into runtime_publishing_delivery_events
           (workspace_id,id,delivery_id,sequence,type,evidence,occurred_at)
         values
           ($1,$2,$3,1,'delivery.accepted',$4::jsonb,$9),
           ($1,$5,$3,2,'delivery.retry_requested',$6::jsonb,$9),
           ($1,$7,$3,3,'delivery.scheduled',$8::jsonb,$9)`,
        [source.workspaceId, `pde_${suffix}_1`, childId, JSON.stringify({
          origin: "retry", releaseId: null, sourceDeliveryId: source.deliveryId,
          retryId, approvalRequestId: origin.approval_request_id,
          approvalDecisionId: origin.approval_decision_id,
          targetSnapshotDigest: origin.target_snapshot_digest,
        }), `pde_${suffix}_2`, JSON.stringify({
          retryId, sourceDeliveryId: source.deliveryId,
          approvalRequestId: origin.approval_request_id,
          approvalDecisionId: origin.approval_decision_id,
          sourceEffectKey: source.effectKey,
          sourceEffectGeneration: 1,
          sourceEvidenceDigest,
          deliveryId: childId, effectKey,
        }), `pde_${suffix}_3`, JSON.stringify({ publishAt: now.toISOString() }), now],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const committed = await databasePool.query<{ next_event_sequence: number }>(
      `select next_event_sequence from runtime_publishing_deliveries
       where workspace_id=$1 and id=$2`,
      [source.workspaceId, childId],
    );
    expect(committed.rows).toEqual([{ next_event_sequence: 4 }]);
    const repository = new DrizzlePublishingDeliveryRepository(
      () => drizzle(databasePool, { schema }) as Db,
    );
    const visibility = {
      workspaceId: source.workspaceId,
      consumingPrincipalId: origin.requesting_principal_id,
      authorizedChannelIds: [source.channelId],
      authorizedArtifactIds: [source.artifactId],
    };
    expect(await repository.getDelivery({
      ...visibility,
      deliveryId: childId,
    })).toMatchObject({ id: childId, releaseId: null, retryId });
    expect(await repository.listDeliveries({
      workspaceId: source.workspaceId,
      filters: visibility,
      limit: 10,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: childId, retryId }),
    ]));
    expect(await repository.getDelivery({
      ...visibility,
      consumingPrincipalId: "principal_foreign",
      deliveryId: childId,
    })).toBeNull();
    expect(await repository.listDeliveries({
      workspaceId: source.workspaceId,
      filters: { ...visibility, consumingPrincipalId: "principal_foreign" },
      limit: 10,
    })).toEqual([]);
  });

  it("rejects a desired-state change without its exact cancellation ledger", async () => {
    const fixture = await seedDelivery(databasePool, "scheduled");
    const client = await databasePool.connect();
    try {
      const cancellationId = `pdc_missing_${randomUUID().replaceAll("-", "")}`;
      const occurredAt = new Date();
      await client.query("begin");
      await client.query(
        `insert into "runtime_publishing_delivery_events" (
           "workspace_id", "id", "delivery_id", "sequence", "type",
           "evidence", "occurred_at"
         ) values
           ($1, $2, $3, 3, 'delivery.cancellation_requested', $4::jsonb, $5),
           ($1, $6, $3, 4, 'delivery.cancelled', $7::jsonb, $5)`,
        [
          fixture.workspaceId,
          `pde_${randomUUID().replaceAll("-", "")}`,
          fixture.deliveryId,
          JSON.stringify({
            cancellationId,
            actorKind: "agent",
            effectDisposition: "not_created",
          }),
          occurredAt,
          `pde_${randomUUID().replaceAll("-", "")}`,
          JSON.stringify({
            cancellationId,
            effectKey: fixture.effectKey,
            effectDisposition: "not_created",
          }),
        ],
      );
      await expect(client.query(
        `update "runtime_publishing_deliveries" set
           "desired_state" = 'cancel', "state" = 'cancelled',
           "next_event_sequence" = 5, "completed_at" = $1,
           "updated_at" = $1
         where "workspace_id" = $2 and "id" = $3`,
        [occurredAt, fixture.workspaceId, fixture.deliveryId],
      )).resolves.toMatchObject({ rowCount: 1 });
      await expect(client.query(
        `set constraints
           "runtime_publishing_delivery_cancellation_state_complete" immediate`,
      )).rejects.toThrow(
        "Publishing Delivery cancellation ledger is missing or inconsistent",
      );
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
    const retained = await databasePool.query<{
      desired_state: string;
      state: string;
    }>(
      `select "desired_state", "state"
       from "runtime_publishing_deliveries"
       where "workspace_id" = $1 and "id" = $2`,
      [fixture.workspaceId, fixture.deliveryId],
    );
    expect(retained.rows[0]).toEqual({
      desired_state: "publish",
      state: "scheduled",
    });
  });

  it("serializes contact before cancellation and commits only unknown truth", async () => {
    const fixture = await seedRepositoryDelivery(databasePool);
    const now = new Date();
    const acquired = await fixture.repository.acquireLease({
      workspaceId: fixture.delivery.workspaceId,
      deliveryId: fixture.delivery.id,
      workerId: "worker_cancel_pg_race",
      now,
      expiresAt: new Date(now.getTime() + 30_000),
    });
    expect(acquired.kind).toBe("acquired");
    if (acquired.kind !== "acquired") return;

    const cancellationLock = await databasePool.connect();
    try {
      const advisoryKey =
        `publishing-delivery-cancel:${fixture.delivery.workspaceId}:${fixture.delivery.id}`;
      await cancellationLock.query("begin");
      await cancellationLock.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [advisoryKey],
      );
      const cancellation = fixture.repository.cancel({
        workspaceId: fixture.delivery.workspaceId,
        deliveryId: fixture.delivery.id,
        cancellationId: fixture.cancellationId,
        actor: fixture.authorizationSession.actor,
        authorizationSession: fixture.authorizationSession,
        requestedAt: now,
      });
      await waitForCancellationAdvisoryLock(databasePool);
      const readinessBase = {
        workspaceId: fixture.delivery.workspaceId,
        deliveryId: fixture.delivery.id,
        effectKey: fixture.delivery.effectKey,
        effectGeneration: fixture.delivery.effectGeneration,
        intentDigest: fixture.delivery.intentDigest!,
        providerAdapterContractDigest: fixture.delivery.providerAdapterContractDigest!,
        mode: "launch" as const,
        authorizationEvidenceDigest: digest("1"),
        approvalEvidenceDigest: digest("2"),
        channelEvidenceDigest: digest("3"),
        credentialEvidenceDigest: digest("4"),
        validationEvidenceDigest: digest("5"),
        evaluatedAt: now,
        expiresAt: new Date(now.getTime() + 10_000),
      };
      const readinessEvidenceDigest = canonicalDigest({
        schema: "publishing-delivery-execution-readiness-evidence/v1",
        ...readinessBase,
        evaluatedAt: readinessBase.evaluatedAt.toISOString(),
        expiresAt: readinessBase.expiresAt.toISOString(),
      });
      const readinessSession: PublishingDeliveryExecutionReadinessSession = {
        schema: "publishing-delivery-execution-readiness/v1",
        id: `pdrdy_${readinessEvidenceDigest.slice("sha256:".length)}`,
        ...readinessBase,
        evidenceDigest: readinessEvidenceDigest,
      };
      const contact = await fixture.repository.beginEffectContact({
        workspaceId: fixture.delivery.workspaceId,
        deliveryId: fixture.delivery.id,
        workerId: acquired.lease.workerId,
        leaseToken: acquired.lease.leaseToken,
        fence: acquired.lease.fence,
        effectKey: fixture.delivery.effectKey,
        intentDigest: fixture.delivery.intentDigest!,
        providerAdapterContractDigest: fixture.delivery.providerAdapterContractDigest!,
        readinessSession,
        startedAt: now,
      });
      expect(contact).toMatchObject({
        kind: "started",
        delivery: { state: "dispatching" },
        event: { type: "effect.contact_started", sequence: 4 },
      });
      await cancellationLock.query("commit");
      const cancelled = await cancellation;
      expect(cancelled).toMatchObject({
        kind: "created",
        cancellation: {
          outcome: "unknown",
          stateAtRequest: "dispatching",
          externallyCompletedAtRequest: null,
        },
        delivery: {
          desiredState: "cancel",
          state: "dispatching",
          effectContactStartedAt: expect.any(Date),
        },
        events: [{
          type: "delivery.cancellation_requested",
          sequence: 5,
          evidence: { effectDisposition: "contact_started" },
        }],
      });
      const replay = await fixture.repository.cancel({
        workspaceId: fixture.delivery.workspaceId,
        deliveryId: fixture.delivery.id,
        cancellationId: fixture.cancellationId,
        actor: fixture.authorizationSession.actor,
        authorizationSession: fixture.authorizationSession,
        requestedAt: new Date(now.getTime() + 1_000),
      });
      expect(replay).toMatchObject({
        kind: "replayed",
        cancellation: { id: fixture.cancellationId, outcome: "unknown" },
        events: [],
      });
      const events = await databasePool.query<{ type: string }>(
        `select "type" from "runtime_publishing_delivery_events"
         where "workspace_id" = $1 and "delivery_id" = $2 and "sequence" >= $3
         order by "sequence"`,
        [fixture.delivery.workspaceId, fixture.delivery.id, 4],
      );
      expect(events.rows.map(({ type }) => type)).toEqual([
        "effect.contact_started",
        "delivery.cancellation_requested",
      ]);
    } catch (error) {
      await cancellationLock.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      cancellationLock.release();
    }
  }, 30_000);
});
