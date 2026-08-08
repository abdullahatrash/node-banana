import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  executeProviderEffect,
  observeProviderEffect,
} from "../../runs/provider-adapter";
import {
  DeterministicLinkedInPlatformAdapter,
  DeterministicLinkedInPlatformTransport,
  type DeterministicLinkedInIntent,
} from "@/lib/provider-adapters/publishing/deterministic-linkedin";
import { describe, expect, it, vi } from "vitest";
import { PublishingDeliveryExecutionService } from "../execution";
import {
  AdapterPublishingPlatformInvocationBoundary,
  PublishingPlatformRegistry,
  type PublishingPlatformInvocationBoundary,
} from "../platform-registry";
import type {
  PublishingDeliveryEvent,
  PublishingDeliveryExecutionLeaseRecord,
  PublishingDeliveryOutboxIntentRecord,
  PublishingDeliveryRecord,
  PublishingDeliveryRepository,
} from "../types";
import { setupPublishingDeliveries } from "./fixtures";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function delivery(publishAt: Date): PublishingDeliveryRecord {
  return {
    id: "delivery_1",
    workspaceId: "workspace_1",
    releaseId: "release_1",
    planId: "plan_1",
    planRevisionId: "revision_1",
    planRevision: 1,
    planRevisionDigest: digest("a"),
    approvalRequestId: "approval_1",
    approvalDecisionId: "decision_1",
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
    intentDigest: null,
    providerOperationRef: null,
    latestEffectEvidenceDigest: null,
    failureCode: null,
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

function retainedFixtureBoundary(
  adapter: DeterministicLinkedInPlatformAdapter,
): PublishingPlatformInvocationBoundary {
  return new AdapterPublishingPlatformInvocationBoundary(
    adapter,
    (record): DeterministicLinkedInIntent => {
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
    },
    async () => ({
      primary: {
        profileId: "credential_1",
        version: 1,
        secret: "memory-e2e-secret-canary",
      },
    }),
  );
}

describe("Publishing Delivery scheduler and fenced worker", () => {
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
      externallyCompleted: false,
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
      externallyCompleted: false,
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
    );

    await expect(
      execution.executeOne({
        workspaceId: "workspace_1",
        deliveryId,
        workerId: "worker_claimed_race",
      }),
    ).resolves.toMatchObject({
      state: "confirmation_pending",
      externallyCompleted: false,
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
      externallyCompleted: false,
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
        preparedAt: Date;
      }) => {
        if (durable.intentDigest && durable.intentDigest !== input.intentDigest) {
          return { kind: "unavailable" as const };
        }
        const kind = durable.intentDigest ? "replayed" : "prepared";
        durable.intentDigest = input.intentDigest;
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
                  ? "publication.failed"
                  : "publication.outcome_unknown";
        durable.state =
          input.outcome.kind === "confirmation_pending"
            ? "confirmation_pending"
            : input.outcome.kind === "retry_scheduled"
              ? "scheduled"
              : input.outcome.kind === "succeeded"
                ? "succeeded"
                : input.outcome.kind === "failed"
                  ? "failed"
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
      dedupeKey: string;
    }> = [];
    const service = new PublishingDeliveryExecutionService(
      repository,
      { schedule: async (input) => void queueCalls.push(input) },
      new PublishingPlatformRegistry().register("linkedin", boundary),
      { now: () => now },
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
      externallyCompleted: false,
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
      durable.state = "failed";
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
    );

    await expect(
      service.executeOne({
        workspaceId: durable.workspaceId,
        deliveryId: durable.id,
        workerId: "worker_1",
      }),
    ).resolves.toEqual({
      deliveryId: durable.id,
      state: "failed",
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
      state: "failed",
      externallyCompleted: false,
    });
    expect(failBeforeEffect).toHaveBeenCalledTimes(1);
    expect(prepareEffect).not.toHaveBeenCalled();
    expect(settleEffect).not.toHaveBeenCalled();
    expect(durable.intentDigest).toBeNull();
  });
});
