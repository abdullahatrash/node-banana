import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { publishingPlanSchema } from "./contracts";
import { PublishingPlanMachine } from "./machine";

const examplePath = fileURLToPath(
  new URL("./example-plan.json", import.meta.url),
);

async function loadExample(): Promise<unknown> {
  return JSON.parse(await readFile(examplePath, "utf8"));
}

function print(label: string, value: unknown): void {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
}

function expectedFailure(label: string, action: () => unknown): void {
  try {
    action();
    throw new Error(`Expected "${label}" to fail.`);
  } catch (error) {
    print(label, {
      rejected: true,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function validateOnly(): Promise<void> {
  const parsed = publishingPlanSchema.parse(await loadExample());
  print("contract valid", parsed);
}

async function demo(): Promise<void> {
  const machine = new PublishingPlanMachine();
  const authored = publishingPlanSchema.parse(await loadExample());

  const revision1 = machine.persistPlan(authored);
  print("1. immutable plan revision", revision1);

  const validation1 = machine.validate(revision1);
  print("2. readiness for exact revision", validation1);

  const redditApproval = machine.requestApproval({
    revision: revision1,
    action: "publish-now",
    targetIds: ["target_reddit"],
    requestedBy: "actor_external_agent",
    expiresAt: "2029-12-02T00:00:00.000Z",
  });
  print("3. pending human approval", redditApproval);

  machine.approve(redditApproval.id, "actor_human_editor");
  print("4. durable approved decision", redditApproval);

  const redditDelivery = machine.release({
    revision: revision1,
    approvalId: redditApproval.id,
    targetIds: ["target_reddit"],
    idempotencyKey: "release_reddit_v1",
  })[0];
  print("5. release atomically consumes approval", {
    approval: redditApproval,
    delivery: redditDelivery,
  });

  const repeatedRelease = machine.release({
    revision: revision1,
    approvalId: redditApproval.id,
    targetIds: ["target_reddit"],
    idempotencyKey: "release_reddit_v1",
  })[0];
  print("6. repeated release returns the same delivery", {
    sameDelivery: repeatedRelease === redditDelivery,
    delivery: repeatedRelease,
  });

  machine.transitionDelivery(redditDelivery.id, "publishing");
  machine.transitionDelivery(redditDelivery.id, "published", {
    providerPostRef: "reddit:t3_example",
  });
  print("7. provider delivery reaches terminal state", redditDelivery);

  const revision2 = machine.persistPlan({
    ...authored,
    targets: authored.targets.map((target) =>
      target.id === "target_reddit"
        ? {
            ...target,
            content: {
              ...target.content,
              text: `${target.content.text} Edited after approval.`,
            },
          }
        : target,
    ),
  });
  machine.validate(revision2);
  print("8. edit creates a new immutable revision", revision2);

  expectedFailure("9. old approval cannot authorize edited content", () =>
    machine.release({
      revision: revision2,
      approvalId: redditApproval.id,
      targetIds: ["target_reddit"],
      idempotencyKey: "release_reddit_v2",
    }),
  );

  const youtubeApproval = machine.requestApproval({
    revision: revision2,
    action: "schedule",
    targetIds: ["target_youtube"],
    requestedBy: "actor_external_agent",
    expiresAt: "2029-12-02T00:00:00.000Z",
  });
  machine.approve(youtubeApproval.id, "actor_human_editor");
  const youtubeDelivery = machine.release({
    revision: revision2,
    approvalId: youtubeApproval.id,
    targetIds: ["target_youtube"],
    idempotencyKey: "release_youtube_v2",
  })[0];
  print("10. scheduled delivery is separate from approval", youtubeDelivery);

  expectedFailure("11. consumed approval can no longer be revoked", () =>
    machine.revoke(
      youtubeApproval.id,
      "actor_human_editor",
      "Changed launch timing.",
    ),
  );

  expectedFailure("12. invalid delivery transition", () =>
    machine.transitionDelivery(youtubeDelivery.id, "published", {
      providerPostRef: "youtube:video_example",
    }),
  );

  machine.transitionDelivery(youtubeDelivery.id, "cancelled");
  print("13. scheduled work is cancelled on the delivery", youtubeDelivery);

  expectedFailure("14. published delivery cannot be cancelled", () =>
    machine.transitionDelivery(redditDelivery.id, "cancelled"),
  );

  print("15. complete in-memory state", machine.snapshot());

  const partialMachine = new PublishingPlanMachine();
  const partialAuthored = structuredClone(authored);
  const partialReddit = partialAuthored.targets.find(
    (target) => target.id === "target_reddit",
  );
  if (!partialReddit) throw new Error("Example Reddit target is missing.");
  delete partialReddit.publishingSettings.title;

  const partialRevision = partialMachine.persistPlan(partialAuthored);
  const partialValidation = partialMachine.validate(partialRevision);
  expectedFailure("16. unready target cannot request approval", () =>
    partialMachine.requestApproval({
      revision: partialRevision,
      action: "publish-now",
      targetIds: ["target_reddit"],
      requestedBy: "actor_external_agent",
      expiresAt: "2029-12-02T00:00:00.000Z",
    }),
  );

  const readySubsetApproval = partialMachine.requestApproval({
    revision: partialRevision,
    action: "schedule",
    targetIds: ["target_youtube"],
    requestedBy: "actor_external_agent",
    expiresAt: "2029-12-02T00:00:00.000Z",
  });
  partialMachine.approve(readySubsetApproval.id, "actor_human_editor");
  partialMachine.release({
    revision: partialRevision,
    approvalId: readySubsetApproval.id,
    targetIds: ["target_youtube"],
    idempotencyKey: "release_ready_subset",
  });
  print("17. ready target advances while another remains unready", {
    validation: partialValidation,
    progress: partialMachine.progress(partialRevision),
  });

  const liveGateMachine = new PublishingPlanMachine();
  const liveGateRevision = liveGateMachine.persistPlan(authored);
  liveGateMachine.validate(liveGateRevision);
  const liveGateApproval = liveGateMachine.requestApproval({
    revision: liveGateRevision,
    action: "publish-now",
    targetIds: ["target_reddit"],
    requestedBy: "actor_external_agent",
    expiresAt: "2029-12-02T00:00:00.000Z",
  });
  liveGateMachine.approve(liveGateApproval.id, "actor_human_editor");
  liveGateMachine.setChannelEnabled("channel_reddit_product", false);

  expectedFailure("18. release gate catches readiness drift", () =>
    liveGateMachine.release({
      revision: liveGateRevision,
      approvalId: liveGateApproval.id,
      targetIds: ["target_reddit"],
      idempotencyKey: "release_after_channel_drift",
    }),
  );
  print("19. blocked release leaves approval unconsumed", liveGateApproval);

  liveGateMachine.setChannelEnabled("channel_reddit_product", true);
  const gatedDelivery = liveGateMachine.release({
    revision: liveGateRevision,
    approvalId: liveGateApproval.id,
    targetIds: ["target_reddit"],
    idempotencyKey: "release_after_channel_drift",
  })[0];
  liveGateMachine.setChannelEnabled("channel_reddit_product", false);
  liveGateMachine.transitionDelivery(gatedDelivery.id, "publishing");
  print("20. pre-publish drift durably blocks delivery", {
    delivery: gatedDelivery,
    validations: liveGateMachine.validations,
  });

  liveGateMachine.setChannelEnabled("channel_reddit_product", true);
  liveGateMachine.resumeDelivery(gatedDelivery.id);
  liveGateMachine.transitionDelivery(gatedDelivery.id, "publishing");
  print("21. external remediation resumes the same delivery", gatedDelivery);

  const expiryMachine = new PublishingPlanMachine();
  const expiryRevision = expiryMachine.persistPlan(authored);
  expiryMachine.validate(expiryRevision);
  const expiringApproval = expiryMachine.requestApproval({
    revision: expiryRevision,
    action: "publish-now",
    targetIds: ["target_reddit"],
    requestedBy: "actor_external_agent",
    expiresAt: "2029-12-01T12:00:06.000Z",
  });
  expiryMachine.advanceTime(10_000);
  expectedFailure("22. expired approval cannot be granted or consumed", () =>
    expiryMachine.approve(expiringApproval.id, "actor_human_editor"),
  );
  print("23. expiry is durable terminal approval state", expiringApproval);

  const policyMachine = new PublishingPlanMachine();
  const policyRevision = policyMachine.persistPlan(authored);
  policyMachine.validate(policyRevision);
  const policyApproval = policyMachine.requestApproval({
    revision: policyRevision,
    action: "publish-now",
    targetIds: ["target_reddit"],
    requestedBy: "actor_external_agent",
    expiresAt: "2029-12-02T00:00:00.000Z",
  });
  policyMachine.approveByPolicy(policyApproval.id, {
    policyRef: "policy_auto_publish_reddit",
    policyVersion: 3,
    evaluationRef: "policy_eval_123",
  });
  const policyDeliveries = policyMachine.release({
    revision: policyRevision,
    approvalId: policyApproval.id,
    targetIds: ["target_reddit"],
    idempotencyKey: "release_policy_authorized",
  });
  print("24. policy authorization uses the same approval and release path", {
    approval: policyApproval,
    deliveries: policyDeliveries,
  });

  expectedFailure("25. recurring timing is outside Publishing Plan v1", () =>
    publishingPlanSchema.parse({
      ...authored,
      targets: authored.targets.map((target) =>
        target.id === "target_youtube"
          ? {
              ...target,
              timing: {
                mode: "recurring",
                cron: "0 9 * * 1",
                timeZone: "Europe/Athens",
              },
            }
          : target,
      ),
    }),
  );

  const retryMachine = new PublishingPlanMachine(
    24 * 60 * 60 * 1_000,
    3,
  );
  const retryRevision = retryMachine.persistPlan(authored);
  retryMachine.validate(retryRevision);
  const retryApproval = retryMachine.requestApproval({
    revision: retryRevision,
    action: "publish-now",
    targetIds: ["target_reddit"],
    requestedBy: "actor_external_agent",
    expiresAt: "2029-12-02T00:00:00.000Z",
  });
  retryMachine.approve(retryApproval.id, "actor_human_editor");
  const retryDelivery = retryMachine.release({
    revision: retryRevision,
    approvalId: retryApproval.id,
    targetIds: ["target_reddit"],
    idempotencyKey: "release_retry_scenario",
  })[0];

  retryMachine.transitionDelivery(retryDelivery.id, "publishing");
  retryMachine.recordProviderFailure(retryDelivery.id, {
    kind: "retryable-safe",
    error: { code: "provider_unavailable", message: "Provider returned 503." },
    retryAt: "2029-12-01T12:05:00.000Z",
  });
  print("26. known-safe transient failure schedules bounded retry", retryDelivery);

  retryMachine.resumeRetry(retryDelivery.id);
  retryMachine.transitionDelivery(retryDelivery.id, "publishing");
  retryMachine.recordProviderFailure(retryDelivery.id, {
    kind: "outcome-unknown",
    error: {
      code: "response_lost",
      message: "Connection closed after request bytes were sent.",
    },
  });
  expectedFailure("27. ambiguous provider outcome cannot blindly resume", () =>
    retryMachine.resumeDelivery(retryDelivery.id),
  );
  print("28. ambiguous outcome blocks for reconciliation", retryDelivery);

  retryMachine.reconcileProviderOutcome(retryDelivery.id, {
    outcome: "not-published",
  });
  retryMachine.transitionDelivery(retryDelivery.id, "publishing");
  retryMachine.recordProviderFailure(retryDelivery.id, {
    kind: "non-retryable",
    error: {
      code: "provider_rejected",
      message: "Provider permanently rejected the content.",
    },
  });
  print("29. non-retryable failure is terminal with attempt history", retryDelivery);

  const manualRetryApproval = retryMachine.requestApproval({
    revision: retryRevision,
    action: "publish-now",
    targetIds: ["target_reddit"],
    requestedBy: "actor_external_agent",
    expiresAt: "2029-12-02T00:00:00.000Z",
  });
  retryMachine.approve(manualRetryApproval.id, "actor_human_editor");
  const manualRetryDelivery = retryMachine.release({
    revision: retryRevision,
    approvalId: manualRetryApproval.id,
    targetIds: ["target_reddit"],
    idempotencyKey: "release_manual_retry",
  })[0];
  print("30. manual retry uses fresh approval and new delivery", {
    failedDeliveryId: retryDelivery.id,
    approval: manualRetryApproval,
    newDelivery: manualRetryDelivery,
  });

  const supersedeMachine = new PublishingPlanMachine();
  const supersedeRevision1 = supersedeMachine.persistPlan(authored);
  supersedeMachine.validate(supersedeRevision1);
  const pendingOldApproval = supersedeMachine.requestApproval({
    revision: supersedeRevision1,
    action: "publish-now",
    targetIds: ["target_reddit"],
    requestedBy: "actor_external_agent",
    expiresAt: "2029-12-02T00:00:00.000Z",
  });
  const approvedOldApproval = supersedeMachine.requestApproval({
    revision: supersedeRevision1,
    action: "schedule",
    targetIds: ["target_youtube"],
    requestedBy: "actor_external_agent",
    expiresAt: "2029-12-02T00:00:00.000Z",
  });
  supersedeMachine.approve(approvedOldApproval.id, "actor_human_editor");
  const supersedeRevision2 = supersedeMachine.persistPlan({
    ...authored,
    title: "Launch-week product announcement — revised",
  });
  print("31. new revision supersedes stale unconsumed approvals", {
    supersededBy: supersedeRevision2,
    approvals: [pendingOldApproval, approvedOldApproval],
  });
  expectedFailure("32. superseded approval cannot advance", () =>
    supersedeMachine.approve(pendingOldApproval.id, "actor_human_editor"),
  );
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  if (args.has("--validate")) {
    await validateOnly();
  } else {
    await demo();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
