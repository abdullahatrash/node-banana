import { describe, expect, it } from "vitest";
import {
  activationArtifactV1Schema,
  attributionAnswerSchema,
  brandProfileV1Schema,
  brandSourceInputSchema,
  businessClassificationAnswerSchema,
  contentLanguageSchema,
  goalsAnswerSchema,
  onboardingAnswersV1Schema,
  onboardingCommandRequestSchema,
} from "../schemas";

const sourceId = "source_1";

function validBrandProfile() {
  return {
    schemaVersion: 1 as const,
    contentLanguage: "ar-SA",
    identity: {
      companyName: "شركة تصميم",
      coreIdentity: "منصة تساعد العلامات التجارية على صناعة المحتوى.",
      logoAssetId: null,
    },
    offering: ["إنشاء محتوى متعدد اللغات"],
    audiences: [
      { name: "الشركات الناشئة", description: "فرق التسويق الصغيرة", weight: 60 },
      { name: "الوكالات", description: "وكالات المحتوى", weight: 40 },
    ],
    problems: ["بطء إنتاج المحتوى"],
    benefits: ["تسريع العمل"],
    differentiators: ["مصمم للمنطقة العربية"],
    mission: "جعل صناعة المحتوى أسهل.",
    positioning: "مساعد محتوى للعلامات في المنطقة.",
    ownedSpace: "المحتوى العربي المدعوم بالذكاء الاصطناعي.",
    businessModel: "b2b" as const,
    categories: ["saas" as const],
    voice: {
      descriptors: ["واضح", "عملي"],
      do: ["استخدم لغة مباشرة"],
      doNot: ["لا تختلق أرقاماً"],
    },
    prohibitedClaims: ["نتائج مضمونة"],
    prohibitedTopics: [],
    competitors: [{ name: "منافس", url: null }],
    contentAngles: ["كيف توفر وقت فريقك"],
    uncertainties: [],
    evidence: [
      { sourceId, excerptHash: `sha256:${"a".repeat(64)}` },
    ],
    sourceIds: [sourceId],
  };
}

describe("onboarding schemas", () => {
  it("accepts Arabic, English, and mixed-script onboarding answers", () => {
    expect(
      onboardingAnswersV1Schema.parse({
        schemaVersion: 1,
        identity: {
          fullName: "Noura النجار",
          companyName: "Tasmeem AI تصميم",
          logoAssetId: null,
        },
      }),
    ).toMatchObject({ schemaVersion: 1 });
  });

  it("keeps content language independent and BCP-47 compatible", () => {
    expect(contentLanguageSchema.parse("ar-SA")).toBe("ar-SA");
    expect(contentLanguageSchema.parse("en")).toBe("en");
    expect(contentLanguageSchema.safeParse("arabic").success).toBe(false);
  });

  it("bounds manual descriptions", () => {
    expect(
      brandSourceInputSchema.safeParse({ kind: "description", description: "short" }).success,
    ).toBe(false);
    expect(
      brandSourceInputSchema.safeParse({ kind: "description", description: "وصف ".repeat(6) }).success,
    ).toBe(true);
  });

  it("requires details when Other is selected", () => {
    expect(
      businessClassificationAnswerSchema.safeParse({
        businessModel: "b2b",
        categories: ["other"],
      }).success,
    ).toBe(false);
    expect(
      goalsAnswerSchema.safeParse({
        signupIntent: "marketing_now",
        expectedOutcomes: ["other"],
      }).success,
    ).toBe(false);
  });

  it("allows acquisition attribution to be skipped", () => {
    expect(attributionAnswerSchema.parse({ sources: [] })).toEqual({ sources: [] });
  });

  it("rejects duplicate multi-select values", () => {
    expect(
      goalsAnswerSchema.safeParse({
        signupIntent: "curious",
        expectedOutcomes: ["save_time", "save_time"],
      }).success,
    ).toBe(false);
  });

  it("requires audience weights to total 100", () => {
    const profile = validBrandProfile();
    profile.audiences[0].weight = 50;
    expect(brandProfileV1Schema.safeParse(profile).success).toBe(false);
  });

  it("requires evidence to reference a declared source", () => {
    const profile = validBrandProfile();
    profile.evidence[0].sourceId = "source_2";
    expect(brandProfileV1Schema.safeParse(profile).success).toBe(false);
  });

  it("rejects unknown Brand Profile keys and schema versions", () => {
    expect(
      brandProfileV1Schema.safeParse({ ...validBrandProfile(), unexpected: true }).success,
    ).toBe(false);
    expect(
      brandProfileV1Schema.safeParse({ ...validBrandProfile(), schemaVersion: 2 }).success,
    ).toBe(false);
  });

  it("validates activation artifacts against a Brand Profile revision", () => {
    expect(
      activationArtifactV1Schema.parse({
        schemaVersion: 1,
        contentLanguage: "en",
        kind: "social_post",
        title: "A faster content workflow",
        hook: "Your team should not spend all week on one post.",
        body: "Start with a reviewed Brand Profile and build from reliable facts.",
        rationale: "Addresses the saved-time goal.",
        suggestedFormats: ["LinkedIn post"],
        brandProfileId: "profile_1",
      }).brandProfileId,
    ).toBe("profile_1");
  });

  it("requires an idempotency key and optimistic revision on commands", () => {
    expect(
      onboardingCommandRequestSchema.safeParse({
        type: "save_attribution",
        expectedRevision: 6,
        idempotencyKey: "command_123",
        payload: { sources: [] },
      }).success,
    ).toBe(true);
    expect(
      onboardingCommandRequestSchema.safeParse({
        type: "complete",
        expectedRevision: -1,
        idempotencyKey: "short",
        payload: {},
      }).success,
    ).toBe(false);
  });
});

