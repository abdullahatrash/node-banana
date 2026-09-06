import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { describe, expect, it } from "vitest";
import { AesGcmWorkflowRunEventCursorCodec } from "../cursor";
import { createDeterministicWorkflowRunExecutorRegistry } from "../executors";
import {
  InMemoryWorkflowRunQueue,
  InMemoryWorkflowRunRepository,
  InMemoryWorkflowRunRevisionReader,
} from "../memory";
import { WorkflowRunService } from "../service";
import { BudgetService } from "../../budgets/service";
import { InMemoryBudgetRepository } from "../../budgets/memory";
import { workflowRunWorkerId } from "../worker-identity";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "../../workflows";
import type { ResolvedWorkflowDefinition } from "../../workflows/types";
import type { WorkflowRunBudgetPort, WorkflowRunStudioAssetPort } from "../types";
import { InMemoryQuotaRepository } from "../../quotas/memory";
import { QuotaService } from "../../quotas/service";
import { WorkflowRunSpendQuoteCodec, workflowRunQuoteCeilingDigest, workflowRunQuoteInputDigest, type WorkflowRunAcceptedSpendQuote } from "../spend-quote";

function definition(
  operation = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
    "runtime.digest_text@1",
  )!,
): ResolvedWorkflowDefinition {
  return {
    schema: "content-workflow-revision-definition/v1",
    workflowId: "workflow_1",
    name: "Deterministic digest",
    inputs: {
      text: { kind: "text", required: true },
    },
    credentialSlots: {},
    steps: [{
      id: "digest",
      operation: {
        identity: operation.identity,
        contractDigest: operation.contractDigest,
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
  };
}

function setup(studioAssets?: WorkflowRunStudioAssetPort) {
  const repository = new InMemoryWorkflowRunRepository();
  const revisions = new InMemoryWorkflowRunRevisionReader();
  const queue = new InMemoryWorkflowRunQueue();
  const cursor = new AesGcmWorkflowRunEventCursorCodec(() => ({
    active: { id: "test", key: Buffer.alloc(32, 7) },
    all: [{ id: "test", key: Buffer.alloc(32, 7) }],
  }));
  let now = new Date("2026-07-25T12:00:00.000Z");
  const resolved = definition();
  revisions.put("workspace_1", {
    id: "revision_1",
    workflowId: "workflow_1",
    revision: 1,
    definitionDigest: canonicalDigest(resolved),
    definition: resolved,
    operationRegistryDigest: GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest,
  });
  const service = new WorkflowRunService(
    repository,
    revisions,
    queue,
    createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    ),
    cursor,
    { now: () => new Date(now) },
    undefined,
    undefined,
    undefined,
    undefined,
    new WorkflowRunSpendQuoteCodec(null),
    studioAssets,
  );
  const start = (overrides: Partial<Parameters<typeof service.start>[0]> = {}) =>
    service.start({
      workspaceId: "workspace_1",
      workflowId: "workflow_1",
      revisionId: "revision_1",
      inputs: { text: "hello" },
      principalId: "principal_1",
      keyId: "key_1",
      authorizationEvidenceRef: "trace_original",
      idempotencyKey: "start-run-1",
      ...overrides,
    });
  return {
    repository,
    revisions,
    queue,
    cursor,
    service,
    start,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe("WorkflowRunService", () => {
  it("pins exact ordered Studio Asset evidence at start@3 and preserves historical @2 replay", async () => {
    const references = ["asset_z", "asset_a"].map((assetId) => ({ assetId, digest: `sha256:${(assetId === "asset_z" ? "a" : "b").repeat(64)}`, type: "image" as const, mediaType: "image/png", sizeBytes: 42, width: 1080, height: 1920, durationSeconds: null }));
    const value = setup({ resolveStudioAssets: async ({ workspaceId, assetIds }) => workspaceId === "workspace_1" ? assetIds.map((id) => references.find((reference) => reference.assetId === id)!).filter(Boolean) : [] });
    const accepted = await value.start({ capability: "workflow_runs.start@3", inputArtifactIds: [], inputStudioAssetIds: ["asset_z", "asset_a"] });
    const stored = await value.repository.getById({ workspaceId: "workspace_1", runId: accepted.run.id });
    expect(stored?.startSnapshot).toMatchObject({ schema: "workflow-run-start-snapshot/v3", studioAssetReferences: references });
    await expect(value.start({ capability: "workflow_runs.start@3", inputArtifactIds: [], inputStudioAssetIds: ["asset_a", "asset_z"] })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const missing = setup({ resolveStudioAssets: async () => references.slice(0, 1) });
    await expect(missing.start({ capability: "workflow_runs.start@3", inputArtifactIds: [], inputStudioAssetIds: ["asset_z", "asset_a"] })).rejects.toMatchObject({ code: "WORKFLOW_RUN_UNAVAILABLE" });

    const historical = setup();
    const first = await historical.start({ capability: "workflow_runs.start@2", inputArtifactIds: [] });
    await expect(historical.start({ capability: "workflow_runs.start@2", inputArtifactIds: [], authorizationEvidenceRef: "trace_replay" })).resolves.toEqual(first);
  });
  it("durably waits on concurrency, survives restart, and resumes the same Run", async () => {
    const at = new Date("2026-07-25T12:00:00.000Z");
    const quotaRepository = new InMemoryQuotaRepository(() => new Date(at));
    const quotas = new QuotaService(quotaRepository);
    await quotas.createPolicyRevision({
      workspaceId: "workspace_1",
      principalId: null,
      kind: "admission",
      boundary: "run_admission",
      dimension: "runtime.run_admissions@1",
      unit: "count",
      window: "calendar_day",
      timezone: "UTC",
      reservationRule: "consume",
      warningThreshold: "2",
      hardLimit: "2",
      exhaustionBehavior: "deny",
      actorUserId: "user_1",
      idempotencyKey: "admission_policy_1",
      recordedAt: at,
    });
    await quotas.createPolicyRevision({
      workspaceId: "workspace_1",
      principalId: null,
      kind: "concurrency",
      boundary: "run_concurrency",
      dimension: "runtime.concurrent_runs@1",
      unit: "count",
      window: "concurrent",
      timezone: "UTC",
      reservationRule: "release_on_terminal",
      warningThreshold: "1",
      hardLimit: "1",
      exhaustionBehavior: "wait",
      actorUserId: "user_1",
      idempotencyKey: "concurrency_policy_1",
      recordedAt: at,
    });
    const blocker = await quotas.planClaim({
      workspaceId: "workspace_1",
      principalId: "principal_blocker",
      runId: "run_blocker",
      transitionKey: "blocker_concurrency",
      boundary: "run_concurrency",
      subject: { kind: "run", id: "run_blocker" },
      claims: [{ dimension: "runtime.concurrent_runs@1", unit: "count", amount: "1" }],
      recordedAt: at,
    });
    await expect(quotas.commitClaim(blocker)).resolves.toMatchObject({ kind: "created" });

    const base = setup();
    const repository = new InMemoryWorkflowRunRepository(undefined, undefined, quotaRepository);
    const service = new WorkflowRunService(
      repository,
      base.revisions,
      base.queue,
      createDeterministicWorkflowRunExecutorRegistry(GOLDEN_WORKFLOW_OPERATION_REGISTRY),
      base.cursor,
      { now: () => new Date(at) },
      undefined,
      undefined,
      undefined,
      quotas,
    );
    const accepted = await service.start({
      workspaceId: "workspace_1",
      workflowId: "workflow_1",
      revisionId: "revision_1",
      inputs: { text: "hello" },
      principalId: "principal_1",
      keyId: "key_1",
      authorizationEvidenceRef: "trace_1",
      idempotencyKey: "quota_start_1",
    });
    const waiting = await service.executeOne({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_1",
    });
    expect(waiting).toMatchObject({ id: accepted.run.id, state: "waiting", failureCode: "QUOTA_WAIT" });
    const waitEvent = (repository.events.get(`workspace_1\u0000${accepted.run.id}`) ?? [])
      .find((event) => event.type === "run.waiting");
    expect(waitEvent?.data).toMatchObject({
      boundary: "run_concurrency",
      reasonCode: "QUOTA_RENEWABLE_CAPACITY_EXHAUSTED",
      evidence: [{ eligibility: { kind: "capacity_release" } }],
    });

    const release = await quotas.planTransition({
      workspaceId: "workspace_1",
      transitionId: "release_blocker",
      subject: { kind: "run", id: "run_blocker" },
      outcome: "release",
      amount: null,
      evidenceRef: "blocker_completed",
      recordedAt: new Date(at.getTime() + 1_000),
    });
    await quotas.commitTransition(release);
    await service.sweepEligibleQuotaWaits({ workspaceId: "workspace_1" });
    await service.relayNext();
    await service.relayNext();

    const competitor = await quotas.planClaim({
      workspaceId: "workspace_1",
      principalId: "principal_competitor",
      runId: "run_competitor",
      transitionKey: "competitor_concurrency",
      boundary: "run_concurrency",
      subject: { kind: "run", id: "run_competitor" },
      claims: [{ dimension: "runtime.concurrent_runs@1", unit: "count", amount: "1" }],
      recordedAt: new Date(at.getTime() + 1_500),
    });
    await quotas.commitClaim(competitor);

    const restarted = new WorkflowRunService(
      repository,
      base.revisions,
      base.queue,
      createDeterministicWorkflowRunExecutorRegistry(GOLDEN_WORKFLOW_OPERATION_REGISTRY),
      base.cursor,
      { now: () => new Date(at.getTime() + 2_000) },
      undefined,
      undefined,
      undefined,
      quotas,
    );
    await expect(restarted.executeOne({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_2",
    })).resolves.toMatchObject({ id: accepted.run.id, state: "waiting" });
    const releaseCompetitor = await quotas.planTransition({
      workspaceId: "workspace_1",
      transitionId: "release_competitor",
      subject: { kind: "run", id: "run_competitor" },
      outcome: "release",
      amount: null,
      evidenceRef: "competitor_completed",
      recordedAt: new Date(at.getTime() + 2_500),
    });
    await quotas.commitTransition(releaseCompetitor);
    await restarted.sweepEligibleQuotaWaits({ workspaceId: "workspace_1" });
    expect([...repository.outbox.values()].find(
      (intent) => intent.dedupeKey.startsWith("quota-wait-resume:") &&
        intent.runId === accepted.run.id,
    )).toMatchObject({ state: "pending" });
    await expect(restarted.executeOne({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_2",
    })).resolves.toMatchObject({ id: accepted.run.id, state: "completed" });
    expect((await quotas.listWaits({ workspaceId: "workspace_1", runId: accepted.run.id }))[0])
      .toMatchObject({ state: "resumed", resumedBy: { kind: "system" } });

    const blockerTwo = await quotas.planClaim({
      workspaceId: "workspace_1",
      principalId: "principal_blocker",
      runId: "run_blocker_2",
      transitionKey: "blocker_concurrency_2",
      boundary: "run_concurrency",
      subject: { kind: "run", id: "run_blocker_2" },
      claims: [{ dimension: "runtime.concurrent_runs@1", unit: "count", amount: "1" }],
      recordedAt: new Date(at.getTime() + 3_000),
    });
    await quotas.commitClaim(blockerTwo);
    const acceptedTwo = await service.start({
      workspaceId: "workspace_1",
      workflowId: "workflow_1",
      revisionId: "revision_1",
      inputs: { text: "manual" },
      principalId: "principal_1",
      keyId: "key_1",
      authorizationEvidenceRef: "trace_2",
      idempotencyKey: "quota_start_2",
    });
    await service.executeOne({
      workspaceId: "workspace_1",
      runId: acceptedTwo.run.id,
      workerId: "worker_3",
    });
    const manualWait = (await quotas.listWaits({
      workspaceId: "workspace_1",
      runId: acceptedTwo.run.id,
      state: "waiting",
    }))[0]!;
    const releaseTwo = await quotas.planTransition({
      workspaceId: "workspace_1",
      transitionId: "release_blocker_2",
      subject: { kind: "run", id: "run_blocker_2" },
      outcome: "release",
      amount: null,
      evidenceRef: "blocker_2_completed",
      recordedAt: new Date(at.getTime() + 4_000),
    });
    await quotas.commitTransition(releaseTwo);
    const manualInput = {
      workspaceId: "workspace_1",
      waitId: manualWait.id,
      actor: { kind: "human" as const, userId: "user_1" },
      idempotencyKey: "manual_resume_1",
    };
    const originalResumeQuotaWait = repository.resumeQuotaWait.bind(repository);
    let arrivals = 0;
    let releaseRace!: () => void;
    const raceGate = new Promise<void>((resolve) => { releaseRace = resolve; });
    repository.resumeQuotaWait = async (input) => {
      arrivals += 1;
      if (arrivals === 3) releaseRace();
      await raceGate;
      return originalResumeQuotaWait(input);
    };
    const [winner, actorConflict, keyConflict] = await Promise.allSettled([
      service.resumeQuotaWait(manualInput),
      service.resumeQuotaWait({
        ...manualInput,
        actor: { kind: "human", userId: "user_2" },
      }),
      service.resumeQuotaWait({
        ...manualInput,
        idempotencyKey: "manual_resume_2",
      }),
    ]);
    expect(winner.status).toBe("fulfilled");
    expect(actorConflict).toMatchObject({
      status: "rejected",
      reason: { code: "WORKFLOW_RUN_NOT_RESUMABLE" },
    });
    expect(keyConflict).toMatchObject({
      status: "rejected",
      reason: { code: "WORKFLOW_RUN_NOT_RESUMABLE" },
    });
    if (winner.status !== "fulfilled") throw winner.reason;
    const firstManual = winner.value;
    const replayManual = await service.resumeQuotaWait(manualInput);
    expect(replayManual.run).toEqual(firstManual.run);
    expect(replayManual.inspect).toEqual(firstManual.inspect);
    await expect(service.resumeQuotaWait({
      ...manualInput,
      idempotencyKey: "manual_resume_2",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(firstManual.run).toMatchObject({ id: acceptedTwo.run.id, state: "accepted" });
    expect(await quotas.getWait({ workspaceId: "workspace_1", waitId: manualWait.id }))
      .toMatchObject({
        state: "resumed",
        resumedBy: { kind: "human", userId: "user_1" },
        resumeIdempotencyKey: "manual_resume_1",
      });
    const manualResumeEvents = (repository.events.get(`workspace_1\u0000${acceptedTwo.run.id}`) ?? [])
      .filter((event) => event.type === "run.resumed");
    expect(manualResumeEvents).toHaveLength(1);
    expect([...repository.outbox.values()].filter(
      (intent) => intent.dedupeKey === `quota-wait-manual-resume:${manualWait.id}`,
    )).toHaveLength(1);

    const source = await repository.getById({
      workspaceId: "workspace_1",
      runId: acceptedTwo.run.id,
    });
    const admissionBlocker = await quotas.planClaim({
      workspaceId: "workspace_1",
      principalId: "principal_blocker",
      runId: "run_admission_blocker",
      transitionKey: "admission_blocker",
      boundary: "run_admission",
      subject: { kind: "run", id: "run_admission_blocker" },
      claims: [{ dimension: "runtime.run_admissions@1", unit: "count", amount: "1" }],
      recordedAt: new Date(at.getTime() + 4_500),
    });
    await quotas.commitClaim(admissionBlocker);
    const derivedId = "run_derived_quota_wait";
    const derivedAt = new Date(at.getTime() + 5_000);
    const admissionPlan = await quotas.planClaim({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      runId: derivedId,
      transitionKey: `quota:run_admission:${derivedId}:v1`,
      boundary: "run_admission",
      subject: { kind: "run", id: derivedId },
      claims: [{ dimension: "runtime.run_admissions@1", unit: "count", amount: "1" }],
      recordedAt: derivedAt,
    });
    const derived = await repository.deriveRun({
      run: {
        ...structuredClone(source!),
        id: derivedId,
        state: "accepted",
        nextEventSequence: 3,
        derivation: {
          kind: "manual_retry",
          sourceRunId: source!.id,
          rootRunId: source!.id,
          sourceStartSnapshotDigest: source!.startSnapshotDigest,
          retryFromStepId: "digest",
          reusedOutputs: [],
        },
        resumeAt: null,
        failureCode: null,
        acceptedAt: derivedAt,
        startedAt: null,
        completedAt: null,
        updatedAt: derivedAt,
      },
      events: [
        { id: "derived_accepted", workspaceId: "workspace_1", runId: derivedId, sequence: 1, type: "run.accepted", data: {}, occurredAt: derivedAt },
        { id: "derived_lineage", workspaceId: "workspace_1", runId: derivedId, sequence: 2, type: "run.derived", data: {}, occurredAt: derivedAt },
      ],
      receipt: {
        workspaceId: "workspace_1",
        principalId: "principal_1",
        keyId: "key_1",
        authorizationEvidenceRef: "trace_derived",
        capability: "workflow_runs.retry@1",
        idempotencyKey: "derived_quota_wait_1",
        requestFingerprint: "sha256:derived",
        runId: derivedId,
        initialEventCursor: "cursor_derived",
        result: null,
        createdAt: derivedAt,
      },
      outboxIntent: {
        id: "derived_outbox",
        workspaceId: "workspace_1",
        runId: derivedId,
        generation: 1,
        dedupeKey: `workflow-run:workspace_1:${derivedId}:v1`,
        state: "pending",
        deliveryToken: null,
        deliveryAttempts: 0,
        availableAt: derivedAt,
        claimedAt: null,
        deliveredAt: null,
        createdAt: derivedAt,
      },
      quotaAdmissionPlan: admissionPlan,
      quotaWaitEventId: "derived_quota_wait_event",
    });
    expect(derived).toMatchObject({
      kind: "quota_denied",
      reasonCodes: ["QUOTA_CAPACITY_EXHAUSTED"],
    });
    await expect(repository.getById({
      workspaceId: "workspace_1",
      runId: derivedId,
    })).resolves.toBeNull();
    expect(repository.events.has(`workspace_1\u0000${derivedId}`)).toBe(false);
    expect(repository.outbox.has("derived_outbox")).toBe(false);
    await expect(quotas.listWaits({
      workspaceId: "workspace_1",
      runId: derivedId,
    })).resolves.toEqual([]);
  });

  it("publishes predictable admission exhaustion as QUOTA_EXCEEDED", async () => {
    const at = new Date("2026-07-25T12:00:00.000Z");
    const quotaRepository = new InMemoryQuotaRepository(() => new Date(at));
    const quotas = new QuotaService(quotaRepository);
    await quotas.createPolicyRevision({
      workspaceId: "workspace_1",
      principalId: null,
      kind: "admission",
      boundary: "run_admission",
      dimension: "runtime.run_admissions@1",
      unit: "count",
      window: "calendar_day",
      timezone: "UTC",
      reservationRule: "consume",
      warningThreshold: "1",
      hardLimit: "1",
      exhaustionBehavior: "deny",
      actorUserId: "user_1",
      idempotencyKey: "admission_limit_1",
      recordedAt: at,
    });
    const base = setup();
    const repository = new InMemoryWorkflowRunRepository(undefined, undefined, quotaRepository);
    const service = new WorkflowRunService(
      repository,
      base.revisions,
      base.queue,
      createDeterministicWorkflowRunExecutorRegistry(GOLDEN_WORKFLOW_OPERATION_REGISTRY),
      base.cursor,
      { now: () => new Date(at) },
      undefined,
      undefined,
      undefined,
      quotas,
    );
    const start = (idempotencyKey: string) => service.start({
      workspaceId: "workspace_1",
      workflowId: "workflow_1",
      revisionId: "revision_1",
      inputs: { text: "hello" },
      principalId: "principal_1",
      keyId: "key_1",
      authorizationEvidenceRef: `trace_${idempotencyKey}`,
      idempotencyKey,
    });

    await expect(start("quota_limit_first")).resolves.toMatchObject({
      run: { state: "accepted" },
    });
    await expect(start("quota_limit_second")).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      retryable: false,
      details: {
        reasonCodes: ["QUOTA_CAPACITY_EXHAUSTED"],
        evidence: [expect.objectContaining({
          dimension: "runtime.run_admissions@1",
          requested: "1",
          available: "0",
        })],
      },
    });
    expect(repository.runs.size).toBe(1);
    expect(repository.outbox.size).toBe(1);
  });

  it("previews without binding, admits atomically, and replays before fresh budget evaluation", async () => {
    const budgetRepository = new InMemoryBudgetRepository();
    const budgets = new BudgetService(budgetRepository);
    await budgets.createPolicyRevision({
      workspaceId: "workspace_1",
      principalId: null,
      currency: "USD",
      period: "calendar_day",
      timezone: "UTC",
      warningThreshold: "5",
      hardLimit: "10",
      unknownPriceTreatment: "deny",
      unknownPriceAllowance: null,
      actorUserId: "user_1",
      idempotencyKey: "policy_1",
      recordedAt: new Date("2026-07-25T12:00:00.000Z"),
    });
    const revisions = new InMemoryWorkflowRunRevisionReader();
    const resolved = definition();
    revisions.put("workspace_1", {
      id: "revision_1",
      workflowId: "workflow_1",
      revision: 1,
      definitionDigest: canonicalDigest(resolved),
      definition: resolved,
      operationRegistryDigest: GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest,
    });
    const repository = new InMemoryWorkflowRunRepository(undefined, budgetRepository);
    const service = new WorkflowRunService(
      repository,
      revisions,
      new InMemoryWorkflowRunQueue(),
      createDeterministicWorkflowRunExecutorRegistry(GOLDEN_WORKFLOW_OPERATION_REGISTRY),
      new AesGcmWorkflowRunEventCursorCodec(() => ({
        active: { id: "test", key: Buffer.alloc(32, 7) },
        all: [{ id: "test", key: Buffer.alloc(32, 7) }],
      })),
      { now: () => new Date("2026-07-25T12:00:00.000Z") },
      undefined,
      undefined,
      budgets,
    );
    const request = {
      workspaceId: "workspace_1",
      workflowId: "workflow_1",
      revisionId: "revision_1",
      inputs: { text: "hello" },
      principalId: "principal_1",
      keyId: "key_1",
      authorizationEvidenceRef: "trace_1",
      idempotencyKey: "start_run_1",
    };
    await expect(service.preview(request)).resolves.toMatchObject({
      admissible: true,
      ceiling: { amount: "0", currency: "USD" },
    });
    expect(budgetRepository.reservations.size).toBe(0);
    const accepted = await service.start(request);
    expect(budgetRepository.reservations.size).toBe(1);
    await budgets.setSpendSuspended({
      workspaceId: "workspace_1",
      suspended: true,
      reason: "emergency",
      actorUserId: "user_1",
      recordedAt: new Date("2026-07-25T12:01:00.000Z"),
    });
    await expect(service.start({ ...request, authorizationEvidenceRef: "trace_2" }))
      .resolves.toEqual(accepted);
    expect(budgetRepository.reservations.size).toBe(1);
  });

  it.each(["workflow_runs.start@2", "workflow_runs.start@3"] as const)("verifies, pins, atomically redeems, and caps one accepted provider-spend quote for %s", async (capability) => {
    const at = new Date("2026-07-25T12:00:00.000Z");
    const budgetRepository = new InMemoryBudgetRepository();
    const budgets = new BudgetService(budgetRepository);
    await budgets.createPolicyRevision({ workspaceId: "workspace_1", principalId: null, currency: "USD", period: "calendar_day", timezone: "UTC", warningThreshold: "5", hardLimit: "10", unknownPriceTreatment: "deny", unknownPriceAllowance: null, actorUserId: "user_1", idempotencyKey: "quoted_policy_1", recordedAt: at });
    const base = setup();
    const repository = new InMemoryWorkflowRunRepository(undefined, budgetRepository);
    const codec = new WorkflowRunSpendQuoteCodec(Buffer.alloc(32, 9));
    const studioAssetReferences = [{ assetId: "asset_z", digest: `sha256:${"a".repeat(64)}`, type: "image" as const, mediaType: "image/png", sizeBytes: 42, width: 1080, height: 1920, durationSeconds: null }];
    const studioAssets = { resolveStudioAssets: async () => studioAssetReferences };
    const service = new WorkflowRunService(repository, base.revisions, base.queue, createDeterministicWorkflowRunExecutorRegistry(GOLDEN_WORKFLOW_OPERATION_REGISTRY), base.cursor, { now: () => at }, undefined, undefined, budgets, undefined, codec, studioAssets);
    const request = { workspaceId: "workspace_1", workflowId: "workflow_1", revisionId: "revision_1", inputs: { text: "hello" }, inputArtifactIds: [], ...(capability === "workflow_runs.start@3" ? { inputStudioAssetIds: ["asset_z"] } : {}), principalId: "principal_1", keyId: "key_1", authorizationEvidenceRef: "trace_quote", idempotencyKey: "quoted_start_1", capability };
    const preview = await service.preview(request);
    const providerModels = preview.stepExposures.map((exposure) => ({ provider: exposure.provider, model: exposure.model, pricePerAttempt: exposure.amountPerAttempt ?? "", automaticAttempts: exposure.automaticAttempts, pricingSnapshotIds: [...exposure.pricingSnapshotIds].sort() }));
    const pricingSnapshotIds = [...new Set(providerModels.flatMap((item) => item.pricingSnapshotIds))].sort();
    const quote: WorkflowRunAcceptedSpendQuote = {
      schema: "workflow-run-accepted-spend-quote/v1", quoteId: `quote_fixed_${capability.endsWith("@3") ? "3" : "2"}`, sourceWorkspaceId: "portfolio_1", targetWorkspaceId: request.workspaceId, requestedByUserId: "owner_1", delegatedPrincipalId: request.principalId, delegatedKeyId: request.keyId, capability, workflowId: request.workflowId, workflowRevisionId: request.revisionId,
      inputDigest: workflowRunQuoteInputDigest({ ...request, ...(capability === "workflow_runs.start@3" ? { studioAssetReferences } : {}) }), targetStateDigest: canonicalDigest({ workflowId: request.workflowId, revisionId: request.revisionId }), amount: preview.ceiling.amount!, currency: preview.ceiling.currency!, providerModels, pricingSnapshotIds, ceiling: { maximumAmount: preview.ceiling.amount!, currency: preview.ceiling.currency!, maximumProviderAttempts: providerModels.reduce((total, model) => total + model.automaticAttempts, 0) }, ceilingDigest: "", quotedAt: at.toISOString(), expiresAt: new Date(at.getTime() + 300_000).toISOString(),
    };
    quote.ceilingDigest = workflowRunQuoteCeilingDigest(quote);
    const acceptedSpendQuoteRef = codec.seal(quote);
    const accepted = await service.start({ ...request, acceptedSpendQuoteRef });
    expect((await repository.getById({ workspaceId: request.workspaceId, runId: accepted.run.id }))?.startSnapshot.acceptedSpendQuote).toMatchObject({ quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency, pricingSnapshotIds: quote.pricingSnapshotIds });
    expect(repository.spendQuoteRedemptions.get(quote.quoteId)).toMatchObject({ runId: accepted.run.id, principalId: request.principalId });
    await expect(service.start({ ...request, idempotencyKey: "quoted_start_2", acceptedSpendQuoteRef })).rejects.toMatchObject({ code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE" });
    await expect(service.start({ ...request, idempotencyKey: "quoted_start_3", principalId: "principal_other", acceptedSpendQuoteRef })).rejects.toMatchObject({ code: "WORKFLOW_RUN_INVALID_INPUT" });
    const stale = { ...quote, quoteId: "quote_stale_1", expiresAt: new Date(at.getTime() - 1).toISOString() };
    stale.ceilingDigest = workflowRunQuoteCeilingDigest(stale);
    await expect(service.start({ ...request, idempotencyKey: "quoted_start_4", acceptedSpendQuoteRef: codec.seal(stale) })).rejects.toMatchObject({ code: "WORKFLOW_RUN_INVALID_INPUT" });
  });

  it("applies the same Workflow eligibility gate to preview and start", async () => {
    const unsupported = definition();
    unsupported.steps.push({
      ...structuredClone(unsupported.steps[0]!),
      id: "digest_again",
    });
    const revisions = new InMemoryWorkflowRunRevisionReader();
    revisions.put("workspace_1", {
      id: "revision_unsupported",
      workflowId: "workflow_1",
      revision: 2,
      definitionDigest: canonicalDigest(unsupported),
      definition: unsupported,
      operationRegistryDigest: GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest,
    });
    const budgets: WorkflowRunBudgetPort = {
      previewRun: async (input) => ({
        schema: "run-admission-preview/v1",
        workspaceId: input.workspaceId,
        principalId: input.principalId,
        workflowId: input.workflowId,
        workflowRevisionId: input.workflowRevisionId,
        evaluatedAt: input.at,
        ceiling: {
          amount: "0",
          currency: "USD",
          certainty: "conservative",
          fxSnapshotIds: [],
        },
        applicableCredentialSpendGrants: [],
        applicablePolicies: [],
        requiredReservations: [],
        stepExposures: input.stepExposures,
        warnings: [],
        admissible: true,
        denialReasons: [],
      }),
      planAdmission: async () => {
        throw new Error("Eligibility must fail before Budget admission.");
      },
      planSettlement: async (input) => input,
    };
    const service = new WorkflowRunService(
      new InMemoryWorkflowRunRepository(),
      revisions,
      new InMemoryWorkflowRunQueue(),
      createDeterministicWorkflowRunExecutorRegistry(
        GOLDEN_WORKFLOW_OPERATION_REGISTRY,
      ),
      new AesGcmWorkflowRunEventCursorCodec(() => ({
        active: { id: "test", key: Buffer.alloc(32, 7) },
        all: [{ id: "test", key: Buffer.alloc(32, 7) }],
      })),
      { now: () => new Date("2026-07-25T12:00:00.000Z") },
      undefined,
      undefined,
      budgets,
    );
    const proposed = {
      workspaceId: "workspace_1",
      workflowId: "workflow_1",
      revisionId: "revision_unsupported",
      inputs: { text: "hello" },
      principalId: "principal_1",
    };
    await expect(service.preview(proposed)).rejects.toMatchObject({
      code: "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
    });
    await expect(service.start({
      ...proposed,
      keyId: "key_1",
      authorizationEvidenceRef: "trace_1",
      idempotencyKey: "unsupported-start-1",
    })).rejects.toMatchObject({
      code: "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW",
    });
  });

  it("atomically accepts the Run, immutable snapshot, event, receipt, and outbox", async () => {
    const { repository, start } = setup();
    const accepted = await start();
    expect(accepted.run.state).toBe("accepted");
    expect(accepted.inspect).toEqual({
      capability: "workflow_runs.get@1",
      input: {
        workflowId: "workflow_1",
        runId: accepted.run.id,
      },
    });
    expect(accepted.events.capability).toBe("workflow_run_events.list@1");
    expect(repository.runs.size).toBe(1);
    expect(repository.events.size).toBe(1);
    expect(repository.receipts.size).toBe(1);
    expect(repository.outbox.size).toBe(1);
    const stored = [...repository.runs.values()][0];
    expect(stored.startSnapshot.schema).toBe(
      "workflow-run-start-snapshot/v2",
    );
    expect(stored.startSnapshot.operationContracts).toEqual([
      expect.objectContaining({ identity: "runtime.digest_text@1" }),
    ]);
    expect(stored.startSnapshot.providerResolutions).toEqual([
      expect.objectContaining({
        stepId: "digest",
        provider: "runtime",
        providerOperation: "digest_text",
        model: "sha256",
        adapterContractDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        launchSafety: {
          mode: "native_effect_key",
          guard: "workflow-step-attempt/v1",
          replay: "provider_deduplicated",
        },
      }),
    ]);
    expect(
      Object.isFrozen(stored.startSnapshot.providerResolutions?.[0]?.usageCeilings),
    ).toBe(true);
    expect(stored.startSnapshot.artifactReferences).toEqual([]);
    expect(stored.startSnapshot.credentialReferences).toEqual([]);
    expect(Object.isFrozen(stored.startSnapshot)).toBe(true);
    expect([...repository.outbox.values()][0].dedupeKey).toBe(
      `workflow-run:workspace_1:${accepted.run.id}:v1`,
    );
  });

  it("rolls back every acceptance record when the atomic start fails", async () => {
    const { repository, start } = setup();
    repository.failNextStart = true;
    await expect(start()).rejects.toMatchObject({
      code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
    });
    expect(repository.runs.size).toBe(0);
    expect(repository.events.size).toBe(0);
    expect(repository.receipts.size).toBe(0);
    expect(repository.outbox.size).toBe(0);
  });

  it("replays immutable acceptance with fresh evidence, even after completion", async () => {
    const { service, start } = setup();
    const accepted = await start();
    await service.executeOne({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_1",
    });
    const replay = await start({
      authorizationEvidenceRef: "trace_retry",
    });
    expect(replay).toEqual(accepted);
    expect(replay.run.state).toBe("accepted");
    await expect(
      service.get({
        workspaceId: "workspace_1",
        principalId: "principal_1",
        workflowId: "workflow_1",
        runId: accepted.run.id,
      }),
    ).resolves.toMatchObject({ state: "completed" });
  });

  it("replays idempotent acceptance across Agent key rotation", async () => {
    const { repository, start } = setup();
    const first = await start();
    const second = await start({
      keyId: "key_2",
      authorizationEvidenceRef: "trace_rotated_key",
    });
    expect(second).toEqual(first);
    expect(repository.runs.size).toBe(1);
    expect(repository.receipts.size).toBe(1);
  });

  it("relays one identifier-only stable schedule and is retry safe", async () => {
    const { queue, service, start } = setup();
    const accepted = await start();
    await expect(service.relayNext()).resolves.toEqual({
      delivered: true,
      runId: accepted.run.id,
    });
    await expect(service.relayNext()).resolves.toEqual({ delivered: false });
    expect([...queue.scheduled.entries()]).toEqual([
      [
        `workflow-run:workspace_1:${accepted.run.id}:v1`,
        { workspaceId: "workspace_1", runId: accepted.run.id },
      ],
    ]);
  });

  it("replays relay ambiguity with the same dedupe identity", async () => {
    const { queue, repository, service, start } = setup();
    const accepted = await start();
    repository.failNextMarkOutboxDelivered = true;
    await expect(service.relayNext()).rejects.toMatchObject({
      code: "WORKFLOW_RUN_DELIVERY_UNAVAILABLE",
    });
    await expect(service.relayNext()).resolves.toEqual({
      delivered: true,
      runId: accepted.run.id,
    });
    expect(queue.scheduled.size).toBe(1);
    expect([...queue.scheduled.keys()]).toEqual([
      `workflow-run:workspace_1:${accepted.run.id}:v1`,
    ]);
  });

  it("advances accepted to completed under a fence with gap-free retained events", async () => {
    const { service, start } = setup();
    const accepted = await start();
    const completed = await service.executeOne({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_1",
    });
    expect(completed).toMatchObject({
      state: "completed",
      failureCode: null,
      output: { textDigest: canonicalDigest("hello") },
    });
    const page = await service.listEvents({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      workflowId: "workflow_1",
      runId: accepted.run.id,
      cursor: accepted.events.input.cursor,
    });
    expect(page.items.map(({ sequence, type }) => ({ sequence, type }))).toEqual([
      { sequence: 1, type: "run.accepted" },
      { sequence: 2, type: "step.completed" },
      { sequence: 3, type: "run.completed" },
    ]);
    await expect(
      service.listEvents({
        workspaceId: "workspace_1",
        principalId: "principal_1",
        workflowId: "workflow_1",
        runId: accepted.run.id,
        cursor: page.nextCursor,
      }),
    ).resolves.toMatchObject({ items: [] });
  });

  it("projects retained event JSON through exact grammars and drops secret canaries even under allowlisted keys", async () => {
    const { repository, service, start } = setup();
    const accepted = await start();
    const key = `workspace_1\u0000${accepted.run.id}`;
    const [event] = repository.events.get(key)!;
    repository.events.set(key, [{
      ...event!,
      data: {
        startSnapshotDigest: "Bearer sk-event-secret",
        reasonCode: "secret-token-value",
        arbitraryPayload: { prompt: "do not publish me" },
      },
    }]);

    const page = await service.listEvents({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      workflowId: "workflow_1",
      runId: accepted.run.id,
      cursor: accepted.events.input.cursor,
    });
    expect(page.items).toEqual([
      expect.objectContaining({ type: "run.accepted", data: {} }),
    ]);
    expect(JSON.stringify(page)).not.toContain("secret");
    expect(JSON.stringify(page)).not.toContain("prompt");
  });

  it("rejects stale fences after lease takeover", async () => {
    const { advance, repository, start } = setup();
    const accepted = await start();
    const first = await repository.acquireLease({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_1",
      now: new Date("2026-07-25T12:00:00.000Z"),
      expiresAt: new Date("2026-07-25T12:00:01.000Z"),
    });
    expect(first.kind).toBe("acquired");
    advance(2_000);
    const second = await repository.acquireLease({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_2",
      now: new Date("2026-07-25T12:00:02.000Z"),
      expiresAt: new Date("2026-07-25T12:00:32.000Z"),
    });
    expect(second.kind).toBe("acquired");
    if (first.kind !== "acquired" || second.kind !== "acquired") return;
    expect(second.lease.fence > first.lease.fence).toBe(true);
    await expect(
      repository.completeStep({
        workspaceId: "workspace_1",
        runId: accepted.run.id,
        workerId: first.lease.workerId,
        token: first.lease.token,
        fence: first.lease.fence,
        output: {},
        completedAt: new Date("2026-07-25T12:00:02.000Z"),
        stepEventId: "event_step_stale",
        runEventId: "event_run_stale",
      }),
    ).resolves.toEqual({ kind: "stale_fence" });
  });

  it("renews only the exact live lease owner and preserves its fence", async () => {
    const { repository, start } = setup();
    const accepted = await start();
    const lease = await repository.acquireLease({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: "worker_renew",
      now: new Date("2026-07-25T12:00:00.000Z"),
      expiresAt: new Date("2026-07-25T12:00:10.000Z"),
    });
    expect(lease.kind).toBe("acquired");
    if (lease.kind !== "acquired") return;
    const renewed = await repository.renewLease({
      workspaceId: "workspace_1",
      runId: accepted.run.id,
      workerId: lease.lease.workerId,
      token: lease.lease.token,
      fence: lease.lease.fence,
      now: new Date("2026-07-25T12:00:05.000Z"),
      expiresAt: new Date("2026-07-25T12:00:35.000Z"),
    });
    expect(renewed).toMatchObject({
      kind: "renewed",
      lease: {
        fence: lease.lease.fence,
        expiresAt: new Date("2026-07-25T12:00:35.000Z"),
      },
    });
    await expect(
      repository.renewLease({
        workspaceId: "workspace_1",
        runId: accepted.run.id,
        workerId: "worker_other",
        token: lease.lease.token,
        fence: lease.lease.fence,
        now: new Date("2026-07-25T12:00:06.000Z"),
        expiresAt: new Date("2026-07-25T12:00:36.000Z"),
      }),
    ).resolves.toEqual({ kind: "stale_fence" });
  });

  it("keeps completion persistence failures reentrant instead of marking failed", async () => {
    const { repository, service, start } = setup();
    const accepted = await start();
    const workerId = workflowRunWorkerId("stable-sdk-step-id");
    repository.failNextFinish = true;
    await expect(
      service.executeOne({
        workspaceId: "workspace_1",
        runId: accepted.run.id,
        workerId,
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
    });
    expect([...repository.runs.values()][0].state).toBe("running");
    expect([...repository.events.values()][0]).toHaveLength(1);
    await expect(
      service.executeOne({
        workspaceId: "workspace_1",
        runId: accepted.run.id,
        workerId,
      }),
    ).resolves.toMatchObject({ state: "completed" });
  });

  it("rejects provider, credential, image, and mismatched operation contracts", async () => {
    const { revisions, start } = setup();
    const provider = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
      "gemini.generate_text@1",
    )!;
    for (const [id, changed] of [
      ["revision_provider", definition(provider)],
      [
        "revision_mismatch",
        definition({
          ...GOLDEN_WORKFLOW_OPERATION_REGISTRY.get("runtime.digest_text@1")!,
          contractDigest: `sha256:${"f".repeat(64)}`,
        }),
      ],
    ] as const) {
      revisions.put("workspace_1", {
        id,
        workflowId: "workflow_1",
        revision: 2,
        definitionDigest: canonicalDigest(changed),
        definition: changed,
        operationRegistryDigest: GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest,
      });
      await expect(
        start({ revisionId: id, idempotencyKey: `start-${id}` }),
      ).rejects.toMatchObject({ code: "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW" });
    }
  });

  it("binds event cursors to Workspace, Principal, Workflow, and Run", async () => {
    const { service, start } = setup();
    const accepted = await start();
    await expect(
      service.listEvents({
        workspaceId: "workspace_1",
        principalId: "principal_2",
        workflowId: "workflow_1",
        runId: accepted.run.id,
        cursor: accepted.events.input.cursor,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_RUN_UNAVAILABLE" });
  });
});
