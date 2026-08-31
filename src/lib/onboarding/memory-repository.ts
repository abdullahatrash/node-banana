import {
  activationArtifactV1Schema,
  brandProfileV1Schema,
  contentLanguageSchema,
  onboardingAnswersV1Schema,
} from "./schemas";
import type {
  ActivationArtifactRecord,
  AnalysisRunTransition,
  BrandAnalysisRunRecord,
  BrandProfileRecord,
  BrandSourceRecord,
  CommandCommitInput,
  CommandCommitResult,
  OnboardingAggregate,
  OnboardingRepository,
  OnboardingSessionRecord,
  SourceExtractionUpdate,
} from "./repository";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function key(...parts: string[]): string {
  return parts.join("\u0000");
}

interface MemoryReceipt {
  fingerprint: string;
  revision: number;
}

export class InMemoryOnboardingRepository implements OnboardingRepository {
  readonly sessions = new Map<string, OnboardingSessionRecord>();
  readonly userSessionIds = new Map<string, string>();
  readonly sources = new Map<string, BrandSourceRecord>();
  readonly runs = new Map<string, BrandAnalysisRunRecord>();
  readonly profiles = new Map<string, BrandProfileRecord>();
  readonly artifacts = new Map<string, ActivationArtifactRecord>();
  readonly receipts = new Map<string, MemoryReceipt>();
  readonly userLocales = new Map<string, "ar" | "en">();
  readonly workspaceLanguages = new Map<string, string>();
  private mutationTail: Promise<void> = Promise.resolve();

  private async lock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.mutationTail = previous.then(() => current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async getOrCreateSession(
    input: Parameters<OnboardingRepository["getOrCreateSession"]>[0],
  ): Promise<OnboardingSessionRecord> {
    return this.lock(async () => {
      const existingId = this.userSessionIds.get(input.userId);
      if (existingId) return clone(this.sessions.get(existingId)!);
      const session: OnboardingSessionRecord = {
        id: input.sessionId,
        userId: input.userId,
        workspaceId: null,
        status: "not_started",
        currentStep: "identity",
        answers: { schemaVersion: 1 },
        contentLanguage: input.contentLanguage,
        revision: 0,
        completedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      };
      this.sessions.set(session.id, session);
      this.userSessionIds.set(session.userId, session.id);
      this.userLocales.set(session.userId, input.interfaceLocale);
      return clone(session);
    });
  }

  async readAggregate(userId: string): Promise<OnboardingAggregate | null> {
    const sessionId = this.userSessionIds.get(userId);
    if (!sessionId) return null;
    const rawSession = this.sessions.get(sessionId);
    if (!rawSession) return null;
    const session = clone(rawSession);
    session.answers = onboardingAnswersV1Schema.parse(session.answers);
    const workspaceId = session.workspaceId;
    const matchingRuns = workspaceId
      ? [...this.runs.values()]
          .filter((run) => run.workspaceId === workspaceId)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      : [];
    const profiles = workspaceId
      ? [...this.profiles.values()].filter((profile) => profile.workspaceId === workspaceId)
      : [];
    const draftProfile = profiles.find((profile) => profile.status === "draft") ?? null;
    const activeProfile = profiles.find((profile) => profile.status === "active") ?? null;
    const activationArtifact = activeProfile
      ? [...this.artifacts.values()].find(
          (artifact) =>
            artifact.workspaceId === workspaceId &&
            artifact.brandProfileId === activeProfile.id,
        ) ?? null
      : null;
    return {
      session,
      interfaceLocale: this.userLocales.get(userId) ?? "ar",
      contentLanguage: workspaceId
        ? this.workspaceLanguages.get(workspaceId) ?? "ar"
        : "ar",
      analysis: matchingRuns[0] ? clone(matchingRuns[0]) : null,
      draftProfile: draftProfile ? clone(draftProfile) : null,
      activeProfile: activeProfile ? clone(activeProfile) : null,
      activationArtifact: activationArtifact ? clone(activationArtifact) : null,
    };
  }

  async commitCommand(input: CommandCommitInput): Promise<CommandCommitResult> {
    return this.lock(async () => {
      const receiptKey = key(input.userId, input.receipt.idempotencyKey);
      const existingReceipt = this.receipts.get(receiptKey);
      if (existingReceipt) {
        if (existingReceipt.fingerprint !== input.receipt.requestFingerprint) {
          return { kind: "conflict" };
        }
        const replayed = this.sessions.get(input.sessionId);
        return replayed
          ? { kind: "replayed", session: clone(replayed) }
          : { kind: "not_found" };
      }

      const current = this.sessions.get(input.sessionId);
      if (!current || current.userId !== input.userId) return { kind: "not_found" };
      if (current.revision !== input.expectedRevision) return { kind: "stale_revision" };

      const answers = onboardingAnswersV1Schema.parse(input.answers);
      if (input.workspace) {
        contentLanguageSchema.parse(input.workspace.contentLanguage);
        current.workspaceId = input.workspace.id;
        current.contentLanguage = input.workspace.contentLanguage;
        this.userLocales.set(input.userId, input.workspace.interfaceLocale);
        this.workspaceLanguages.set(input.workspace.id, input.workspace.contentLanguage);
      }
      if (input.source) this.sources.set(input.source.id, clone(input.source));
      if (input.analysisRun) this.runs.set(input.analysisRun.id, clone(input.analysisRun));
      if (input.activateProfileId) {
        const profile = this.profiles.get(input.activateProfileId);
        if (!profile || profile.workspaceId !== current.workspaceId || profile.status !== "draft") {
          return { kind: "conflict" };
        }
        for (const candidate of this.profiles.values()) {
          if (candidate.workspaceId === current.workspaceId && candidate.status === "active") {
            candidate.status = "superseded";
          }
        }
        profile.status = "active";
        profile.acceptedByUserId = input.userId;
        profile.acceptedAt = new Date();
      }

      const updated: OnboardingSessionRecord = {
        ...current,
        status: input.nextStatus,
        currentStep: input.nextStep,
        answers,
        revision: current.revision + 1,
        completedAt: input.completedAt ?? current.completedAt,
        updatedAt: input.completedAt ?? new Date(),
      };
      this.sessions.set(updated.id, updated);
      this.receipts.set(receiptKey, {
        fingerprint: input.receipt.requestFingerprint,
        revision: updated.revision,
      });
      return { kind: "committed", session: clone(updated) };
    });
  }

  async getBrandSource(workspaceId: string, sourceId: string) {
    const source = this.sources.get(sourceId);
    return source?.workspaceId === workspaceId ? clone(source) : null;
  }

  async updateSourceExtraction(input: SourceExtractionUpdate) {
    return this.lock(async () => {
      const source = this.sources.get(input.sourceId);
      if (!source || source.workspaceId !== input.workspaceId) return null;
      const updated: BrandSourceRecord = { ...source, ...input };
      this.sources.set(source.id, updated);
      return clone(updated);
    });
  }

  async getAnalysisRun(workspaceId: string, runId: string) {
    const run = this.runs.get(runId);
    return run?.workspaceId === workspaceId ? clone(run) : null;
  }

  async transitionAnalysisRun(input: AnalysisRunTransition) {
    return this.lock(async () => {
      const run = this.runs.get(input.runId);
      if (
        !run ||
        run.workspaceId !== input.workspaceId ||
        !input.expectedStatuses.includes(run.status)
      ) {
        return null;
      }
      const updated: BrandAnalysisRunRecord = {
        ...run,
        status: input.status,
        stage: input.stage,
        errorCode: input.errorCode === undefined ? run.errorCode : input.errorCode,
        errorMessage: input.errorMessage === undefined ? run.errorMessage : input.errorMessage,
        startedAt: input.startedAt === undefined ? run.startedAt : input.startedAt,
        finishedAt: input.finishedAt === undefined ? run.finishedAt : input.finishedAt,
        updatedAt: input.updatedAt,
      };
      this.runs.set(run.id, updated);
      return clone(updated);
    });
  }

  async createDraftProfile(input: BrandProfileRecord) {
    return this.lock(async () => {
      const existing = [...this.profiles.values()].find(
        (profile) => profile.generatedFromRunId === input.generatedFromRunId,
      );
      if (existing) return clone(existing);
      const record = clone(input);
      record.profile = brandProfileV1Schema.parse(record.profile);
      this.profiles.set(record.id, record);
      return clone(record);
    });
  }

  async createActivationArtifact(input: ActivationArtifactRecord) {
    return this.lock(async () => {
      const existing = [...this.artifacts.values()].find(
        (artifact) =>
          artifact.workspaceId === input.workspaceId &&
          artifact.brandProfileId === input.brandProfileId,
      );
      if (existing) return clone(existing);
      const record = clone(input);
      record.artifact = activationArtifactV1Schema.parse(record.artifact);
      this.artifacts.set(record.id, record);
      return clone(record);
    });
  }
}
