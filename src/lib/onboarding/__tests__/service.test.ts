import { describe, expect, it } from "vitest";
import { InMemoryOnboardingRepository } from "../memory-repository";
import { InMemoryOnboardingQueue } from "../queue";
import type { BrandProfileRecord } from "../repository";
import { DefaultOnboardingService, type OnboardingIdGenerator } from "../service";

const now = new Date("2026-08-31T12:00:00.000Z");

function testService() {
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

