import { z } from "zod";
import { supportAttachmentReferencesSchema } from "@/lib/product-support/attachment-policy";

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

export const BLITZ_REJECTION_CODES = ["not_relevant", "brand_mismatch", "stale_source", "rights_unclear", "too_similar", "wrong_format", "other"] as const;

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

const blitzRejectionReasonSchema = z.object({
  code: z.enum(BLITZ_REJECTION_CODES),
  note: z.string().trim().max(300).default(""),
}).strict();

const legacyBlitzRejectionReasonSchema = text(300).transform((note) => ({
  code: "other" as const,
  note,
}));

export const inspirationPayloadSchema = z.object({
  sourceUrl: z.union([
    z.string().url(),
    z.string().regex(/^\/api\/studio\/assets\/[A-Za-z0-9%._~-]+\/download$/),
  ]),
  sourceAssetId: text(200).nullable().default(null),
  sourceMediaType: z.enum(["image", "video"]).nullable().default(null),
  sourceName: text(200),
  capturedAt: z.string().datetime(),
  metricsObservedAt: z.string().datetime(),
  metrics: z.object({ views: z.number().int().nonnegative(), likes: z.number().int().nonnegative() }),
  region: optionalText(80),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable().default(null),
  format: z.enum(CONTENT_FORMATS),
  rightsStatus: z.enum(["licensed", "user_submitted", "embeddable", "metadata_only", "restricted"]),
  rightsSnapshot: z.object({ id: text(200), revision: z.number().int().positive(), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).nullable().default(null),
  permittedInfluence: z.array(z.enum(["topic", "hook", "pacing", "structure"])).min(1),
  whyThisAppears: z.array(text(300)).min(1),
  tags: z.array(text(80)).default([]),
});

export const blitzPayloadSchema = z.object({
  campaignId: text(200).nullable().default(null),
  replenishmentRunId: text(200).nullable().default(null),
  inspirationItemId: text(200).nullable().default(null),
  contentPieceId: text(200).nullable().default(null),
  sourceAttribution: text(500),
  sourceAssetId: text(200).nullable().default(null),
  sourceMediaType: z.enum(["image", "video"]).nullable().default(null),
  rightsSnapshot: z.object({ id: text(200), revision: z.number().int().positive(), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).nullable().default(null),
  rightsBasis: z.enum(["owned", "licensed", "public_domain", "consented"]).nullable().default(null),
  permittedRemix: z.enum(["reference_only", "transform", "derivative"]).nullable().default(null),
  rightsEvidenceIds: z.array(text(200)).default([]),
  contentLanguage: z.enum(["ar", "en", "mixed"]).nullable().default(null),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable().default(null),
  format: z.enum(CONTENT_FORMATS).nullable().default(null),
  remixBrief: z.object({ influences: z.array(text(200)).min(1), protectedExpressionExcluded: z.boolean() }),
  rationale: text(1_000),
  sourceComparison: z.object({ views: z.number().int().nonnegative(), likes: z.number().int().nonnegative(), observedAt: z.string().datetime(), selectionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).nullable().default(null),
  executionMode: z.enum(["byok", "managed"]).nullable().default(null),
  generationCeilingCents: z.number().int().nonnegative().default(0),
  rejectionReasons: z.array(z.union([blitzRejectionReasonSchema, legacyBlitzRejectionReasonSchema])).max(12).default([]),
});

export const contentPieceSchema = z.object({
  format: z.enum(CONTENT_FORMATS),
  formatDefinition: z.object({ id: text(200), revision: z.number().int().positive(), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).nullable().default(null),
  contentLanguage: z.enum(["ar", "en", "mixed"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable().default(null),
  prompt: optionalText(10_000),
  script: optionalText(25_000),
  aspectRatio: z.enum(["9:16", "1:1", "16:9"]).default("9:16"),
  durationSeconds: z.number().int().min(4).max(60).default(15),
  captionStyle: optionalText(100),
  speaker: optionalText(500),
  scene: optionalText(1_000),
  sourceAssetIds: z.array(text(200)).default([]),
  personaId: text(200).nullable().default(null),
  mediaSetIds: z.array(text(200)).default([]),
  themeRevisionRefs: z.array(z.object({ themeId: text(200), revision: z.number().int().positive() }).strict()).default([]),
  validationIssues: z.array(text(200)).default([]),
  candidateArtifactIds: z.array(text(200)).default([]),
  candidates: z.array(z.object({
    assetId: text(200), intentId: text(200).nullable(), operationId: text(200).nullable(), contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), createdAt: z.string().datetime(),
    renderProof: z.object({
      schema: z.literal("content-render-proof/v1"), status: z.literal("passed"),
      inputAssets: z.array(z.object({ assetId: text(200), type: z.enum(["image", "video"]), contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), width: z.number().int().positive(), height: z.number().int().positive(), durationSeconds: z.number().int().positive().nullable() })),
      output: z.object({ assetId: text(200), contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), width: z.number().int().positive(), height: z.number().int().positive(), durationSeconds: z.number().int().positive().nullable() }),
      intentId: text(200).nullable(), operationId: text(200).nullable(), verifiedAt: z.string().datetime(), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    }),
  })).default([]),
  renderProofStatus: z.enum(["not_requested", "pending", "passed", "failed"]).default("not_requested"),
  generatedText: z.object({
    textOutputId: text(200),
    intentId: text(200),
    operationId: text(200),
    contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).nullable().default(null),
  generatedMedia: z.object({
    assetId: text(200),
    intentId: text(200),
    operationId: text(200),
    contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).nullable().default(null),
});

export const campaignPayloadSchema = z.object({
  currentStep: z.number().int().min(1).max(10),
  name: text(200),
  formatMix: z.partialRecord(z.enum(CONTENT_FORMATS), z.number().int().min(0).max(100)),
  remixRatio: z.number().int().min(0).max(100),
  inspirationIds: z.array(text(200)).default([]),
  brandProfileRef: z.object({ id: text(200), revision: z.number().int().positive(), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).nullable().default(null),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(ARABIC_VARIETIES).nullable().default(null),
  personaIds: z.array(text(200)).default([]),
  demoAssetIds: z.array(text(200)).default([]),
  mediaSetIds: z.array(text(200)).default([]),
  themeRevisionRefs: z.array(z.object({ themeId: text(200), revision: z.number().int().positive(), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict()).default([]),
  channelIds: z.array(text(200)).default([]),
  variantsPerChannel: z.number().int().min(1).max(10).default(1),
  cadence: z.object({ timezone: text(100), weekStart: z.number().int().min(0).max(6).default(1), startAt: z.string().datetime().nullable(), endAt: z.string().datetime().nullable(), postsPerWeek: z.number().int().min(1).max(100), calendarCapacity: z.number().int().min(1).max(1_000).default(100) }),
  execution: z.object({
    mode: z.enum(["byok", "managed"]),
    modelPolicy: text(200),
    creditCeiling: z.number().int().nonnegative(),
    budgetCents: z.number().int().nonnegative(),
    replenishmentMode: z.enum(["daily", "manual"]).default("manual"),
    blitzTargetCapacity: z.number().int().min(1).max(100).default(20),
    blitzMaximumCreatesPerRun: z.number().int().min(1).max(50).default(10),
    workflow: z.object({
      workflowId: text(200),
      workflowRevisionId: text(200),
      inputs: z.record(z.string().trim().min(1).max(200), z.string().max(25_000)),
      inputArtifactIds: z.array(text(200)).max(100),
    }).nullable().default(null),
  }),
  reviewMode: z.enum(["request_human", "evaluate_policy"]),
  autoPublishGrantId: text(200).nullable().default(null),
  validationErrors: z.array(text(500)).default([]),
  runtime: z.object({
    runId: text(200),
    workflowId: text(200),
    workflowRevisionId: text(200),
    state: z.enum(["accepted", "running", "waiting", "outcome_unknown", "completed", "failed"]),
    startSnapshotDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    quoteId: text(200),
    quotedAmount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    acceptedAt: z.string().datetime(),
    scheduleAuthority: z.object({ principalId: text(200), keyId: text(300), authorizationEvidenceRef: text(500) }).nullable().default(null),
  }).nullable().default(null),
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

export const websiteAnalyticsSourceSchema = z.object({ hostname: text(253), publicKey: text(300), enabled: z.boolean(), lastEventAt: z.string().datetime().nullable(), verificationStatus: z.enum(["pending", "verified", "failed"]).default("pending"), verificationChallenge: text(300).default("legacy-unverified"), verifiedAt: z.string().datetime().nullable().default(null), refreshStatus: z.enum(["idle", "queued", "running", "succeeded", "failed"]).default("idle"), refreshRequestedAt: z.string().datetime().nullable().default(null), lastRefreshAt: z.string().datetime().nullable().default(null), lastRefreshError: text(300).nullable().default(null) })
export const geoAnalyticsSourceSchema = z.object({ domain: text(253), topics: z.array(text(300)).min(1), enabled: z.boolean(), lastObservationAt: z.string().datetime().nullable(), verificationStatus: z.enum(["pending", "verified", "failed"]).default("pending"), verificationChallenge: text(300).default("legacy-unverified"), verifiedAt: z.string().datetime().nullable().default(null), refreshStatus: z.enum(["idle", "queued", "running", "succeeded", "failed"]).default("idle"), refreshRequestedAt: z.string().datetime().nullable().default(null), lastRefreshAt: z.string().datetime().nullable().default(null), lastRefreshError: text(300).nullable().default(null) })

const simpleSchemas = {
  media_set: z.object({ assetIds: z.array(text(200)), category: optionalText(100), description: optionalText(1_000) }),
  website_analytics_source: websiteAnalyticsSourceSchema,
  geo_analytics_source: geoAnalyticsSourceSchema,
  referral: z.object({ code: text(80), destinationEmail: z.string().email().nullable(), status: z.enum(["available", "invited", "qualified", "rewarded"]), rewardCreditCents: z.number().int().nonnegative() }),
  channel_onboarding_order: z.object({ platforms: z.array(text(80)).min(1), goals: z.array(text(300)).min(1), requestedLaunchAt: z.string().datetime().nullable(), notes: optionalText(2_000), statusDetail: optionalText(1_000) }),
  feedback: z.object({ category: z.enum(["idea", "problem", "praise"]), body: text(5_000), route: optionalText(500), attachmentRefs: supportAttachmentReferencesSchema.default([]) }),
  support_case: z.object({ category: z.enum(["account", "billing", "generation", "publishing", "safety", "other"]), body: text(5_000), severity: z.enum(["normal", "urgent"]), resolution: optionalText(5_000), attachmentRefs: supportAttachmentReferencesSchema.default([]) }),
  guidance_progress: z.object({ completedKeys: z.array(text(120)), dismissedReleaseIds: z.array(text(120)) }),
} as const;

export const PRODUCT_STATES: Record<ProductRecordKind, readonly string[]> = {
  inspiration_item: ["active", "saved", "dismissed", "restricted"],
  blitz_item: ["queued", "accepted", "rejected", "editing"],
  content_piece: ["draft", "active", "archived", "deleted"],
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
  inspiration_item: inspirationPayloadSchema,
  blitz_item: blitzPayloadSchema,
  content_piece: contentPieceSchema,
  campaign_automation: campaignPayloadSchema,
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

const CAMPAIGN_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["validating", "archived"],
  validating: ["active", "draft", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [],
};

export function productTransitionIssue(input: { kind: ProductRecordKind; from: string; to: string; payload: Record<string, unknown>; now?: Date }): string | null {
  if (input.from === input.to) return null;
  if (input.kind === "campaign_automation") {
    return CAMPAIGN_TRANSITIONS[input.from]?.includes(input.to)
      ? null
      : "CAMPAIGN_TRANSITION_NOT_ALLOWED";
  }
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
