export type GenerationCapability = "text_generation" | "text_to_image" | "image_to_image" | "text_to_video" | "image_to_video" | "video_to_video";
export type GenerationQuality = "preview" | "standard" | "premium";
export type ExecutionMode = "sync" | "async";
export type ReplicateEndpoint = "versioned" | "official";
export type GenerationFundingMode = "byok" | "managed";
export const DEFAULT_GENERATION_FUNDING_MODE: GenerationFundingMode = "managed";
export type ContentLanguage = "ar" | "en" | "mixed";
export type ArabicVariety = "msa" | "gulf" | "egyptian" | "levantine" | "maghrebi" | "other";
export type UnitPriceBasis = "image" | "second" | "run";
export type MeteredPriceBasis = "input_megapixel" | "output_megapixel";
export type PriceBasis = UnitPriceBasis | MeteredPriceBasis;
export type ExecutionPriceUsd =
  | { basis: UnitPriceBasis; amount: number }
  | { basis: "components"; components: ReadonlyArray<{ basis: MeteredPriceBasis; amount: number }> };
export type ProviderSafetyContract =
  | { mode?: "provider_input"; parameterKey: string; safeValue: string | number | boolean }
  | { mode: "provider_managed"; parameterKey: null; safeValue: null; evidenceSourceUrl: string; evidenceDigest: `sha256:${string}` };
export type PricingQuantity = { basis: PriceBasis; quantity: number };
export type CostQuoteLineItem = { basis: PriceBasis; unitAmount: number; quantity: number; maximumAmount: number };

export interface ExactModelRef { provider: "replicate" | "google" | "kie" | "openai" | "fal" | "wavespeed"; model: string; version: string; inputSchemaDigest: string; }
export interface GenerationPersonaBinding {
  personaId: string;
  personaRevision: number;
  purpose: "generation";
  model: ExactModelRef & { provider: "replicate"; qualificationDigest: `sha256:${string}`; trainingJobId: string };
  disclosure: string;
  evidence: { consentEvidenceId: string | null; providerAcceptanceEvidenceId: string; disclosureEvidenceId: string; abuseReviewEvidenceId: string };
}
export interface CostQuote {
  currency: "USD";
  /** Legacy normalized unit fields. Component quotes normalize to one run. */
  amount: number;
  basis: UnitPriceBasis;
  quantity: number;
  lineItems?: readonly CostQuoteLineItem[];
  quotedAt: Date;
  expiresAt: Date;
}
export interface ModelQualificationEvidence {
  id: string; revision: number; digest: `sha256:${string}`; issuedAt: Date; expiresAt: Date;
  signingKeyId: string;
  license: { name: string; commercialUse: boolean; derivativeUse: boolean; sourceUrl: string; digest: `sha256:${string}` };
  pricingSource: { sourceUrl: string; digest: `sha256:${string}`; checkedAt: Date };
  qualificationRun: { id: string; digest: `sha256:${string}`; completedAt: Date };
}
export interface InspirationRightsEvidence {
  schema: "inspiration-rights-evidence/v1"; id: string; workspaceId: string;
  sourceAssetId: string; sourceDigest: `sha256:${string}`;
  basis: "owned" | "licensed" | "public_domain" | "consented";
  permittedRemix: "reference_only" | "transform" | "derivative";
  issuer: { type: "workspace_asset_owner" | "license_authority" | "rights_holder" | "public_registry"; id: string };
  verifier: { type: "workspace_member"; userId: string };
  scope: { commercialUse: boolean; derivativeUse: boolean; modelInputUse: boolean; territories: string[] };
  evidenceDocumentAssetId: string | null; sourceUrl: string | null;
  issuedAt: Date; verifiedAt: Date; expiresAt: Date | null; digest: `sha256:${string}`;
}
export interface ImmutableBrandContext {
  schema: "brand-context/v1"; profileId: string; revision: number; acceptedAt: Date; contentLanguage: "ar" | "en" | "mixed";
  identity: { companyName: string; coreIdentity: string }; offering: string[]; audiences: Array<{ name: string; description: string; weight: number }>;
  benefits: string[]; differentiators: string[]; positioning: string; voice: { descriptors: string[]; do: string[]; doNot: string[] };
  palette: string[]; constraints: { prohibitedClaims: string[]; prohibitedTopics: string[] }; contentAngles: string[];
  referenceAssets: Array<{ assetId: string; digest: `sha256:${string}`; kind: "logo" }>; digest: `sha256:${string}`;
}
export type ModelExecutionQualification =
  | { status: "unqualified"; reason: "IMMUTABLE_VERSION_AND_SCHEMA_NOT_CONFIGURED" }
  | { status: "qualified"; endpoint: ReplicateEndpoint; version: string; inputSchemaDigest: `sha256:${string}`; executionPriceUsd: ExecutionPriceUsd; maxQuantity: number; cancelAfterSeconds: number; outputShape: { width: number | null; height: number | null; fps: number | null }; inputContract: { promptKey: string; aspectRatioKey: string | null; quantityKey: string | null; imageKey: string | null; imageMode: "single" | "array"; safety: ProviderSafetyContract | null; lockedParameters: Record<string, string | number | boolean> }; evidence: ModelQualificationEvidence };
export interface ModelDescriptor {
  provider: ExactModelRef["provider"]; model: string; label: string;
  capabilities: readonly GenerationCapability[]; quality: GenerationQuality;
  contentLanguages: readonly ContentLanguage[]; arabicVarieties: readonly ArabicVariety[];
  verifiedRegions: readonly string[]; executionModes: readonly ExecutionMode[];
  aspectRatios: readonly string[]; priceUsd: ExecutionPriceUsd;
  lane: "preview" | "brand" | "final" | "canary"; qualification: ModelExecutionQualification;
}

export interface FallbackAuthorization {
  schema: "model-fallback-authorization/v1"; id: string; workspaceId: string; revision: number; source: ExactModelRef;
  targets: readonly ExactModelRef[]; capability: GenerationCapability; minimumQuality: GenerationQuality; contentLanguage: ContentLanguage;
  arabicVariety: ArabicVariety | null; verifiedRegion: string; executionMode: ExecutionMode; maxTotalCostUsd: number;
  sourceQuote: { currency: "USD"; basis: CostQuote["basis"]; maxUnitAmount: number };
  issuedByUserId: string; issuedAt: Date; expiresAt: Date; revokedAt: Date | null; revokedByUserId: string | null;
}

export interface GenerationIntent {
  schema: "generation-intent/v1"; id: string; workspaceId: string;
  brand: { profileId: string; revision: number; digest: `sha256:${string}`; acceptedAt: Date; context: ImmutableBrandContext };
  promptDigest: `sha256:${string}`; capability: GenerationCapability; contentLanguage: ContentLanguage; arabicVariety: ArabicVariety | null;
  providerComposition: import("./provider-input-composition").ProviderCompositionEvidence;
  rights: { snapshotId: string; revision: number; digest: `sha256:${string}`; basis: "owned" | "licensed" | "public_domain" | "consented"; permittedRemix: "reference_only" | "transform" | "derivative"; evidence: InspirationRightsEvidence[]; sourceAssetIds: string[] };
  remixBrief: { digest: `sha256:${string}`; preserve: string[]; transform: string[]; avoid: string[] };
  qualification: { id: string; revision: number; digest: `sha256:${string}`; expiresAt: Date };
  regionAdmission: { policyId: string; policyVersion: number; evidenceDigest: `sha256:${string}`; region: string; routeId: string; evidenceExpiresAt: Date };
  outputContract: { mediaType: "text" | "image" | "video"; aspectRatio: "9:16" | null; width: number | null; height: number | null; durationSeconds: number | null; fps: number | null; safetyParameterKey: string | null; safetyValue: string | number | boolean | null; lockedParametersDigest: `sha256:${string}` };
  requestedModel: ExactModelRef; selectedModel: ExactModelRef; fallbackAuthorizationId: string | null; fundingMode: GenerationFundingMode;
  contentExecution?: {
    schema: "content-format-execution-binding/v1";
    contentPiece: { id: string; revision: number; digest: `sha256:${string}` };
    formatDefinition: { id: string; revision: number; digest: `sha256:${string}` };
    workflow: { id: string; revisionId: string; operation: string; inputs: string[] };
    modelPolicy: { id: string; revision: number; qualifiedModelsOnly: true; digest: `sha256:${string}`; region: string; defaultModel: ExactModelRef; compatibleModels: ExactModelRef[]; overrideMode: "explicit_exact_allowlist" };
    workflowInputs: { format: string; script: string; prompt: string; speaker: string; scene: string; captionStyle: string; personaId: string | null; mediaSetRevisions: Array<{ mediaSetId: string; revision: number; digest: `sha256:${string}`; orderedAssetIds: string[] }>; themeInstructions: Array<{ themeId: string; revision: number; digest: `sha256:${string}`; visual: { stylePrompt: string; palette: string[]; avoid: string[] }; captions: { style: string; fontFamilies: string[]; position: "top" | "center" | "bottom"; bidi: "native" }; licenseEvidenceIds: string[] }>; orderedSources: Array<{ assetId: string; type: string; slotKey: string; slotOrdinal: number }>; durationSeconds: number; aspectRatio: "9:16"; contentLanguage: ContentLanguage; arabicVariety: ArabicVariety | null };
    inputArtifactIds: string[];
    providerInputArtifactIds: string[];
    digest: `sha256:${string}`;
  } | null;
  persona?: GenerationPersonaBinding | null;
  creativeBinding?: {
    sessionId: string; sessionRevision: number; briefDigest: `sha256:${string}`;
    promptPolicyRevision: "arabic-safe-creative/v1"; stage: "copy" | "visual";
    copyRevision: number | null; copyDigest: `sha256:${string}` | null;
    output: { format: "image" | "video"; durationMs: number | null };
  };
  quote: CostQuote; reservationIds: string[]; createdByUserId: string; createdAt: Date;
}

export interface InspirationRightsSnapshot {
  schema: "inspiration-rights-snapshot/v1"; id: string; workspaceId: string; revision: number;
  basis: GenerationIntent["rights"]["basis"]; permittedRemix: GenerationIntent["rights"]["permittedRemix"];
  evidence: InspirationRightsEvidence[]; sourceAssetIds: string[]; digest: `sha256:${string}`; createdByUserId: string; createdAt: Date;
}

export type CompatibilityFailure = "target_not_authorized" | "expired" | "revoked" | "capability" | "quality" | "content_language" | "arabic_variety" | "region" | "execution_mode" | "quote_expired" | "cost_ceiling" | "source_quote";
