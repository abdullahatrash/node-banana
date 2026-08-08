import { describe, expect, it } from "vitest";
import { setupPublishingDeliveries } from "./fixtures";

describe("PublishingDeliveryService", () => {
  it("atomically releases the exact approved target set into stable scheduled Deliveries", async () => {
    const setup = await setupPublishingDeliveries();
    const result = await setup.service.release(setup.releaseInput());

    expect(result).toMatchObject({
      schema: "publishing-delivery-durable-acceptance/v1",
      approvalRequestId: setup.rawApproval.id,
      approvalDecisionId: setup.rawApproval.decision!.id,
      durable: true,
      externallyCompleted: false,
      deliveries: [{
        targetId: "target_1",
        channelId: "channel_linkedin",
        state: "scheduled",
        externallyCompleted: false,
      }],
    });
    expect(setup.repository.releases.size).toBe(1);
    expect(setup.repository.deliveries.size).toBe(1);
    expect(setup.repository.outbox.size).toBe(1);
    expect([...setup.repository.events.values()][0]?.map((event) => event.type)).toEqual([
      "delivery.accepted",
      "delivery.scheduled",
    ]);
    expect(setup.repository.approvals.get(`workspace_1\u0000${setup.rawApproval.id}`)?.consumption).not.toBeNull();
  });

  it("replays the immutable Durable Acceptance after later external completion", async () => {
    const setup = await setupPublishingDeliveries();
    const first = await setup.service.release(setup.releaseInput());
    const delivery = [...setup.repository.deliveries.values()][0]!;
    setup.repository.deliveries.set(`workspace_1\u0000${delivery.id}`, {
      ...delivery,
      state: "succeeded",
      providerOperationRef: "linkedin_post_1",
      latestEffectEvidenceDigest: `sha256:${"a".repeat(64)}`,
      completedAt: new Date("2026-08-08T12:02:00.000Z"),
    });

    const replay = await setup.service.release(setup.releaseInput());
    expect(replay).toEqual(first);
    expect(replay.deliveries[0]).toMatchObject({
      state: "scheduled",
      externallyCompleted: false,
    });
  });

  it("fails closed instead of replaying malformed persisted acceptance", async () => {
    const setup = await setupPublishingDeliveries();
    const first = await setup.service.release(setup.releaseInput());
    const release = setup.repository.releases.get(`workspace_1\u0000${first.releaseId}`)!;
    setup.repository.releases.set(`workspace_1\u0000${first.releaseId}`, {
      ...release,
      acceptedDeliveries: release.acceptedDeliveries.map((item) => ({
        ...item,
        externallyCompleted: true as false,
      })),
    });
    await expect(setup.service.release(setup.releaseInput())).rejects.toMatchObject({
      code: "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE",
    });
  });

  it("uses caller manifests only as exact authorization assertions and cannot retarget", async () => {
    const setup = await setupPublishingDeliveries();
    await expect(setup.service.release({
      ...setup.releaseInput(),
      channelIds: ["channel_other"],
    })).rejects.toMatchObject({ code: "PUBLISHING_DELIVERY_AUTHORIZATION_STALE" });
    expect(setup.repository.releases.size).toBe(0);
  });

  it("independently rejects stale authorization and stale Publish Validation", async () => {
    const authorization = await setupPublishingDeliveries();
    authorization.setAuthorizationCurrent(false);
    await expect(authorization.service.release(authorization.releaseInput())).rejects.toMatchObject({
      code: "PUBLISHING_DELIVERY_AUTHORIZATION_STALE",
    });

    const validation = await setupPublishingDeliveries();
    validation.setValidationCurrent(false);
    await expect(validation.service.release(validation.releaseInput())).rejects.toMatchObject({
      code: "PUBLISHING_DELIVERY_VALIDATION_STALE",
    });
  });

  it("scopes idempotency to the exact manifest and returns the original Delivery set", async () => {
    const setup = await setupPublishingDeliveries();
    const first = await setup.service.release({
      ...setup.releaseInput(),
      artifactIds: [...setup.releaseInput().artifactIds].reverse(),
    });
    expect(await setup.service.release(setup.releaseInput())).toEqual(first);
    await expect(setup.service.release({
      ...setup.releaseInput(),
      artifactIds: ["artifact_text"],
    })).rejects.toMatchObject({ code: "PUBLISHING_DELIVERY_IDEMPOTENCY_CONFLICT" });
  });

  it("requester-scopes inspect, list, and retained event evidence", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const resources = {
      authorizedChannelIds: setup.rawApproval.channelIds,
      authorizedArtifactIds: setup.rawApproval.artifactIds,
    };
    expect(await setup.service.get({ workspaceId: "workspace_1", principalId: "principal_1", deliveryId, ...resources })).toMatchObject({ id: deliveryId, state: "scheduled", externallyCompleted: false });
    expect(await setup.service.list({ workspaceId: "workspace_1", principalId: "principal_1", filters: {}, limit: 10, ...resources })).toHaveLength(1);
    expect((await setup.service.listEvents({ workspaceId: "workspace_1", principalId: "principal_1", deliveryId, afterSequence: 0, limit: 10, ...resources })).map((event) => event.type)).toEqual(["delivery.accepted", "delivery.scheduled"]);
    await expect(setup.service.get({ workspaceId: "workspace_1", principalId: "principal_2", deliveryId, ...resources })).rejects.toMatchObject({ code: "PUBLISHING_DELIVERY_NOT_FOUND" });
  });

  it("supports canonical punctuated Artifact IDs across release, inspect, list, and retained events", async () => {
    const setup = await setupPublishingDeliveries(undefined, {
      punctuatedArtifacts: true,
    });
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const resources = {
      authorizedChannelIds: setup.rawApproval.channelIds,
      authorizedArtifactIds: ["artifact:text.v1", "artifact:image.v1"],
    };
    expect((await setup.service.get({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      deliveryId,
      ...resources,
    })).artifactIds).toEqual(["artifact:text.v1", "artifact:image.v1"]);
    expect(await setup.service.list({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      filters: {},
      limit: 10,
      ...resources,
    })).toHaveLength(1);
    expect(await setup.service.listEvents({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      deliveryId,
      afterSequence: 0,
      limit: 10,
      ...resources,
    })).toHaveLength(2);
  });

  it("intrinsically cancels before effect contact and replays one immutable result", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const input = setup.cancellationInput("agent", deliveryId);

    const first = await setup.service.cancel(input);
    const replay = await setup.service.cancel(input);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      schema: "publishing-delivery-cancellation/v1",
      deliveryId,
      desiredState: "cancel",
      stateAtRequest: "scheduled",
      outcome: "prevented",
      externallyCompletedAtRequest: false,
      durable: true,
      externallyReversed: false,
    });
    expect(setup.repository.deliveries.get(`workspace_1\u0000${deliveryId}`)).toMatchObject({
      desiredState: "cancel",
      state: "cancelled",
      effectContactStartedAt: null,
    });
    expect(setup.repository.cancellations.size).toBe(1);
    expect(setup.repository.events.get(`workspace_1\u0000${deliveryId}`)?.map((event) => event.type)).toEqual([
      "delivery.accepted",
      "delivery.scheduled",
      "delivery.cancellation_requested",
      "delivery.cancelled",
    ]);
  });

  it("requires exact resources and current explicit authority for Agent or Human cancellation", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    await expect(setup.service.cancel({
      ...setup.cancellationInput("agent", deliveryId),
      artifactIds: [...setup.rawApproval.artifactIds, "artifact_unrelated"],
    })).rejects.toMatchObject({ code: "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED" });
    setup.setCancellationAuthorizationCurrent(false);
    await expect(setup.service.cancel(
      setup.cancellationInput("human", deliveryId),
    )).rejects.toMatchObject({ code: "PUBLISHING_DELIVERY_CANCELLATION_NOT_AUTHORIZED" });
    setup.setCancellationAuthorizationCurrent(true);
    expect(await setup.service.cancel(
      setup.cancellationInput("human", deliveryId),
    )).toMatchObject({ outcome: "prevented" });
  });

  it("returns conditional without claiming reversal after provider acceptance", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const deliveryKey = `workspace_1\u0000${deliveryId}`;
    const delivery = setup.repository.deliveries.get(deliveryKey)!;
    setup.repository.deliveries.set(deliveryKey, {
      ...delivery,
      state: "confirmation_pending",
      intentDigest: `sha256:${"a".repeat(64)}`,
      providerOperationRef: "linkedin_operation_1",
      effectContactStartedAt: new Date("2026-08-08T12:01:05.000Z"),
    });

    const result = await setup.service.cancel(
      setup.cancellationInput("agent", deliveryId),
    );
    expect(result).toMatchObject({
      stateAtRequest: "confirmation_pending",
      outcome: "conditional",
      externallyCompletedAtRequest: null,
      externallyReversed: false,
    });
    expect(setup.repository.deliveries.get(deliveryKey)).toMatchObject({
      desiredState: "cancel",
      state: "confirmation_pending",
      providerOperationRef: "linkedin_operation_1",
    });
  });

  it("terminalizes an abandoned contacted retry as unknown and never calls it prevented", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const deliveryKey = `workspace_1\u0000${deliveryId}`;
    const delivery = setup.repository.deliveries.get(deliveryKey)!;
    setup.repository.deliveries.set(deliveryKey, {
      ...delivery,
      state: "scheduled",
      intentDigest: `sha256:${"a".repeat(64)}`,
      effectContactStartedAt: new Date("2026-08-08T12:01:05.000Z"),
      latestEffectEvidenceDigest: `sha256:${"b".repeat(64)}`,
      failureCode: "PROVIDER_RETRYABLE",
    });

    const result = await setup.service.cancel(
      setup.cancellationInput("agent", deliveryId),
    );
    expect(result).toMatchObject({
      stateAtRequest: "scheduled",
      outcome: "unknown",
      externallyCompletedAtRequest: null,
    });
    expect(setup.repository.deliveries.get(deliveryKey)).toMatchObject({
      desiredState: "cancel",
      state: "outcome_unknown",
      failureCode: "CANCELLED_AFTER_EFFECT_CONTACT",
    });
  });

  it("replays the original cancellation for the same actor after authority changes", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const input = setup.cancellationInput("human", deliveryId);
    const first = await setup.service.cancel(input);
    setup.setCancellationAuthorizationCurrent(false);
    setup.setNow("2026-08-08T14:00:00.000Z");
    expect(await setup.service.cancel(input)).toEqual(first);
  });

  it("keeps an active contacted worker settle-capable while returning unknown", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const deliveryKey = `workspace_1\u0000${deliveryId}`;
    const delivery = setup.repository.deliveries.get(deliveryKey)!;
    setup.repository.deliveries.set(deliveryKey, {
      ...delivery,
      state: "dispatching",
      intentDigest: `sha256:${"a".repeat(64)}`,
      dispatchStartedAt: new Date("2026-08-08T12:01:01.000Z"),
      effectContactStartedAt: new Date("2026-08-08T12:01:02.000Z"),
    });
    setup.repository.leases.set(deliveryKey, {
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "worker_1",
      leaseToken: "lease_1",
      fence: BigInt(1),
      acquiredAt: new Date("2026-08-08T12:01:00.000Z"),
      expiresAt: new Date("2026-08-08T12:02:00.000Z"),
      renewedAt: new Date("2026-08-08T12:01:00.000Z"),
      releasedAt: null,
    });

    const result = await setup.service.cancel(
      setup.cancellationInput("agent", deliveryId),
    );
    expect(result).toMatchObject({ stateAtRequest: "dispatching", outcome: "unknown" });
    expect(setup.repository.deliveries.get(deliveryKey)).toMatchObject({
      desiredState: "cancel",
      state: "dispatching",
    });
    expect(setup.repository.leases.get(deliveryKey)?.releasedAt).toBeNull();
  });

  it("leaves no partial cancellation evidence when the durable mutation fails", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const deliveryKey = `workspace_1\u0000${deliveryId}`;
    setup.repository.failNextMutation = true;
    await expect(setup.service.cancel(
      setup.cancellationInput("agent", deliveryId),
    )).rejects.toMatchObject({ code: "PUBLISHING_DELIVERY_PERSISTENCE_UNAVAILABLE" });
    expect(setup.repository.cancellations.size).toBe(0);
    expect(setup.repository.deliveries.get(deliveryKey)).toMatchObject({
      desiredState: "publish",
      state: "scheduled",
    });
    expect(setup.repository.events.get(deliveryKey)).toHaveLength(2);
  });
});
