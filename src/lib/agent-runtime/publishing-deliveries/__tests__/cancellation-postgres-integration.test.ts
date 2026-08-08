import { randomUUID } from "node:crypto";
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
         "approval_decision_id", "target_ordinal", "target_id",
         "channel_id", "artifact_ids", "target_snapshot",
         "target_snapshot_digest", "publish_at", "desired_state", "state",
         "effect_key", "intent_digest", "provider_operation_ref",
         "latest_effect_evidence_digest", "failure_code",
         "next_event_sequence", "next_outbox_generation", "accepted_at",
         "scheduled_at", "dispatch_started_at", "effect_contact_started_at",
         "completed_at", "updated_at"
       ) values (
         $1, $2, $3, $4, $5, 1, $6, $7, $8, $9, 0, $10, $11,
         $12::jsonb, $13::jsonb, $14, $15, 'publish', $16, $17, $18,
         null, null, null, $19, 2, $15, $15, $20, null, null, $15
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
        nextEventSequence,
        state === "dispatching" ? acceptedAt : null,
      ],
    );
    const events = [
      { sequence: 1, type: "delivery.accepted", evidence: {} },
      { sequence: 2, type: "delivery.scheduled", evidence: {} },
      ...(state === "dispatching"
        ? [{
            sequence: 3,
            type: "effect.prepared",
            evidence: { effectKey, intentDigest },
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
  const dispatchStartedAt = new Date();
  const delivery: PublishingDeliveryRecord = {
    ...structuredClone(original),
    publishAt: new Date(dispatchStartedAt.getTime() - 1_000),
    state: "dispatching",
    intentDigest,
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
         "approval_decision_id", "target_ordinal", "target_id", "channel_id",
         "artifact_ids", "target_snapshot", "target_snapshot_digest",
         "publish_at", "desired_state", "state", "effect_key", "intent_digest",
         "provider_operation_ref", "latest_effect_evidence_digest", "failure_code",
         "next_event_sequence", "next_outbox_generation", "accepted_at",
         "scheduled_at", "dispatch_started_at", "effect_contact_started_at",
         "completed_at", "updated_at"
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, $12,
         $13::jsonb, $14::jsonb, $15, $16, 'publish', 'dispatching', $17,
         $18, null, null, null, 4, 2, $19, $20, $21, null, null, $21
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
        delivery.acceptedAt,
        delivery.scheduledAt,
        dispatchStartedAt,
      ],
    );
    for (const event of [
      { sequence: 1, type: "delivery.accepted", evidence: {} },
      { sequence: 2, type: "delivery.scheduled", evidence: {} },
      {
        sequence: 3,
        type: "effect.prepared",
        evidence: { effectKey: delivery.effectKey, intentDigest },
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
      const contact = await fixture.repository.beginEffectContact({
        workspaceId: fixture.delivery.workspaceId,
        deliveryId: fixture.delivery.id,
        workerId: acquired.lease.workerId,
        leaseToken: acquired.lease.leaseToken,
        fence: acquired.lease.fence,
        effectKey: fixture.delivery.effectKey,
        intentDigest: fixture.delivery.intentDigest!,
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
