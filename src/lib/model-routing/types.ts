export type GenerationCapability = "text_generation" | "text_to_image" | "image_to_image" | "text_to_video" | "image_to_video" | "video_to_video";
export type GenerationQuality = "preview" | "standard" | "premium";
export type ExecutionMode = "sync" | "async";
export type GenerationFundingMode = "byok" | "managed";
export type ContentLanguage = "ar" | "en" | "mixed";
export type ArabicVariety = "msa" | "gulf" | "egyptian" | "levantine" | "maghrebi" | "other";

export interface ExactModelRef { provider: "replicate" | "google" | "kie" | "openai" | "fal" | "wavespeed"; model: string; version: string; inputSchemaDigest: string; }
export interface GenerationPersonaBinding {
  personaId: string;
  personaRevision: number;
  purpose: "generation";
  model: ExactModelRef & { provider: "replicate"; qualificationDigest: `sha256:${string}`; trainingJobId: string };
  disclosure: string;
  evidence: { consentEvidenceId: string | null; providerAcceptanceEvidenceId: string; disclosureEvidenceId: string; abuseReviewEvidenceId: string };
}
export interface CostQuote { currency: "USD"; amount: number; basis: "image" | "second" | "run"; quantity: number; quotedAt: Date; expiresAt: Date; }
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
  | { status: "qualified"; endpoint: "versioned"; version: string; inputSchemaDigest: `sha256:${string}`; executionPriceUsd: { basis: CostQuote["basis"]; amount: number }; maxQuantity: number; cancelAfterSeconds: number; outputShape: { width: number | null; height: number | null; fps: number | null }; inputContract: { promptKey: string; aspectRatioKey: string | null; quantityKey: string | null; imageKey: string | null; imageMode: "single" | "array"; safety: { parameterKey: string; safeValue: string | number | boolean } | null; lockedParameters: Record<string, string | number | boolean> }; evidence: ModelQualificationEvidence };
export interface ModelDescriptor {
  provider: ExactModelRef["provider"]; model: string; label: string;
  capabilities: readonly GenerationCapability[]; quality: GenerationQuality;
  contentLanguages: readonly ContentLanguage[]; arabicVarieties: readonly ArabicVariety[];
  verifiedRegions: readonly string[]; executionModes: readonly ExecutionMode[];
  aspectRatios: readonly string[]; priceUsd: { basis: CostQuote["basis"]; amount: number };
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
  providerComposition: { schema: "provider-input-composition/v1"; promptVersion: "tasmeemai-brand-prompt/v1"; mediaVersion: "tasmeemai-brand-media/v1"; rawPromptDigest: `sha256:${string}`; brandContextDigest: `sha256:${string}`; composedPromptDigest: `sha256:${string}`; sourceAssetIds: string[]; brandReferenceAssets: Array<{ assetId: string; digest: `sha256:${string}`; kind: "logo" }>; providerMediaAssetIds: string[]; brandMediaDisposition: "provider_input" | "prompt_context" | "provider_input_and_prompt_context"; model: ExactModelRef; capability: GenerationCapability; contractDigest: `sha256:${string}`; digest: `sha256:${string}` };
  rights: { snapshotId: string; revision: number; digest: `sha256:${string}`; basis: "owned" | "licensed" | "public_domain" | "consented"; permittedRemix: "reference_only" | "transform" | "derivative"; evidence: InspirationRightsEvidence[]; sourceAssetIds: string[] };
  remixBrief: { digest: `sha256:${string}`; preserve: string[]; transform: string[]; avoid: string[] };
  qualification: { id: string; revision: number; digest: `sha256:${string}`; expiresAt: Date };
  regionAdmission: { policyId: string; policyVersion: number; evidenceDigest: `sha256:${string}`; region: string; routeId: string; evidenceExpiresAt: Date };
  outputContract: { mediaType: "text" | "image" | "video"; aspectRatio: "9:16" | null; width: number | null; height: number | null; durationSeconds: number | null; fps: number | null; safetyParameterKey: string | null; safetyValue: string | number | boolean | null; lockedParametersDigest: `sha256:${string}` };
  requestedModel: ExactModelRef; selectedModel: ExactModelRef; fallbackAuthorizationId: string | null; fundingMode: GenerationFundingMode;
  persona?: GenerationPersonaBinding | null;
  quote: CostQuote; reservationIds: string[]; createdByUserId: string; createdAt: Date;
}

export interface InspirationRightsSnapshot {
  schema: "inspiration-rights-snapshot/v1"; id: string; workspaceId: string; revision: number;
  basis: GenerationIntent["rights"]["basis"]; permittedRemix: GenerationIntent["rights"]["permittedRemix"];
  evidence: InspirationRightsEvidence[]; sourceAssetIds: string[]; digest: `sha256:${string}`; createdByUserId: string; createdAt: Date;
}

export type CompatibilityFailure = "target_not_authorized" | "expired" | "revoked" | "capability" | "quality" | "content_language" | "arabic_variety" | "region" | "execution_mode" | "quote_expired" | "cost_ceiling" | "source_quote";
