import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { describe, expect, it } from "vitest";
import type { PublishingApprovalRequestRecord } from "../../publishing-approvals/types";
import type {
  PublishingDeliveryEvent,
  PublishingDeliveryRecord,
} from "../types";
import {
  PUBLISHING_DELIVERY_EFFECT_KEY_PATTERN,
  publishingDeliveryEffectKey,
} from "../keys";
import { setupPublishingDeliveries } from "./fixtures";

function seedFreshRetryApproval(input: {
  raw: PublishingApprovalRequestRecord;
  repository: { seedApproval(value: PublishingApprovalRequestRecord): void };
  approvalRequestId?: string;
  approvalDecisionId?: string;
  deliveryId: string;
  evidenceDigest: string;
}): PublishingApprovalRequestRecord {
  const approval = structuredClone(input.raw);
  approval.id = input.approvalRequestId ?? "approval_retry_1";
  approval.createdAt = new Date("2026-08-08T12:00:30.000Z");
  approval.consumption = null;
  if (!approval.decision) throw new Error("approved fixture required");
  approval.decision.id = input.approvalDecisionId ?? "approval_retry_decision_1";
  approval.decision.approvalRequestId = approval.id;
  approval.decision.decidedAt = new Date("2026-08-08T12:00:45.000Z");
  approval.retrySource = {
    deliveryId: input.deliveryId,
    evidenceDigest: input.evidenceDigest,
  };
  input.repository.seedApproval(approval);
  return approval;
}

function overwriteDelivery(
  setup: Awaited<ReturnType<typeof setupPublishingDeliveries>>,
  deliveryId: string,
  value: Partial<PublishingDeliveryRecord>,
) {
  const storageKey = `workspace_1\u0000${deliveryId}`;
  const current = setup.repository.deliveries.get(storageKey);
  if (!current) throw new Error("delivery fixture required");
  setup.repository.deliveries.set(storageKey, { ...current, ...value });
  return setup.repository.deliveries.get(storageKey)!;
}

describe("Publishing Delivery recovery core", () => {
  it("accepts every derived effect generation emitted by the key constructor", () => {
    for (const generation of [2, 9, 10, 19, 20, 999]) {
      expect(
        PUBLISHING_DELIVERY_EFFECT_KEY_PATTERN.test(
          publishingDeliveryEffectKey("workspace_1", "delivery_1", generation),
        ),
      ).toBe(true);
    }
  });

  it("retries only normalized transient not-created evidence under a fresh exact Approval", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const sourceEvidenceDigest = canonicalDigest({ failure: "adapter unavailable" });
    const now = new Date("2026-08-08T12:01:30.000Z");
    const claimed = await setup.repository.claimOutbox({
      now,
      claimExpiresBefore: new Date(0),
      deliveryToken: "queue_not_created",
    });
    if (claimed.kind !== "claimed") throw new Error("claim required");
    await setup.repository.markOutboxDelivered({
      intentId: claimed.intent.id,
      deliveryToken: "queue_not_created",
      deliveredAt: now,
    });
    const acquired = await setup.repository.acquireLease({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "worker_not_created",
      now,
      expiresAt: new Date(now.getTime() + 30_000),
    });
    if (acquired.kind !== "acquired") throw new Error("lease required");
    const intentDigest = canonicalDigest({ target: acquired.delivery.targetSnapshot });
    const adapterDigest = canonicalDigest({ adapter: "linkedin-test-v1" });
    const prepared = await setup.repository.prepareEffect({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: acquired.lease.workerId,
      leaseToken: acquired.lease.leaseToken,
      fence: acquired.lease.fence,
      effectKey: acquired.delivery.effectKey,
      intentDigest,
      providerAdapterContractDigest: adapterDigest,
      preparedAt: now,
    });
    if (prepared.kind !== "prepared") throw new Error("prepare required");
    const settled = await setup.repository.settleEffect({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: acquired.lease.workerId,
      leaseToken: acquired.lease.leaseToken,
      fence: acquired.lease.fence,
      effectKey: acquired.delivery.effectKey,
      intentDigest,
      outcome: {
        kind: "failed",
        providerOperationRef: null,
        evidenceDigest: sourceEvidenceDigest,
        failureCode: "PLATFORM_ADAPTER_UNAVAILABLE",
        failureClass: "transient",
        retryable: true,
        effectDisposition: "not_created",
      },
      occurredAt: now,
    });
    expect(settled).toMatchObject({
      kind: "settled",
      delivery: {
        state: "failed_transient",
        failureEffectDisposition: "not_created",
      },
      event: {
        type: "publication.failed_transient",
        evidence: { effectDisposition: "not_created" },
      },
    });
    if (settled.kind !== "settled") throw new Error("settlement required");
    const before = settled.delivery;
    seedFreshRetryApproval({ raw: setup.rawApproval, repository: setup.repository, deliveryId, evidenceDigest: sourceEvidenceDigest });

    const command = setup.recoveryInput(
      "retry",
      "human",
      deliveryId,
      sourceEvidenceDigest,
    );
    if (!("approvalRequestId" in command)) throw new Error("retry command required");
    const first = await setup.service.retry(command);
    const replay = await setup.service.retry(command);

    expect(replay).toEqual(first);
    await expect(setup.service.retry({
      ...command,
      idempotencyKey: "different-retry-key",
    })).rejects.toMatchObject({ code: "PUBLISHING_DELIVERY_RETRY_NOT_SAFE" });
    expect(setup.repository.retryMutationReceipts.size).toBe(1);
    expect(first).toMatchObject({
      schema: "publishing-delivery-retry/v1",
      sourceDeliveryId: deliveryId,
      sourceEvidenceDigest,
      delivery: {
        state: "scheduled",
        externallyCompleted: false,
      },
      durable: true,
      externallyCompleted: false,
    });
    expect(first.delivery.id).not.toBe(deliveryId);
    expect(first.delivery.effectKey).not.toBe(before.effectKey);
    expect(setup.repository.deliveries.get(`workspace_1\u0000${deliveryId}`)).toMatchObject({
      state: "failed_transient",
      effectKey: before.effectKey,
      effectGeneration: 1,
      latestEffectEvidenceDigest: sourceEvidenceDigest,
      failureClass: "transient",
      failureRetryable: true,
      failureEffectDisposition: "not_created",
    });
    expect(setup.repository.deliveries.get(
      `workspace_1\u0000${first.delivery.id}`,
    )).toMatchObject({
      sourceDeliveryId: deliveryId,
      retryId: first.retryId,
      approvalRequestId: "approval_retry_1",
      approvalDecisionId: "approval_retry_decision_1",
      state: "scheduled",
    });
    expect(setup.repository.events.get(`workspace_1\u0000${deliveryId}`)?.some(
      (event) => event.type === "delivery.retry_requested",
    )).toBe(false);
    expect(setup.repository.events.get(
      `workspace_1\u0000${first.delivery.id}`,
    )?.map((event) => event.type)).toEqual([
      "delivery.accepted",
      "delivery.retry_requested",
      "delivery.scheduled",
    ]);
    expect(setup.repository.retryApprovalConsumptions.size).toBe(1);
    expect(setup.repository.retries.size).toBe(1);
    expect([...setup.repository.retries.values()][0]).toMatchObject({
      sourceDeliveryId: deliveryId,
      deliveryId: first.delivery.id,
      actor: { kind: "human", userId: "owner_1" },
      authorization: {
        capability: "publishing_deliveries.retry@1",
        resources: {
          channelIds: setup.rawApproval.channelIds,
          artifactIds: setup.rawApproval.artifactIds,
        },
        humanGrants: [{ channelId: setup.rawApproval.channelIds[0] }],
      },
    });

    setup.setRecoveryAuthorizationCurrent(false);
    await expect(setup.service.retry(command)).rejects.toMatchObject({
      code: "PUBLISHING_DELIVERY_RECOVERY_NOT_AUTHORIZED",
    });
    setup.setRecoveryAuthorizationCurrent(true);

    const otherActor = setup.recoveryInput(
      "retry",
      "agent",
      deliveryId,
      sourceEvidenceDigest,
    );
    if (!("approvalRequestId" in otherActor)) throw new Error("retry command required");
    await expect(setup.service.retry(otherActor)).rejects.toMatchObject({
      code: "PUBLISHING_DELIVERY_RETRY_NOT_SAFE",
    });
    expect(setup.repository.retries.size).toBe(1);
    expect(setup.repository.deliveries.size).toBe(2);

    await expect(setup.service.retry({
      ...command,
      artifactIds: ["artifact_other"],
    })).rejects.toMatchObject({ code: "PUBLISHING_DELIVERY_IDEMPOTENCY_CONFLICT" });
  });

  it("creates a fresh effect identity after normalized provider-failed-known evidence", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const sourceEvidenceDigest = canonicalDigest({ failure: "provider known" });
    const intentDigest = canonicalDigest({ post: "stable" });
    const adapterDigest = canonicalDigest({ adapter: "linkedin-v1" });
    const before = overwriteDelivery(setup, deliveryId, {
      state: "failed_transient",
      intentDigest,
      providerAdapterContractDigest: adapterDigest,
      effectContactStartedAt: new Date("2026-08-08T12:01:10.000Z"),
      latestEffectEvidenceDigest: sourceEvidenceDigest,
      failureCode: "LINKEDIN_TEMPORARY",
      failureClass: "transient",
      failureRetryable: true,
      failureEffectDisposition: "provider_failed_known",
      completedAt: new Date("2026-08-08T12:01:30.000Z"),
    });
    seedFreshRetryApproval({ raw: setup.rawApproval, repository: setup.repository, deliveryId, evidenceDigest: sourceEvidenceDigest });
    const command = setup.recoveryInput(
      "retry",
      "agent",
      deliveryId,
      sourceEvidenceDigest,
    );
    if (!("approvalRequestId" in command)) throw new Error("retry command required");

    const result = await setup.service.retry(command);

    expect(result.delivery.effectKey).not.toBe(before.effectKey);
    expect(setup.repository.deliveries.get(
      `workspace_1\u0000${result.delivery.id}`,
    )).toMatchObject({
      releaseId: null,
      sourceDeliveryId: deliveryId,
      retryId: result.retryId,
      intentDigest,
      providerAdapterContractDigest: adapterDigest,
    });
    expect(setup.repository.effectIdentities.get(
      `workspace_1\u0000${result.delivery.id}\u00001`,
    )).toMatchObject({
      generation: 1,
      parentEffectKey: null,
      parentGeneration: null,
      sourceEvidenceDigest,
      derivation: "manual_retry",
    });
  });

  it("allows a fresh-Approval derived Delivery for known terminal failure", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const evidenceDigest = canonicalDigest({ state: "failed_terminal" });
    overwriteDelivery(setup, deliveryId, {
      state: "failed_terminal",
      latestEffectEvidenceDigest: evidenceDigest,
      failureCode: "PROVIDER_REJECTED",
      failureClass: "terminal",
      failureRetryable: false,
      failureEffectDisposition: "provider_failed_known",
    });
    seedFreshRetryApproval({ raw: setup.rawApproval, repository: setup.repository, deliveryId, evidenceDigest });
    const command = setup.recoveryInput("retry", "agent", deliveryId, evidenceDigest);
    if (!("approvalRequestId" in command)) throw new Error("retry command required");
    const result = await setup.service.retry(command);
    expect(result.sourceDeliveryId).toBe(deliveryId);
    expect(result.delivery.id).not.toBe(deliveryId);
    expect(setup.repository.deliveries.get(`workspace_1\u0000${deliveryId}`)?.state)
      .toBe("failed_terminal");
  });

  it("creates a retry chain without mutating either terminal source Delivery", async () => {
    const setup = await setupPublishingDeliveries();
    const released = await setup.service.release(setup.releaseInput());
    const source1Id = released.deliveries[0]!.id;
    const evidence1 = canonicalDigest({ failure: "first" });
    overwriteDelivery(setup, source1Id, {
      state: "failed_terminal",
      latestEffectEvidenceDigest: evidence1,
      failureCode: "FIRST_KNOWN_FAILURE",
      failureClass: "terminal",
      failureRetryable: false,
      failureEffectDisposition: "provider_failed_known",
    });
    seedFreshRetryApproval({ raw: setup.rawApproval, repository: setup.repository, deliveryId: source1Id, evidenceDigest: evidence1 });
    const command1 = setup.recoveryInput("retry", "agent", source1Id, evidence1);
    if (!("approvalRequestId" in command1)) throw new Error("retry command required");
    const retry1 = await setup.service.retry(command1);

    const source2Id = retry1.delivery.id;
    const evidence2 = canonicalDigest({ failure: "second" });
    overwriteDelivery(setup, source2Id, {
      state: "failed_transient",
      latestEffectEvidenceDigest: evidence2,
      failureCode: "SECOND_KNOWN_FAILURE",
      failureClass: "transient",
      failureRetryable: true,
      failureEffectDisposition: "provider_failed_known",
      completedAt: new Date("2026-08-08T12:02:00.000Z"),
    });
    seedFreshRetryApproval({
      raw: setup.rawApproval,
      repository: setup.repository,
      approvalRequestId: "approval_retry_2",
      approvalDecisionId: "approval_retry_decision_2",
      deliveryId: source2Id,
      evidenceDigest: evidence2,
    });
    const retryCommand2 = setup.recoveryInput("retry", "human", source2Id, evidence2);
    if (!("approvalRequestId" in retryCommand2)) throw new Error("retry command required");
    const command2 = {
      ...retryCommand2,
      approvalRequestId: "approval_retry_2",
    };
    const retry2 = await setup.service.retry(command2);

    expect(retry2.sourceDeliveryId).toBe(source2Id);
    expect(retry2.delivery.id).not.toBe(source2Id);
    expect(setup.repository.deliveries.get(`workspace_1\u0000${source1Id}`))
      .toMatchObject({ state: "failed_terminal", latestEffectEvidenceDigest: evidence1 });
    expect(setup.repository.deliveries.get(`workspace_1\u0000${source2Id}`))
      .toMatchObject({ state: "failed_transient", latestEffectEvidenceDigest: evidence2 });
    expect(setup.repository.deliveries.get(
      `workspace_1\u0000${retry2.delivery.id}`,
    )).toMatchObject({
      sourceDeliveryId: source2Id,
      retryId: retry2.retryId,
      releaseId: null,
      approvalRequestId: "approval_retry_2",
      approvalDecisionId: "approval_retry_decision_2",
    });
  });

  it("creates and decides a due recovery-bound Approval before accepting the retry", async () => {
    const setup = await setupPublishingDeliveries();
    const released = await setup.service.release(setup.releaseInput());
    const sourceDeliveryId = released.deliveries[0]!.id;
    const evidenceDigest = canonicalDigest({ failure: "human-approved-recovery" });
    const source = overwriteDelivery(setup, sourceDeliveryId, {
      state: "failed_terminal",
      latestEffectEvidenceDigest: evidenceDigest,
      failureCode: "KNOWN_PROVIDER_FAILURE",
      failureClass: "terminal",
      failureRetryable: false,
      failureEffectDisposition: "provider_failed_known",
      completedAt: new Date("2026-08-08T12:06:00.000Z"),
    });
    setup.approvals.setNow("2026-08-08T12:06:00.000Z");
    setup.setNow("2026-08-08T12:06:00.000Z");
    const recoveryRequest = {
      ...setup.approvals.requestInput(),
      idempotencyKey: "approval-retry-real-flow",
      retrySource: { deliveryId: sourceDeliveryId, evidenceDigest },
    };

    await expect(setup.approvals.service.request({
      ...recoveryRequest,
      idempotencyKey: "approval-retry-forged",
    })).rejects.toMatchObject({ code: "PUBLISHING_APPROVAL_STALE_VALIDATION" });

    setup.approvals.repository.seedRetrySource({
      workspaceId: source.workspaceId,
      deliveryId: source.id,
      evidenceDigest,
      desiredState: "publish",
      state: "failed_terminal",
      failureClass: "terminal",
      retryable: false,
      planId: source.planId,
      planRevisionId: source.planRevisionId,
      planRevision: source.planRevision,
      planRevisionDigest: source.planRevisionDigest,
      targetId: source.targetId,
      channelId: source.channelId,
      artifactIds: [...source.artifactIds],
      requestingPrincipalId: source.requestingPrincipalId,
    });
    const requested = await setup.approvals.service.request(recoveryRequest);
    expect(requested.retrySource).toEqual({ deliveryId: sourceDeliveryId, evidenceDigest });
    expect(setup.approvals.validationModes.at(-1)).toBe("retry_due");
    const approved = await setup.approvals.service.decide({
      workspaceId: source.workspaceId,
      userId: "owner_1",
      idempotencyKey: "approve-retry-real-flow",
      approvalRequestId: requested.id,
      expectedInspectionDigest: requested.inspectionDigest,
      decision: "approved",
    });
    expect(setup.approvals.validationModes.at(-1)).toBe("retry_due");
    const rawApproval = setup.approvals.repository.requests.get(
      `workspace_1\u0000${approved.id}`,
    );
    if (!rawApproval) throw new Error("approved retry request required");
    setup.repository.seedApproval(rawApproval);
    const command = {
      ...setup.recoveryInput("retry", "human", sourceDeliveryId, evidenceDigest),
      approvalRequestId: approved.id,
    };
    if (!("expectedFailureEvidenceDigest" in command)) {
      throw new Error("retry command required");
    }
    const retry = await setup.service.retry(command);
    expect(retry).toMatchObject({
      sourceDeliveryId,
      sourceEvidenceDigest: evidenceDigest,
      delivery: { state: "scheduled" },
      durable: true,
      externallyCompleted: false,
    });
  });

  it("blocks retry for ambiguous, succeeded, and cancelled truth", async () => {
    for (const state of [
      "outcome_unknown",
      "succeeded",
      "cancelled",
    ] as const) {
      const setup = await setupPublishingDeliveries();
      const accepted = await setup.service.release(setup.releaseInput());
      const deliveryId = accepted.deliveries[0]!.id;
      const evidenceDigest = canonicalDigest({ state });
      overwriteDelivery(setup, deliveryId, {
        state,
        latestEffectEvidenceDigest: evidenceDigest,
        failureCode: state === "succeeded" ? null : "NOT_RETRYABLE",
        failureClass: null,
        failureRetryable: null,
        failureEffectDisposition: state === "outcome_unknown"
          ? "ambiguous"
          : null,
      });
      seedFreshRetryApproval({ raw: setup.rawApproval, repository: setup.repository, deliveryId, evidenceDigest });
      const command = setup.recoveryInput("retry", "agent", deliveryId, evidenceDigest);
      if (!("approvalRequestId" in command)) throw new Error("retry command required");
      await expect(setup.service.retry(command)).rejects.toMatchObject({
        code: "PUBLISHING_DELIVERY_RETRY_NOT_SAFE",
      });
    }
  });

  it("queues one exact observe-only reconciliation and durably settles success with replay", async () => {
    const setup = await setupPublishingDeliveries();
    const accepted = await setup.service.release(setup.releaseInput());
    const deliveryId = accepted.deliveries[0]!.id;
    const sourceEvidenceDigest = canonicalDigest({ unknown: "timeout" });
    const intentDigest = canonicalDigest({ post: "stable" });
    const adapterDigest = canonicalDigest({ adapter: "linkedin-v1" });
    overwriteDelivery(setup, deliveryId, {
      state: "outcome_unknown",
      intentDigest,
      providerAdapterContractDigest: adapterDigest,
      providerOperationRef: "linkedin_operation_1",
      latestEffectEvidenceDigest: sourceEvidenceDigest,
      failureCode: "PROVIDER_TIMEOUT",
      failureClass: null,
      failureRetryable: null,
      failureEffectDisposition: "ambiguous",
      completedAt: new Date("2026-08-08T12:01:30.000Z"),
    });
    for (const outbox of setup.repository.outbox.values()) outbox.state = "delivered";
    const command = setup.recoveryInput(
      "reconcile",
      "human",
      deliveryId,
      sourceEvidenceDigest,
    );
    if (!("expectedUnknownEvidenceDigest" in command)) {
      throw new Error("reconciliation command required");
    }
    const queued = await setup.service.reconcile(command);
    expect(await setup.service.reconcile(command)).toEqual(queued);
    const otherActor = setup.recoveryInput(
      "reconcile",
      "agent",
      deliveryId,
      sourceEvidenceDigest,
    );
    if (!("expectedUnknownEvidenceDigest" in otherActor)) {
      throw new Error("reconciliation command required");
    }
    const outboxCount = setup.repository.outbox.size;
    await expect(setup.service.reconcile(otherActor)).rejects.toMatchObject({
      code: "PUBLISHING_DELIVERY_RECONCILIATION_NOT_AVAILABLE",
    });
    expect(setup.repository.reconciliations.size).toBe(1);
    expect(setup.repository.outbox.size).toBe(outboxCount);
    expect(queued).toMatchObject({
      status: "queued",
      resolution: null,
      externallyCompleted: null,
      sourceEvidenceDigest,
    });

    const now = new Date("2026-08-08T12:02:00.000Z");
    const claimed = await setup.repository.claimOutbox({
      now,
      claimExpiresBefore: new Date(now.getTime() - 30_000),
      deliveryToken: "reconcile_queue_1",
    });
    if (claimed.kind !== "claimed") throw new Error("reconcile claim required");
    expect(claimed.intent.purpose).toBe("reconcile");
    await setup.repository.markOutboxDelivered({
      intentId: claimed.intent.id,
      deliveryToken: "reconcile_queue_1",
      deliveredAt: now,
    });
    const acquired = await setup.repository.acquireReconciliationLease({
      workspaceId: "workspace_1",
      deliveryId,
      workerId: "reconcile_worker_1",
      now,
      expiresAt: new Date(now.getTime() + 30_000),
    });
    if (acquired.kind !== "acquired") throw new Error("reconcile lease required");
    const evidenceDigest = canonicalDigest({ result: "succeeded" });
    const event: PublishingDeliveryEvent = {
      schema: "publishing-delivery-event/v1",
      id: `pde_${deliveryId}_${acquired.delivery.nextEventSequence}`,
      workspaceId: "workspace_1",
      deliveryId,
      sequence: acquired.delivery.nextEventSequence,
      type: "delivery.reconciled",
      evidence: {
        reconciliationId: acquired.reconciliation.id,
        effectKey: acquired.delivery.effectKey,
        effectGeneration: acquired.delivery.effectGeneration,
        sourceEvidenceDigest,
        evidenceDigest,
        resolution: "succeeded",
        providerOperationRef: "linkedin_operation_1",
        failureCode: null,
        retryable: null,
      },
      occurredAt: now,
    };
    const settled = await setup.repository.settleReconciliation({
      workspaceId: "workspace_1",
      deliveryId,
      reconciliationId: acquired.reconciliation.id,
      workerId: acquired.lease.workerId,
      leaseToken: acquired.lease.leaseToken,
      fence: acquired.lease.fence,
      effectKey: acquired.delivery.effectKey,
      effectGeneration: acquired.delivery.effectGeneration,
      intentDigest,
      providerAdapterContractDigest: adapterDigest,
      sourceEvidenceDigest,
      resolution: {
        kind: "succeeded",
        providerOperationRef: "linkedin_operation_1",
        evidenceDigest,
      },
      event,
      occurredAt: now,
    });
    expect(settled).toMatchObject({
      kind: "settled",
      delivery: { state: "succeeded" },
    });
    expect(await setup.service.reconcile(command)).toMatchObject({
      status: "completed",
      resolution: "succeeded",
      externallyCompleted: true,
    });
  });
});
