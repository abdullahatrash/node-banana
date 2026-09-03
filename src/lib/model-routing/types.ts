export type GenerationCapability = "text_to_image" | "image_to_image" | "text_to_video" | "image_to_video" | "video_to_video";
export type GenerationQuality = "preview" | "standard" | "premium";
export type ExecutionMode = "sync" | "async";
export type ContentLanguage = "ar" | "en" | "mixed";
export type ArabicVariety = "msa" | "gulf" | "egyptian" | "levantine" | "maghrebi" | "other";

export interface ExactModelRef { provider: "replicate" | "google" | "kie" | "openai" | "fal" | "wavespeed"; model: string; version: string; inputSchemaDigest: string; }
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
  | { status: "qualified"; endpoint: "versioned"; version: string; inputSchemaDigest: `sha256:${string}`; executionPriceUsd: { basis: CostQuote["basis"]; amount: number }; maxQuantity: number; cancelAfterSeconds: number; outputShape: { width: number; height: number; fps: number | null }; inputContract: { promptKey: string; brandContextKey: string; aspectRatioKey: string; quantityKey: string | null; imageKey: string | null; imageMode: "single" | "array"; safety: { parameterKey: string; safeValue: string | number | boolean }; lockedParameters: Record<string, string | number | boolean> }; evidence: ModelQualificationEvidence };
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
  rights: { snapshotId: string; revision: number; digest: `sha256:${string}`; basis: "owned" | "licensed" | "public_domain" | "consented"; permittedRemix: "reference_only" | "transform" | "derivative"; evidence: InspirationRightsEvidence[]; sourceAssetIds: string[] };
  remixBrief: { digest: `sha256:${string}`; preserve: string[]; transform: string[]; avoid: string[] };
  qualification: { id: string; revision: number; digest: `sha256:${string}`; expiresAt: Date };
  regionAdmission: { policyId: string; policyVersion: number; evidenceDigest: `sha256:${string}`; region: string; routeId: string; evidenceExpiresAt: Date };
  outputContract: { mediaType: "image" | "video"; aspectRatio: "9:16"; width: number; height: number; durationSeconds: number | null; fps: number | null; safetyParameterKey: string; safetyValue: string | number | boolean; lockedParametersDigest: `sha256:${string}` };
  requestedModel: ExactModelRef; selectedModel: ExactModelRef; fallbackAuthorizationId: string | null;
  quote: CostQuote; reservationIds: string[]; createdByUserId: string; createdAt: Date;
}

export interface InspirationRightsSnapshot {
  schema: "inspiration-rights-snapshot/v1"; id: string; workspaceId: string; revision: number;
  basis: GenerationIntent["rights"]["basis"]; permittedRemix: GenerationIntent["rights"]["permittedRemix"];
  evidence: InspirationRightsEvidence[]; sourceAssetIds: string[]; digest: `sha256:${string}`; createdByUserId: string; createdAt: Date;
}

export type CompatibilityFailure = "target_not_authorized" | "expired" | "revoked" | "capability" | "quality" | "content_language" | "arabic_variety" | "region" | "execution_mode" | "quote_expired" | "cost_ceiling" | "source_quote";
