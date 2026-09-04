import { z } from "zod";

export const PRODUCT_RECORD_KINDS = [
  "inspiration_item",
  "blitz_item",
  "content_piece",
  "campaign_automation",
  "creator_persona",
  "media_set",
  "website_analytics_source",
  "geo_analytics_source",
  "referral",
  "channel_onboarding_order",
  "feedback",
  "support_case",
  "guidance_progress",
] as const;

export type ProductRecordKind = (typeof PRODUCT_RECORD_KINDS)[number];

export const CONTENT_FORMATS = [
  "slideshow",
  "wall_of_text",
  "video_hook_demo",
  "speaking_hook_demo",
  "talking_head_ugc",
  "green_screen_meme",
  "talking_head_green_screen",
  "product_spokesperson",
  "green_screen_mobile_app",
  "claymation",
  "character_swap",
  "custom_upload",
] as const;

export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const CONTENT_FORMAT_DEFINITIONS: Record<ContentFormat, {
  aspectRatio: "9:16" | "1:1";
  duration: readonly [number, number];
  requiredInputs: readonly ("script" | "images" | "video" | "persona" | "app_capture")[];
  supportsArabic: boolean;
  renderProofRequired: boolean;
}> = {
  slideshow: { aspectRatio: "9:16", duration: [4, 60], requiredInputs: ["script", "images"], supportsArabic: true, renderProofRequired: true },
  wall_of_text: { aspectRatio: "9:16", duration: [4, 60], requiredInputs: ["script", "video"], supportsArabic: true, renderProofRequired: true },
  video_hook_demo: { aspectRatio: "9:16", duration: [4, 60], requiredInputs: ["script", "video"], supportsArabic: true, renderProofRequired: true },
  speaking_hook_demo: { aspectRatio: "9:16", duration: [4, 60], requiredInputs: ["script", "video"], supportsArabic: true, renderProofRequired: true },
  talking_head_ugc: { aspectRatio: "9:16", duration: [4, 60], requiredInputs: ["script", "persona"], supportsArabic: true, renderProofRequired: true },
  green_screen_meme: { aspectRatio: "9:16", duration: [4, 60], requiredInputs: ["script", "images", "video"], supportsArabic: true, renderProofRequired: true },
  talking_head_green_screen: { aspectRatio: "9:16", duration: [4, 60], requiredInputs: ["script", "persona", "video"], supportsArabic: true, renderProofRequired: true },
  product_spokesperson: { aspectRatio: "9:16", duration: [4, 60], requiredInputs: ["script", "persona", "images"], supportsArabic: true, renderProofRequired: true },
  green_screen_mobile_app: { aspectRatio: "9:16", duration: [4, 60], requiredInputs: ["script", "app_capture"], supportsArabic: true, renderProofRequired: true },
  claymation: { aspectRatio: "9:16", duration: [4, 60], requiredInputs: ["script", "images"], supportsArabic: true, renderProofRequired: true },
  character_swap: { aspectRatio: "9:16", duration: [4, 60], requiredInputs: ["video", "persona"], supportsArabic: true, renderProofRequired: true },
  custom_upload: { aspectRatio: "1:1", duration: [4, 60], requiredInputs: ["video"], supportsArabic: true, renderProofRequired: true },
};

export const AUTOMATION_STEPS = [
  "basics",
  "format_mix",
  "inspiration_remix",
  "brand_language",
  "personas_media",
  "channels_variants",
  "cadence_capacity",
  "execution_budget",
  "review_authority",
  "validate_activate",
] as const;

export const ARABIC_VARIETIES = [
  "msa",
  "gulf",
  "egyptian",
  "levantine",
  "maghrebi",
] as const;

const text = (max = 2_000) => z.string().trim().min(1).max(max);
const optionalText = (max = 2_000) => z.string().trim().max(max).default("");

const inspirationSchema = z.object({
  sourceUrl: z.string().url(),
  sourceName: text(200),
  capturedAt: z.string().datetime(),
  metricsObservedAt: z.string().datetime(),
  metrics: z.object({ views: z.number().int().nonnegative(), likes: z.number().int().nonnegative() }),
  region: optionalText(80),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable().default(null),
  format: z.enum(CONTENT_FORMATS),
  rightsStatus: z.enum(["licensed", "user_submitted", "embeddable", "metadata_only", "restricted"]),
  permittedInfluence: z.array(z.enum(["topic", "hook", "pacing", "structure"])).min(1),
  whyThisAppears: z.array(text(300)).min(1),
  tags: z.array(text(80)).default([]),
});

const blitzSchema = z.object({
  inspirationItemId: text(200).nullable().default(null),
  contentPieceId: text(200).nullable().default(null),
  sourceAttribution: text(500),
  remixBrief: z.object({ influences: z.array(text(200)).min(1), protectedExpressionExcluded: z.boolean() }),
  rationale: text(1_000),
  rejectionReasons: z.array(text(300)).default([]),
});

const contentPieceSchema = z.object({
  format: z.enum(CONTENT_FORMATS),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable().default(null),
  prompt: optionalText(10_000),
  script: optionalText(25_000),
  aspectRatio: z.enum(["9:16", "1:1", "16:9"]).default("9:16"),
  durationSeconds: z.number().int().min(4).max(60).default(15),
  captionStyle: optionalText(100),
  sourceAssetIds: z.array(text(200)).default([]),
  candidateArtifactIds: z.array(text(200)).default([]),
  renderProofStatus: z.enum(["not_requested", "pending", "passed", "failed"]).default("not_requested"),
});

const campaignSchema = z.object({
  currentStep: z.number().int().min(1).max(10),
  name: text(200),
  formatMix: z.partialRecord(z.enum(CONTENT_FORMATS), z.number().int().min(0).max(100)),
  remixRatio: z.number().int().min(0).max(100),
  inspirationIds: z.array(text(200)).default([]),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable().default(null),
  personaIds: z.array(text(200)).default([]),
  mediaSetIds: z.array(text(200)).default([]),
  channelIds: z.array(text(200)).default([]),
  variantsPerChannel: z.number().int().min(1).max(10).default(1),
  cadence: z.object({ timezone: text(100), startAt: z.string().datetime().nullable(), endAt: z.string().datetime().nullable(), postsPerWeek: z.number().int().min(1).max(100) }),
  execution: z.object({ mode: z.enum(["byok", "managed"]), modelPolicy: text(200), creditCeiling: z.number().int().nonnegative(), budgetCents: z.number().int().nonnegative() }),
  reviewMode: z.enum(["request_human", "evaluate_policy"]),
  autoPublishGrantId: text(200).nullable().default(null),
  validationErrors: z.array(text(500)).default([]),
}).superRefine((value, context) => {
  const total = Object.values(value.formatMix).reduce((sum, percentage) => sum + percentage, 0);
  if (total !== 100) context.addIssue({ code: "custom", path: ["formatMix"], message: "Content format mix must total 100%." });
  if (value.reviewMode === "evaluate_policy" && !value.autoPublishGrantId) context.addIssue({ code: "custom", path: ["autoPublishGrantId"], message: "An exact active auto-publish grant is required." });
});

const personaSchema = z.object({
  kind: z.enum(["synthetic", "consented_likeness"]),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable().default(null),
  traits: z.array(text(200)).min(1),
  disclosure: text(1_000),
  consentEvidenceRef: text(500).nullable().default(null),
  consentExpiresAt: z.string().datetime().nullable().default(null),
  trainingSourceAssetIds: z.array(text(200)).default([]),
  trainingRunId: text(200).nullable().default(null),
  reusableModelRef: text(500).nullable().default(null),
});

const simpleSchemas = {
  media_set: z.object({ assetIds: z.array(text(200)), category: optionalText(100), description: optionalText(1_000) }),
  website_analytics_source: z.object({ hostname: text(253), publicKey: text(300), enabled: z.boolean(), lastEventAt: z.string().datetime().nullable() }),
  geo_analytics_source: z.object({ domain: text(253), topics: z.array(text(300)).min(1), enabled: z.boolean(), lastObservationAt: z.string().datetime().nullable() }),
  referral: z.object({ code: text(80), destinationEmail: z.string().email().nullable(), status: z.enum(["available", "invited", "qualified", "rewarded"]), rewardCreditCents: z.number().int().nonnegative() }),
  channel_onboarding_order: z.object({ platforms: z.array(text(80)).min(1), goals: z.array(text(300)).min(1), requestedLaunchAt: z.string().datetime().nullable(), notes: optionalText(2_000), statusDetail: optionalText(1_000) }),
  feedback: z.object({ category: z.enum(["idea", "problem", "praise"]), body: text(5_000), route: optionalText(500) }),
  support_case: z.object({ category: z.enum(["account", "billing", "generation", "publishing", "safety", "other"]), body: text(5_000), severity: z.enum(["normal", "urgent"]), resolution: optionalText(5_000) }),
  guidance_progress: z.object({ completedKeys: z.array(text(120)), dismissedReleaseIds: z.array(text(120)) }),
} as const;

export const PRODUCT_STATES: Record<ProductRecordKind, readonly string[]> = {
  inspiration_item: ["active", "saved", "dismissed", "restricted"],
  blitz_item: ["queued", "accepted", "rejected", "editing"],
  content_piece: ["active", "archived", "deleted"],
  campaign_automation: ["draft", "validating", "active", "paused", "archived"],
  creator_persona: ["draft", "consent_review", "ready_to_train", "training", "review", "active", "training_failed", "suspended", "consent_expired", "deleted"],
  media_set: ["active", "archived"],
  website_analytics_source: ["active", "disabled"],
  geo_analytics_source: ["active", "disabled"],
  referral: ["available", "invited", "qualified", "rewarded"],
  channel_onboarding_order: ["draft", "submitted", "in_review", "scheduled", "completed", "cancelled"],
  feedback: ["submitted", "reviewing", "planned", "completed", "closed"],
  support_case: ["open", "waiting_customer", "investigating", "resolved", "closed"],
  guidance_progress: ["active"],
};

const payloadSchemas: Record<ProductRecordKind, z.ZodType<Record<string, unknown>>> = {
  inspiration_item: inspirationSchema,
  blitz_item: blitzSchema,
  content_piece: contentPieceSchema,
  campaign_automation: campaignSchema,
  creator_persona: personaSchema,
  ...simpleSchemas,
};

export function parseProductPayload(kind: ProductRecordKind, payload: unknown) {
  return payloadSchemas[kind].parse(payload);
}

const PERSONA_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["consent_review", "ready_to_train", "deleted"],
  consent_review: ["ready_to_train", "deleted"],
  ready_to_train: ["training", "deleted"],
  training: ["review", "training_failed", "deleted"],
  training_failed: ["ready_to_train", "deleted"],
  review: ["active", "training_failed", "deleted"],
  active: ["suspended", "consent_expired", "deleted"],
  suspended: ["active", "deleted"],
  consent_expired: ["consent_review", "deleted"],
  deleted: [],
};

export function productTransitionIssue(input: { kind: ProductRecordKind; from: string; to: string; payload: Record<string, unknown>; now?: Date }): string | null {
  if (input.from === input.to) return null;
  if (input.kind !== "creator_persona") return null;
  if (!PERSONA_TRANSITIONS[input.from]?.includes(input.to)) return "CREATOR_PERSONA_TRANSITION_NOT_ALLOWED";
  const persona = personaSchema.parse(input.payload);
  if (persona.kind === "consented_likeness" && ["ready_to_train", "training", "review", "active"].includes(input.to)) {
    if (!persona.consentEvidenceRef || !persona.consentExpiresAt) return "CREATOR_PERSONA_CONSENT_REQUIRED";
    if (new Date(persona.consentExpiresAt) <= (input.now ?? new Date())) return "CREATOR_PERSONA_CONSENT_EXPIRED";
  }
  if (["training", "review", "active"].includes(input.to) && !persona.trainingRunId) return "CREATOR_PERSONA_TRAINING_RECEIPT_REQUIRED";
  if (input.to === "active" && !persona.reusableModelRef) return "CREATOR_PERSONA_MODEL_REFERENCE_REQUIRED";
  return null;
}

export const productCreateSchema = z.object({
  kind: z.enum(PRODUCT_RECORD_KINDS),
  title: text(240),
  state: text(80),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: text(200),
}).superRefine((value, context) => {
  if (!PRODUCT_STATES[value.kind].includes(value.state)) context.addIssue({ code: "custom", path: ["state"], message: "Unsupported state for record kind." });
  const result = payloadSchemas[value.kind].safeParse(value.payload);
  if (!result.success) for (const issue of result.error.issues) context.addIssue({ ...issue, path: ["payload", ...issue.path] });
});

export const productUpdateSchema = z.object({
  id: text(200),
  expectedRevision: z.number().int().positive(),
  title: text(240).optional(),
  state: text(80).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: text(200),
});
