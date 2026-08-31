import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { describe, expect, it, vi } from "vitest";
import { PublishingDeliveryExecutionService } from "../execution";
import {
  PublishingPlatformRegistry,
  type PublishingPlatformInvocationBoundary,
} from "../platform-registry";
import type {
  PublishingDeliveryExecutionReadinessPort,
  PublishingDeliveryRecord,
} from "../types";
import { setupPublishingDeliveries } from "./fixtures";

const intentDigest = canonicalDigest({
  schema: "cancellation-execution-intent/v1",
  content: "retained",
});
const providerContract = {
  providerContractDigest: `sha256:${"8".repeat(64)}`,
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
      id: "readiness_cancellation",
      ...input,
      mode: "launch",
      authorizationEvidenceDigest: canonicalDigest("authorization"),
      approvalEvidenceDigest: canonicalDigest("approval"),
      channelEvidenceDigest: canonicalDigest("channel"),
      credentialEvidenceDigest: canonicalDigest("credential"),
      validationEvidenceDigest: canonicalDigest("validation"),
      evidenceDigest: canonicalDigest("readiness"),
      evaluatedAt: input.evaluatedAt,
      expiresAt: new Date(input.evaluatedAt.getTime() + 30_000),
    },
  }),
};

const providerEvidence = (
  effectDisposition: "not_created" | "accepted" | "terminal_failed" | "unknown",
) => ({
  providerRequestId: null,
  httpStatus: null,
  providerCode: null,
  operatorTraceRef: null,
  effectDisposition,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function boundary(input: {
  prepare?: () => Promise<void>;
  launch: PublishingPlatformInvocationBoundary extends {
    prepare(delivery: Readonly<PublishingDeliveryRecord>): Promise<infer E>;
  } ? E extends { launch: infer L } ? L : never : never;
  observe?: PublishingPlatformInvocationBoundary extends {
    prepare(delivery: Readonly<PublishingDeliveryRecord>): Promise<infer E>;
  } ? E extends { observe: infer O } ? O : never : never;
}): PublishingPlatformInvocationBoundary {
  return {
    prepare: async () => {
      await input.prepare?.();
      return {
        intentDigest,
        ...providerContract,
        ensureContactReady: async () => undefined,
        launch: input.launch,
        observe: input.observe ?? input.launch,
      };
    },
  };
}

async function released() {
  const setup = await setupPublishingDeliveries();
  const accepted = await setup.service.release(setup.releaseInput());
  const deliveryId = accepted.deliveries[0]!.id;
  let now = new Date(accepted.deliveries[0]!.publishAt);
  const setNow = (value: Date) => {
    now = value;
    setup.setNow(value.toISOString());
  };
  const cancel = () => setup.service.cancel(
    setup.cancellationInput("agent", deliveryId),
  );
  setNow(now);
  return { setup, deliveryId, cancel, setNow, now: () => now };
}

function execution(input: Awaited<ReturnType<typeof released>>, platform: PublishingPlatformInvocationBoundary) {
  return new PublishingDeliveryExecutionService(
    input.setup.repository,
    { schedule: vi.fn(async () => undefined) },
    new PublishingPlatformRegistry().register("linkedin", platform),
    { now: input.now },
    readyExecution,
  );
}

describe("Publishing Delivery cancellation execution races", () => {
  it("clears retained readiness blocker evidence when cancelling a blocked Delivery", async () => {
    const input = await released();
    const storageKey = `workspace_1\u0000${input.deliveryId}`;
    const delivery = input.setup.repository.deliveries.get(storageKey)!;
    input.setup.repository.deliveries.set(storageKey, {
      ...delivery,
      state: "blocked",
      readinessBlockCode: "CHANNEL_UNAVAILABLE",
      readinessEvidenceDigest: canonicalDigest("blocked-channel"),
      readinessBlockedAt: input.now(),
      readinessRetryAt: new Date(input.now().getTime() + 5_000),
      readinessBlockCount: 3,
    });

    await expect(input.cancel()).resolves.toMatchObject({
      outcome: "prevented",
    });
    expect(input.setup.repository.deliveries.get(storageKey)).toMatchObject({
      state: "cancelled",
      readinessBlockCode: null,
      readinessEvidenceDigest: null,
      readinessBlockedAt: null,
      readinessRetryAt: null,
      readinessBlockCount: 0,
    });
  });

  it("prevents a stale claimed dispatch before contact and stays cancelled after restart", async () => {
    const input = await released();
    const claimed = await input.setup.repository.claimOutbox({
      now: input.now(),
      claimExpiresBefore: new Date(input.now().getTime() - 30_000),
      deliveryToken: "stale_claim_before_cancel",
    });
    expect(claimed.kind).toBe("claimed");
    const launch = vi.fn(async () => ({
      kind: "succeeded" as const,
      providerOperationRef: "must_not_exist",
      outputs: {},
      evidence: providerEvidence("accepted"),
      usage: [],
    }));

    await expect(input.cancel()).resolves.toMatchObject({
      outcome: "prevented",
      stateAtRequest: "scheduled",
      externallyCompletedAtRequest: false,
      externallyReversed: false,
    });
    const worker = execution(input, boundary({ launch }));
    await expect(worker.executeOne({
      workspaceId: "workspace_1",
      deliveryId: input.deliveryId,
      workerId: "cancelled_stale_claim_worker",
    })).resolves.toEqual({
      deliveryId: input.deliveryId,
      state: "cancelled",
      externallyCompleted: false,
    });
    await expect(worker.executeOne({
      workspaceId: "workspace_1",
      deliveryId: input.deliveryId,
      workerId: "cancelled_restart_worker",
    })).resolves.toMatchObject({ state: "cancelled" });
    expect(launch).not.toHaveBeenCalled();
  });

  it("lets cancellation win an active lease while intent preparation is paused", async () => {
    const input = await released();
    const preparationEntered = deferred<void>();
    const continuePreparation = deferred<void>();
    const launch = vi.fn(async () => ({
      kind: "succeeded" as const,
      providerOperationRef: "must_not_launch",
      outputs: {}, evidence: providerEvidence("accepted"), usage: [],
    }));
    const worker = execution(input, boundary({
      prepare: async () => {
        preparationEntered.resolve();
        await continuePreparation.promise;
      },
      launch,
    }));
    await worker.relayNext();
    const running = worker.executeOne({
      workspaceId: "workspace_1",
      deliveryId: input.deliveryId,
      workerId: "cancel_during_prepare_worker",
    });
    await preparationEntered.promise;
    await expect(input.cancel()).resolves.toMatchObject({ outcome: "prevented" });
    continuePreparation.resolve();
    await expect(running).resolves.toMatchObject({ state: "cancelled" });
    expect(launch).not.toHaveBeenCalled();
  });

  it("retains an unknown cancellation result while the active fenced worker settles known success", async () => {
    const input = await released();
    const contactEntered = deferred<void>();
    const finishContact = deferred<void>();
    const launch = vi.fn(async () => {
      contactEntered.resolve();
      await finishContact.promise;
      return {
        kind: "succeeded" as const,
        providerOperationRef: "linkedin_effect_after_cancel",
        outputs: { published: true }, evidence: providerEvidence("accepted"), usage: [],
      };
    });
    const worker = execution(input, boundary({ launch }));
    await worker.relayNext();
    const running = worker.executeOne({
      workspaceId: "workspace_1",
      deliveryId: input.deliveryId,
      workerId: "active_contact_worker",
    });
    await contactEntered.promise;
    const first = await input.cancel();
    expect(first).toMatchObject({
      outcome: "unknown",
      stateAtRequest: "dispatching",
      externallyCompletedAtRequest: null,
    });
    finishContact.resolve();
    await expect(running).resolves.toEqual({
      deliveryId: input.deliveryId,
      state: "succeeded",
      externallyCompleted: true,
    });
    const replay = await input.cancel();
    expect(replay).toEqual(first);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("continues observation of an accepted effect after conditional cancellation without relaunch", async () => {
    const input = await released();
    const launch = vi.fn(async () => ({
      kind: "outcome_unknown" as const,
      providerOperationRef: "linkedin_accepted_before_cancel",
      failureCode: "PLATFORM_EFFECT_PENDING",
      pollAfterMs: 1_000,
      evidence: providerEvidence("accepted"), usage: [],
    }));
    const observe = vi.fn(async () => ({
      kind: "succeeded" as const,
      providerOperationRef: "linkedin_accepted_before_cancel",
      outputs: { published: true }, evidence: providerEvidence("accepted"), usage: [],
    }));
    const worker = execution(input, boundary({ launch, observe }));
    await worker.relayNext();
    await expect(worker.executeOne({
      workspaceId: "workspace_1", deliveryId: input.deliveryId,
      workerId: "accepted_launch_worker",
    })).resolves.toMatchObject({ state: "confirmation_pending" });
    const cancellation = await input.cancel();
    expect(cancellation).toMatchObject({
      outcome: "conditional",
      externallyCompletedAtRequest: null,
    });

    input.setNow(new Date(input.now().getTime() + 1_000));
    await expect(worker.relayNext()).resolves.toMatchObject({ delivered: true });
    await expect(worker.executeOne({
      workspaceId: "workspace_1", deliveryId: input.deliveryId,
      workerId: "cancelled_observation_worker",
    })).resolves.toMatchObject({ state: "succeeded", externallyCompleted: true });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    await expect(input.cancel()).resolves.toEqual(cancellation);
  });

  it("suppresses retry/relaunch when cancellation races a retryable contact failure", async () => {
    const input = await released();
    const contactEntered = deferred<void>();
    const finishContact = deferred<void>();
    const launch = vi.fn(async () => {
      contactEntered.resolve();
      await finishContact.promise;
      return {
        kind: "failed_known" as const,
        providerOperationRef: null,
        failureCode: "PLATFORM_TEMPORARY_FAILURE",
        retryHint: { retryable: true as const, retryAfterMs: 1_000 },
        evidence: providerEvidence("not_created"),
        usage: [],
      };
    });
    const worker = execution(input, boundary({ launch }));
    await worker.relayNext();
    const running = worker.executeOne({
      workspaceId: "workspace_1", deliveryId: input.deliveryId,
      workerId: "retry_race_worker",
    });
    await contactEntered.promise;
    await expect(input.cancel()).resolves.toMatchObject({
      outcome: "unknown",
      externallyCompletedAtRequest: null,
    });
    finishContact.resolve();
    await expect(running).resolves.toMatchObject({
      state: "failed_transient",
      externallyCompleted: false,
    });
    input.setNow(new Date(input.now().getTime() + 2_000));
    await expect(worker.relayNext()).resolves.toEqual({ delivered: false });
    await expect(worker.executeOne({
      workspaceId: "workspace_1", deliveryId: input.deliveryId,
      workerId: "retry_suppressed_restart",
    })).resolves.toMatchObject({ state: "failed_transient" });
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("requires explicit retry after a known transient failure and never relaunches", async () => {
    const input = await released();
    const launch = vi.fn(async () => ({
      kind: "failed_known" as const,
      providerOperationRef: null,
      failureCode: "PLATFORM_TEMPORARY_FAILURE",
      retryHint: { retryable: true as const, retryAfterMs: 1_000 },
      evidence: providerEvidence("not_created"),
      usage: [],
    }));
    const worker = execution(input, boundary({ launch }));
    await worker.relayNext();
    await expect(worker.executeOne({
      workspaceId: "workspace_1", deliveryId: input.deliveryId,
      workerId: "scheduled_retry_worker",
    })).resolves.toMatchObject({ state: "failed_transient" });
    await expect(input.cancel()).resolves.toMatchObject({
      outcome: "too_late",
      stateAtRequest: "failed_transient",
      externallyReversed: false,
    });
    input.setNow(new Date(input.now().getTime() + 1_000));
    await worker.relayNext();
    await expect(worker.executeOne({
      workspaceId: "workspace_1", deliveryId: input.deliveryId,
      workerId: "scheduled_retry_cancelled_restart",
    })).resolves.toMatchObject({ state: "failed_transient" });
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("never relaunches a contact-started effect after lease expiry and reports late success truthfully", async () => {
    const input = await released();
    const claimed = await input.setup.repository.claimOutbox({
      now: input.now(),
      claimExpiresBefore: new Date(input.now().getTime() - 30_000),
      deliveryToken: "manual_contact_claim",
    });
    expect(claimed.kind).toBe("claimed");
    const lease = await input.setup.repository.acquireLease({
      workspaceId: "workspace_1", deliveryId: input.deliveryId,
      workerId: "crashed_contact_worker", now: input.now(),
      expiresAt: new Date(input.now().getTime() + 1_000),
    });
    expect(lease.kind).toBe("acquired");
    if (lease.kind !== "acquired") throw new TypeError("Expected lease");
    const prepared = await input.setup.repository.prepareEffect({
      workspaceId: "workspace_1", deliveryId: input.deliveryId,
      workerId: lease.lease.workerId, leaseToken: lease.lease.leaseToken,
      fence: lease.lease.fence, effectKey: lease.delivery.effectKey,
      intentDigest,
      providerAdapterContractDigest: providerContract.providerContractDigest,
      preparedAt: input.now(),
    });
    expect(prepared.kind).toBe("prepared");
    const readiness = await readyExecution.checkCurrent({
      workspaceId: "workspace_1",
      deliveryId: input.deliveryId,
      effectKey: lease.delivery.effectKey,
      effectGeneration: lease.delivery.effectGeneration,
      intentDigest,
      providerAdapterContractDigest: providerContract.providerContractDigest,
      evaluatedAt: input.now(),
    });
    if (readiness.kind !== "ready") throw new TypeError("Expected readiness");
    const began = await input.setup.repository.beginEffectContact({
      workspaceId: "workspace_1", deliveryId: input.deliveryId,
      workerId: lease.lease.workerId, leaseToken: lease.lease.leaseToken,
      fence: lease.lease.fence, effectKey: lease.delivery.effectKey,
      intentDigest,
      providerAdapterContractDigest: providerContract.providerContractDigest,
      readinessSession: readiness.session,
      startedAt: input.now(),
    });
    expect(began.kind).toBe("started");
    await expect(input.cancel()).resolves.toMatchObject({ outcome: "unknown" });

    const launch = vi.fn(async () => ({
      kind: "succeeded" as const, providerOperationRef: "must_not_relaunch",
      outputs: {}, evidence: providerEvidence("accepted"), usage: [],
    }));
    input.setNow(new Date(input.now().getTime() + 2_000));
    const restarted = execution(input, boundary({ launch }));
    await expect(restarted.executeOne({
      workspaceId: "workspace_1", deliveryId: input.deliveryId,
      workerId: "post_crash_worker",
    })).resolves.toMatchObject({ state: "outcome_unknown" });
    expect(launch).not.toHaveBeenCalled();

    const successInput = await released();
    const successLaunch = vi.fn(async () => ({
      kind: "succeeded" as const,
      providerOperationRef: "linkedin_already_succeeded",
      outputs: {}, evidence: providerEvidence("accepted"), usage: [],
    }));
    const successWorker = execution(successInput, boundary({ launch: successLaunch }));
    await successWorker.relayNext();
    await successWorker.executeOne({
      workspaceId: "workspace_1", deliveryId: successInput.deliveryId,
      workerId: "successful_worker",
    });
    await expect(successInput.cancel()).resolves.toMatchObject({
      outcome: "too_late",
      stateAtRequest: "succeeded",
      externallyCompletedAtRequest: true,
      externallyReversed: false,
    });
    await successWorker.executeOne({
      workspaceId: "workspace_1", deliveryId: successInput.deliveryId,
      workerId: "successful_restart",
    });
    expect(successLaunch).toHaveBeenCalledTimes(1);
  });
});
