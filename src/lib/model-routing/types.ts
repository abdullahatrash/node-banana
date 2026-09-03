export type GenerationCapability = "text_to_image" | "image_to_image" | "text_to_video" | "image_to_video" | "video_to_video";
export type GenerationQuality = "preview" | "standard" | "premium";
export type ExecutionMode = "sync" | "async";
export type ContentLanguage = "ar" | "en" | "mixed";
export type ArabicVariety = "msa" | "gulf" | "egyptian" | "levantine" | "maghrebi" | "other";

export interface ExactModelRef { provider: "replicate" | "google" | "kie" | "openai" | "fal" | "wavespeed"; model: string; version: string; inputSchemaDigest: string; }
export interface CostQuote { currency: "USD"; amount: number; basis: "image" | "second" | "run"; quantity: number; quotedAt: Date; expiresAt: Date; }
export interface ModelDescriptor extends ExactModelRef { label: string; capabilities: readonly GenerationCapability[]; quality: GenerationQuality; contentLanguages: readonly ContentLanguage[]; arabicVarieties: readonly ArabicVariety[]; verifiedRegions: readonly string[]; executionModes: readonly ExecutionMode[]; aspectRatios: readonly string[]; priceUsd: { basis: CostQuote["basis"]; amount: number }; lane: "preview" | "brand" | "final" | "canary"; }

export interface FallbackAuthorization {
  schema: "model-fallback-authorization/v1"; id: string; workspaceId: string; revision: number; source: ExactModelRef;
  targets: readonly ExactModelRef[]; capability: GenerationCapability; minimumQuality: GenerationQuality; contentLanguage: ContentLanguage;
  arabicVariety: ArabicVariety | null; verifiedRegion: string; executionMode: ExecutionMode; maxTotalCostUsd: number;
  issuedByUserId: string; issuedAt: Date; expiresAt: Date; revokedAt: Date | null; revokedByUserId: string | null;
}

export interface GenerationIntent {
  schema: "generation-intent/v1"; id: string; workspaceId: string;
  brand: { profileId: string; revision: number; digest: `sha256:${string}`; acceptedAt: Date };
  promptDigest: `sha256:${string}`; capability: GenerationCapability; contentLanguage: ContentLanguage; arabicVariety: ArabicVariety | null;
  rights: { basis: "owned" | "licensed" | "public_domain" | "consented"; evidenceRefs: string[]; sourceUrls: string[] };
  requestedModel: ExactModelRef; selectedModel: ExactModelRef; fallbackAuthorizationId: string | null;
  quote: CostQuote; reservationId: string; createdByUserId: string; createdAt: Date;
}

export type CompatibilityFailure = "target_not_authorized" | "expired" | "revoked" | "capability" | "quality" | "content_language" | "arabic_variety" | "region" | "execution_mode" | "quote_expired" | "cost_ceiling";
