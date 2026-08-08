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
});
