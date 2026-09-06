import { describe, expect, it, vi } from "vitest";
import { InMemoryOnboardingRepository } from "../memory-repository";
import { InMemoryOnboardingQueue } from "../queue";
import type { BrandProfileRecord } from "../repository";
import type { BrandProfileGenerator } from "../brand-profile/ports";
import { DefaultOnboardingService, type OnboardingIdGenerator } from "../service";

const now = new Date("2026-08-31T12:00:00.000Z");

function testService(profileGenerator?: () => BrandProfileGenerator) {
  const repository = new InMemoryOnboardingRepository();
  const queue = new InMemoryOnboardingQueue();
  const counts = new Map<string, number>();
  const ids: OnboardingIdGenerator = {
    generate(prefix) {
      const next = (counts.get(prefix) ?? 0) + 1;
      counts.set(prefix, next);
      return `${prefix}_${next}`;
    },
  };
  const service = new DefaultOnboardingService(
    repository,
    queue,
    { now: () => now },
    ids,
    undefined,
    profileGenerator,
  );
  return { repository, queue, service };
}

function identityCommand(expectedRevision = 0) {
  return {
    type: "save_identity",
    expectedRevision,
    idempotencyKey: "identity_command_1",
    payload: {
      fullName: "Noura Alnajjar",
      companyName: "Tasmeem AI",
      logoAssetId: null,
      interfaceLocale: "en",
      contentLanguage: "en",
    },
  } as const;
}

async function reachReview(
  service: DefaultOnboardingService,
): Promise<{ workspaceId: string; runId: string }> {
  await service.getSnapshot({ userId: "user_1" });
  const identity = await service.execute({
    userId: "user_1",
    command: identityCommand(),
  });
  const source = await service.execute({
    userId: "user_1",
    command: {
      type: "set_brand_source",
      expectedRevision: 1,
      idempotencyKey: "source_command_1",
      payload: {
        kind: "description",
        description: "We help MENA brands create reliable Arabic and English content.",
      },
    },
  });
  await service.execute({
    userId: "user_1",
    command: {
      type: "save_company_stage",
      expectedRevision: 2,
      idempotencyKey: "stage_command_1",
      payload: { teamSize: "2_5", monthlyRevenue: "1000_10000_usd" },
    },
  });
  await service.execute({
    userId: "user_1",
    command: {
      type: "save_role",
      expectedRevision: 3,
      idempotencyKey: "role_command_1",
      payload: { role: "founder" },
    },
  });
  await service.execute({
    userId: "user_1",
    command: {
      type: "save_business_classification",
      expectedRevision: 4,
      idempotencyKey: "business_command_1",
      payload: { businessModel: "b2b", categories: ["saas"] },
    },
  });
  await service.execute({
    userId: "user_1",
    command: {
      type: "save_goals",
      expectedRevision: 5,
      idempotencyKey: "goals_command_1",
      payload: {
        signupIntent: "marketing_now",
        expectedOutcomes: ["save_time"],
      },
    },
  });
  await service.execute({
    userId: "user_1",
    command: {
      type: "save_attribution",
      expectedRevision: 6,
      idempotencyKey: "attribution_command_1",
      payload: { sources: [] },
    },
  });
  return {
    workspaceId: identity.workspaceId!,
    runId: source.analysis!.runId,
  };
}

function draftProfile(workspaceId: string, runId: string): BrandProfileRecord {
  return {
    id: "profile_1",
    workspaceId,
    revision: 1,
    status: "draft",
    schemaVersion: 1,
    profile: {
      schemaVersion: 1,
      contentLanguage: "en",
      identity: {
        companyName: "Tasmeem AI",
        coreIdentity: "A multilingual content platform for MENA brands.",
        logoAssetId: null,
      },
      offering: ["Arabic and English content generation"],
      audiences: [{ name: "MENA brands", description: "Small teams", weight: 100 }],
      problems: ["Slow content production"],
      benefits: ["Faster content planning"],
      differentiators: ["Arabic-first experience"],
      mission: "Make reliable content easier to create.",
      positioning: "A content copilot for MENA brands.",
      ownedSpace: "Reviewed multilingual brand content.",
      businessModel: "b2b",
      categories: ["saas"],
      voice: { descriptors: ["clear"], do: [], doNot: [] },
      prohibitedClaims: [],
      prohibitedTopics: [],
      competitors: [],
      contentAngles: ["Create more without losing your voice"],
      uncertainties: [],
      evidence: [],
      sourceIds: ["source_1"],
    },
    generatedFromRunId: runId,
    sourceProfileId: null,
    acceptedByUserId: null,
    acceptedAt: null,
    createdAt: now,
  };
}

describe("DefaultOnboardingService", () => {
  it("initializes Arabic defaults and creates a Workspace only on identity", async () => {
    const { repository, service } = testService();
    const initial = await service.getSnapshot({ userId: "user_1" });
    expect(initial).toMatchObject({
      status: "not_started",
      currentStep: "identity",
      interfaceLocale: "ar",
      contentLanguage: "ar",
      workspaceId: null,
    });

    const saved = await service.execute({
      userId: "user_1",
      command: identityCommand(),
    });
    expect(saved).toMatchObject({
      currentStep: "brand_source",
      interfaceLocale: "en",
      contentLanguage: "en",
      workspaceId: "ws_1",
    });
    expect(repository.workspaceLanguages.get("ws_1")).toBe("en");
  });

  it("creates one source/run and safely replays a command", async () => {
    const { repository, queue, service } = testService();
    await service.getSnapshot({ userId: "user_1" });
    await service.execute({ userId: "user_1", command: identityCommand() });
    const command = {
      type: "set_brand_source",
      expectedRevision: 1,
      idempotencyKey: "source_command_1",
      payload: {
        kind: "description",
        description: "We help MENA brands create reliable Arabic content.",
      },
    } as const;
    const first = await service.execute({ userId: "user_1", command });
    const replay = await service.execute({ userId: "user_1", command });
    expect(replay.revision).toBe(first.revision);
    expect(repository.sources.size).toBe(1);
    expect(repository.runs.size).toBe(1);
    expect(queue.scheduled.size).toBe(1);
  });

  it("exposes a failed dispatch after reload and retries the same saved run", async () => {
    const { repository, queue, service } = testService();
    await service.getSnapshot({ userId: "user_1" });
    await service.execute({ userId: "user_1", command: identityCommand() });
    const schedule = vi.spyOn(queue, "schedule").mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(service.execute({ userId: "user_1", command: {
      type: "set_brand_source", expectedRevision: 1, idempotencyKey: "source_queue_failure",
      payload: { kind: "description", description: "We help MENA brands create reliable Arabic content." },
    } })).rejects.toMatchObject({ status: 503 });
    const saved = await service.getSnapshot({ userId: "user_1" });
    expect(saved.currentStep).toBe("company_stage");
    expect(saved.analysis).toMatchObject({ status: "queued", errorCode: "WORKFLOW_DISPATCH_FAILED" });
    const command = { type: "retry_preparation", expectedRevision: saved.revision, idempotencyKey: "retry_queue_failure", payload: { runId: saved.analysis!.runId } };
    const recovered = await service.execute({ userId: "user_1", command });
    expect(recovered.currentStep).toBe(saved.currentStep);
    expect(recovered.analysis).toMatchObject({ runId: saved.analysis!.runId, status: "queued", errorCode: null });
    await service.execute({ userId: "user_1", command });
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(repository.sources.size).toBe(1);
    expect(repository.runs.size).toBe(1);
    expect(queue.scheduled.size).toBe(1);
    await expect(service.execute({ userId: "user_1", command: { ...command, expectedRevision: recovered.revision, idempotencyKey: "wrong_run_retry", payload: { runId: "someone_elses_run" } } })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects stale and out-of-order commands", async () => {
    const { service } = testService();
    await service.getSnapshot({ userId: "user_1" });
    await expect(
      service.execute({
        userId: "user_1",
        command: {
          type: "save_goals",
          expectedRevision: 0,
          idempotencyKey: "goals_too_early",
          payload: { signupIntent: "curious", expectedOutcomes: ["save_time"] },
        },
      }),
    ).rejects.toThrow(/not valid during identity/);
  });

  it("preserves answers while navigating back and creates a new source revision", async () => {
    const { repository, service } = testService();
    await reachReview(service);
    const changed = await service.execute({
      userId: "user_1",
      command: {
        type: "change_brand_source",
        expectedRevision: 7,
        idempotencyKey: "change_source_1",
        payload: {},
      },
    });
    expect(changed.currentStep).toBe("brand_source");
    expect(changed).toMatchObject({
      answers: { goals: { expectedOutcomes: ["save_time"] } },
    });

    await service.execute({
      userId: "user_1",
      command: {
        type: "set_brand_source",
        expectedRevision: 8,
        idempotencyKey: "source_command_2",
        payload: {
          kind: "description",
          description: "A corrected description with enough detail for a second analysis.",
        },
      },
    });
    expect([...repository.sources.values()].map((source) => source.revision)).toEqual([1, 2]);
  });

  it("creates an immutable corrected profile revision and matching first value", async () => {
    const generator: BrandProfileGenerator = {
      async generateProfile() {
        throw new Error("not used");
      },
      async generateActivationArtifact({ brandProfileId, profile }) {
        return {
          schemaVersion: 1,
          contentLanguage: profile.contentLanguage,
          kind: "social_post",
          title: "Corrected suggestion",
          hook: "Corrected hook",
          body: "Corrected body",
          rationale: "Uses the corrected profile.",
          suggestedFormats: ["LinkedIn post"],
          brandProfileId,
        };
      },
    };
    const { repository, service } = testService(() => generator);
    const { workspaceId, runId } = await reachReview(service);
    await repository.transitionAnalysisRun({
      runId,
      workspaceId,
      expectedStatuses: ["queued"],
      status: "ready",
      stage: "ready",
      startedAt: now,
      finishedAt: now,
      updatedAt: now,
    });
    const original = { ...draftProfile(workspaceId, runId), id: "profile_generated" };
    await repository.createDraftProfile(original);

    const edited = await service.execute({
      userId: "user_1",
      command: {
        type: "edit_brand_profile",
        expectedRevision: 7,
        idempotencyKey: "edit_profile_1",
        payload: {
          profileId: original.id,
          correction: {
            coreIdentity: "A corrected, reviewed identity.",
            offering: original.profile.offering,
            benefits: original.profile.benefits,
            differentiators: original.profile.differentiators,
            mission: original.profile.mission,
            positioning: original.profile.positioning,
            ownedSpace: original.profile.ownedSpace,
            voice: original.profile.voice,
            prohibitedClaims: original.profile.prohibitedClaims,
            prohibitedTopics: original.profile.prohibitedTopics,
            contentAngles: original.profile.contentAngles,
            uncertainties: original.profile.uncertainties,
          },
        },
      },
    });

    expect(repository.profiles.get(original.id)?.status).toBe("superseded");
    expect(edited.draftBrandProfile?.identity.coreIdentity).toBe(
      "A corrected, reviewed identity.",
    );
    expect(edited.draftBrandProfileId).not.toBe(original.id);
  });

  it("requires a validated draft, activates it, and completes with first value", async () => {
    const { repository, service } = testService();
    const { workspaceId, runId } = await reachReview(service);
    const run = await repository.getAnalysisRun(workspaceId, runId);
    expect(run).not.toBeNull();
    await repository.transitionAnalysisRun({
      runId,
      workspaceId,
      expectedStatuses: ["queued"],
      status: "ready",
      stage: "ready",
      startedAt: now,
      finishedAt: now,
      updatedAt: now,
    });
    await repository.createDraftProfile(draftProfile(workspaceId, runId));
    await repository.createActivationArtifact({
      id: "activation_1",
      workspaceId,
      brandProfileId: "profile_1",
      schemaVersion: 1,
      artifact: {
        schemaVersion: 1,
        contentLanguage: "en",
        kind: "social_post",
        title: "Start with a reviewed brand",
        hook: "Your content should sound like you.",
        body: "Build from reviewed brand facts and a clear voice.",
        rationale: "Shows the core activation value.",
        suggestedFormats: ["LinkedIn post"],
        brandProfileId: "profile_1",
      },
      createdAt: now,
    });

    const ready = await service.getSnapshot({ userId: "user_1" });
    expect(ready.status).toBe("ready");
    expect(ready.draftBrandProfile?.identity.companyName).toBe("Tasmeem AI");

    const accepted = await service.execute({
      userId: "user_1",
      command: {
        type: "accept_brand_profile",
        expectedRevision: 7,
        idempotencyKey: "accept_profile_1",
        payload: { profileId: "profile_1" },
      },
    });
    expect(accepted).toMatchObject({
      currentStep: "education",
      activeBrandProfileId: "profile_1",
      activationArtifactId: "activation_1",
    });

    const completed = await service.execute({
      userId: "user_1",
      command: {
        type: "complete",
        expectedRevision: 8,
        idempotencyKey: "complete_onboarding_1",
        payload: {},
      },
    });
    expect(completed.status).toBe("completed");
  });
});
