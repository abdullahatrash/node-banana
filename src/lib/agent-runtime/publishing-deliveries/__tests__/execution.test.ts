import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  executeProviderEffect,
  observeProviderEffect,
  ProviderTransportFault,
} from "../../runs/provider-adapter";
import {
  DeterministicLinkedInPlatformAdapter,
  DeterministicLinkedInPlatformTransport,
  type DeterministicLinkedInIntent,
} from "@/lib/publishing-adapters/deterministic-linkedin";
import { describe, expect, it, vi } from "vitest";
import { PublishingDeliveryExecutionService } from "../execution";
import {
  AdapterPublishingPlatformInvocationBoundary,
  PublishingPlatformContactReadinessError,
  PublishingPlatformPreparationError,
  PublishingPlatformRegistry,
  type PublishingPlatformInvocationBoundary,
} from "../platform-registry";
import type {
  PublishingDeliveryEvent,
  PublishingDeliveryExecutionReadinessPort,
  PublishingDeliveryExecutionLeaseRecord,
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryReconciliationRequestRecord,
  PublishingDeliveryRecord,
  PublishingDeliveryRepository,
} from "../types";
import { setupPublishingDeliveries } from "./fixtures";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const providerContract = {
  providerContractDigest: digest("8"),
  launchSafety: {
    mode: "native_effect_key" as const,
    guard: "publishing-delivery/v1" as const,
    replay: "provider_deduplicated" as const,
  },
  observation: "provider_operation_ref" as const,
};

const readyExecution: PublishingDeliveryExecutionReadinessPort = {
  checkCurrent: async (input) => ({
    kind: "ready",
    session: {
      schema: "publishing-delivery-execution-readiness/v1",
      id: "readiness_1",
      ...input,
      mode: "launch",
      authorizationEvidenceDigest: digest("4"),
      approvalEvidenceDigest: digest("5"),
      channelEvidenceDigest: digest("6"),
      credentialEvidenceDigest: digest("7"),
      validationEvidenceDigest: digest("9"),
      evidenceDigest: digest("0"),
      evaluatedAt: input.evaluatedAt,
      expiresAt: new Date(input.evaluatedAt.getTime() + 30_000),
    },
  }),
};

function delivery(publishAt: Date): PublishingDeliveryRecord {
  return {
    id: "delivery_1",
    workspaceId: "workspace_1",
    sourceDeliveryId: null,
    retryId: null,
    releaseId: "release_1",
    planId: "plan_1",
    planRevisionId: "revision_1",
    planRevision: 1,
    planRevisionDigest: digest("a"),
    approvalRequestId: "approval_1",
    approvalDecisionId: "decision_1",
    requestingPrincipalId: "principal_1",
    requestingKeyId: "key_1",
    targetId: "target_1",
    channelId: "channel_1",
    artifactIds: ["content_1"],
    targetSnapshot: {
      schema: "publishing-delivery-target-snapshot/v1",
      target: {
        targetId: "target_1",
        channelId: "channel_1",
        contentArtifactId: "content_1",
        mediaArtifactIds: [],
        settings: { type: "person" },
        timing: { kind: "scheduled", publishAt: publishAt.toISOString() },
      },
      validation: {
        targetId: "target_1",
        channel: {
          id: "channel_1",
          platform: "linkedin",
          authorKind: "person",
          snapshotDigest: digest("b"),
          capabilityVersion: digest("c"),
        },
        artifacts: [
          {
            id: "content_1",
            digest: digest("d"),
            snapshotDigest: digest("e"),
            kind: "text",
            mediaType: "text/plain; charset=utf-8",
            sizeBytes: 33,
          },
        ],
        settingsDigest: digest("f"),
        publishAt: publishAt.toISOString(),
        policyEvidenceDigest: digest("1"),
        policyStateDigest: digest("2"),
        blockerCodes: [],
      },
      targetDigest: digest("3"),
    },
    targetSnapshotDigest: digest("3"),
    publishAt,
    desiredState: "publish",
    state: "scheduled",
    effectKey: "publishing-effect:v1:workspace_1:delivery_1",
    effectGeneration: 1,
    intentDigest: null,
    providerAdapterContractDigest: null,
    providerOperationRef: null,
    latestEffectEvidenceDigest: null,
    failureCode: null,
    failureClass: null,
    failureRetryable: null,
    failureEffectDisposition: null,
    readinessBlockCode: null,
    readinessEvidenceDigest: null,
    readinessBlockedAt: null,
    readinessRetryAt: null,
    readinessBlockCount: 0,
    nextEffectAttempt: 1,
    nextEventSequence: 3,
    nextOutboxGeneration: 2,
    acceptedAt: new Date("2026-08-09T12:00:00.000Z"),
    scheduledAt: new Date("2026-08-09T12:00:00.000Z"),
    dispatchStartedAt: null,
    effectContactStartedAt: null,
    completedAt: null,
    updatedAt: new Date("2026-08-09T12:00:00.000Z"),
  };
}

function firstOutbox(
  record: PublishingDeliveryRecord,
): PublishingDeliveryOutboxIntentRecord {
  return {
    id: "outbox_1",
    workspaceId: record.workspaceId,
    deliveryId: record.id,
    purpose: "publish",
    dedupeKey: `publishing-delivery:${record.workspaceId}:${record.id}:v1`,
    generation: 1,
    state: "pending",
    availableAt: record.publishAt,
    deliveryToken: null,
    deliveryAttempts: 0,
    claimedAt: null,
    deliveredAt: null,
  };
}

function event(
  record: PublishingDeliveryRecord,
  type: PublishingDeliveryEvent["type"],
  occurredAt: Date,
): PublishingDeliveryEvent {
  return {
    schema: "publishing-delivery-event/v1",
    id: `event_${record.nextEventSequence}`,
    workspaceId: record.workspaceId,
    deliveryId: record.id,
    sequence: record.nextEventSequence,
    type,
    evidence: {},
    occurredAt,
  } as PublishingDeliveryEvent;
}

function retainedFixtureIntent(
  record: Readonly<PublishingDeliveryRecord>,
): DeterministicLinkedInIntent {
  const content = record.targetSnapshot.validation.artifacts.find(
    (artifact) => artifact.kind === "text",
  )!;
  const media = record.targetSnapshot.validation.artifacts.filter(
    (artifact) => artifact.kind === "image",
  );
  return {
    schema: "publishing-platform-intent/v1",
    deliveryId: record.id,
    planRevisionId: record.planRevisionId,
    planRevisionDigest: record.planRevisionDigest,
    targetId: record.targetId,
    channel: {
      id: record.channelId,
      platform: "linkedin",
      authorKind: record.targetSnapshot.validation.channel.authorKind,
      snapshotDigest: record.targetSnapshot.validation.channel.snapshotDigest,
    },
    content: {
      artifactId: content.id,
      digest: content.digest,
      mediaType: "text/plain; charset=utf-8",
      text: "Launch copy",
    },
    media: media.map((artifact) => ({
      artifactId: artifact.id,
      digest: artifact.digest,
      mediaType: artifact.mediaType as
        | "image/jpeg"
        | "image/png"
        | "image/gif",
      bytes: Uint8Array.from(Buffer.from("opaque", "utf8")),
    })),
    settings: { type: record.targetSnapshot.validation.channel.authorKind },
    publishAt: record.publishAt.toISOString(),
  };
}

function retainedFixtureBoundary(
  adapter: DeterministicLinkedInPlatformAdapter,
): PublishingPlatformInvocationBoundary {
  return new AdapterPublishingPlatformInvocationBoundary(
    adapter,
    retainedFixtureIntent,
    async () => ({
      primary: {
        profileId: "credential_1",
        version: 1,
        secret: "memory-e2e-secret-canary",
      },
    }),
  );
}

async function retainContactMarker(input: {
  setup: Awaited<ReturnType<typeof setupPublishingDeliveries>>;
  deliveryId: string;
  now: Date;
  intentDigest: string;
  providerAdapterContractDigest: string;
}) {
  await input.setup.repository.claimOutbox({
    now: input.now,
    claimExpiresBefore: new Date(input.now.getTime() - 30_000),
    deliveryToken: "crash_contact_claim",
  });
  const acquired = await input.setup.repository.acquireLease({
    workspaceId: "workspace_1",
    deliveryId: input.deliveryId,
    workerId: "crashed_worker",
    now: input.now,
    expiresAt: new Date(input.now.getTime() + 1_000),
  });
  if (acquired.kind !== "acquired") throw new TypeError("Expected lease");
  await input.setup.repository.prepareEffect({
    workspaceId: "workspace_1",
    deliveryId: input.deliveryId,
    workerId: acquired.lease.workerId,
    leaseToken: acquired.lease.leaseToken,
    fence: acquired.lease.fence,
    effectKey: acquired.delivery.effectKey,
    intentDigest: input.intentDigest,
    providerAdapterContractDigest: input.providerAdapterContractDigest,
    preparedAt: input.now,
  });
  const readiness = await readyExecution.checkCurrent({
    workspaceId: "workspace_1",
    deliveryId: input.deliveryId,
    effectKey: acquired.delivery.effectKey,
    effectGeneration: acquired.delivery.effectGeneration,
    intentDigest: input.intentDigest,
    providerAdapterContractDigest: input.providerAdapterContractDigest,
    evaluatedAt: input.now,
  });
  if (readiness.kind !== "ready") throw new TypeError("Expected readiness");
  await input.setup.repository.beginEffectContact({
    workspaceId: "workspace_1",
    deliveryId: input.deliveryId,
    workerId: acquired.lease.workerId,
    leaseToken: acquired.lease.leaseToken,
    fence: acquired.lease.fence,
    effectKey: acquired.delivery.effectKey,
    intentDigest: input.intentDigest,
    providerAdapterContractDigest: input.providerAdapterContractDigest,
    readinessSession: readiness.session,
    startedAt: input.now,
  });
}

describe("Publishing Delivery scheduler and fenced worker", () => {
  it.each([
    {
      name: "success",
      providerRef: "provider_effect_1",
      observation: "provider_operation_ref" as const,
      outcome: {
        kind: "succeeded" as const,
        providerOperationRef: "provider_effect_1",
        outputs: {},
        evidence: {
          providerRequestId: "request_1",
          httpStatus: 200,
          providerCode: "SUCCEEDED",
          operatorTraceRef: null,
          effectDisposition: "accepted" as const,
        },
        usage: [],
      },
      expectedResolution: "succeeded",
      expectedState: "succeeded",
      externallyCompleted: true,
    },
    {
      name: "known transient failure",
      providerRef: "provider_effect_1",
      observation: "provider_operation_ref" as const,
      outcome: {
        kind: "failed_known" as const,
        providerOperationRef: "provider_effect_1",
        failureCode: "PLATFORM_TEMPORARY_FAILURE",
        retryHint: { retryable: true as const, retryAfterMs: 1_000 },
        evidence: {
          providerRequestId: "request_1",
          httpStatus: 503,
          providerCode: "TEMPORARY",
          operatorTraceRef: null,
          effectDisposition: "terminal_failed" as const,
        },
        usage: [],
      },
      expectedResolution: "failed_known",
      expectedState: "failed_transient",
      externallyCompleted: false,
    },
    {
      name: "still unknown",
      providerRef: "provider_effect_1",
      observation: "provider_operation_ref" as const,
      outcome: {
        kind: "outcome_unknown" as const,
        providerOperationRef: "provider_effect_1",
        failureCode: "PLATFORM_EFFECT_PENDING",
        pollAfterMs: 1_000,
        evidence: {
          providerRequestId: "request_1",
          httpStatus: 202,
          providerCode: "PENDING",
          operatorTraceRef: null,
          effectDisposition: "accepted" as const,
        },
        usage: [],
      },
      expectedResolution: "still_unknown",
      expectedState: "outcome_unknown",
      externallyCompleted: null,
    },
    {
      name: "operator required",
      providerRef: null,
      observation: "none" as const,
      outcome: null,
      expectedResolution: "operator_required",
      expectedState: "outcome_unknown",
      externallyCompleted: null,
    },
  ])("reconciles retained provider evidence as $name without relaunch", async (scenario) => {
    const now = new Date("2026-08-09T12:05:00.000Z");
    const durable: PublishingDeliveryRecord = {
      ...delivery(now),
      state: "outcome_unknown" as const,
      intentDigest: digest("9"),
      providerAdapterContractDigest: providerContract.providerContractDigest,
      providerOperationRef: scenario.providerRef,
      latestEffectEvidenceDigest: digest("a"),
      effectContactStartedAt: new Date("2026-08-09T12:04:00.000Z"),
      completedAt: new Date("2026-08-09T12:04:30.000Z"),
    };
    const reconciliation: PublishingDeliveryReconciliationRequestRecord = {
      schema: "publishing-delivery-reconciliation-request/v1",
      id: "reconciliation_1",
      workspaceId: durable.workspaceId,
      deliveryId: durable.id,
      actor: { kind: "human", userId: "user_1" },
      sourceEffectKey: durable.effectKey,
      sourceEffectGeneration: durable.effectGeneration,
      sourceIntentDigest: durable.intentDigest!,
      sourceProviderAdapterContractDigest:
        durable.providerAdapterContractDigest!,
      sourceProviderOperationRef: scenario.providerRef,
      sourceEvidenceDigest: durable.latestEffectEvidenceDigest!,
      authorization: {
        schema: "publishing-delivery-recovery-authorization-session/v1",
        id: "authorization_1",
        workspaceId: durable.workspaceId,
        actor: { kind: "human", userId: "user_1" },
        capability: "publishing_deliveries.reconcile@1",
        contractDigest: digest("b"),
        admissionEvidenceRef: "admission_1",
        evidenceRef: "evidence_1",
        evidenceDigest: digest("c"),
        resources: { channelIds: [durable.channelId], artifactIds: durable.artifactIds },
        humanGrants: [{ channelId: durable.channelId, grantId: "grant_1" }],
        issuedAt: new Date("2026-08-09T12:04:50.000Z"),
        expiresAt: new Date("2026-08-09T12:06:00.000Z"),
      },
      requestedAt: new Date("2026-08-09T12:04:50.000Z"),
    };
    const lease: PublishingDeliveryExecutionLeaseRecord = {
      workspaceId: durable.workspaceId,
      deliveryId: durable.id,
      workerId: "reconcile_worker_1",
      leaseToken: "reconcile_lease_1",
      fence: BigInt(2),
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + 30_000),
      renewedAt: now,
      releasedAt: null,
    };
    const settleReconciliation = vi.fn(async (input) => {
      durable.state = scenario.expectedState as PublishingDeliveryRecord["state"];
      return {
        kind: "settled" as const,
        delivery: structuredClone(durable),
        reconciliation: structuredClone(reconciliation),
        result: {
          schema: "publishing-delivery-reconciliation-result/v1" as const,
          id: "reconciliation_result_1",
          workspaceId: durable.workspaceId,
          deliveryId: durable.id,
          reconciliationId: reconciliation.id,
          sourceEvidenceDigest: reconciliation.sourceEvidenceDigest,
          effectKey: durable.effectKey,
          effectGeneration: durable.effectGeneration,
          resolution: input.resolution,
          completedAt: input.occurredAt,
        },
        event: input.event,
      };
    });
    const repository = {
      acquireReconciliationLease: vi.fn(async () => ({
        kind: "acquired" as const,
        delivery: structuredClone(durable),
        reconciliation: structuredClone(reconciliation),
        lease: structuredClone(lease),
      })),
      renewLease: vi.fn(async () => structuredClone(lease)),
      settleReconciliation,
      getDelivery: vi.fn(async () => structuredClone(durable)),
    } as unknown as PublishingDeliveryRepository;
    const launch = vi.fn();
    const observe = vi.fn(async () => structuredClone(scenario.outcome!));
    const boundary: PublishingPlatformInvocationBoundary = {
      prepare: async () => ({
        intentDigest: durable.intentDigest!,
        ...providerContract,
        observation: scenario.observation,
        ensureContactReady: async () => undefined,
        launch,
        observe,
      }),
    };
    const service = new PublishingDeliveryExecutionService(
      repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register("linkedin", boundary),
      { now: () => now },
      readyExecution,
    );

    await expect(service.executeOne({
      workspaceId: durable.workspaceId,
      deliveryId: durable.id,
      workerId: lease.workerId,
      purpose: "reconcile",
    })).resolves.toEqual({
      deliveryId: durable.id,
      state: scenario.expectedState,
      externallyCompleted: scenario.externallyCompleted,
    });
    expect(launch).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledTimes(scenario.outcome ? 1 : 0);
    expect(settleReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      effectKey: durable.effectKey,
      effectGeneration: durable.effectGeneration,
      sourceEvidenceDigest: reconciliation.sourceEvidenceDigest,
      resolution: expect.objectContaining({ kind: scenario.expectedResolution }),
      event: expect.objectContaining({
        type: "delivery.reconciled",
        sequence: durable.nextEventSequence,
      }),
    }));
  });

  it("fails closed on a contact-time authorization revocation without launching", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const now = new Date(accepted.deliveries[0]!.publishAt);
    setup.setNow(now.toISOString());
    const launch = vi.fn(async () => ({
      kind: "succeeded" as const,
      providerOperationRef: "must_not_exist",
      outputs: {},
      evidence: {
        providerRequestId: null,
        httpStatus: null,
        providerCode: null,
        operatorTraceRef: null,
        effectDisposition: "not_created" as const,
      },
      usage: [],
    }));
    const boundary: PublishingPlatformInvocationBoundary = {
      prepare: async () => ({
        intentDigest: digest("9"),
        ...providerContract,
        ensureContactReady: async () => undefined,
        launch,
        observe: launch,
      }),
    };
    const service = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register("linkedin", boundary),
      { now: () => now },
      {
        checkCurrent: async () => ({
          kind: "blocked",
          failureCode: "EXECUTION_AUTHORIZATION_REVOKED",
          evidenceDigest: digest("4"),
        }),
      },
    );

    await service.relayNext();
    await expect(service.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "revoked_worker_1",
    })).resolves.toMatchObject({
      state: "blocked",
      externallyCompleted: false,
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "durable at-most-once",
      launchSafety: {
        mode: "durable_at_most_once" as const,
        guard: "publishing-delivery/v1" as const,
        replay: "never_launch" as const,
      },
      expectedState: "outcome_unknown",
      expectedLaunches: 0,
    },
    {
      name: "native effect-key deduplication",
      launchSafety: providerContract.launchSafety,
      expectedState: "outcome_unknown",
      expectedLaunches: 0,
    },
  ])("recovers a crash after contact with $name", async (scenario) => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    let now = new Date(accepted.deliveries[0]!.publishAt);
    setup.setNow(now.toISOString());
    const retainedIntentDigest = digest("9");
    await retainContactMarker({
      setup,
      deliveryId,
      now,
      intentDigest: retainedIntentDigest,
      providerAdapterContractDigest: providerContract.providerContractDigest,
    });
    now = new Date(now.getTime() + 2_000);
    setup.setNow(now.toISOString());
    const launch = vi.fn(async () => ({
      kind: "succeeded" as const,
      providerOperationRef: "provider_effect_deduplicated",
      outputs: {},
      evidence: {
        providerRequestId: "request_deduplicated",
        httpStatus: 200,
        providerCode: "SUCCEEDED",
        operatorTraceRef: null,
        effectDisposition: "accepted" as const,
      },
      usage: [],
    }));
    const service = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register("linkedin", {
        prepare: async () => ({
          intentDigest: retainedIntentDigest,
          providerContractDigest: providerContract.providerContractDigest,
          launchSafety: scenario.launchSafety,
          observation: "provider_operation_ref",
          ensureContactReady: async () => undefined,
          launch,
          observe: launch,
        }),
      }),
      { now: () => now },
      readyExecution,
    );

    await expect(service.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: `restart_${scenario.name.replaceAll(" ", "_")}`,
    })).resolves.toMatchObject({ state: scenario.expectedState });
    expect(launch).toHaveBeenCalledTimes(scenario.expectedLaunches);
    await expect(setup.repository.getDelivery({
      workspaceId: "workspace_1",
      deliveryId,
    })).resolves.toMatchObject({
      state: "outcome_unknown",
      nextEffectAttempt: 2,
      failureCode: "PROVIDER_CONTACT_OUTCOME_UNKNOWN",
    });
    await expect(service.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "second_restart",
    })).resolves.toMatchObject({ state: scenario.expectedState });
    expect(launch).toHaveBeenCalledTimes(scenario.expectedLaunches);
  });

  it.each([
    {
      providerDisposition: "not_created" as const,
      expectedDisposition: "not_created",
    },
    {
      providerDisposition: "terminal_failed" as const,
      expectedDisposition: "provider_failed_known",
    },
  ])("normalizes provider $providerDisposition failure identity evidence", async (scenario) => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const now = new Date(accepted.deliveries[0]!.publishAt);
    setup.setNow(now.toISOString());
    const service = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register("linkedin", {
        prepare: async () => ({
          intentDigest: digest("9"),
          ...providerContract,
          ensureContactReady: async () => undefined,
          launch: async () => ({
            kind: "failed_known",
            providerOperationRef: null,
            failureCode: "PLATFORM_TEMPORARY_FAILURE",
            retryHint: { retryable: true, retryAfterMs: 1_000 },
            evidence: {
              providerRequestId: "request_failed",
              httpStatus: 503,
              providerCode: "TEMPORARY",
              operatorTraceRef: null,
              effectDisposition: scenario.providerDisposition,
            },
            usage: [],
          }),
          observe: async () => {
            throw new TypeError("Observation must not run.");
          },
        }),
      }),
      { now: () => now },
      readyExecution,
    );
    await service.relayNext();
    await expect(service.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: `failure_${scenario.providerDisposition}`,
    })).resolves.toMatchObject({ state: "failed_transient" });
    await expect(setup.repository.getDelivery({
      workspaceId: "workspace_1",
      deliveryId,
    })).resolves.toMatchObject({
      failureEffectDisposition: scenario.expectedDisposition,
    });
  });

  it.each([
    {
      name: "unknown content exception",
      stage: "intent" as const,
      error: new Error("secret-bearing storage detail"),
      invalidIntent: false,
      malformedCredential: false,
      expectedState: "failed_terminal",
      expectedCode: "PLATFORM_CONTENT_RESOLUTION_FAILED",
    },
    {
      name: "transient content resolution",
      stage: "intent" as const,
      error: new PublishingPlatformPreparationError({
        failureCode: "CONTENT_TRANSPORT_UNAVAILABLE",
        failureClass: "transient",
        retryable: true,
      }),
      invalidIntent: false,
      malformedCredential: false,
      expectedState: "failed_transient",
      expectedCode: "CONTENT_TRANSPORT_UNAVAILABLE",
    },
    {
      name: "terminal invalid intent",
      stage: "intent" as const,
      error: null,
      invalidIntent: true,
      malformedCredential: false,
      expectedState: "failed_terminal",
      expectedCode: "PLATFORM_INTENT_INVALID",
    },
    {
      name: "transient secret transport",
      stage: "credential" as const,
      error: new PublishingPlatformContactReadinessError({
        failureCode: "CREDENTIAL_TRANSPORT_UNAVAILABLE",
        failureClass: "transient",
        retryable: true,
      }),
      invalidIntent: false,
      malformedCredential: false,
      expectedState: "failed_transient",
      expectedCode: "CREDENTIAL_TRANSPORT_UNAVAILABLE",
    },
    {
      name: "unknown secret exception",
      stage: "credential" as const,
      error: new Error("secret-bearing credential provider detail"),
      invalidIntent: false,
      malformedCredential: false,
      expectedState: "failed_terminal",
      expectedCode: "CREDENTIAL_RESOLUTION_FAILED",
    },
    {
      name: "terminal revoked credential",
      stage: "credential" as const,
      error: new PublishingPlatformContactReadinessError({
        failureCode: "CREDENTIAL_REVOKED",
        failureClass: "terminal",
        retryable: false,
      }),
      invalidIntent: false,
      malformedCredential: false,
      expectedState: "failed_terminal",
      expectedCode: "CREDENTIAL_REVOKED",
    },
    {
      name: "terminal malformed credential",
      stage: "credential" as const,
      error: null,
      invalidIntent: false,
      malformedCredential: true,
      expectedState: "failed_terminal",
      expectedCode: "CREDENTIAL_INVALID",
    },
  ])("persists safe normalized $name evidence before contact", async (scenario) => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const now = new Date(accepted.deliveries[0]!.publishAt);
    setup.setNow(now.toISOString());
    const adapter = new DeterministicLinkedInPlatformAdapter(
      new DeterministicLinkedInPlatformTransport(() => now, 1_000),
    );
    const boundary = new AdapterPublishingPlatformInvocationBoundary(
      adapter,
      (record) => {
        if (scenario.stage === "intent" && scenario.error) throw scenario.error;
        return scenario.invalidIntent
          ? ({} as DeterministicLinkedInIntent)
          : retainedFixtureIntent(record);
      },
      async () => {
        if (scenario.stage === "credential" && scenario.error) {
          throw scenario.error;
        }
        return {
          primary: {
            profileId: scenario.malformedCredential ? "" : "credential_1",
            version: 1,
            secret: "secret-canary",
          },
        };
      },
    );
    const service = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register("linkedin", boundary),
      { now: () => now },
      readyExecution,
    );
    await service.relayNext();
    await expect(service.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: `classification_${scenario.stage}_${scenario.expectedCode}`,
    })).resolves.toMatchObject({ state: scenario.expectedState });
    await expect(setup.repository.getDelivery({
      workspaceId: "workspace_1",
      deliveryId,
    })).resolves.toMatchObject({
      state: scenario.expectedState,
      failureCode: scenario.expectedCode,
      failureClass: scenario.expectedState === "failed_transient"
        ? "transient"
        : "terminal",
      failureRetryable: scenario.expectedState === "failed_transient",
      failureEffectDisposition: "not_created",
      providerOperationRef: null,
      effectContactStartedAt: null,
    });
  });

  it.each([
    {
      failureCode: "CHANNEL_UNAVAILABLE" as const,
    },
    {
      failureCode: "CREDENTIAL_UNAVAILABLE" as const,
    },
    {
      failureCode: "APPROVAL_NO_LONGER_VALID" as const,
    },
    {
      failureCode: "VALIDATION_STALE" as const,
    },
  ])("blocks $failureCode at execution readiness with zero adapter contact", async (scenario) => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const now = new Date(accepted.deliveries[0]!.publishAt);
    setup.setNow(now.toISOString());
    const transport = new DeterministicLinkedInPlatformTransport(() => now, 1_000);
    const adapter = new DeterministicLinkedInPlatformAdapter(transport);
    const readiness: PublishingDeliveryExecutionReadinessPort = {
      checkCurrent: async () => ({
        kind: "blocked",
        failureCode: scenario.failureCode,
        evidenceDigest: canonicalDigest({
          schema: "publishing-readiness-fault/v1",
          failureCode: scenario.failureCode,
        }),
      }),
    };
    const execution = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register(
        "linkedin",
        retainedFixtureBoundary(adapter),
      ),
      { now: () => now },
      readiness,
    );

    await expect(execution.relayNext()).resolves.toMatchObject({ delivered: true });
    await expect(execution.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: `readiness_${scenario.failureCode.toLowerCase()}`,
    })).resolves.toMatchObject({ state: "blocked", externallyCompleted: false });

    expect(transport.launchCalls).toHaveLength(0);
    expect(transport.observationCalls).toHaveLength(0);
    expect(transport.effects).toHaveLength(0);
    await expect(setup.repository.getDelivery({
      workspaceId: "workspace_1",
      deliveryId,
    })).resolves.toMatchObject({
      state: "blocked",
      failureCode: null,
      failureRetryable: null,
      failureEffectDisposition: null,
      readinessBlockCode: scenario.failureCode,
      readinessBlockCount: 1,
      providerOperationRef: null,
      effectContactStartedAt: null,
      nextEffectAttempt: 1,
    });
  });

  it("resumes the same blocked Delivery after readiness recovers without consuming an effect attempt", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    let now = new Date(accepted.deliveries[0]!.publishAt);
    setup.setNow(now.toISOString());
    let blocked = true;
    const readiness: PublishingDeliveryExecutionReadinessPort = {
      checkCurrent: async (input) => blocked
        ? {
            kind: "blocked",
            failureCode: "CHANNEL_UNAVAILABLE",
            evidenceDigest: digest("b"),
          }
        : {
            kind: "ready",
            session: {
              schema: "publishing-delivery-execution-readiness/v1",
              id: "readiness_resumed",
              ...input,
              mode: "launch",
              authorizationEvidenceDigest: digest("4"),
              approvalEvidenceDigest: digest("5"),
              channelEvidenceDigest: digest("6"),
              credentialEvidenceDigest: digest("7"),
              validationEvidenceDigest: digest("9"),
              evidenceDigest: digest("0"),
              evaluatedAt: input.evaluatedAt,
              expiresAt: new Date(input.evaluatedAt.getTime() + 30_000),
            },
          },
    };
    const transport = new DeterministicLinkedInPlatformTransport(() => now, 1_000);
    const execution = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register(
        "linkedin",
        retainedFixtureBoundary(new DeterministicLinkedInPlatformAdapter(transport)),
      ),
      { now: () => now },
      readiness,
    );

    await execution.relayNext();
    await expect(execution.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "readiness_block",
    })).resolves.toMatchObject({ deliveryId, state: "blocked" });
    expect(transport.launchCalls).toHaveLength(0);

    blocked = false;
    now = new Date(now.getTime() + 5_000);
    setup.setNow(now.toISOString());
    await expect(execution.relayNext()).resolves.toMatchObject({ delivered: true });
    const resumed = await execution.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "readiness_resume",
    });
    expect(resumed.deliveryId).toBe(deliveryId);
    expect(transport.launchCalls).toHaveLength(1);
    const retained = await setup.repository.getDelivery({
      workspaceId: "workspace_1",
      deliveryId,
    });
    expect(retained).toMatchObject({
      readinessBlockCode: null,
      readinessBlockCount: 0,
      nextEffectAttempt: 2,
    });
    const events = await setup.repository.listEvents({
      workspaceId: "workspace_1",
      deliveryId,
      afterSequence: 0,
      limit: 100,
    });
    expect(events?.map((event) => event.type)).toEqual(expect.arrayContaining([
      "delivery.blocked",
      "delivery.resumed",
      "effect.contact_started",
    ]));
  });

  it("normalizes an actually thrown provider timeout after contact to outcome_unknown", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const now = new Date(accepted.deliveries[0]!.publishAt);
    setup.setNow(now.toISOString());
    const launch = vi.fn(async () => {
      throw new ProviderTransportFault("timeout", "accepted", null);
    });
    const adapter = new DeterministicLinkedInPlatformAdapter({
      launch,
      observe: vi.fn(),
    });
    const execution = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register(
        "linkedin",
        retainedFixtureBoundary(adapter),
      ),
      { now: () => now },
      readyExecution,
    );

    await execution.relayNext();
    await expect(execution.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "provider_timeout_worker",
    })).resolves.toEqual({
      deliveryId,
      state: "outcome_unknown",
      externallyCompleted: null,
    });
    expect(launch).toHaveBeenCalledTimes(1);
    await expect(setup.repository.getDelivery({
      workspaceId: "workspace_1",
      deliveryId,
    })).resolves.toMatchObject({
      state: "outcome_unknown",
      failureCode: "PLATFORM_TRANSPORT_OUTCOME_UNKNOWN",
      failureEffectDisposition: "ambiguous",
      providerOperationRef: null,
      effectContactStartedAt: now,
    });
  });

  it("blocks new reconciliation and provider observation after operator-required exhaustion", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const storageKey = `workspace_1\u0000${deliveryId}`;
    const sourceEvidenceDigest = canonicalDigest({ unknown: "attempt-eight" });
    const intentDigest = canonicalDigest({ post: "retained" });
    const adapterDigest = canonicalDigest({ adapter: "linkedin-v1" });
    const current = setup.repository.deliveries.get(storageKey);
    if (!current) throw new Error("delivery required");
    setup.repository.deliveries.set(storageKey, {
      ...current,
      state: "outcome_unknown",
      intentDigest,
      providerAdapterContractDigest: adapterDigest,
      providerOperationRef: "linkedin_operation_exhaustion",
      latestEffectEvidenceDigest: sourceEvidenceDigest,
      failureCode: "PROVIDER_TIMEOUT",
      failureClass: null,
      failureRetryable: null,
      failureEffectDisposition: "ambiguous",
      nextEffectAttempt: 8,
      effectContactStartedAt: new Date("2026-08-08T12:01:00.000Z"),
      completedAt: new Date("2026-08-08T12:01:30.000Z"),
    });
    for (const outbox of setup.repository.outbox.values()) outbox.state = "delivered";
    const firstCommand = setup.recoveryInput(
      "reconcile",
      "agent",
      deliveryId,
      sourceEvidenceDigest,
    );
    if (!("expectedUnknownEvidenceDigest" in firstCommand)) {
      throw new Error("reconciliation command required");
    }
    await expect(setup.service.reconcile(firstCommand)).resolves.toMatchObject({
      status: "queued",
    });

    const observe = vi.fn(async () => ({
      kind: "outcome_unknown" as const,
      providerOperationRef: "linkedin_operation_exhaustion",
      failureCode: "PLATFORM_EFFECT_PENDING",
      pollAfterMs: 1_000,
      evidence: {
        providerRequestId: "request_attempt_eight",
        httpStatus: 202,
        providerCode: "PENDING",
        operatorTraceRef: null,
        effectDisposition: "accepted" as const,
      },
      usage: [],
    }));
    const prepare = vi.fn(async () => ({
      intentDigest,
      providerContractDigest: adapterDigest,
      launchSafety: providerContract.launchSafety,
      observation: "provider_operation_ref" as const,
      ensureContactReady: async () => undefined,
      launch: vi.fn(),
      observe,
    }));
    const execution = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register("linkedin", { prepare }),
      { now: () => new Date("2026-08-08T12:02:00.000Z") },
      readyExecution,
    );
    await expect(execution.relayNext()).resolves.toMatchObject({ delivered: true });

    await expect(execution.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "final_reconciliation_worker",
      purpose: "reconcile",
    })).resolves.toEqual({
      deliveryId,
      state: "outcome_unknown",
      externallyCompleted: null,
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    const exhausted = setup.repository.deliveries.get(storageKey)!;
    expect(exhausted).toMatchObject({
      state: "outcome_unknown",
      failureCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
      failureEffectDisposition: "ambiguous",
      nextEffectAttempt: 9,
    });
    const exhaustedEvidenceDigest = exhausted.latestEffectEvidenceDigest!;
    expect(setup.repository.events.get(storageKey)?.at(-1)).toMatchObject({
      type: "delivery.reconciled",
      evidence: {
        evidenceDigest: exhaustedEvidenceDigest,
        resolution: "operator_required",
        failureCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
      },
    });
    const outboxCount = setup.repository.outbox.size;
    const exhaustedCommand = setup.recoveryInput(
      "reconcile",
      "agent",
      deliveryId,
      exhaustedEvidenceDigest,
    );
    if (!("expectedUnknownEvidenceDigest" in exhaustedCommand)) {
      throw new Error("reconciliation command required");
    }
    await expect(setup.service.reconcile(exhaustedCommand)).rejects.toMatchObject({
      code: "PUBLISHING_DELIVERY_RECONCILIATION_NOT_AVAILABLE",
    });
    expect(setup.repository.outbox.size).toBe(outboxCount);

    await expect(execution.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "exhausted_reconciliation_worker",
      purpose: "reconcile",
    })).resolves.toEqual({
      deliveryId,
      state: "outcome_unknown",
      externallyCompleted: null,
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it("backs off a failed durable queue handoff without changing its identity", async () => {
    const now = new Date("2026-08-09T12:05:00.000Z");
    const intent = {
      ...firstOutbox(delivery(now)),
      state: "claimed" as const,
      deliveryToken: "relay_failure_token",
      deliveryAttempts: 3,
      claimedAt: now,
    };
    const releaseOutbox = vi.fn(async () => "released" as const);
    const repository = {
      claimOutbox: vi.fn(async () => ({
        kind: "claimed" as const,
        intent: structuredClone(intent),
      })),
      releaseOutbox,
    } as unknown as PublishingDeliveryRepository;
    const execution = new PublishingDeliveryExecutionService(
      repository,
      { schedule: vi.fn(async () => { throw new Error("queue unavailable"); }) },
      new PublishingPlatformRegistry(),
      { now: () => now },
      readyExecution,
    );

    await expect(execution.relayNext()).rejects.toMatchObject({
      code: "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
    });
    expect(releaseOutbox).toHaveBeenCalledWith({
      intentId: intent.id,
      deliveryToken: intent.deliveryToken,
      availableAt: new Date(now.getTime() + 4_000),
    });
  });

  it("executes an actual released Memory Delivery without replaying an old generation", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    let current = new Date("2026-08-08T11:59:00.000Z");
    const transport = new DeterministicLinkedInPlatformTransport(
      () => current,
      1_000,
    );
    const adapter = new DeterministicLinkedInPlatformAdapter(transport);
    const boundary = retainedFixtureBoundary(adapter);
    const scheduled: string[] = [];
    const execution = new PublishingDeliveryExecutionService(
      setup.repository,
      {
        schedule: async ({ dedupeKey }) => {
          scheduled.push(dedupeKey);
        },
      },
      new PublishingPlatformRegistry().register("linkedin", boundary),
      { now: () => current },
      readyExecution,
    );

    await expect(execution.relayNext()).resolves.toEqual({ delivered: false });
    expect(transport.launchCalls).toHaveLength(0);

    current = new Date(accepted.deliveries[0]!.publishAt);
    await expect(execution.relayNext()).resolves.toMatchObject({
      delivered: true,
      deliveryId,
    });
    await expect(
      execution.executeOne({
        workspaceId: "workspace_1",
        deliveryId,
        workerId: "worker_generation_1",
      }),
    ).resolves.toMatchObject({
      state: "confirmation_pending",
      externallyCompleted: null,
    });
    expect(transport.effects).toHaveLength(1);
    expect(scheduled[0]).toMatch(/:v1$/);
    const deliveryAfterLaunch = await setup.repository.getDelivery({
      workspaceId: "workspace_1",
      deliveryId,
    });
    expect(deliveryAfterLaunch).toMatchObject({
      state: "confirmation_pending",
      nextOutboxGeneration: 3,
      providerOperationRef: expect.stringMatching(/^linkedin:effect:/),
    });
    const acceptedProviderRef = deliveryAfterLaunch?.providerOperationRef;

    // A replayed generation-1 workflow cannot bypass the newer generation-2
    // observation intent while it is still pending and not due.
    await expect(
      execution.executeOne({
        workspaceId: "workspace_1",
        deliveryId,
        workerId: "worker_old_generation_replay",
      }),
    ).resolves.toMatchObject({
      state: "confirmation_pending",
      externallyCompleted: null,
    });
    expect(transport.observationCalls).toHaveLength(0);

    const pendingPoll = [...setup.repository.outbox.values()]
      .filter((item) => item.deliveryId === deliveryId)
      .sort((left, right) => right.generation - left.generation)[0]!;
    current = new Date(pendingPoll.availableAt);
    await expect(execution.relayNext()).resolves.toMatchObject({ delivered: true });
    expect(scheduled[1]).toMatch(/:v2$/);
    await expect(
      execution.executeOne({
        workspaceId: "workspace_1",
        deliveryId,
        workerId: "worker_generation_2",
      }),
    ).resolves.toEqual({
      deliveryId,
      state: "succeeded",
      externallyCompleted: true,
    });
    expect(transport.effects).toHaveLength(1);
    expect(transport.launchCalls).toHaveLength(1);
    expect(transport.observationCalls).toHaveLength(1);
    expect(transport.observationCalls[0]?.providerOperationRef).toBe(
      acceptedProviderRef,
    );
    await expect(
      setup.repository.getDelivery({
        workspaceId: "workspace_1",
        deliveryId,
      }),
    ).resolves.toMatchObject({ providerOperationRef: acceptedProviderRef });
    await expect(execution.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "worker_duplicate_provider_response",
    })).resolves.toEqual({
      deliveryId,
      state: "succeeded",
      externallyCompleted: true,
    });
    expect(transport.effects).toHaveLength(1);
    expect(transport.launchCalls).toHaveLength(1);
    expect(transport.observationCalls).toHaveLength(1);
    expect(
      (await setup.repository.listEvents({
        workspaceId: "workspace_1",
        deliveryId,
        afterSequence: 0,
        limit: 20,
      }))?.map((item) => item.type),
    ).toEqual([
      "delivery.accepted",
      "delivery.scheduled",
      "effect.prepared",
      "effect.contact_started",
      "publication.confirmation_pending",
      "publication.succeeded",
    ]);
  });

  it("can start under the exact claimed outbox before relay acknowledgement", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const current = new Date(accepted.deliveries[0]!.publishAt);
    const claimed = await setup.repository.claimOutbox({
      now: current,
      claimExpiresBefore: new Date(current.getTime() - 30_000),
      deliveryToken: "relay_race_token",
    });
    expect(claimed.kind).toBe("claimed");
    if (claimed.kind !== "claimed") throw new TypeError("Expected due outbox.");
    const transport = new DeterministicLinkedInPlatformTransport(
      () => current,
      1_000,
    );
    const execution = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register(
        "linkedin",
        retainedFixtureBoundary(
          new DeterministicLinkedInPlatformAdapter(transport),
        ),
      ),
      { now: () => current },
      readyExecution,
    );

    await expect(
      execution.executeOne({
        workspaceId: "workspace_1",
        deliveryId,
        workerId: "worker_claimed_race",
      }),
    ).resolves.toMatchObject({
      state: "confirmation_pending",
      externallyCompleted: null,
    });
    expect(transport.launchCalls).toHaveLength(1);
    await expect(
      setup.repository.markOutboxDelivered({
        intentId: claimed.intent.id,
        deliveryToken: "relay_race_token",
        deliveredAt: current,
      }),
    ).resolves.toBe("delivered");
  });

  it("preserves a known provider effect when observation preparation is temporarily unavailable", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    let current = new Date(accepted.deliveries[0]!.publishAt);
    const transport = new DeterministicLinkedInPlatformTransport(
      () => current,
      60_000,
    );
    const withAdapter = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register(
        "linkedin",
        retainedFixtureBoundary(
          new DeterministicLinkedInPlatformAdapter(transport),
        ),
      ),
      { now: () => current },
      readyExecution,
    );
    await withAdapter.relayNext();
    await expect(withAdapter.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "worker_launch",
    })).resolves.toMatchObject({ state: "confirmation_pending" });
    const launched = await setup.repository.getDelivery({
      workspaceId: "workspace_1",
      deliveryId,
    });
    const providerOperationRef = launched?.providerOperationRef;
    expect(providerOperationRef).toMatch(/^linkedin:effect:/);

    const observationPoll = [...setup.repository.outbox.values()]
      .filter((item) => item.deliveryId === deliveryId)
      .sort((left, right) => right.generation - left.generation)[0]!;
    current = new Date(observationPoll.availableAt);
    const withoutAdapter = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry(),
      { now: () => current },
      readyExecution,
    );
    await expect(withoutAdapter.relayNext()).resolves.toMatchObject({
      delivered: true,
      deliveryId,
    });
    await expect(withoutAdapter.executeOne({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "worker_observation_prepare_unavailable",
    })).resolves.toEqual({
      deliveryId,
      state: "confirmation_pending",
      externallyCompleted: null,
    });
    expect(await setup.repository.getDelivery({
      workspaceId: "workspace_1",
      deliveryId,
    })).toMatchObject({
      state: "confirmation_pending",
      providerOperationRef,
      nextOutboxGeneration: 4,
    });
    const deliveryEvents = await setup.repository.listEvents({
      workspaceId: "workspace_1",
      deliveryId,
      afterSequence: 0,
      limit: 20,
    });
    expect(deliveryEvents?.map((item) => item.type)).toEqual([
      "delivery.accepted",
      "delivery.scheduled",
      "effect.prepared",
      "effect.contact_started",
      "publication.confirmation_pending",
      "publication.confirmation_pending",
    ]);
    expect(transport.launchCalls).toHaveLength(1);
    expect(transport.observationCalls).toHaveLength(0);
  });

  it("advances two identical pending observations to a later success without stranding the Delivery", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    let current = new Date(accepted.deliveries[0]!.publishAt);
    let launchCalls = 0;
    let observationCalls = 0;
    const providerOperationRef = "linkedin_effect_repeated_pending";
    const pending = {
      kind: "outcome_unknown" as const,
      providerOperationRef,
      failureCode: "PLATFORM_EFFECT_PENDING",
      pollAfterMs: 1_000,
      evidence: {
        providerRequestId: "request_pending",
        httpStatus: 202,
        providerCode: "PENDING",
        operatorTraceRef: null,
        effectDisposition: "accepted" as const,
      },
      usage: [],
    };
    const boundary: PublishingPlatformInvocationBoundary = {
      prepare: async () => ({
        intentDigest: digest("9"),
        ...providerContract,
        ensureContactReady: async () => undefined,
        launch: async () => {
          launchCalls += 1;
          return structuredClone(pending);
        },
        observe: async () => {
          observationCalls += 1;
          return observationCalls === 1
            ? structuredClone(pending)
            : {
                kind: "succeeded" as const,
                providerOperationRef,
                outputs: { published: true },
                evidence: {
                  providerRequestId: "request_succeeded",
                  httpStatus: 200,
                  providerCode: "PUBLISHED",
                  operatorTraceRef: null,
                  effectDisposition: "accepted" as const,
                },
                usage: [],
              };
        },
      }),
    };
    const execution = new PublishingDeliveryExecutionService(
      setup.repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register("linkedin", boundary),
      { now: () => current },
      readyExecution,
    );

    await execution.relayNext();
    await expect(execution.executeOne({
      workspaceId: "workspace_1", deliveryId, workerId: "pending_worker_1",
    })).resolves.toMatchObject({ state: "confirmation_pending" });
    current = new Date(current.getTime() + 1_000);
    await execution.relayNext();
    await expect(execution.executeOne({
      workspaceId: "workspace_1", deliveryId, workerId: "pending_worker_2",
    })).resolves.toMatchObject({ state: "confirmation_pending" });
    expect(await setup.repository.getDelivery({
      workspaceId: "workspace_1", deliveryId,
    })).toMatchObject({ nextOutboxGeneration: 4, providerOperationRef });
    current = new Date(current.getTime() + 1_000);
    await execution.relayNext();
    await expect(execution.executeOne({
      workspaceId: "workspace_1", deliveryId, workerId: "pending_worker_3",
    })).resolves.toEqual({ deliveryId, state: "succeeded", externallyCompleted: true });
    expect(launchCalls).toBe(1);
    expect(observationCalls).toBe(2);
    expect((await setup.repository.listEvents({
      workspaceId: "workspace_1", deliveryId, afterSequence: 0, limit: 20,
    }))?.map((item) => item.type)).toEqual([
      "delivery.accepted",
      "delivery.scheduled",
      "effect.prepared",
      "effect.contact_started",
      "publication.confirmation_pending",
      "publication.confirmation_pending",
      "publication.succeeded",
    ]);
  });

  it("waits until publishAt, then launch -> confirmation_pending -> observe success with one effect", async () => {
    let now = new Date("2026-08-09T12:00:00.000Z");
    const publishAt = new Date("2026-08-09T12:05:00.000Z");
    const durable = delivery(publishAt);
    let outbox: PublishingDeliveryOutboxIntentRecord | null =
      firstOutbox(durable);
    let fence = BigInt(0);
    let lease: PublishingDeliveryExecutionLeaseRecord | null = null;
    const eventTypes: string[] = [];

    const repository = {
      claimOutbox: vi.fn(async (input: {
        now: Date;
        deliveryToken: string;
      }) => {
        if (
          !outbox ||
          outbox.state !== "pending" ||
          outbox.availableAt.getTime() > input.now.getTime()
        ) {
          return { kind: "empty" as const };
        }
        outbox = {
          ...outbox,
          state: "claimed",
          deliveryToken: input.deliveryToken,
          deliveryAttempts: outbox.deliveryAttempts + 1,
          claimedAt: input.now,
        };
        return { kind: "claimed" as const, intent: structuredClone(outbox) };
      }),
      markOutboxDelivered: vi.fn(async () => {
        if (!outbox) return "stale" as const;
        outbox = { ...outbox, state: "delivered", deliveredAt: now };
        return "delivered" as const;
      }),
      releaseOutbox: vi.fn(async () => "released" as const),
      acquireLease: vi.fn(async (input: {
        workerId: string;
        now: Date;
        expiresAt: Date;
      }) => {
        if (durable.publishAt.getTime() > input.now.getTime()) {
          return { kind: "not_due" as const };
        }
        if (["succeeded", "failed", "outcome_unknown"].includes(durable.state)) {
          return { kind: "terminal" as const };
        }
        fence += BigInt(1);
        lease = {
          workspaceId: durable.workspaceId,
          deliveryId: durable.id,
          workerId: input.workerId,
          leaseToken: `lease_${fence}`,
          fence,
          acquiredAt: input.now,
          expiresAt: input.expiresAt,
          renewedAt: input.now,
          releasedAt: null,
        };
        durable.state = "dispatching";
        durable.dispatchStartedAt ??= input.now;
        return {
          kind: "acquired" as const,
          delivery: structuredClone(durable),
          lease: structuredClone(lease),
        };
      }),
      renewLease: vi.fn(async () => structuredClone(lease)),
      prepareEffect: vi.fn(async (input: {
        effectKey: string;
        intentDigest: string;
        providerAdapterContractDigest: string;
        preparedAt: Date;
      }) => {
        if (durable.intentDigest && durable.intentDigest !== input.intentDigest) {
          return { kind: "unavailable" as const };
        }
        const kind = durable.intentDigest ? "replayed" : "prepared";
        durable.intentDigest = input.intentDigest;
        durable.providerAdapterContractDigest =
          input.providerAdapterContractDigest;
        const retained = event(durable, "effect.prepared", input.preparedAt);
        if (kind === "prepared") {
          eventTypes.push(retained.type);
          durable.nextEventSequence += 1;
        }
        return {
          kind,
          delivery: structuredClone(durable),
          event: retained,
        };
      }),
      beginEffectContact: vi.fn(async (input: { startedAt: Date }) => {
        const kind = durable.effectContactStartedAt ? "replayed" : "started";
        const retained = event(durable, "effect.contact_started", input.startedAt);
        if (kind === "started") {
          durable.effectContactStartedAt = input.startedAt;
          eventTypes.push(retained.type);
          durable.nextEventSequence += 1;
        }
        return {
          kind,
          delivery: structuredClone(durable),
          event: retained,
        };
      }),
      settleEffect: vi.fn(async (input: {
        outcome: {
          kind: string;
          providerOperationRef?: string | null;
          evidenceDigest: string;
          failureCode?: string;
          failureClass?: "transient" | "terminal";
        };
        retryOutboxIntent?: PublishingDeliveryOutboxIntentRecord;
        occurredAt: Date;
      }) => {
        durable.latestEffectEvidenceDigest = input.outcome.evidenceDigest;
        durable.providerOperationRef =
          input.outcome.providerOperationRef ?? durable.providerOperationRef;
        durable.failureCode = input.outcome.failureCode ?? null;
        const type =
          input.outcome.kind === "confirmation_pending"
            ? "publication.confirmation_pending"
            : input.outcome.kind === "succeeded"
              ? "publication.succeeded"
              : input.outcome.kind === "retry_scheduled"
                ? "publication.retry_scheduled"
                : input.outcome.kind === "failed"
                  ? input.outcome.failureClass === "transient"
                    ? "publication.failed_transient"
                    : "publication.failed_terminal"
                  : "publication.outcome_unknown";
        durable.state =
          input.outcome.kind === "confirmation_pending"
            ? "confirmation_pending"
            : input.outcome.kind === "retry_scheduled"
              ? "scheduled"
              : input.outcome.kind === "succeeded"
                ? "succeeded"
                : input.outcome.kind === "failed"
                  ? input.outcome.failureClass === "transient"
                    ? "failed_transient"
                    : "failed_terminal"
                  : "outcome_unknown";
        durable.updatedAt = input.occurredAt;
        if (durable.state === "succeeded") durable.completedAt = input.occurredAt;
        const retained = event(durable, type, input.occurredAt);
        eventTypes.push(retained.type);
        durable.nextEventSequence += 1;
        if (input.retryOutboxIntent) {
          outbox = structuredClone(input.retryOutboxIntent);
        }
        return {
          kind: "settled" as const,
          delivery: structuredClone(durable),
          event: retained,
        };
      }),
      getDelivery: vi.fn(async () => structuredClone(durable)),
    } as unknown as PublishingDeliveryRepository;

    const transport = new DeterministicLinkedInPlatformTransport(
      () => now,
      1_000,
    );
    const adapter = new DeterministicLinkedInPlatformAdapter(transport);
    const boundary: PublishingPlatformInvocationBoundary = {
      prepare: async (record) => {
        const platformIntent: DeterministicLinkedInIntent = {
          schema: "publishing-platform-intent/v1",
          deliveryId: record.id,
          planRevisionId: record.planRevisionId,
          planRevisionDigest: record.planRevisionDigest,
          targetId: record.targetId,
          channel: {
            id: record.channelId,
            platform: "linkedin",
            authorKind: "person",
            snapshotDigest:
              record.targetSnapshot.validation.channel.snapshotDigest,
          },
          content: {
            artifactId: "content_1",
            digest: digest("d"),
            mediaType: "text/plain; charset=utf-8",
            text: "A deterministic future publication.",
          },
          media: [],
          settings: { type: "person" },
          publishAt: record.publishAt.toISOString(),
        };
        const providerRequest = {
          intent: platformIntent,
          intentDigest: canonicalDigest(platformIntent),
          credentials: {
            primary: {
              profileId: "credential_1",
              version: 1,
              secret: "secret-canary",
            },
          },
        };
        return {
          intentDigest: providerRequest.intentDigest,
          ...providerContract,
          ensureContactReady: async () => undefined,
          launch: (effectKey) =>
            executeProviderEffect(adapter, { ...providerRequest, effectKey }),
          observe: (effectKey, providerOperationRef) =>
            observeProviderEffect(adapter, {
              ...providerRequest,
              effectKey,
              providerOperationRef,
            }),
        };
      },
    };
    const queueCalls: Array<{
      workspaceId: string;
      deliveryId: string;
      purpose: "publish" | "reconcile";
      dedupeKey: string;
    }> = [];
    const service = new PublishingDeliveryExecutionService(
      repository,
      { schedule: async (input) => void queueCalls.push(input) },
      new PublishingPlatformRegistry().register("linkedin", boundary),
      { now: () => now },
      readyExecution,
    );

    await expect(service.relayNext()).resolves.toEqual({ delivered: false });
    expect(queueCalls).toHaveLength(0);
    expect(transport.effects).toHaveLength(0);

    now = publishAt;
    await expect(service.relayNext()).resolves.toMatchObject({ delivered: true });
    expect(queueCalls).toHaveLength(1);
    expect(transport.effects).toHaveLength(0);

    await expect(
      service.executeOne({
        workspaceId: durable.workspaceId,
        deliveryId: durable.id,
        workerId: "worker_1",
      }),
    ).resolves.toEqual({
      deliveryId: durable.id,
      state: "confirmation_pending",
      externallyCompleted: null,
    });
    expect(transport.effects).toHaveLength(1);
    expect(transport.launchCalls).toHaveLength(1);
    expect(transport.observationCalls).toHaveLength(0);

    now = new Date("2026-08-09T12:05:01.000Z");
    await expect(service.relayNext()).resolves.toMatchObject({ delivered: true });
    await expect(
      service.executeOne({
        workspaceId: durable.workspaceId,
        deliveryId: durable.id,
        workerId: "worker_2",
      }),
    ).resolves.toEqual({
      deliveryId: durable.id,
      state: "succeeded",
      externallyCompleted: true,
    });
    expect(transport.effects).toHaveLength(1);
    expect(transport.launchCalls).toHaveLength(1);
    expect(transport.observationCalls).toHaveLength(1);
    expect(eventTypes).toEqual([
      "effect.prepared",
      "effect.contact_started",
      "publication.confirmation_pending",
      "publication.succeeded",
    ]);
  });

  it("durably fails before contact when adapter preparation is unavailable and restart stays terminal", async () => {
    const now = new Date("2026-08-09T12:05:00.000Z");
    const durable = delivery(now);
    const lease: PublishingDeliveryExecutionLeaseRecord = {
      workspaceId: durable.workspaceId,
      deliveryId: durable.id,
      workerId: "worker_1",
      leaseToken: "lease_1",
      fence: BigInt(1),
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + 30_000),
      renewedAt: now,
      releasedAt: null,
    };
    let terminal = false;
    const prepareEffect = vi.fn();
    const failBeforeEffect = vi.fn(async (input: {
      failureCode: string;
      evidenceDigest: string;
    }) => {
      expect(input).toMatchObject({
        failureCode: "PLATFORM_INTENT_UNAVAILABLE",
        evidenceDigest: expect.stringMatching(/^sha256:/),
      });
      terminal = true;
      durable.state = "failed_terminal";
      durable.failureCode = input.failureCode;
      durable.latestEffectEvidenceDigest = input.evidenceDigest;
      return {
        kind: "settled" as const,
        delivery: structuredClone(durable),
        event: event(durable, "effect.not_created", now),
      };
    });
    const settleEffect = vi.fn();
    const repository = {
      acquireLease: vi.fn(async () =>
        terminal
          ? ({ kind: "terminal" as const })
          : ({
              kind: "acquired" as const,
              delivery: structuredClone(durable),
              lease: structuredClone(lease),
            })),
      prepareEffect,
      failBeforeEffect,
      settleEffect,
      getDelivery: vi.fn(async () => structuredClone(durable)),
    } as unknown as PublishingDeliveryRepository;
    const service = new PublishingDeliveryExecutionService(
      repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register("linkedin", {
        prepare: async () => {
          throw new Error("secret-bearing storage failure");
        },
      }),
      { now: () => now },
      readyExecution,
    );

    await expect(
      service.executeOne({
        workspaceId: durable.workspaceId,
        deliveryId: durable.id,
        workerId: "worker_1",
      }),
    ).resolves.toEqual({
      deliveryId: durable.id,
      state: "failed_terminal",
      externallyCompleted: false,
    });
    await expect(
      service.executeOne({
        workspaceId: durable.workspaceId,
        deliveryId: durable.id,
        workerId: "worker_2",
      }),
    ).resolves.toEqual({
      deliveryId: durable.id,
      state: "failed_terminal",
      externallyCompleted: false,
    });
    expect(failBeforeEffect).toHaveBeenCalledTimes(1);
    expect(prepareEffect).not.toHaveBeenCalled();
    expect(settleEffect).not.toHaveBeenCalled();
    expect(durable.intentDigest).toBeNull();
  });

  it("blocks a retry-derived Delivery when its pinned intent or adapter contract drifts", async () => {
    const now = new Date("2026-08-09T15:00:00.000Z");
    const durable = delivery(now);
    durable.releaseId = null;
    durable.sourceDeliveryId = "delivery_source_1";
    durable.retryId = "retry_1";
    durable.intentDigest = digest("a");
    durable.providerAdapterContractDigest = digest("b");
    const lease: PublishingDeliveryExecutionLeaseRecord = {
      workspaceId: durable.workspaceId,
      deliveryId: durable.id,
      workerId: "worker_retry_drift",
      leaseToken: "lease_retry_drift",
      fence: BigInt(1),
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + 30_000),
      renewedAt: now,
      releasedAt: null,
    };
    const prepareEffect = vi.fn(async (input: {
      intentDigest: string;
      providerAdapterContractDigest: string;
    }) => input.intentDigest === durable.intentDigest &&
        input.providerAdapterContractDigest === durable.providerAdapterContractDigest
      ? ({
          kind: "prepared" as const,
          delivery: structuredClone(durable),
          event: event(durable, "effect.prepared", now),
        })
      : ({ kind: "stale" as const }));
    const repository = {
      acquireLease: vi.fn(async () => ({
        kind: "acquired" as const,
        delivery: structuredClone(durable),
        lease: structuredClone(lease),
      })),
      prepareEffect,
      getDelivery: vi.fn(async () => structuredClone(durable)),
    } as unknown as PublishingDeliveryRepository;
    const launch = vi.fn();
    const service = new PublishingDeliveryExecutionService(
      repository,
      { schedule: vi.fn() },
      new PublishingPlatformRegistry().register("linkedin", {
        prepare: async () => ({
          intentDigest: digest("c"),
          providerContractDigest: digest("d"),
          launchSafety: providerContract.launchSafety,
          observation: providerContract.observation,
          ensureContactReady: async () => undefined,
          launch,
          observe: vi.fn(),
        }),
      }),
      { now: () => now },
      readyExecution,
    );

    await expect(service.executeOne({
      workspaceId: durable.workspaceId,
      deliveryId: durable.id,
      workerId: lease.workerId,
    })).rejects.toMatchObject({
      code: "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
    });
    expect(prepareEffect).toHaveBeenCalledWith(expect.objectContaining({
      intentDigest: digest("c"),
      providerAdapterContractDigest: digest("d"),
    }));
    expect(launch).not.toHaveBeenCalled();
  });
});
