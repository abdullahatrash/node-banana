import { describe, expect, it } from "vitest";
import { PublishingPlanServiceError } from "../errors";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { publishingPlanAuthorizationContractDigest } from "../authorization-contract";
import {
  publishingPlanDraft,
  setupPublishingPlans,
} from "./fixtures";

function createInput(
  setup: ReturnType<typeof setupPublishingPlans>,
  candidate = publishingPlanDraft(),
  idempotencyKey = "publishing-plan-create-1",
  expectedRevision?: number,
) {
  return {
    candidate,
    workspaceId: "workspace_1",
    principalId: "principal_1",
    keyId: "key_1",
    creationAuthorizationEvidenceRef: "otr_creation_evidence",
    effectiveResources: setup.effectiveResources,
    idempotencyKey,
    expectedRevision,
  };
}

describe("PublishingPlanRevisionService", () => {
  it("appends revisions while preserving every earlier target set", async () => {
    const setup = setupPublishingPlans();
    const first = await setup.service.create(createInput(setup));
    const edited = publishingPlanDraft();
    edited.targets[0]!.timing = {
      kind: "scheduled",
      scheduledAt: "2026-08-09T12:00:00.000Z",
    };
    const second = await setup.service.create(
      createInput(setup, edited, "publishing-plan-create-2", 1),
    );

    expect([first.revision, second.revision]).toEqual([1, 2]);
    expect(first.id).not.toBe(second.id);
    const storedFirst = await setup.service.getRevision(
      "workspace_1",
      first.id,
    );
    expect(storedFirst.definition.targets[0]?.settings).toEqual({
      type: "person",
    });
    expect(setup.repository.plans.get("workspace_1\u0000plan_1")).toMatchObject({
      currentRevision: 2,
    });
  });

  it("replays the exact revision and rejects idempotency conflicts", async () => {
    const setup = setupPublishingPlans();
    const first = await setup.service.create(createInput(setup));
    const replay = await setup.service.create(createInput(setup));
    const changed = publishingPlanDraft();
    changed.targets[0]!.timing = {
      kind: "scheduled",
      scheduledAt: "2026-08-09T12:00:00.000Z",
    };

    expect(replay).toEqual(first);
    await expect(
      setup.service.create(createInput(setup, changed)),
    ).rejects.toMatchObject({ code: "PUBLISHING_PLAN_IDEMPOTENCY_CONFLICT" });
  });

  it("revalidates current state before a new commit", async () => {
    const setup = setupPublishingPlans();
    const channel = setup.channels.snapshots.values().next().value!;
    setup.channels.put({ ...channel, state: "revoked" });

    await expect(setup.service.create(createInput(setup))).rejects.toMatchObject({
      code: "PUBLISHING_PLAN_VALIDATION_FAILED",
      details: {
        blockers: [expect.objectContaining({ code: "CHANNEL_INACCESSIBLE" })],
      },
    });
    expect(setup.repository.revisions.size).toBe(0);
  });

  it("fails closed when persistence is unavailable", async () => {
    const setup = setupPublishingPlans();
    setup.repository.failNextCommit = true;

    await expect(setup.service.create(createInput(setup))).rejects.toEqual(
      expect.objectContaining<Partial<PublishingPlanServiceError>>({
        code: "PUBLISHING_PLAN_PERSISTENCE_UNAVAILABLE",
      }),
    );
  });

  it("rejects guessed-plan creation, cross-principal edits, and stale revisions", async () => {
    const setup = setupPublishingPlans();
    await setup.service.create(createInput(setup));
    await expect(
      setup.service.create(
        createInput(setup, publishingPlanDraft(), "guessed-existing-plan"),
      ),
    ).rejects.toMatchObject({ code: "PUBLISHING_PLAN_EDIT_CONFLICT" });

    setup.contexts.put({
      contextId: "context_principal_2",
      contextDigest: canonicalDigest({ principal: "principal_2" }),
      workspaceId: "workspace_1",
      principalId: "principal_2",
      keyId: "key_2",
      authorizationEvidenceRef: "otr_principal_2",
      capability: "publishing_plan_revisions.create@1",
      authorizationContractDigest: publishingPlanAuthorizationContractDigest(
        "publishing_plan_revisions.create@1",
      ),
      resources: {
        channelIds: ["channel_linkedin"],
        artifactIds: ["artifact_image", "artifact_text"],
      },
      issuedAt: new Date("2026-08-08T11:00:00.000Z"),
      expiresAt: new Date("2026-08-08T13:00:00.000Z"),
    });
    await expect(
      setup.service.create({
        ...createInput(
          setup,
          publishingPlanDraft(),
          "cross-principal-edit",
          1,
        ),
        principalId: "principal_2",
        keyId: "key_2",
        creationAuthorizationEvidenceRef: "otr_principal_2",
      }),
    ).rejects.toMatchObject({ code: "PUBLISHING_PLAN_EDIT_CONFLICT" });

    await expect(
      setup.service.create(
        createInput(setup, publishingPlanDraft(), "stale-revision-edit", 2),
      ),
    ).rejects.toMatchObject({ code: "PUBLISHING_PLAN_REVISION_CONFLICT" });
  });

  it("allows only one concurrent edit at an expected revision", async () => {
    const setup = setupPublishingPlans();
    await setup.service.create(createInput(setup));
    const left = publishingPlanDraft();
    left.targets[0]!.timing = {
      kind: "scheduled",
      scheduledAt: "2026-08-09T13:00:00.000Z",
    };
    const right = publishingPlanDraft();
    right.targets[0]!.timing = {
      kind: "scheduled",
      scheduledAt: "2026-08-09T14:00:00.000Z",
    };

    const settled = await Promise.allSettled([
      setup.service.create(createInput(setup, left, "concurrent-left", 1)),
      setup.service.create(createInput(setup, right, "concurrent-right", 1)),
    ]);

    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((item) => item.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          code: "PUBLISHING_PLAN_REVISION_CONFLICT",
        }),
      }),
    ]);
  });

  it("rejects a state change inside the allocation critical section", async () => {
    const setup = setupPublishingPlans();
    setup.repository.beforeValidationSessionCheck = () => {
      const channel = setup.channels.snapshots.values().next().value!;
      setup.channels.put({
        ...channel,
        versionDigest: canonicalDigest({ channel: channel.id, version: 99 }),
      });
    };

    await expect(setup.service.create(createInput(setup))).rejects.toMatchObject({
      code: "PUBLISHING_PLAN_VALIDATION_EXPIRED",
    });
    expect(setup.repository.revisions.size).toBe(0);
  });
});
