import { describe, expect, it } from "vitest";
import { InMemoryOnboardingRepository } from "../memory-repository";
import type {
  ActivationArtifactRecord,
  BrandAnalysisRunRecord,
  BrandProfileRecord,
  BrandSourceRecord,
  CommandCommitInput,
} from "../repository";

const now = new Date("2026-08-31T12:00:00.000Z");

function source(): BrandSourceRecord {
  return {
    id: "source_1",
    workspaceId: "ws_1",
    revision: 1,
    kind: "description",
    submittedUrl: null,
    finalUrl: null,
    submittedDescription: "We make Arabic content tools for growing brands.",
    cleanedText: null,
    contentHash: null,
    sourceLanguage: null,
    extractedBytes: null,
    fetchedAt: null,
    createdByUserId: "user_1",
    createdAt: now,
  };
}

function run(): BrandAnalysisRunRecord {
  return {
    id: "run_1",
    workspaceId: "ws_1",
    sourceId: "source_1",
    retryOfRunId: null,
    status: "queued",
    stage: "queued",
    idempotencyKey: "analysis_source_1",
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function profile(): BrandProfileRecord {
  return {
    id: "profile_1",
    workspaceId: "ws_1",
    revision: 1,
    status: "draft",
    schemaVersion: 1,
    profile: {
      schemaVersion: 1,
      contentLanguage: "ar",
      identity: {
        companyName: "تصميم",
        coreIdentity: "منصة لصناعة المحتوى العربي.",
        logoAssetId: null,
      },
      offering: ["إنشاء المحتوى"],
      audiences: [{ name: "الشركات", description: "فرق صغيرة", weight: 100 }],
      problems: [],
      benefits: [],
      differentiators: [],
      mission: "تسهيل صناعة المحتوى.",
      positioning: "مساعد محتوى عربي.",
      ownedSpace: "محتوى عربي موثوق.",
      businessModel: "b2b",
      categories: ["saas"],
      voice: { descriptors: ["واضح"], do: [], doNot: [] },
      prohibitedClaims: [],
      prohibitedTopics: [],
      competitors: [],
      contentAngles: [],
      uncertainties: [],
      evidence: [],
      sourceIds: ["source_1"],
    },
    generatedFromRunId: "run_1",
    acceptedByUserId: null,
    acceptedAt: null,
    createdAt: now,
  };
}

function artifact(): ActivationArtifactRecord {
  return {
    id: "activation_1",
    workspaceId: "ws_1",
    brandProfileId: "profile_1",
    schemaVersion: 1,
    artifact: {
      schemaVersion: 1,
      contentLanguage: "ar",
      kind: "social_post",
      title: "ابدأ من هوية واضحة",
      hook: "المحتوى الجيد يبدأ بفهم العلامة.",
      body: "راجع هوية علامتك قبل إنشاء المحتوى.",
      rationale: "يعرض القيمة الأولى بسرعة.",
      suggestedFormats: ["منشور لينكدإن"],
      brandProfileId: "profile_1",
    },
    createdAt: now,
  };
}

async function initializedRepository() {
  const repository = new InMemoryOnboardingRepository();
  const session = await repository.getOrCreateSession({
    sessionId: "onb_1",
    userId: "user_1",
    interfaceLocale: "ar",
    contentLanguage: "ar",
    now,
  });
  return { repository, session };
}

function identityCommit(revision = 0): CommandCommitInput {
  return {
    sessionId: "onb_1",
    userId: "user_1",
    expectedRevision: revision,
    nextStatus: "in_progress",
    nextStep: "brand_source",
    answers: {
      schemaVersion: 1,
      identity: {
        fullName: "نورة النجار",
        companyName: "تصميم",
        logoAssetId: null,
      },
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
      organizationId: "org_ws_1",
      organizationMemberId: "mbr_ws_1_user_1",
      ownerUserId: "user_1",
      ownerName: "نورة النجار",
      interfaceLocale: "ar",
      contentLanguage: "ar",
      quotaBytes: 10_737_418_240,
    },
  };
}

describe("InMemoryOnboardingRepository", () => {
  it("creates one validated session per user", async () => {
    const { repository, session } = await initializedRepository();
    const replay = await repository.getOrCreateSession({
      sessionId: "onb_other",
      userId: "user_1",
      interfaceLocale: "en",
      contentLanguage: "en",
      now: new Date(now.getTime() + 1_000),
    });
    expect(replay.id).toBe(session.id);
    expect(replay.answers).toEqual({ schemaVersion: 1 });
    expect(replay.contentLanguage).toBe("ar");
  });

  it("commits workspace provisioning and replays the same command", async () => {
    const { repository } = await initializedRepository();
    const first = await repository.commitCommand(identityCommit());
    const replay = await repository.commitCommand(identityCommit());
    expect(first.kind).toBe("committed");
    expect(replay.kind).toBe("replayed");
    if (replay.kind === "replayed") {
      expect(replay.session.workspaceId).toBe("ws_1");
      expect(replay.session.revision).toBe(1);
    }
  });

  it("rejects idempotency collisions and stale revisions", async () => {
    const { repository } = await initializedRepository();
    await repository.commitCommand(identityCommit());
    const collision = identityCommit();
    collision.receipt.requestFingerprint = `sha256:${"b".repeat(64)}`;
    expect((await repository.commitCommand(collision)).kind).toBe("conflict");

    const stale = identityCommit(0);
    stale.receipt.idempotencyKey = "identity_command_2";
    expect((await repository.commitCommand(stale)).kind).toBe("stale_revision");
  });

  it("creates source and analysis resources atomically with a command", async () => {
    const { repository } = await initializedRepository();
    await repository.commitCommand(identityCommit());
    const result = await repository.commitCommand({
      sessionId: "onb_1",
      userId: "user_1",
      expectedRevision: 1,
      nextStatus: "in_progress",
      nextStep: "company_stage",
      answers: {
        ...identityCommit().answers,
        brandSource: {
          kind: "description",
          description: "We make Arabic content tools for growing brands.",
        },
      },
      receipt: {
        userId: "user_1",
        idempotencyKey: "brand_source_command_1",
        commandType: "set_brand_source",
        requestFingerprint: `sha256:${"c".repeat(64)}`,
      },
      source: source(),
      analysisRun: run(),
    });
    expect(result.kind).toBe("committed");
    expect(await repository.getBrandSource("ws_1", "source_1")).not.toBeNull();
    expect(await repository.getAnalysisRun("ws_1", "run_1")).not.toBeNull();
  });

  it("validates stored documents again on read", async () => {
    const { repository, session } = await initializedRepository();
    repository.sessions.set(session.id, {
      ...session,
      answers: { schemaVersion: 2 } as never,
    });
    await expect(repository.readAggregate("user_1")).rejects.toThrow();
  });

  it("persists analysis progress, a validated draft, and activation output", async () => {
    const { repository } = await initializedRepository();
    await repository.commitCommand(identityCommit());
    repository.sources.set(source().id, source());
    repository.runs.set(run().id, run());
    const transitioned = await repository.transitionAnalysisRun({
      runId: "run_1",
      workspaceId: "ws_1",
      expectedStatuses: ["queued"],
      status: "running",
      stage: "extracting",
      startedAt: now,
      updatedAt: now,
    });
    expect(transitioned?.stage).toBe("extracting");

    expect((await repository.createDraftProfile(profile())).profile.schemaVersion).toBe(1);
    expect((await repository.createActivationArtifact(artifact())).artifact.kind).toBe(
      "social_post",
    );
  });
});
