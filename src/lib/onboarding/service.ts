import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  noOpOnboardingAnalytics,
  recordOnboardingEventBestEffort,
  type OnboardingAnalytics,
} from "./analytics";
import type { InterfaceLocale, OnboardingSnapshot } from "./contracts";
import { OnboardingError } from "./errors";
import type { OnboardingQueue } from "./queue";
import type {
  BrandAnalysisRunRecord,
  BrandSourceRecord,
  CommandCommitResult,
  OnboardingAggregate,
  OnboardingRepository,
  WorkspaceProvisionInput,
} from "./repository";
import {
  onboardingAnswersV1Schema,
  onboardingCommandRequestSchema,
  onboardingSnapshotSchema,
  type OnboardingAnswersV1,
  type OnboardingCommandRequest,
} from "./schemas";
import { transitionOnboarding } from "./state-machine";

const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

export interface OnboardingClock {
  now(): Date;
}

export interface OnboardingIdGenerator {
  generate(prefix: "onb" | "ws" | "source" | "run"): string;
}

const systemClock: OnboardingClock = { now: () => new Date() };
const randomIdGenerator: OnboardingIdGenerator = {
  generate: (prefix) => `${prefix}_${randomUUID()}`,
};

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function workspaceProvision(input: {
  workspaceId: string;
  userId: string;
  fullName: string;
  companyName: string;
  interfaceLocale: InterfaceLocale;
  contentLanguage: string;
}): WorkspaceProvisionInput {
  const fallbackSlug = `workspace-${input.workspaceId.slice(-8).toLowerCase()}`;
  const slugBase = slugify(input.companyName) || fallbackSlug;
  const uniqueSuffix = input.workspaceId.replace(/[^A-Za-z0-9]/g, "").slice(-8);
  return {
    id: input.workspaceId,
    name: input.companyName,
    slug: `${slugBase}-${uniqueSuffix}`.slice(0, 80),
    organizationId: `org_${input.workspaceId}`,
    organizationMemberId: `mbr_${input.workspaceId}_${input.userId}`,
    ownerUserId: input.userId,
    ownerName: input.fullName,
    interfaceLocale: input.interfaceLocale,
    contentLanguage: input.contentLanguage,
    quotaBytes: DEFAULT_QUOTA_BYTES,
  };
}

function snapshotFromAggregate(aggregate: OnboardingAggregate): OnboardingSnapshot {
  const analysisReady = aggregate.analysis?.status === "ready";
  const status =
    aggregate.session.status === "in_progress" && analysisReady
      ? "ready"
      : aggregate.session.status;
  return onboardingSnapshotSchema.parse({
    sessionId: aggregate.session.id,
    userId: aggregate.session.userId,
    workspaceId: aggregate.session.workspaceId,
    status,
    currentStep: aggregate.session.currentStep,
    revision: aggregate.session.revision,
    interfaceLocale: aggregate.interfaceLocale,
    contentLanguage: aggregate.contentLanguage,
    answers: aggregate.session.answers,
    analysis: aggregate.analysis
      ? {
          runId: aggregate.analysis.id,
          stage: aggregate.analysis.stage,
          status: aggregate.analysis.status,
          errorCode: aggregate.analysis.errorCode,
          retryOfRunId: aggregate.analysis.retryOfRunId,
        }
      : null,
    draftBrandProfileId: aggregate.draftProfile?.id ?? null,
    draftBrandProfile: aggregate.draftProfile?.profile ?? null,
    activeBrandProfileId: aggregate.activeProfile?.id ?? null,
    activationArtifactId: aggregate.activationArtifact?.id ?? null,
    activationArtifact: aggregate.activationArtifact?.artifact ?? null,
  });
}

function mergeAnswer(
  current: OnboardingAnswersV1,
  command: OnboardingCommandRequest,
): OnboardingAnswersV1 {
  switch (command.type) {
    case "save_identity":
      return onboardingAnswersV1Schema.parse({ ...current, identity: command.payload });
    case "set_brand_source":
      return onboardingAnswersV1Schema.parse({ ...current, brandSource: command.payload });
    case "save_company_stage":
      return onboardingAnswersV1Schema.parse({ ...current, companyStage: command.payload });
    case "save_role":
      return onboardingAnswersV1Schema.parse({ ...current, role: command.payload });
    case "save_business_classification":
      return onboardingAnswersV1Schema.parse({
        ...current,
        businessClassification: command.payload,
      });
    case "save_goals":
      return onboardingAnswersV1Schema.parse({ ...current, goals: command.payload });
    case "save_attribution":
      return onboardingAnswersV1Schema.parse({ ...current, attribution: command.payload });
    default:
      return current;
  }
}

function commitError(result: Exclude<CommandCommitResult, { kind: "committed" | "replayed" }>): never {
  if (result.kind === "stale_revision") {
    throw new OnboardingError(
      "ONBOARDING_CONFLICT",
      "Onboarding changed in another tab. Refresh and try again.",
      409,
    );
  }
  if (result.kind === "not_found") {
    throw new OnboardingError(
      "ONBOARDING_NOT_FOUND",
      "Onboarding session was not found.",
      404,
    );
  }
  throw new OnboardingError(
    "ONBOARDING_CONFLICT",
    "The idempotency key was already used for a different request.",
    409,
  );
}

export class DefaultOnboardingService {
  constructor(
    private readonly repository: OnboardingRepository,
    private readonly queue: OnboardingQueue,
    private readonly clock: OnboardingClock = systemClock,
    private readonly ids: OnboardingIdGenerator = randomIdGenerator,
    private readonly analytics: OnboardingAnalytics = noOpOnboardingAnalytics,
  ) {}

  private async scheduleAnalysis(input: { workspaceId: string; runId: string }) {
    const intent = await this.repository.getAnalysisDispatchIntent(
      input.workspaceId,
      input.runId,
    );
    if (!intent) {
      throw new OnboardingError(
        "ONBOARDING_COMMAND_INVALID",
        "The Brand Analysis dispatch intent is missing.",
        500,
      );
    }
    if (intent.status === "dispatched") return;

    try {
      await this.queue.schedule(input);
      await this.repository.recordAnalysisDispatch({
        ...input,
        succeeded: true,
        now: this.clock.now(),
      });
    } catch {
      await this.repository.recordAnalysisDispatch({
        ...input,
        succeeded: false,
        errorCode: "WORKFLOW_DISPATCH_FAILED",
        now: this.clock.now(),
      });
      throw new OnboardingError(
        "ONBOARDING_COMMAND_INVALID",
        "Workspace preparation could not be queued. Retry the request safely.",
        503,
      );
    }
  }

  async getSnapshot(input: { userId: string }): Promise<OnboardingSnapshot> {
    let aggregate = await this.repository.readAggregate(input.userId);
    if (!aggregate) {
      await this.repository.getOrCreateSession({
        sessionId: this.ids.generate("onb"),
        userId: input.userId,
        interfaceLocale: "ar",
        contentLanguage: "ar",
        now: this.clock.now(),
      });
      aggregate = await this.repository.readAggregate(input.userId);
    }
    if (!aggregate) {
      throw new OnboardingError(
        "ONBOARDING_NOT_FOUND",
        "Unable to initialize onboarding.",
        500,
      );
    }
    const snapshot = snapshotFromAggregate(aggregate);
    await recordOnboardingEventBestEffort(this.analytics, {
      eventName: "step_viewed",
      userId: aggregate.session.userId,
      workspaceId: aggregate.session.workspaceId ?? undefined,
      sessionId: aggregate.session.id,
      step: aggregate.session.currentStep,
      interfaceLocale: aggregate.interfaceLocale,
      contentLanguage: aggregate.contentLanguage,
      occurredAt: this.clock.now(),
    });
    return snapshot;
  }

  async execute(input: {
    userId: string;
    command: unknown;
  }): Promise<OnboardingSnapshot> {
    const command = onboardingCommandRequestSchema.parse(input.command);
    const aggregate = await this.repository.readAggregate(input.userId);
    if (!aggregate) {
      throw new OnboardingError(
        "ONBOARDING_NOT_FOUND",
        "Onboarding session was not found.",
        404,
      );
    }
    const requestFingerprint = canonicalDigest(command);
    const receipt = await this.repository.readCommandReceipt({
      userId: input.userId,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint,
    });
    if (receipt.kind === "conflict") {
      throw new OnboardingError(
        "ONBOARDING_CONFLICT",
        "The idempotency key was already used for a different request.",
        409,
      );
    }
    if (receipt.kind === "replayed") {
      if (
        (command.type === "set_brand_source" || command.type === "retry_analysis") &&
        aggregate.session.workspaceId &&
        aggregate.analysis?.status === "queued"
      ) {
        await this.scheduleAnalysis({
          workspaceId: aggregate.session.workspaceId,
          runId: aggregate.analysis.id,
        });
      }
      return snapshotFromAggregate(aggregate);
    }
    if (command.expectedRevision !== aggregate.session.revision) {
      throw new OnboardingError(
        "ONBOARDING_CONFLICT",
        "Onboarding changed in another tab. Refresh and try again.",
        409,
      );
    }
    if (
      command.type === "accept_brand_profile" &&
      command.payload.profileId !== aggregate.draftProfile?.id
    ) {
      throw new OnboardingError(
        "ONBOARDING_COMMAND_INVALID",
        "The selected Brand Profile is no longer the current draft.",
        409,
      );
    }

    const transition = transitionOnboarding(
      {
        status:
          aggregate.session.status === "in_progress" &&
          aggregate.analysis?.status === "ready"
            ? "ready"
            : aggregate.session.status,
        currentStep: aggregate.session.currentStep,
      },
      command.type,
      {
        analysisReady: aggregate.analysis?.status === "ready",
        hasDraftProfile: Boolean(aggregate.draftProfile),
        hasActiveProfile: Boolean(aggregate.activeProfile),
        hasActivationArtifact: Boolean(aggregate.activationArtifact),
      },
    );

    const now = this.clock.now();
    const answers = mergeAnswer(aggregate.session.answers, command);
    let workspace: WorkspaceProvisionInput | undefined;
    let source: BrandSourceRecord | undefined;
    let analysisRun: BrandAnalysisRunRecord | undefined;

    if (command.type === "save_identity") {
      if (aggregate.session.workspaceId) {
        throw new OnboardingError(
          "ONBOARDING_COMMAND_INVALID",
          "This onboarding session already owns a Workspace.",
          409,
        );
      }
      const workspaceId = this.ids.generate("ws");
      workspace = workspaceProvision({
        workspaceId,
        userId: input.userId,
        fullName: command.payload.fullName,
        companyName: command.payload.companyName,
        interfaceLocale: command.payload.interfaceLocale ?? aggregate.interfaceLocale,
        contentLanguage: command.payload.contentLanguage ?? aggregate.contentLanguage,
      });
    }

    if (command.type === "set_brand_source") {
      const workspaceId = aggregate.session.workspaceId;
      if (!workspaceId) {
        throw new OnboardingError(
          "ONBOARDING_COMMAND_INVALID",
          "Create the Workspace before adding a Brand Source.",
          409,
        );
      }
      source = {
        id: this.ids.generate("source"),
        workspaceId,
        revision: 1,
        kind: command.payload.kind,
        submittedUrl: command.payload.kind === "website" ? command.payload.url : null,
        finalUrl: null,
        submittedDescription:
          command.payload.kind === "description" ? command.payload.description : null,
        cleanedText: null,
        contentHash: null,
        sourceLanguage: null,
        extractedBytes: null,
        fetchedAt: null,
        createdByUserId: input.userId,
        createdAt: now,
      };
      analysisRun = {
        id: this.ids.generate("run"),
        workspaceId,
        sourceId: source.id,
        retryOfRunId: null,
        status: "queued",
        stage: "queued",
        idempotencyKey: `initial:${source.id}`,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    if (command.type === "retry_analysis") {
      const previous = aggregate.analysis;
      if (!previous || !aggregate.session.workspaceId) {
        throw new OnboardingError(
          "ONBOARDING_COMMAND_INVALID",
          "There is no Brand Analysis to retry.",
          409,
        );
      }
      analysisRun = {
        id: this.ids.generate("run"),
        workspaceId: aggregate.session.workspaceId,
        sourceId: previous.sourceId,
        retryOfRunId: previous.id,
        status: "queued",
        stage: "queued",
        idempotencyKey: `retry:${previous.id}:${command.idempotencyKey}`,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    const result = await this.repository.commitCommand({
      sessionId: aggregate.session.id,
      userId: input.userId,
      expectedRevision: command.expectedRevision,
      nextStatus: transition.status,
      nextStep: transition.currentStep,
      answers,
      completedAt: command.type === "complete" ? now : undefined,
      receipt: {
        userId: input.userId,
        idempotencyKey: command.idempotencyKey,
        commandType: command.type,
        requestFingerprint,
      },
      workspace,
      source,
      analysisRun,
      activateProfileId:
        command.type === "accept_brand_profile" ? command.payload.profileId : undefined,
    });
    if (result.kind !== "committed" && result.kind !== "replayed") {
      commitError(result);
    }

    const updated = await this.repository.readAggregate(input.userId);
    if (!updated) {
      throw new OnboardingError(
        "ONBOARDING_NOT_FOUND",
        "Onboarding session disappeared after commit.",
        500,
      );
    }
    if (
      (command.type === "set_brand_source" || command.type === "retry_analysis") &&
      updated.session.workspaceId &&
      updated.analysis?.status === "queued"
    ) {
      await this.scheduleAnalysis({
        workspaceId: updated.session.workspaceId,
        runId: updated.analysis.id,
      });
    }
    const telemetryBase = {
      userId: input.userId,
      workspaceId: updated.session.workspaceId ?? undefined,
      sessionId: updated.session.id,
      interfaceLocale: updated.interfaceLocale,
      contentLanguage: updated.contentLanguage,
      occurredAt: now,
    } as const;
    await recordOnboardingEventBestEffort(this.analytics, {
      ...telemetryBase,
      eventName: "step_completed",
      step: aggregate.session.currentStep,
    });
    if (command.type === "set_brand_source") {
      await recordOnboardingEventBestEffort(this.analytics, {
        ...telemetryBase,
        eventName: "source_selected",
        sourceKind: command.payload.kind,
      });
    } else if (command.type === "accept_brand_profile") {
      await recordOnboardingEventBestEffort(this.analytics, {
        ...telemetryBase,
        eventName: "profile_accepted",
      });
    } else if (command.type === "complete") {
      await recordOnboardingEventBestEffort(this.analytics, {
        ...telemetryBase,
        eventName: "onboarding_completed",
      });
    }
    return snapshotFromAggregate(updated);
  }
}

export type OnboardingService = Pick<DefaultOnboardingService, "getSnapshot" | "execute">;
