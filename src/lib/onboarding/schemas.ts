import { z } from "zod";
import {
  ACQUISITION_SOURCES,
  BRAND_ANALYSIS_STAGES,
  BRAND_ANALYSIS_STATUSES,
  BUSINESS_CATEGORIES,
  BUSINESS_MODELS,
  EXPECTED_OUTCOMES,
  INTERFACE_LOCALES,
  MONTHLY_REVENUE_RANGES,
  ONBOARDING_STATUSES,
  ONBOARDING_STEPS,
  PROFESSIONAL_ROLES,
  SIGNUP_INTENTS,
  TEAM_SIZES,
} from "./contracts";

const idSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const nonEmptyText = (maximum: number) => z.string().trim().min(1).max(maximum);
const uniqueArray = <T extends z.ZodTypeAny>(item: T, maximum: number) =>
  z.array(item).max(maximum).refine(
    (values) => new Set(values.map((value) => JSON.stringify(value))).size === values.length,
    "Values must be unique.",
  );

export const interfaceLocaleSchema = z.enum(INTERFACE_LOCALES);
export const contentLanguageSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "Use a valid BCP-47 language tag.");

export const identityAnswerSchema = z
  .object({
    fullName: nonEmptyText(120),
    companyName: nonEmptyText(160),
    logoAssetId: idSchema.nullable().default(null),
    interfaceLocale: interfaceLocaleSchema.optional(),
    contentLanguage: contentLanguageSchema.optional(),
  })
  .strict();

export const brandSourceInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("website"),
      url: z.string().trim().url().max(2048),
    })
    .strict(),
  z
    .object({
      kind: z.literal("description"),
      description: z.string().trim().min(20).max(50_000),
    })
    .strict(),
]);

export const companyStageAnswerSchema = z
  .object({
    teamSize: z.enum(TEAM_SIZES),
    monthlyRevenue: z.enum(MONTHLY_REVENUE_RANGES),
  })
  .strict();

export const roleAnswerSchema = z
  .object({
    role: z.enum(PROFESSIONAL_ROLES),
    otherRole: nonEmptyText(120).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.role === "other" && !value.otherRole) {
      context.addIssue({
        code: "custom",
        path: ["otherRole"],
        message: "Describe the role when Other is selected.",
      });
    }
  });

export const businessClassificationAnswerSchema = z
  .object({
    businessModel: z.enum(BUSINESS_MODELS),
    categories: uniqueArray(z.enum(BUSINESS_CATEGORIES), BUSINESS_CATEGORIES.length).min(1),
    otherCategory: nonEmptyText(120).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.categories.includes("other") && !value.otherCategory) {
      context.addIssue({
        code: "custom",
        path: ["otherCategory"],
        message: "Describe the category when Other is selected.",
      });
    }
  });

export const goalsAnswerSchema = z
  .object({
    signupIntent: z.enum(SIGNUP_INTENTS),
    expectedOutcomes: uniqueArray(z.enum(EXPECTED_OUTCOMES), EXPECTED_OUTCOMES.length).min(1),
    otherOutcome: nonEmptyText(240).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expectedOutcomes.includes("other") && !value.otherOutcome) {
      context.addIssue({
        code: "custom",
        path: ["otherOutcome"],
        message: "Describe the outcome when Other is selected.",
      });
    }
  });

export const attributionAnswerSchema = z
  .object({
    sources: uniqueArray(z.enum(ACQUISITION_SOURCES), ACQUISITION_SOURCES.length),
    otherSource: nonEmptyText(160).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sources.includes("other") && !value.otherSource) {
      context.addIssue({
        code: "custom",
        path: ["otherSource"],
        message: "Describe the source when Other is selected.",
      });
    }
  });

export const onboardingAnswersV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    identity: identityAnswerSchema.optional(),
    brandSource: brandSourceInputSchema.optional(),
    companyStage: companyStageAnswerSchema.optional(),
    role: roleAnswerSchema.optional(),
    businessClassification: businessClassificationAnswerSchema.optional(),
    goals: goalsAnswerSchema.optional(),
    attribution: attributionAnswerSchema.optional(),
  })
  .strict();

const evidenceReferenceSchema = z
  .object({
    sourceId: idSchema,
    excerptHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

const audienceSchema = z
  .object({
    name: nonEmptyText(120),
    description: nonEmptyText(1_000),
    weight: z.number().int().min(0).max(100),
  })
  .strict();

export const brandProfileV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    contentLanguage: contentLanguageSchema,
    identity: z
      .object({
        companyName: nonEmptyText(160),
        coreIdentity: nonEmptyText(1_500),
        logoAssetId: idSchema.nullable(),
      })
      .strict(),
    offering: uniqueArray(nonEmptyText(1_000), 20).min(1),
    audiences: uniqueArray(audienceSchema, 12).min(1),
    problems: uniqueArray(nonEmptyText(1_000), 20),
    benefits: uniqueArray(nonEmptyText(1_000), 20),
    differentiators: uniqueArray(nonEmptyText(1_000), 20),
    mission: nonEmptyText(2_000),
    positioning: nonEmptyText(2_000),
    ownedSpace: nonEmptyText(1_000),
    businessModel: z.enum(BUSINESS_MODELS),
    categories: uniqueArray(z.enum(BUSINESS_CATEGORIES), BUSINESS_CATEGORIES.length).min(1),
    voice: z
      .object({
        descriptors: uniqueArray(nonEmptyText(120), 12).min(1),
        do: uniqueArray(nonEmptyText(500), 10),
        doNot: uniqueArray(nonEmptyText(500), 10),
      })
      .strict(),
    prohibitedClaims: uniqueArray(nonEmptyText(500), 30),
    prohibitedTopics: uniqueArray(nonEmptyText(500), 30),
    competitors: uniqueArray(
      z
        .object({
          name: nonEmptyText(160),
          url: z.string().trim().url().max(2048).nullable(),
        })
        .strict(),
      30,
    ),
    contentAngles: uniqueArray(nonEmptyText(1_000), 30),
    uncertainties: uniqueArray(nonEmptyText(1_000), 30),
    evidence: uniqueArray(evidenceReferenceSchema, 100),
    sourceIds: uniqueArray(idSchema, 20).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const totalWeight = value.audiences.reduce((sum, audience) => sum + audience.weight, 0);
    if (totalWeight !== 100) {
      context.addIssue({
        code: "custom",
        path: ["audiences"],
        message: "Audience weights must total 100.",
      });
    }
    const sourceIds = new Set(value.sourceIds);
    value.evidence.forEach((evidence, index) => {
      if (!sourceIds.has(evidence.sourceId)) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "sourceId"],
          message: "Evidence must reference a declared source.",
        });
      }
    });
  });

export const activationArtifactV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    contentLanguage: contentLanguageSchema,
    kind: z.enum(["social_post", "video_script", "content_brief"]),
    title: nonEmptyText(200),
    hook: nonEmptyText(500),
    body: nonEmptyText(5_000),
    rationale: nonEmptyText(1_000),
    suggestedFormats: uniqueArray(nonEmptyText(120), 10),
    brandProfileId: idSchema,
  })
  .strict();

const commandBase = {
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(8).max(200),
};

export const onboardingCommandRequestSchema = z.discriminatedUnion("type", [
  z.object({ ...commandBase, type: z.literal("save_identity"), payload: identityAnswerSchema }).strict(),
  z.object({ ...commandBase, type: z.literal("set_brand_source"), payload: brandSourceInputSchema }).strict(),
  z.object({ ...commandBase, type: z.literal("save_company_stage"), payload: companyStageAnswerSchema }).strict(),
  z.object({ ...commandBase, type: z.literal("save_role"), payload: roleAnswerSchema }).strict(),
  z.object({ ...commandBase, type: z.literal("save_business_classification"), payload: businessClassificationAnswerSchema }).strict(),
  z.object({ ...commandBase, type: z.literal("save_goals"), payload: goalsAnswerSchema }).strict(),
  z.object({ ...commandBase, type: z.literal("save_attribution"), payload: attributionAnswerSchema }).strict(),
  z.object({ ...commandBase, type: z.literal("accept_brand_profile"), payload: z.object({ profileId: idSchema }).strict() }).strict(),
  z.object({ ...commandBase, type: z.literal("retry_analysis"), payload: z.object({}).strict() }).strict(),
  z.object({ ...commandBase, type: z.literal("complete"), payload: z.object({}).strict() }).strict(),
]);

export const onboardingSnapshotSchema = z
  .object({
    sessionId: idSchema,
    userId: idSchema,
    workspaceId: idSchema.nullable(),
    status: z.enum(ONBOARDING_STATUSES),
    currentStep: z.enum(ONBOARDING_STEPS),
    revision: z.number().int().nonnegative(),
    interfaceLocale: interfaceLocaleSchema,
    contentLanguage: contentLanguageSchema,
    answers: onboardingAnswersV1Schema,
    analysis: z
      .object({
        runId: idSchema,
        stage: z.enum(BRAND_ANALYSIS_STAGES),
        status: z.enum(BRAND_ANALYSIS_STATUSES),
        errorCode: z.string().trim().min(1).max(120).nullable(),
        retryOfRunId: idSchema.nullable(),
      })
      .strict()
      .nullable(),
    draftBrandProfileId: idSchema.nullable(),
    draftBrandProfile: brandProfileV1Schema.nullable(),
    activeBrandProfileId: idSchema.nullable(),
    activationArtifactId: idSchema.nullable(),
    activationArtifact: activationArtifactV1Schema.nullable(),
  })
  .strict();

export type OnboardingAnswersV1 = z.infer<typeof onboardingAnswersV1Schema>;
export type BrandProfileV1 = z.infer<typeof brandProfileV1Schema>;
export type ActivationArtifactV1 = z.infer<typeof activationArtifactV1Schema>;
export type BrandSourceInput = z.infer<typeof brandSourceInputSchema>;
export type OnboardingCommandRequest = z.infer<typeof onboardingCommandRequestSchema>;
export type ParsedOnboardingSnapshot = z.infer<typeof onboardingSnapshotSchema>;
