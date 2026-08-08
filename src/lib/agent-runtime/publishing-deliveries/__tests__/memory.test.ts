import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { describe, expect, it } from "vitest";
import { InMemoryPublishingDeliveryRepository } from "../memory";
import type { PublishingDeliveryRepository } from "../types";
import { setupPublishingDeliveries } from "./fixtures";

class CapturingUnavailableRepository extends InMemoryPublishingDeliveryRepository {
  captured: Parameters<PublishingDeliveryRepository["release"]>[0] | null = null;

  override async release(input: Parameters<PublishingDeliveryRepository["release"]>[0]) {
    this.captured = structuredClone(input);
    return { kind: "unavailable" as const };
  }
}

describe("InMemoryPublishingDeliveryRepository", () => {
  it("validates the full atomic release plan before mutating any durable map", async () => {
    const capture = new CapturingUnavailableRepository();
    const setup = await setupPublishingDeliveries(capture);
    await expect(setup.service.release(setup.releaseInput())).rejects.toMatchObject({
      code: "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
    });
    const planned = capture.captured!;
    const repository = new InMemoryPublishingDeliveryRepository();
    repository.seedApproval(setup.rawApproval);
    repository.setAuthorizationSessionVerifier(async () => true);
    repository.setValidationSessionVerifier(async () => true);
    planned.outboxIntents[0]!.generation = 2;

    expect(await repository.release(planned)).toEqual({ kind: "unavailable" });
    expect(repository.releases.size).toBe(0);
    expect(repository.deliveries.size).toBe(0);
    expect(repository.events.size).toBe(0);
    expect(repository.outbox.size).toBe(0);
    expect(repository.receipts.size).toBe(0);
    expect(repository.approvals.get(`workspace_1\u0000${setup.rawApproval.id}`)?.consumption).toBeNull();
  });

  it("clears queue ownership after delivery and fences stable-effect retry dispatch", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const now = new Date("2026-08-08T12:02:00.000Z");
    const claimed = await setup.repository.claimOutbox({
      now,
      claimExpiresBefore: new Date(now.getTime() - 30_000),
      deliveryToken: "queue_token_1",
    });
    expect(claimed.kind).toBe("claimed");
    if (claimed.kind !== "claimed") throw new Error("claim missing");
    expect(await setup.repository.markOutboxDelivered({
      intentId: claimed.intent.id,
      deliveryToken: "queue_token_1",
      deliveredAt: now,
    })).toBe("delivered");
    expect(setup.repository.outbox.get(claimed.intent.id)?.deliveryToken).toBeNull();

    const acquired = await setup.repository.acquireLease({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "worker_1",
      now,
      expiresAt: new Date(now.getTime() + 30_000),
    });
    expect(acquired.kind).toBe("acquired");
    if (acquired.kind !== "acquired") throw new Error("lease missing");
    const intentDigest = canonicalDigest({ target: acquired.delivery.targetSnapshot });
    const prepared = await setup.repository.prepareEffect({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: acquired.lease.workerId,
      leaseToken: acquired.lease.leaseToken,
      fence: acquired.lease.fence,
      effectKey: acquired.delivery.effectKey,
      intentDigest,
      preparedAt: now,
    });
    expect(prepared.kind).toBe("prepared");
    if (prepared.kind !== "prepared") throw new Error("prepare missing");
    const retryAt = new Date(now.getTime() + 30_000);
    const retry = await setup.repository.settleEffect({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: acquired.lease.workerId,
      leaseToken: acquired.lease.leaseToken,
      fence: acquired.lease.fence,
      effectKey: acquired.delivery.effectKey,
      intentDigest,
      outcome: {
        kind: "retry_scheduled",
        evidenceDigest: canonicalDigest({ retry: 1 }),
        failureCode: "LINKEDIN_TEMPORARY",
        retryAt,
      },
      retryOutboxIntent: {
        id: "outbox_retry_1",
        workspaceId: "workspace_1",
        deliveryId,
        dedupeKey: `publishing-delivery:workspace_1:${deliveryId}:v2`,
        generation: 2,
        state: "pending",
        availableAt: retryAt,
        deliveryToken: null,
        deliveryAttempts: 0,
        claimedAt: null,
        deliveredAt: null,
      },
      occurredAt: now,
    });
    expect(retry).toMatchObject({
      kind: "settled",
      delivery: { state: "scheduled", failureCode: "LINKEDIN_TEMPORARY" },
    });

    expect(await setup.repository.acquireLease({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "worker_2",
      now: retryAt,
      expiresAt: new Date(retryAt.getTime() + 30_000),
    })).toEqual({ kind: "not_due" });
    const retryClaim = await setup.repository.claimOutbox({
      now: retryAt,
      claimExpiresBefore: new Date(retryAt.getTime() - 30_000),
      deliveryToken: "queue_token_2",
    });
    if (retryClaim.kind !== "claimed") throw new Error("retry claim missing");
    await setup.repository.markOutboxDelivered({
      intentId: retryClaim.intent.id,
      deliveryToken: "queue_token_2",
      deliveredAt: retryAt,
    });
    const reacquired = await setup.repository.acquireLease({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "worker_2",
      now: retryAt,
      expiresAt: new Date(retryAt.getTime() + 30_000),
    });
    expect(reacquired.kind).toBe("acquired");
    if (reacquired.kind !== "acquired") throw new Error("retry lease missing");
    expect(reacquired.lease.fence).toBeGreaterThan(acquired.lease.fence);
    const reprepared = await setup.repository.prepareEffect({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: reacquired.lease.workerId,
      leaseToken: reacquired.lease.leaseToken,
      fence: reacquired.lease.fence,
      effectKey: reacquired.delivery.effectKey,
      intentDigest,
      preparedAt: retryAt,
    });
    expect(reprepared).toMatchObject({
      kind: "prepared",
      delivery: {
        state: "dispatching",
        effectKey: acquired.delivery.effectKey,
        latestEffectEvidenceDigest: null,
        failureCode: null,
      },
    });
  });

  it("records truthful pre-contact failure without fabricating an effect intent", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const now = new Date("2026-08-08T12:02:00.000Z");
    const claimed = await setup.repository.claimOutbox({ now, claimExpiresBefore: new Date(0), deliveryToken: "queue_precontact" });
    if (claimed.kind !== "claimed") throw new Error("claim missing");
    await setup.repository.markOutboxDelivered({ intentId: claimed.intent.id, deliveryToken: "queue_precontact", deliveredAt: now });
    const acquired = await setup.repository.acquireLease({
      workspaceId: "workspace_1", deliveryId, workerId: "worker_1", now,
      expiresAt: new Date(now.getTime() + 30_000),
    });
    if (acquired.kind !== "acquired") throw new Error("lease missing");
    const evidenceDigest = canonicalDigest({ code: "PLATFORM_ADAPTER_UNAVAILABLE" });
    const failed = await setup.repository.failBeforeEffect({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: acquired.lease.workerId,
      leaseToken: acquired.lease.leaseToken,
      fence: acquired.lease.fence,
      effectKey: acquired.delivery.effectKey,
      evidenceDigest,
      failureCode: "PLATFORM_ADAPTER_UNAVAILABLE",
      occurredAt: now,
    });
    expect(failed).toMatchObject({
      kind: "settled",
      delivery: { state: "failed", intentDigest: null, providerOperationRef: null },
      event: { type: "effect.not_created" },
    });
    expect((setup.repository.events.get(`workspace_1\u0000${deliveryId}`) ?? []).some((event) => event.type === "effect.prepared")).toBe(false);
  });

  it("schedules another poll under a new fence even when pending evidence is identical", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const firstAt = new Date(accepted.deliveries[0]!.publishAt);
    const firstClaim = await setup.repository.claimOutbox({
      now: firstAt,
      claimExpiresBefore: new Date(firstAt.getTime() - 30_000),
      deliveryToken: "poll_queue_1",
    });
    if (firstClaim.kind !== "claimed") throw new Error("first claim missing");
    await setup.repository.markOutboxDelivered({
      intentId: firstClaim.intent.id,
      deliveryToken: "poll_queue_1",
      deliveredAt: firstAt,
    });
    const firstLease = await setup.repository.acquireLease({
      workspaceId: "workspace_1", deliveryId, workerId: "poll_worker_1", now: firstAt,
      expiresAt: new Date(firstAt.getTime() + 30_000),
    });
    if (firstLease.kind !== "acquired") throw new Error("first lease missing");
    const intentDigest = canonicalDigest(firstLease.delivery.targetSnapshot);
    await setup.repository.prepareEffect({
      workspaceId: "workspace_1", deliveryId, workerId: firstLease.lease.workerId,
      leaseToken: firstLease.lease.leaseToken, fence: firstLease.lease.fence,
      effectKey: firstLease.delivery.effectKey, intentDigest, preparedAt: firstAt,
    });
    const evidenceDigest = canonicalDigest({ pending: true });
    const secondAt = new Date(firstAt.getTime() + 1_000);
    const firstPending = await setup.repository.settleEffect({
      workspaceId: "workspace_1", deliveryId, workerId: firstLease.lease.workerId,
      leaseToken: firstLease.lease.leaseToken, fence: firstLease.lease.fence,
      effectKey: firstLease.delivery.effectKey, intentDigest,
      outcome: { kind: "confirmation_pending", providerOperationRef: "linkedin_effect_1", evidenceDigest, pollAt: secondAt },
      retryOutboxIntent: {
        id: "poll_outbox_2", workspaceId: "workspace_1", deliveryId,
        dedupeKey: `publishing-delivery:workspace_1:${deliveryId}:v2`, generation: 2,
        state: "pending", availableAt: secondAt, deliveryToken: null,
        deliveryAttempts: 0, claimedAt: null, deliveredAt: null,
      },
      occurredAt: firstAt,
    });
    expect(firstPending.kind).toBe("settled");
    const secondClaim = await setup.repository.claimOutbox({
      now: secondAt,
      claimExpiresBefore: new Date(secondAt.getTime() - 30_000),
      deliveryToken: "poll_queue_2",
    });
    if (secondClaim.kind !== "claimed") throw new Error("second claim missing");
    await setup.repository.markOutboxDelivered({
      intentId: secondClaim.intent.id,
      deliveryToken: "poll_queue_2",
      deliveredAt: secondAt,
    });
    const secondLease = await setup.repository.acquireLease({
      workspaceId: "workspace_1", deliveryId, workerId: "poll_worker_2", now: secondAt,
      expiresAt: new Date(secondAt.getTime() + 30_000),
    });
    if (secondLease.kind !== "acquired") throw new Error("second lease missing");
    await setup.repository.prepareEffect({
      workspaceId: "workspace_1", deliveryId, workerId: secondLease.lease.workerId,
      leaseToken: secondLease.lease.leaseToken, fence: secondLease.lease.fence,
      effectKey: secondLease.delivery.effectKey, intentDigest, preparedAt: secondAt,
    });
    const thirdAt = new Date(secondAt.getTime() + 1_000);
    const secondPending = await setup.repository.settleEffect({
      workspaceId: "workspace_1", deliveryId, workerId: secondLease.lease.workerId,
      leaseToken: secondLease.lease.leaseToken, fence: secondLease.lease.fence,
      effectKey: secondLease.delivery.effectKey, intentDigest,
      outcome: { kind: "confirmation_pending", providerOperationRef: "linkedin_effect_1", evidenceDigest, pollAt: thirdAt },
      retryOutboxIntent: {
        id: "poll_outbox_3", workspaceId: "workspace_1", deliveryId,
        dedupeKey: `publishing-delivery:workspace_1:${deliveryId}:v3`, generation: 3,
        state: "pending", availableAt: thirdAt, deliveryToken: null,
        deliveryAttempts: 0, claimedAt: null, deliveredAt: null,
      },
      occurredAt: secondAt,
    });
    expect(secondPending).toMatchObject({
      kind: "settled",
      delivery: { state: "confirmation_pending", nextOutboxGeneration: 4 },
    });
    expect(setup.repository.outbox.get("poll_outbox_3")).toMatchObject({
      generation: 3,
      state: "pending",
    });
  });
});
