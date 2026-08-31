import type { BrandProfileGenerator } from "./brand-profile/ports";
import type { BrandSourceReader } from "./brand-source/ports";
import { BrandProfileGenerationError } from "./brand-profile/ports";
import { BrandSourceReadError } from "./brand-source/ports";
import type { BrandAnalysisStage } from "./contracts";
import type {
  AnalysisGenerationContext,
  BrandProfileRecord,
  OnboardingRepository,
} from "./repository";

export interface OnboardingAnalysisInput {
  workspaceId: string;
  runId: string;
}

export type OnboardingAnalysisWorkStage =
  | "start"
  | "source"
  | "profile"
  | "activation"
  | "finalize";

export interface AnalysisFailure {
  code: string;
  retryable: boolean;
}

export interface AnalysisWorkerClock {
  now(): Date;
}

export interface AnalysisWorkerDependencies {
  repository: OnboardingRepository;
  readerFor(kind: "website" | "description"): BrandSourceReader;
  generator(): BrandProfileGenerator;
  clock?: AnalysisWorkerClock;
}

const STAGE_ORDER: BrandAnalysisStage[] = [
  "queued",
  "fetching_source",
  "extracting",
  "generating_profile",
  "generating_first_value",
  "ready",
];

class AnalysisInvariantError extends Error {
  readonly code = "ANALYSIS_INVARIANT_VIOLATION";
  readonly retryable = false;
}

function stageAtLeast(current: BrandAnalysisStage, target: BrandAnalysisStage) {
  return STAGE_ORDER.indexOf(current) >= STAGE_ORDER.indexOf(target);
}

export function classifyAnalysisFailure(error: unknown): AnalysisFailure {
  if (error instanceof BrandSourceReadError || error instanceof BrandProfileGenerationError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
  ) {
    return { code: error.code.slice(0, 120), retryable: error.retryable };
  }
  return { code: "ANALYSIS_INTERNAL_ERROR", retryable: true };
}

export class DefaultOnboardingAnalysisWorker {
  private readonly clock: AnalysisWorkerClock;

  constructor(private readonly dependencies: AnalysisWorkerDependencies) {
    this.clock = dependencies.clock ?? { now: () => new Date() };
  }

  private async context(input: OnboardingAnalysisInput): Promise<AnalysisGenerationContext> {
    const context = await this.dependencies.repository.getAnalysisGenerationContext(
      input.workspaceId,
      input.runId,
    );
    if (!context) throw new AnalysisInvariantError("Analysis context was not found.");
    return context;
  }

  private async advance(
    input: OnboardingAnalysisInput,
    target: BrandAnalysisStage,
  ) {
    const run = await this.dependencies.repository.getAnalysisRun(
      input.workspaceId,
      input.runId,
    );
    if (!run) throw new AnalysisInvariantError("Analysis run was not found.");
    if (run.status === "ready") return run;
    if (run.status !== "queued" && run.status !== "running") {
      throw new AnalysisInvariantError("Analysis run is already terminal.");
    }
    if (stageAtLeast(run.stage, target)) return run;

    const now = this.clock.now();
    const transitioned = await this.dependencies.repository.transitionAnalysisRun({
      workspaceId: input.workspaceId,
      runId: input.runId,
      expectedStatuses: run.status === "queued" ? ["queued"] : ["running"],
      expectedStages: [run.stage],
      status: target === "ready" ? "ready" : "running",
      stage: target,
      errorCode: null,
      errorMessage: null,
      startedAt: run.startedAt ?? now,
      finishedAt: target === "ready" ? now : null,
      updatedAt: now,
    });
    if (!transitioned) {
      const reloaded = await this.dependencies.repository.getAnalysisRun(
        input.workspaceId,
        input.runId,
      );
      if (reloaded && stageAtLeast(reloaded.stage, target)) return reloaded;
      throw new AnalysisInvariantError("Analysis stage transition conflicted.");
    }
    return transitioned;
  }

  async executeStage(
    input: OnboardingAnalysisInput,
    stage: OnboardingAnalysisWorkStage,
  ): Promise<void> {
    switch (stage) {
      case "start":
        await this.advance(input, "fetching_source");
        return;
      case "source":
        await this.readSource(input);
        return;
      case "profile":
        await this.generateProfile(input);
        return;
      case "activation":
        await this.generateActivation(input);
        return;
      case "finalize":
        await this.finalize(input);
    }
  }

  private async readSource(input: OnboardingAnalysisInput) {
    await this.advance(input, "fetching_source");
    const context = await this.context(input);
    if (!context.source.cleanedText) {
      const extraction = await this.dependencies.readerFor(context.source.kind).read(
        context.source,
      );
      const updated = await this.dependencies.repository.updateSourceExtraction({
        sourceId: context.source.id,
        workspaceId: input.workspaceId,
        finalUrl: extraction.finalUrl,
        cleanedText: extraction.cleanedText,
        contentHash: extraction.contentHash,
        sourceLanguage: extraction.sourceLanguage,
        extractedBytes: extraction.extractedBytes,
        fetchedAt: extraction.fetchedAt,
      });
      if (!updated) throw new AnalysisInvariantError("Source extraction could not be saved.");
    }
    await this.advance(input, "extracting");
  }

  private async generateProfile(input: OnboardingAnalysisInput) {
    await this.advance(input, "generating_profile");
    const existing = await this.dependencies.repository.getDraftProfileByRun(
      input.workspaceId,
      input.runId,
    );
    if (existing) return;

    const context = await this.context(input);
    const profile = await this.dependencies.generator().generateProfile({
      source: context.source,
      answers: context.answers,
      contentLanguage: context.contentLanguage,
    });
    const now = this.clock.now();
    await this.dependencies.repository.createDraftProfile({
      id: `profile_${input.runId}`,
      workspaceId: input.workspaceId,
      revision: await this.dependencies.repository.getNextBrandProfileRevision(
        input.workspaceId,
      ),
      status: "draft",
      schemaVersion: 1,
      profile,
      generatedFromRunId: input.runId,
      acceptedByUserId: null,
      acceptedAt: null,
      createdAt: now,
    });
  }

  private async requireProfile(input: OnboardingAnalysisInput): Promise<BrandProfileRecord> {
    const profile = await this.dependencies.repository.getDraftProfileByRun(
      input.workspaceId,
      input.runId,
    );
    if (!profile) throw new AnalysisInvariantError("Draft Brand Profile was not found.");
    return profile;
  }

  private async generateActivation(input: OnboardingAnalysisInput) {
    await this.advance(input, "generating_first_value");
    const profile = await this.requireProfile(input);
    const existing = await this.dependencies.repository.getActivationArtifactByProfile(
      input.workspaceId,
      profile.id,
    );
    if (existing) return;

    const artifact = await this.dependencies.generator().generateActivationArtifact({
      brandProfileId: profile.id,
      profile: profile.profile,
    });
    await this.dependencies.repository.createActivationArtifact({
      id: `activation_${input.runId}`,
      workspaceId: input.workspaceId,
      brandProfileId: profile.id,
      schemaVersion: 1,
      artifact,
      createdAt: this.clock.now(),
    });
  }

  private async finalize(input: OnboardingAnalysisInput) {
    const profile = await this.requireProfile(input);
    const artifact = await this.dependencies.repository.getActivationArtifactByProfile(
      input.workspaceId,
      profile.id,
    );
    if (!artifact) throw new AnalysisInvariantError("Activation artifact was not found.");
    await this.advance(input, "ready");
  }

  async fail(input: OnboardingAnalysisInput, failure: AnalysisFailure) {
    const run = await this.dependencies.repository.getAnalysisRun(
      input.workspaceId,
      input.runId,
    );
    if (!run || run.status === "ready" || run.status.startsWith("failed_")) return;
    await this.dependencies.repository.transitionAnalysisRun({
      workspaceId: input.workspaceId,
      runId: input.runId,
      expectedStatuses: ["queued", "running"],
      expectedStages: [run.stage],
      status: failure.retryable ? "failed_retryable" : "failed_terminal",
      stage: run.stage,
      errorCode: failure.code,
      errorMessage: null,
      startedAt: run.startedAt,
      finishedAt: this.clock.now(),
      updatedAt: this.clock.now(),
    });
  }
}
