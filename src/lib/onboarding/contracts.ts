export const INTERFACE_LOCALES = ["ar", "en"] as const;

export const ONBOARDING_STEPS = [
  "identity",
  "brand_source",
  "company_stage",
  "role",
  "business_classification",
  "goals",
  "attribution",
  "review",
  "education",
] as const;

export const ONBOARDING_STATUSES = [
  "not_started",
  "in_progress",
  "ready",
  "completed",
  "completed_legacy",
] as const;

export const TEAM_SIZES = [
  "solo",
  "2_5",
  "6_10",
  "11_20",
  "21_50",
  "50_plus",
] as const;

export const MONTHLY_REVENUE_RANGES = [
  "pre_revenue",
  "1_1000_usd",
  "1000_10000_usd",
  "10000_50000_usd",
  "50000_500000_usd",
  "500000_plus_usd",
] as const;

export const PROFESSIONAL_ROLES = [
  "founder",
  "social_media_manager",
  "marketing_manager",
  "agency_owner",
  "freelancer",
  "product_manager",
  "content_creator",
  "growth_manager",
  "other",
] as const;

export const BUSINESS_MODELS = ["b2b", "b2c", "both"] as const;

export const BUSINESS_CATEGORIES = [
  "ecommerce",
  "saas",
  "agency",
  "services",
  "marketplace",
  "media_content",
  "mobile_app",
  "other",
] as const;

export const SIGNUP_INTENTS = [
  "marketing_now",
  "marketing_later",
  "curious",
] as const;

export const EXPECTED_OUTCOMES = [
  "save_time",
  "more_social_views",
  "drive_site_traffic",
  "generate_revenue",
  "learn_content_marketing",
  "other",
] as const;

export const ACQUISITION_SOURCES = [
  "x",
  "linkedin",
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "podcast",
  "newsletter",
  "google",
  "reddit",
  "referral",
  "other",
] as const;

export const BRAND_ANALYSIS_STAGES = [
  "queued",
  "fetching_source",
  "extracting",
  "generating_profile",
  "generating_first_value",
  "ready",
] as const;

export const BRAND_ANALYSIS_STATUSES = [
  "queued",
  "running",
  "ready",
  "failed_retryable",
  "failed_terminal",
] as const;

export type InterfaceLocale = (typeof INTERFACE_LOCALES)[number];
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
export type BrandAnalysisStage = (typeof BRAND_ANALYSIS_STAGES)[number];
export type BrandAnalysisStatus = (typeof BRAND_ANALYSIS_STATUSES)[number];

export interface OnboardingAnalysisSnapshot {
  runId: string;
  stage: BrandAnalysisStage;
  status: BrandAnalysisStatus;
  errorCode: string | null;
  retryOfRunId: string | null;
}

export interface OnboardingSnapshot {
  sessionId: string;
  userId: string;
  workspaceId: string | null;
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  revision: number;
  interfaceLocale: InterfaceLocale;
  contentLanguage: string;
  answers: unknown;
  analysis: OnboardingAnalysisSnapshot | null;
  draftBrandProfileId: string | null;
  draftBrandProfile: import("./schemas").BrandProfileV1 | null;
  activeBrandProfileId: string | null;
  activationArtifactId: string | null;
  activationArtifact: import("./schemas").ActivationArtifactV1 | null;
}
