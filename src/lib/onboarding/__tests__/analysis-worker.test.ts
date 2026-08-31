import { describe, expect, it } from "vitest";
import {
  DefaultOnboardingAnalysisWorker,
  classifyAnalysisFailure,
} from "../analysis-worker";
import { BrandSourceReadError, type BrandSourceReader } from "../brand-source/ports";
import { InMemoryOnboardingRepository } from "../memory-repository";
import type { BrandProfileGenerator } from "../brand-profile/ports";

const now = new Date("2026-08-31T12:00:00.000Z");
const input = { workspaceId: "ws_1", runId: "run_1" };

async function seededRepository() {
  const repository = new InMemoryOnboardingRepository();
  await repository.getOrCreateSession({
    sessionId: "onb_1",
    userId: "user_1",
    interfaceLocale: "ar",
    contentLanguage: "ar",
    now,
  });
  await repository.commitCommand({
    sessionId: "onb_1",
    userId: "user_1",
    expectedRevision: 0,
    nextStatus: "in_progress",
    nextStep: "brand_source",
    answers: {
      schemaVersion: 1,
      identity: { fullName: "نورة", companyName: "تصميم", logoAssetId: null },
    },
    receipt: {
      userId: "user_1",
      idempotencyKey: "identity_command_1",
      commandType: "save_identity",
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    },
    workspace: {
      id: "ws_1",
      name: "تصميم",
      slug: "tasmeem",
      organizationId: "org_1",
      organizationMemberId: "member_1",
      ownerUserId: "user_1",
      ownerName: "نورة",
      interfaceLocale: "ar",
      contentLanguage: "ar",
      quotaBytes: 1_000,
    },
  });
  await repository.commitCommand({
    sessionId: "onb_1",
    userId: "user_1",
    expectedRevision: 1,
    nextStatus: "in_progress",
    nextStep: "company_stage",
    answers: {
      schemaVersion: 1,
      identity: { fullName: "نورة", companyName: "تصميم", logoAssetId: null },
      brandSource: {
        kind: "description",
        description: "منصة تساعد فرق المنطقة على تخطيط محتوى عربي واضح.",
      },
    },
    receipt: {
      userId: "user_1",
      idempotencyKey: "source_command_1",
      commandType: "set_brand_source",
      requestFingerprint: `sha256:${"b".repeat(64)}`,
    },
    source: {
      id: "source_1",
      workspaceId: "ws_1",
      revision: 1,
      kind: "description",
      submittedUrl: null,
      finalUrl: null,
      submittedDescription: "منصة تساعد فرق المنطقة على تخطيط محتوى عربي واضح.",
      cleanedText: null,
      contentHash: null,
      sourceLanguage: null,
      extractedBytes: null,
      fetchedAt: null,
      createdByUserId: "user_1",
      createdAt: now,
    },
    analysisRun: {
      id: "run_1",
      workspaceId: "ws_1",
      sourceId: "source_1",
      retryOfRunId: null,
      status: "queued",
      stage: "queued",
      idempotencyKey: "initial_source_1",
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  });
  return repository;
}

function fakeGenerator(calls: { profiles: number; activations: number }): BrandProfileGenerator {
  return {
    async generateProfile() {
      calls.profiles += 1;
      return {
        schemaVersion: 1,
        contentLanguage: "ar",
        identity: {
          companyName: "تصميم",
          coreIdentity: "منصة محتوى للفرق في المنطقة.",
          logoAssetId: null,
        },
        offering: ["تخطيط المحتوى"],
        audiences: [{ name: "فرق التسويق", description: "فرق صغيرة", weight: 100 }],
        problems: ["بطء التخطيط"],
        benefits: ["أفكار واضحة"],
        differentiators: ["العربية والإنجليزية"],
        mission: "تسهيل تخطيط المحتوى.",
        positioning: "مساعد محتوى للمنطقة.",
        ownedSpace: "المحتوى متعدد اللغات.",
        businessModel: "b2b",
        categories: ["saas"],
        voice: { descriptors: ["واضح"], do: [], doNot: [] },
        prohibitedClaims: [],
        prohibitedTopics: [],
        competitors: [],
        contentAngles: ["خطط بوضوح"],
        uncertainties: ["تحتاج تفاصيل الميزات إلى المراجعة."],
        evidence: [],
        sourceIds: ["source_1"],
      };
    },
    async generateActivationArtifact({ brandProfileId }) {
      calls.activations += 1;
      return {
        schemaVersion: 1,
        contentLanguage: "ar",
        kind: "social_post",
        title: "خطط بوضوح",
        hook: "ابدأ بفكرة واحدة.",
        body: "راجع الفكرة مع فريقك ثم خصصها لكل قناة.",
        rationale: "يعكس هوية العلامة المراجعة.",
        suggestedFormats: ["منشور لينكدإن"],
        brandProfileId,
      };
    },
  };
}

describe("DefaultOnboardingAnalysisWorker", () => {
  it("persists each stage and is idempotent after the run is ready", async () => {
    const repository = await seededRepository();
    const generationCalls = { profiles: 0, activations: 0 };
    let readCalls = 0;
    const reader: BrandSourceReader = {
      async read() {
        readCalls += 1;
        return {
          finalUrl: null,
          cleanedText: "منصة تساعد فرق المنطقة على تخطيط محتوى عربي واضح.",
          contentHash: `sha256:${"c".repeat(64)}`,
          sourceLanguage: "ar",
          extractedBytes: 100,
          pages: [],
          fetchedAt: now,
        };
      },
    };
    const worker = new DefaultOnboardingAnalysisWorker({
      repository,
      readerFor: () => reader,
      generator: () => fakeGenerator(generationCalls),
      clock: { now: () => now },
    });

    for (const stage of ["start", "source", "profile", "activation", "finalize"] as const) {
      await worker.executeStage(input, stage);
    }
    expect(await repository.getAnalysisRun("ws_1", "run_1")).toMatchObject({
      status: "ready",
      stage: "ready",
    });
    expect(await repository.getDraftProfileByRun("ws_1", "run_1")).not.toBeNull();
    expect(
      await repository.getActivationArtifactByProfile("ws_1", "profile_run_1"),
    ).not.toBeNull();

    for (const stage of ["start", "source", "profile", "activation", "finalize"] as const) {
      await worker.executeStage(input, stage);
    }
    expect({ readCalls, ...generationCalls }).toEqual({
      readCalls: 1,
      profiles: 1,
      activations: 1,
    });
  });

  it("classifies a blocked source as terminal without persisting source text", async () => {
    const repository = await seededRepository();
    const worker = new DefaultOnboardingAnalysisWorker({
      repository,
      readerFor: () => ({
        async read() {
          throw new BrandSourceReadError("SOURCE_BLOCKED", "Blocked", false);
        },
      }),
      generator: () => fakeGenerator({ profiles: 0, activations: 0 }),
      clock: { now: () => now },
    });

    await worker.executeStage(input, "start");
    let failure;
    try {
      await worker.executeStage(input, "source");
    } catch (error) {
      failure = classifyAnalysisFailure(error);
    }
    expect(failure).toEqual({ code: "SOURCE_BLOCKED", retryable: false });
    await worker.fail(input, failure!);
    expect(await repository.getAnalysisRun("ws_1", "run_1")).toMatchObject({
      status: "failed_terminal",
      errorCode: "SOURCE_BLOCKED",
      errorMessage: null,
    });
    expect((await repository.getBrandSource("ws_1", "source_1"))?.cleanedText).toBeNull();
  });
});
