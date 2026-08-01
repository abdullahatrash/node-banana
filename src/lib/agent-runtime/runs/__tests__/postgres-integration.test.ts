import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { getDb } from "@/lib/db";
import {
  agentAuthorizationDecisions,
  agentKeys,
  agentPrincipals,
  contentWorkflowRevisions,
  contentWorkflows,
  user,
  workflowRunEvents,
  workflowRunExecutionLeases,
  workflowRunMutationReceipts,
  workflowRunOutboxIntents,
  workflowRuns,
  workflowStepAttempts,
  workspaces,
} from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  WorkflowRunRepository,
  WorkflowRunStartSnapshot,
} from "../types";
import { DrizzleWorkflowRunRepository } from "../postgres-repository";
import { DrizzleArtifactRepository } from
  "../../artifacts/postgres-repository";
import {
  InMemoryArtifactContentStore,
  InMemoryArtifactMediaInspector,
} from "../../artifacts/memory";
import { AesGcmArtifactCursorCodec } from "../../artifacts/cursor";
import {
  ArtifactService,
  type CommitGeneratedArtifactInput,
} from "../../artifacts/service";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describePostgres = databaseUrl ? describe : describe.skip;
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const bytesDigest = (value: string) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

function startInput(
  fixture: {
    workspaceId: string;
    workflowId: string;
    revisionId: string;
    principalId: string;
    keyId: string;
    evidenceRef: string;
    acceptedAt: Date;
  },
  runId: string,
  suffix: string,
): Parameters<WorkflowRunRepository["start"]>[0] {
  const snapshot: WorkflowRunStartSnapshot = {
    schema: "workflow-run-start-snapshot/v1",
    workflowId: fixture.workflowId,
    workflowRevisionId: fixture.revisionId,
    workflowRevision: 1,
    definitionDigest: "",
    operationRegistryDigest: digest("c"),
    definition: {
      schema: "content-workflow-revision-definition/v1",
      workflowId: fixture.workflowId,
      name: "Postgres fixture",
      inputs: { text: { kind: "text", required: true } },
      credentialSlots: {},
      steps: [{
        id: "digest",
        operation: {
          identity: "runtime.digest_text@1",
          contractDigest: digest("d"),
        },
        inputs: {
          text: { from: "workflow_input", input: "text" },
        },
        credentials: {},
        config: {},
        retry: {
          maxAttempts: 1,
          backoff: { initialMs: 0, maxMs: 0, multiplier: 1 },
        },
      }],
      outputs: {
        textDigest: {
          kind: "text",
          binding: {
            from: "step_output",
            step: "digest",
            output: "textDigest",
          },
        },
      },
    },
    inputs: [{ name: "text", kind: "text", value: "hello" }],
    operationContracts: [{
      stepId: "digest",
      identity: "runtime.digest_text@1",
      contractDigest: digest("d"),
    }],
    artifactReferences: [],
    credentialReferences: [],
    authorization: {
      principalId: fixture.principalId,
      keyId: fixture.keyId,
      evidenceRef: fixture.evidenceRef,
    },
  };
  snapshot.definitionDigest = canonicalDigest(snapshot.definition);
  return {
    run: {
      id: runId,
      workspaceId: fixture.workspaceId,
      workflowId: fixture.workflowId,
      workflowRevisionId: fixture.revisionId,
      state: "accepted",
      startSnapshotDigest: canonicalDigest(snapshot),
      startSnapshot: snapshot,
      nextEventSequence: 2,
      output: null,
      finalSnapshot: null,
      finalSnapshotDigest: null,
      derivation: null,
      resumeAt: null,
      failureCode: null,
      acceptedAt: fixture.acceptedAt,
      startedAt: null,
      completedAt: null,
      updatedAt: fixture.acceptedAt,
    },
    firstEvent: {
      id: `event_${suffix}`,
      workspaceId: fixture.workspaceId,
      runId,
      sequence: 1,
      type: "run.accepted",
      data: { startSnapshotDigest: canonicalDigest(snapshot) },
      occurredAt: fixture.acceptedAt,
    },
    receipt: {
      workspaceId: fixture.workspaceId,
      principalId: fixture.principalId,
      keyId: fixture.keyId,
      authorizationEvidenceRef: fixture.evidenceRef,
      capability: "workflow_runs.start@1",
      idempotencyKey: `start-${suffix}`,
      requestFingerprint: digest("e"),
      runId,
      initialEventCursor: `cursor-${suffix}`,
      result: null,
      createdAt: fixture.acceptedAt,
    },
    outboxIntent: {
      id: `outbox_${suffix}`,
      workspaceId: fixture.workspaceId,
      runId,
      generation: 1,
      dedupeKey: `workflow-run:${fixture.workspaceId}:${runId}:v1`,
      state: "pending",
      deliveryToken: null,
      deliveryAttempts: 0,
      availableAt: fixture.acceptedAt,
      claimedAt: null,
      deliveredAt: null,
      createdAt: fixture.acceptedAt,
    },
  };
}

async function seed(tx: Tx) {
  const suffix = randomUUID().replaceAll("-", "");
  const nowRows = await tx.execute<{ database_now: Date }>(
    "select clock_timestamp() as database_now",
  );
  const databaseNow = new Date(String(nowRows.rows[0]!.database_now));
  const fixture = {
    userId: `user_${suffix}`,
    workspaceId: `workspace_${suffix}`,
    workflowId: `workflow_${suffix}`,
    revisionId: `revision_${suffix}`,
    principalId: `principal_${suffix}`,
    keyId: `key_${suffix}`,
    evidenceRef: `trace_${suffix}`,
    acceptedAt: new Date(databaseNow.getTime() - 120_000),
  };
  await tx.insert(user).values({
    id: fixture.userId,
    email: `${suffix}@example.test`,
  });
  await tx.insert(workspaces).values({
    id: fixture.workspaceId,
    name: "Workflow Run integration",
    slug: `workflow-run-${suffix}`,
    ownerUserId: fixture.userId,
  });
  await tx.insert(agentPrincipals).values({
    id: fixture.principalId,
    workspaceId: fixture.workspaceId,
    name: "Workflow Run test principal",
    requestedAccess: [],
  });
  await tx.insert(agentKeys).values({
    id: fixture.keyId,
    principalId: fixture.principalId,
    name: "Workflow Run test key",
    lookupPrefix: `test_${suffix}`,
    secretHash: digest("f"),
  });
  await tx.insert(contentWorkflows).values({
    workspaceId: fixture.workspaceId,
    id: fixture.workflowId,
    currentRevision: 1,
    createdByPrincipalId: fixture.principalId,
    createdByKeyId: fixture.keyId,
    authorizationEvidenceRef: "workflow-fixture",
  });
  const definition = startInput(
    fixture,
    `seed_${suffix}`,
    `seed_${suffix}`,
  ).run.startSnapshot.definition;
  await tx.insert(contentWorkflowRevisions).values({
    workspaceId: fixture.workspaceId,
    id: fixture.revisionId,
    workflowId: fixture.workflowId,
    revision: 1,
    definitionDigest: canonicalDigest(definition),
    definition,
    operationRegistryDigest: digest("c"),
    authorPrincipalId: fixture.principalId,
    authorKeyId: fixture.keyId,
    authorizationEvidenceRef: "revision-fixture",
  });
  await tx.insert(agentAuthorizationDecisions).values({
    id: `decision_${suffix}`,
    workspaceId: fixture.workspaceId,
    principalId: fixture.principalId,
    keyId: fixture.keyId,
    capabilityName: "workflow_runs.start",
    capabilityVersion: 1,
    authorizationContractDigest: digest("9"),
    outcome: "allowed",
    reason: "integration fixture",
    operatorTraceRef: fixture.evidenceRef,
    resources: [{ kind: "workflow", id: fixture.workflowId }],
  });
  return { ...fixture, databaseNow, suffix };
}

describePostgres("DrizzleWorkflowRunRepository with PostgreSQL", () => {
  it("proves rollback, replay, outbox reclaim, fencing, and completion", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const database = drizzle(pool, { schema });
    const rollback = new Error("ROLLBACK_WORKFLOW_RUN_TEST");
    try {
      await database.transaction(async (tx) => {
        const fixture = await seed(tx);
        const repository = new DrizzleWorkflowRunRepository(
          () => tx as unknown as Db,
        );
        const runId = `run_${fixture.suffix}`;
        const accepted = startInput(
          fixture,
          runId,
          `accepted_${fixture.suffix}`,
        );

        await expect(repository.start(accepted)).resolves.toMatchObject({
          kind: "created",
          run: { id: runId, state: "accepted" },
          receipt: { initialEventCursor: accepted.receipt.initialEventCursor },
        });
        await tx.execute(
          'set constraints "workflow_run_acceptance_complete" immediate',
        );
        await tx.execute(
          'set constraints "workflow_run_acceptance_complete" deferred',
        );
        await expect(repository.start(accepted)).resolves.toMatchObject({
          kind: "replayed",
          run: { id: runId },
          receipt: { initialEventCursor: accepted.receipt.initialEventCursor },
        });
        await expect(
          repository.start({
            ...accepted,
            receipt: {
              ...accepted.receipt,
              requestFingerprint: digest("8"),
            },
          }),
        ).resolves.toEqual({ kind: "conflict" });

        const firstClaim = await repository.claimOutbox({
          now: fixture.databaseNow,
          claimExpiresBefore: new Date(
            fixture.databaseNow.getTime() - 30_000,
          ),
          deliveryToken: "delivery-token-1",
        });
        expect(firstClaim).toMatchObject({
          kind: "claimed",
          intent: { deliveryAttempts: 1 },
        });
        const reclaimed = await repository.claimOutbox({
          now: new Date(fixture.databaseNow.getTime() + 61_000),
          claimExpiresBefore: new Date(
            fixture.databaseNow.getTime() + 31_000,
          ),
          deliveryToken: "delivery-token-2",
        });
        expect(reclaimed).toMatchObject({
          kind: "claimed",
          intent: { deliveryAttempts: 2 },
        });
        if (reclaimed.kind !== "claimed") throw new Error("claim expected");
        await expect(
          repository.markOutboxDelivered({
            intentId: reclaimed.intent.id,
            deliveryToken: "delivery-token-1",
            deliveredAt: fixture.databaseNow,
          }),
        ).resolves.toBe(false);
        await expect(
          repository.markOutboxDelivered({
            intentId: reclaimed.intent.id,
            deliveryToken: "delivery-token-2",
            deliveredAt: fixture.databaseNow,
          }),
        ).resolves.toBe(true);

        const staleLease = await repository.acquireLease({
          workspaceId: fixture.workspaceId,
          runId,
          workerId: "worker_1",
          now: new Date("2040-01-01T00:00:00.000Z"),
          expiresAt: new Date("2040-01-01T00:00:00.100Z"),
        });
        const skewedTakeover = await repository.acquireLease({
          workspaceId: fixture.workspaceId,
          runId,
          workerId: "worker_skewed",
          now: new Date("2099-01-01T00:00:00.000Z"),
          expiresAt: new Date("2099-01-01T00:01:00.000Z"),
        });
        expect(skewedTakeover).toEqual({ kind: "busy" });
        await tx.execute("select pg_sleep(0.15)");
        const currentLease = await repository.acquireLease({
          workspaceId: fixture.workspaceId,
          runId,
          workerId: "worker_2",
          now: fixture.databaseNow,
          expiresAt: new Date(fixture.databaseNow.getTime() + 60_000),
        });
        expect(staleLease).toMatchObject({
          kind: "acquired",
          lease: { fence: BigInt(1) },
        });
        expect(currentLease).toMatchObject({
          kind: "acquired",
          lease: { fence: BigInt(2) },
        });
        if (
          staleLease.kind !== "acquired" ||
          currentLease.kind !== "acquired"
        ) {
          throw new Error("leases expected");
        }
        const reentrant = await repository.acquireLease({
          workspaceId: fixture.workspaceId,
          runId,
          workerId: "worker_2",
          now: fixture.databaseNow,
          expiresAt: new Date(fixture.databaseNow.getTime() + 60_000),
        });
        expect(reentrant).toMatchObject({
          kind: "acquired",
          lease: {
            fence: currentLease.lease.fence,
            token: currentLease.lease.token,
          },
        });
        await expect(
          repository.renewLease({
            workspaceId: fixture.workspaceId,
            runId,
            workerId: currentLease.lease.workerId,
            token: currentLease.lease.token,
            fence: currentLease.lease.fence,
            now: fixture.databaseNow,
            expiresAt: new Date(fixture.databaseNow.getTime() + 60_000),
          }),
        ).resolves.toMatchObject({
          kind: "renewed",
          lease: {
            fence: currentLease.lease.fence,
            token: currentLease.lease.token,
          },
        });
        await expect(
          repository.completeStep({
            workspaceId: fixture.workspaceId,
            runId,
            workerId: staleLease.lease.workerId,
            token: staleLease.lease.token,
            fence: staleLease.lease.fence,
            output: { textDigest: digest("7") },
            completedAt: fixture.databaseNow,
            stepEventId: `step_stale_${fixture.suffix}`,
            runEventId: `run_stale_${fixture.suffix}`,
          }),
        ).resolves.toEqual({ kind: "stale_fence" });
        await expect(
          repository.completeStep({
            workspaceId: fixture.workspaceId,
            runId,
            workerId: currentLease.lease.workerId,
            token: currentLease.lease.token,
            fence: currentLease.lease.fence,
            output: { textDigest: digest("7") },
            completedAt: new Date(0),
            stepEventId: `step_done_${fixture.suffix}`,
            runEventId: `run_done_${fixture.suffix}`,
          }),
        ).resolves.toMatchObject({
          kind: "completed",
          run: { state: "completed", nextEventSequence: 4 },
        });
        const events = await repository.listEvents({
          workspaceId: fixture.workspaceId,
          workflowId: fixture.workflowId,
          runId,
          afterSequence: 0,
          limit: 100,
        });
        expect(events?.map(({ sequence, type }) => ({ sequence, type })))
          .toEqual([
            { sequence: 1, type: "run.accepted" },
            { sequence: 2, type: "step.completed" },
            { sequence: 3, type: "run.completed" },
          ]);
        expect(events?.[1]?.occurredAt.getTime()).toBeGreaterThan(
          new Date(0).getTime(),
        );
        await expect(
          tx.transaction((gapTx) =>
            gapTx.insert(workflowRunEvents).values({
              id: `event_gap_${fixture.suffix}`,
              workspaceId: fixture.workspaceId,
              runId,
              sequence: 99,
              type: "run.completed",
              data: {},
              occurredAt: fixture.databaseNow,
            }),
          ),
        ).rejects.toThrow();
        await expect(
          repository.completeStep({
            workspaceId: fixture.workspaceId,
            runId,
            workerId: staleLease.lease.workerId,
            token: staleLease.lease.token,
            fence: staleLease.lease.fence,
            output: { ignored: true },
            completedAt: new Date(0),
            stepEventId: `step_reentry_${fixture.suffix}`,
            runEventId: `run_reentry_${fixture.suffix}`,
          }),
        ).resolves.toMatchObject({
          kind: "completed",
          run: { state: "completed", nextEventSequence: 4 },
        });

        const failedRunId = `run_failed_${fixture.suffix}`;
        const failedStart = startInput(
          fixture,
          failedRunId,
          `failed_${fixture.suffix}`,
        );
        await expect(repository.start(failedStart)).resolves.toMatchObject({
          kind: "created",
        });
        const failureLease = await repository.acquireLease({
          workspaceId: fixture.workspaceId,
          runId: failedRunId,
          workerId: "worker_failure",
          now: fixture.databaseNow,
          expiresAt: new Date(fixture.databaseNow.getTime() + 60_000),
        });
        if (failureLease.kind !== "acquired") {
          throw new Error("failure lease expected");
        }
        await expect(
          repository.failStep({
            workspaceId: fixture.workspaceId,
            runId: failedRunId,
            workerId: failureLease.lease.workerId,
            token: failureLease.lease.token,
            fence: failureLease.lease.fence,
            failureCode: "unsafe reason with secrets",
            failedAt: fixture.databaseNow,
            runEventId: `run_invalid_failure_${fixture.suffix}`,
          }),
        ).resolves.toEqual({ kind: "unavailable" });
        await expect(
          repository.failStep({
            workspaceId: fixture.workspaceId,
            runId: failedRunId,
            workerId: failureLease.lease.workerId,
            token: failureLease.lease.token,
            fence: failureLease.lease.fence,
            failureCode: "STEP_EXECUTION_FAILED",
            failedAt: new Date(0),
            runEventId: `run_failure_${fixture.suffix}`,
          }),
        ).resolves.toMatchObject({
          kind: "completed",
          run: {
            state: "failed",
            failureCode: "STEP_EXECUTION_FAILED",
            nextEventSequence: 3,
          },
        });
        await expect(
          repository.failStep({
            workspaceId: fixture.workspaceId,
            runId: failedRunId,
            workerId: "other_worker",
            token: "other_token",
            fence: BigInt(999),
            failureCode: "IGNORED_REENTRY",
            failedAt: new Date(0),
            runEventId: `run_failure_reentry_${fixture.suffix}`,
          }),
        ).resolves.toMatchObject({
          kind: "completed",
          run: { state: "failed", nextEventSequence: 3 },
        });
        const failedEvents = await repository.listEvents({
          workspaceId: fixture.workspaceId,
          workflowId: fixture.workflowId,
          runId: failedRunId,
          afterSequence: 0,
          limit: 100,
        });
        expect(failedEvents?.map(({ sequence, type, data }) => ({
          sequence,
          type,
          data,
        }))).toEqual([
          {
            sequence: 1,
            type: "run.accepted",
            data: {
              startSnapshotDigest: failedStart.run.startSnapshotDigest,
            },
          },
          {
            sequence: 2,
            type: "run.failed",
            data: { reasonCode: "STEP_EXECUTION_FAILED" },
          },
        ]);

        const rolledBack = startInput(
          fixture,
          `run_rollback_${fixture.suffix}`,
          `rollback_${fixture.suffix}`,
        );
        rolledBack.firstEvent.id = accepted.firstEvent.id;
        await expect(repository.start(rolledBack)).resolves.toEqual({
          kind: "unavailable",
        });
        await expect(
          repository.get({
            workspaceId: fixture.workspaceId,
            workflowId: fixture.workflowId,
            runId: rolledBack.run.id,
          }),
        ).resolves.toBeNull();
        const rolledBackReceipts = await tx
          .select()
          .from(workflowRunMutationReceipts)
          .where(
            and(
              eq(
                workflowRunMutationReceipts.workspaceId,
                fixture.workspaceId,
              ),
              eq(
                workflowRunMutationReceipts.runId,
                rolledBack.run.id,
              ),
            ),
          );
        const rolledBackOutbox = await tx
          .select()
          .from(workflowRunOutboxIntents)
          .where(
            and(
              eq(
                workflowRunOutboxIntents.workspaceId,
                fixture.workspaceId,
              ),
              eq(workflowRunOutboxIntents.runId, rolledBack.run.id),
            ),
          );
        const rolledBackEvents = await tx
          .select()
          .from(workflowRunEvents)
          .where(
            and(
              eq(workflowRunEvents.workspaceId, fixture.workspaceId),
              eq(workflowRunEvents.runId, rolledBack.run.id),
            ),
          );
        expect({
          receipts: rolledBackReceipts.length,
          outbox: rolledBackOutbox.length,
          events: rolledBackEvents.length,
        }).toEqual({ receipts: 0, outbox: 0, events: 0 });
        await tx.execute(
          'set constraints "workflow_run_acceptance_complete", "workflow_run_events_canonical" immediate',
        );

        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await pool.end();
    }
  }, 30_000);

  it("serializes concurrent idempotent acceptance across connections", async () => {
    // Durable Run records are append-only, so this race intentionally targets
    // only a disposable database explicitly supplied as TEST_DATABASE_URL.
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const database = drizzle(pool, { schema });
    try {
      const fixture = await database.transaction((tx) => seed(tx));
      const repository = new DrizzleWorkflowRunRepository(
        () => database as Db,
      );
      const runId = `run_concurrent_${fixture.suffix}`;
      const accepted = startInput(
        fixture,
        runId,
        `concurrent_${fixture.suffix}`,
      );
      const results = await Promise.all(
        Array.from({ length: 4 }, () => repository.start(accepted)),
      );

      expect(results.filter(({ kind }) => kind === "created")).toHaveLength(1);
      expect(results.filter(({ kind }) => kind === "replayed")).toHaveLength(3);
      for (const result of results) {
        expect(result).toMatchObject({
          run: { id: runId },
          receipt: {
            initialEventCursor: accepted.receipt.initialEventCursor,
          },
        });
      }
      await expect(
        repository.start({
          ...accepted,
          receipt: {
            ...accepted.receipt,
            requestFingerprint: digest("8"),
          },
        }),
      ).resolves.toEqual({ kind: "conflict" });

      const rotatedKeyId = `key_rotated_${fixture.suffix}`;
      const rotatedEvidenceRef = `trace_rotated_${fixture.suffix}`;
      await database.insert(agentKeys).values({
        id: rotatedKeyId,
        principalId: fixture.principalId,
        name: "Rotated Workflow Run test key",
        lookupPrefix: `rotated_${fixture.suffix}`,
        secretHash: digest("6"),
      });
      await database.insert(agentAuthorizationDecisions).values({
        id: `decision_rotated_${fixture.suffix}`,
        workspaceId: fixture.workspaceId,
        principalId: fixture.principalId,
        keyId: rotatedKeyId,
        capabilityName: "workflow_runs.start",
        capabilityVersion: 1,
        authorizationContractDigest: digest("9"),
        outcome: "allowed",
        reason: "rotated key integration fixture",
        operatorTraceRef: rotatedEvidenceRef,
        resources: [{ kind: "workflow", id: fixture.workflowId }],
      });
      const rotated = startInput(
        {
          ...fixture,
          keyId: rotatedKeyId,
          evidenceRef: rotatedEvidenceRef,
        },
        `run_rotated_${fixture.suffix}`,
        `rotated_${fixture.suffix}`,
      );
      rotated.receipt.idempotencyKey = accepted.receipt.idempotencyKey;
      rotated.receipt.requestFingerprint =
        accepted.receipt.requestFingerprint;
      await expect(repository.start(rotated)).resolves.toMatchObject({
        kind: "replayed",
        run: { id: runId },
        receipt: {
          initialEventCursor: accepted.receipt.initialEventCursor,
        },
      });

      const [storedRuns, storedEvents, storedReceipts, storedOutbox] =
        await Promise.all([
          database
            .select()
            .from(workflowRuns)
            .where(
              and(
                eq(workflowRuns.workspaceId, fixture.workspaceId),
                eq(workflowRuns.id, runId),
              ),
            ),
          database
            .select()
            .from(workflowRunEvents)
            .where(
              and(
                eq(workflowRunEvents.workspaceId, fixture.workspaceId),
                eq(workflowRunEvents.runId, runId),
              ),
            ),
          database
            .select()
            .from(workflowRunMutationReceipts)
            .where(
              and(
                eq(
                  workflowRunMutationReceipts.workspaceId,
                  fixture.workspaceId,
                ),
                eq(workflowRunMutationReceipts.runId, runId),
              ),
            ),
          database
            .select()
            .from(workflowRunOutboxIntents)
            .where(
              and(
                eq(
                  workflowRunOutboxIntents.workspaceId,
                  fixture.workspaceId,
                ),
                eq(workflowRunOutboxIntents.runId, runId),
              ),
            ),
        ]);
      expect({
        runs: storedRuns.length,
        events: storedEvents.length,
        receipts: storedReceipts.length,
        outbox: storedOutbox.length,
      }).toEqual({ runs: 1, events: 1, receipts: 1, outbox: 1 });
    } finally {
      await pool.end();
    }
  }, 30_000);

  it("durably settles a generated Artifact, Step Attempt, final snapshot, and ordered events", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const database = drizzle(pool, { schema });
    try {
      const fixture = await database.transaction((tx) => seed(tx));
      const repository = new DrizzleWorkflowRunRepository(
        () => database as Db,
      );
      const acceptedInput = startInput(
        fixture,
        `run_attempt_${fixture.suffix}`,
        `attempt_${fixture.suffix}`,
      );
      const accepted = await repository.start(acceptedInput);
      expect(accepted.kind).toBe("created");
      if (accepted.kind !== "created") return;

      const leaseNow = new Date();
      const acquired = await repository.acquireLease({
        workspaceId: fixture.workspaceId,
        runId: accepted.run.id,
        workerId: `worker_${fixture.suffix}`,
        now: leaseNow,
        expiresAt: new Date(leaseNow.getTime() + 30_000),
      });
      expect(acquired.kind).toBe("acquired");
      if (acquired.kind !== "acquired") return;

      const step = accepted.run.startSnapshot.definition.steps[0]!;
      const effectKey =
        `workflow-effect:v1:${fixture.workspaceId}:${accepted.run.id}:${step.id}:1`;
      const intentDigest = digest("7");
      const attemptId = `attempt_${fixture.suffix}`;
      const inputDigest = bytesDigest("hello");
      const prepared = await repository.prepareStepAttempt({
        attempt: {
          id: attemptId,
          workspaceId: fixture.workspaceId,
          runId: accepted.run.id,
          stepId: step.id,
          attempt: 1,
          state: "running",
          operationIdentity: step.operation.identity,
          operationContractDigest: step.operation.contractDigest,
          provider: "runtime",
          providerOperation: "digest_text",
          model: "sha256",
          intentDigest,
          effectKey,
          providerOperationRef: null,
          outcome: null,
          reconciliation: null,
          inputs: [{
            port: "text",
            kind: "text",
            source: { kind: "workflow_input", inputName: "text" },
            contentDigest: inputDigest,
            artifactId: null,
          }],
          outputs: null,
          failureCode: null,
          startedAt: leaseNow,
          completedAt: null,
        },
        workerId: acquired.lease.workerId,
        token: acquired.lease.token,
        fence: acquired.lease.fence,
        eventId: randomUUID(),
      });
      expect(prepared.kind).toBe("created");
      if (prepared.kind !== "created") return;

      const artifactService = new ArtifactService(
        new DrizzleArtifactRepository(() => database as Db),
        new InMemoryArtifactContentStore(),
        new InMemoryArtifactMediaInspector(),
        new AesGcmArtifactCursorCodec(() => ({
          active: { id: "test", key: Buffer.alloc(32, 9) },
          all: [{ id: "test", key: Buffer.alloc(32, 9) }],
        })),
      );
      const generatedText = "durable generated output";
      const generatedInput: CommitGeneratedArtifactInput = {
        workspaceId: fixture.workspaceId,
        creatorPrincipalId: fixture.principalId,
        effectKey,
        outputName: "textDigest",
        content: {
          kind: "text",
          text: generatedText,
          mediaType: "text/plain; charset=utf-8",
          digest: bytesDigest(generatedText),
          sizeBytes: Buffer.byteLength(generatedText, "utf8"),
        },
        origin: {
          workflowId: fixture.workflowId,
          workflowRevisionId: fixture.revisionId,
          workflowRevision: 1,
          definitionDigest:
            accepted.run.startSnapshot.definitionDigest,
          runId: accepted.run.id,
          runStartSnapshotDigest: accepted.run.startSnapshotDigest,
          stepAttemptId: attemptId,
          stepId: step.id,
          attempt: 1,
          provider: "runtime",
          operationIdentity: step.operation.identity,
          providerOperation: "digest_text",
          providerOperationRef: `runtime:${effectKey}`,
          model: "sha256",
          intentDigest,
          providerMetadata: {
            evidence: {
              providerRequestId: `runtime:${effectKey}`,
              httpStatus: 200,
              providerCode: null,
              operatorTraceRef: null,
              effectDisposition: "accepted" as const,
            },
            usage: [],
            retryAfterMs: null,
            pollAfterMs: null,
          },
        },
        lineageInputs: [{
          port: "text",
          kind: "text",
          source: { kind: "workflow_input", inputName: "text" },
          contentDigest: inputDigest,
          sourceArtifactId: null,
        }],
      };
      const generated = await artifactService.commitGenerated(generatedInput);
      const providerMetadata = generatedInput.origin.providerMetadata!;
      await expect(
        artifactService.commitGenerated({
          ...generatedInput,
          origin: {
            ...generatedInput.origin,
            providerMetadata: {
              ...providerMetadata,
              evidence: {
                ...providerMetadata.evidence,
                providerRequestId: "runtime-conflicting-request",
              },
            },
          },
        }),
      ).rejects.toMatchObject({ code: "ARTIFACT_IDEMPOTENCY_CONFLICT" });
      const output = {
        artifactId: generated.id,
        digest: generated.digest,
        kind: generated.kind,
        mediaType: generated.mediaType,
        sizeBytes: generated.sizeBytes,
      };
      const finalSnapshot = {
        schema: "workflow-run-final-snapshot/v1" as const,
        runId: accepted.run.id,
        startSnapshotDigest: accepted.run.startSnapshotDigest,
        stepAttempts: [{
          stepAttemptId: attemptId,
          stepId: step.id,
          attempt: 1,
          state: "completed" as const,
          effectKey,
          outputs: { textDigest: output },
          providerOperationRef: `runtime:${effectKey}`,
        }],
        outputs: { textDigest: output },
      };
      const settled = await repository.settleStepAttempt({
        workspaceId: fixture.workspaceId,
        runId: accepted.run.id,
        stepAttemptId: attemptId,
        workerId: acquired.lease.workerId,
        token: acquired.lease.token,
        fence: acquired.lease.fence,
        outputs: { textDigest: output },
        providerOperationRef: `runtime:${effectKey}`,
        finalSnapshot,
        finalSnapshotDigest: canonicalDigest(finalSnapshot),
        completedAt: new Date(),
        eventIds: {
          generated: [randomUUID()],
          attemptCompleted: randomUUID(),
          runCompleted: randomUUID(),
        },
      });
      expect(settled).toMatchObject({
        kind: "settled",
        run: {
          state: "completed",
          finalSnapshotDigest: canonicalDigest(finalSnapshot),
        },
        attempt: { state: "completed", effectKey },
      });
      const events = await repository.listEvents({
        workspaceId: fixture.workspaceId,
        workflowId: fixture.workflowId,
        runId: accepted.run.id,
        afterSequence: 0,
        limit: 100,
      });
      expect(events?.map(({ sequence, type }) => ({ sequence, type }))).toEqual([
        { sequence: 1, type: "run.accepted" },
        { sequence: 2, type: "step.attempt.started" },
        { sequence: 3, type: "artifact.generated" },
        { sequence: 4, type: "step.attempt.completed" },
        { sequence: 5, type: "run.completed" },
      ]);
      await expect(
        artifactService.getArtifact({
          workspaceId: fixture.workspaceId,
          artifactId: generated.id,
        }),
      ).resolves.toMatchObject({
        artifact: {
          origin: {
            kind: "generated",
            outputName: "textDigest",
            effectKey,
            providerOperation: {
              ref: `runtime:${effectKey}`,
            },
          },
        },
        textContent: generatedText,
      });
    } finally {
      await pool.end();
    }
  }, 30_000);

  it("atomically fails the active Step Attempt and Run under the fenced lease", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const database = drizzle(pool, { schema });
    try {
      const fixture = await database.transaction((tx) => seed(tx));
      const repository = new DrizzleWorkflowRunRepository(
        () => database as Db,
      );
      const acceptedInput = startInput(
        fixture,
        `run_failure_${fixture.suffix}`,
        `failure_${fixture.suffix}`,
      );
      const accepted = await repository.start(acceptedInput);
      expect(accepted.kind).toBe("created");
      if (accepted.kind !== "created") return;

      const leaseNow = new Date();
      const acquired = await repository.acquireLease({
        workspaceId: fixture.workspaceId,
        runId: accepted.run.id,
        workerId: `worker_failure_${fixture.suffix}`,
        now: leaseNow,
        expiresAt: new Date(leaseNow.getTime() + 30_000),
      });
      expect(acquired.kind).toBe("acquired");
      if (acquired.kind !== "acquired") return;

      const step = accepted.run.startSnapshot.definition.steps[0]!;
      const effectKey =
        `workflow-effect:v1:${fixture.workspaceId}:${accepted.run.id}:${step.id}:1`;
      const attemptId = `attempt_failure_${fixture.suffix}`;
      const prepared = await repository.prepareStepAttempt({
        attempt: {
          id: attemptId,
          workspaceId: fixture.workspaceId,
          runId: accepted.run.id,
          stepId: step.id,
          attempt: 1,
          state: "running",
          operationIdentity: step.operation.identity,
          operationContractDigest: step.operation.contractDigest,
          provider: "runtime",
          providerOperation: "digest_text",
          model: "sha256",
          intentDigest: digest("7"),
          effectKey,
          providerOperationRef: null,
          outcome: null,
          reconciliation: null,
          inputs: [{
            port: "text",
            kind: "text",
            source: { kind: "workflow_input", inputName: "text" },
            contentDigest: bytesDigest("hello"),
            artifactId: null,
          }],
          outputs: null,
          failureCode: null,
          startedAt: leaseNow,
          completedAt: null,
        },
        workerId: acquired.lease.workerId,
        token: acquired.lease.token,
        fence: acquired.lease.fence,
        eventId: randomUUID(),
      });
      expect(prepared.kind).toBe("created");
      if (prepared.kind !== "created") return;

      const failureInput = {
        workspaceId: fixture.workspaceId,
        runId: accepted.run.id,
        stepAttemptId: attemptId,
        workerId: acquired.lease.workerId,
        token: acquired.lease.token,
        fence: acquired.lease.fence,
        failureCode: "STEP_EXECUTION_FAILED",
        providerOperationRef: null,
        retryable: false,
        retryAt: null,
        retryOutboxIntent: null,
        failedAt: new Date(),
        eventIds: {
          attemptFailed: randomUUID(),
          retryScheduled: null,
          runWaiting: null,
          runFailed: randomUUID(),
        },
      };
      const failed = await repository.failStepAttempt(failureInput);
      expect(failed).toMatchObject({
        kind: "settled",
        run: {
          state: "failed",
          failureCode: "STEP_EXECUTION_FAILED",
          output: null,
          finalSnapshot: null,
        },
        attempt: {
          id: attemptId,
          state: "failed",
          failureCode: "STEP_EXECUTION_FAILED",
          outputs: null,
        },
      });
      await expect(
        repository.failStepAttempt(failureInput),
      ).resolves.toMatchObject({
        kind: "settled",
        run: { state: "failed" },
        attempt: { state: "failed" },
      });

      const [events, storedAttempts, leases] = await Promise.all([
        repository.listEvents({
          workspaceId: fixture.workspaceId,
          workflowId: fixture.workflowId,
          runId: accepted.run.id,
          afterSequence: 0,
          limit: 100,
        }),
        database
          .select()
          .from(workflowStepAttempts)
          .where(
            and(
              eq(
                workflowStepAttempts.workspaceId,
                fixture.workspaceId,
              ),
              eq(workflowStepAttempts.runId, accepted.run.id),
            ),
          ),
        database
          .select()
          .from(workflowRunExecutionLeases)
          .where(
            and(
              eq(
                workflowRunExecutionLeases.workspaceId,
                fixture.workspaceId,
              ),
              eq(
                workflowRunExecutionLeases.runId,
                accepted.run.id,
              ),
            ),
          ),
      ]);
      expect(events?.map(({ sequence, type }) => ({
        sequence,
        type,
      }))).toEqual([
        { sequence: 1, type: "run.accepted" },
        { sequence: 2, type: "step.attempt.started" },
        { sequence: 3, type: "step.attempt.failed" },
        { sequence: 4, type: "run.failed" },
      ]);
      expect(storedAttempts).toHaveLength(1);
      expect(storedAttempts[0]).toMatchObject({
        state: "failed",
        failureCode: "STEP_EXECUTION_FAILED",
      });
      expect(leases).toHaveLength(1);
      expect(leases[0]!.releasedAt).not.toBeNull();
    } finally {
      await pool.end();
    }
  }, 30_000);
});
