import type {
  BrandAnalysisStage,
  BrandAnalysisStatus,
  InterfaceLocale,
  OnboardingStatus,
  OnboardingStep,
} from "./contracts";
import type {
  ActivationArtifactV1,
  BrandProfileV1,
  OnboardingAnswersV1,
} from "./schemas";

export interface OnboardingSessionRecord {
  id: string;
  userId: string;
  workspaceId: string | null;
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  answers: OnboardingAnswersV1;
  contentLanguage: string;
  revision: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrandSourceRecord {
  id: string;
  workspaceId: string;
  revision: number;
  kind: "website" | "description";
  submittedUrl: string | null;
  finalUrl: string | null;
  submittedDescription: string | null;
  cleanedText: string | null;
  contentHash: string | null;
  sourceLanguage: string | null;
  extractedBytes: number | null;
  fetchedAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
}

export interface BrandAnalysisRunRecord {
  id: string;
  workspaceId: string;
  sourceId: string;
  retryOfRunId: string | null;
  status: BrandAnalysisStatus;
  stage: BrandAnalysisStage;
  idempotencyKey: string;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BrandProfileRecord {
  id: string;
  workspaceId: string;
  revision: number;
  status: "draft" | "active" | "superseded";
  schemaVersion: 1;
  profile: BrandProfileV1;
  generatedFromRunId: string | null;
  sourceProfileId: string | null;
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
}

export interface ActivationArtifactRecord {
  id: string;
  workspaceId: string;
  brandProfileId: string;
  schemaVersion: 1;
  artifact: ActivationArtifactV1;
  createdAt: Date;
}

export interface AnalysisDispatchIntentRecord {
  runId: string;
  workspaceId: string;
  status: "pending" | "dispatched";
  attempts: number;
  lastErrorCode: string | null;
  dispatchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalysisGenerationContext {
  run: BrandAnalysisRunRecord;
  source: BrandSourceRecord;
  answers: OnboardingAnswersV1;
  contentLanguage: string;
}

export interface OnboardingAggregate {
  session: OnboardingSessionRecord;
  interfaceLocale: InterfaceLocale;
  contentLanguage: string;
  analysis: BrandAnalysisRunRecord | null;
  draftProfile: BrandProfileRecord | null;
  activeProfile: BrandProfileRecord | null;
  activationArtifact: ActivationArtifactRecord | null;
}

export interface WorkspaceProvisionInput {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  organizationMemberId: string;
  ownerUserId: string;
  ownerName: string;
  interfaceLocale: InterfaceLocale;
  contentLanguage: string;
  quotaBytes: number;
}

export interface WorkspaceIdentityUpdate {
  workspaceId: string;
  name: string;
  ownerName: string;
  interfaceLocale: InterfaceLocale;
  contentLanguage: string;
}

export interface CommandReceiptInput {
  userId: string;
  idempotencyKey: string;
  commandType: string;
  requestFingerprint: string;
}

export interface CommandCommitInput {
  sessionId: string;
  userId: string;
  expectedRevision: number;
  nextStatus: OnboardingStatus;
  nextStep: OnboardingStep;
  answers: OnboardingAnswersV1;
  completedAt?: Date | null;
  receipt: CommandReceiptInput;
  workspace?: WorkspaceProvisionInput;
  workspaceIdentityUpdate?: WorkspaceIdentityUpdate;
  source?: BrandSourceRecord;
  analysisRun?: BrandAnalysisRunRecord;
  activateProfileId?: string;
  replacementProfile?: BrandProfileRecord;
  replacementActivationArtifact?: ActivationArtifactRecord;
}

export type CommandCommitResult =
  | { kind: "committed"; session: OnboardingSessionRecord }
  | { kind: "replayed"; session: OnboardingSessionRecord }
  | { kind: "conflict" | "stale_revision" | "not_found" };

export type CommandReceiptResult =
  | { kind: "absent" | "conflict" }
  | { kind: "replayed"; sessionRevision: number };

export interface SourceExtractionUpdate {
  sourceId: string;
  workspaceId: string;
  finalUrl: string | null;
  cleanedText: string;
  contentHash: string;
  sourceLanguage: string | null;
  extractedBytes: number;
  fetchedAt: Date;
}

export interface AnalysisRunTransition {
  runId: string;
  workspaceId: string;
  expectedStatuses: BrandAnalysisStatus[];
  expectedStages?: BrandAnalysisStage[];
  status: BrandAnalysisStatus;
  stage: BrandAnalysisStage;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  updatedAt: Date;
}

export interface OnboardingRepository {
  getOrCreateSession(input: {
    sessionId: string;
    userId: string;
    interfaceLocale: InterfaceLocale;
    contentLanguage: string;
    now: Date;
  }): Promise<OnboardingSessionRecord>;
  readAggregate(userId: string): Promise<OnboardingAggregate | null>;
  readCommandReceipt(input: {
    userId: string;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<CommandReceiptResult>;
  commitCommand(input: CommandCommitInput): Promise<CommandCommitResult>;
  getBrandSource(workspaceId: string, sourceId: string): Promise<BrandSourceRecord | null>;
  getNextBrandSourceRevision(workspaceId: string): Promise<number>;
  isWorkspaceLogoAsset(workspaceId: string, assetId: string): Promise<boolean>;
  updateSourceExtraction(input: SourceExtractionUpdate): Promise<BrandSourceRecord | null>;
  getAnalysisRun(workspaceId: string, runId: string): Promise<BrandAnalysisRunRecord | null>;
  transitionAnalysisRun(input: AnalysisRunTransition): Promise<BrandAnalysisRunRecord | null>;
  getAnalysisGenerationContext(
    workspaceId: string,
    runId: string,
  ): Promise<AnalysisGenerationContext | null>;
  getDraftProfileByRun(
    workspaceId: string,
    runId: string,
  ): Promise<BrandProfileRecord | null>;
  getActivationArtifactByProfile(
    workspaceId: string,
    profileId: string,
  ): Promise<ActivationArtifactRecord | null>;
  getNextBrandProfileRevision(workspaceId: string): Promise<number>;
  createDraftProfile(input: BrandProfileRecord): Promise<BrandProfileRecord>;
  createActivationArtifact(input: ActivationArtifactRecord): Promise<ActivationArtifactRecord>;
  getAnalysisDispatchIntent(
    workspaceId: string,
    runId: string,
  ): Promise<AnalysisDispatchIntentRecord | null>;
  recordAnalysisDispatch(input: {
    workspaceId: string;
    runId: string;
    succeeded: boolean;
    errorCode?: string | null;
    now: Date;
  }): Promise<AnalysisDispatchIntentRecord | null>;
}
