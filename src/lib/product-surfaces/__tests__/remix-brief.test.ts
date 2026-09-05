import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { BrandProfileV1 } from "@/lib/onboarding/schemas";
import { compileBrandAwareMetadataBrief, compileBrandAwareRemixBrief, remixBriefProviderContract } from "../remix-brief";

const digest = `sha256:${"a".repeat(64)}` as const;
const profile: BrandProfileV1 = {
  schemaVersion: 1,
  contentLanguage: "ar",
  identity: { companyName: "تمرة", coreIdentity: "وجبات يومية موثوقة", logoAssetId: null },
  offering: ["صندوق تمر فاخر"],
  audiences: [{ name: "المهنيون", description: "مهنيون مشغولون في الخليج", weight: 100 }],
  problems: ["قلة الوقت"], benefits: ["طاقة عملية"], differentiators: ["مصدر محلي"],
  mission: "غذاء أفضل كل يوم", positioning: "اختيار يومي موثوق", ownedSpace: "الوجبات الصحية", businessModel: "b2c", categories: ["ecommerce"],
  voice: { descriptors: ["دافئ", "واضح"], do: ["استخدم لغة طبيعية"], doNot: ["لا تبالغ"] },
  prohibitedClaims: ["يعالج الأمراض"], prohibitedTopics: ["السياسة"], competitors: [], contentAngles: ["طاقة للعمل"], uncertainties: [],
  evidence: [{ sourceId: "source_1", excerptHash: digest }], sourceIds: ["source_1"],
};

const source = {
  sourceUrl: "/api/studio/assets/source-video/download", sourceAssetId: "source-video", sourceMediaType: "video", sourceName: "Licensed library",
  capturedAt: "2026-09-04T09:00:00.000Z", metricsObservedAt: "2026-09-04T09:00:00.000Z", metrics: { views: 1200, likes: 80 }, region: "GCC",
  contentLanguage: "ar", arabicVariety: "gulf", format: "talking_head_ugc", rightsStatus: "licensed",
  rightsSnapshot: { id: "rights_1", revision: 2, digest }, permittedInfluence: ["topic", "hook", "pacing", "structure"],
  creativePrimitives: { topics: ["طاقة العمل"], hookPattern: "سؤال يصف مشكلة يومية", pacing: "افتتاح سريع ثم شرح هادئ", structure: ["مشكلة", "حل", "دعوة"] },
  whyThisAppears: ["licensed_rights"], tags: ["تمر", "الخليج"], trendEvidence: null,
} as const;

describe("brand-aware Remix Brief", () => {
  it("pins Brand, source, Arabic variety, licensed primitives, and provider instructions", () => {
    const brief = compileBrandAwareRemixBrief({ inspirationItemId: "inspiration_1", inspirationRevision: 4, sourceValue: source, brand: { id: "brand_1", revision: 7, acceptedAt: new Date("2026-09-04T08:00:00.000Z"), profile }, permittedRemix: "transform", createdAt: new Date("2026-09-04T10:00:00.000Z") });
    expect(brief.brandProfile).toMatchObject({ id: "brand_1", revision: 7, digest: canonicalDigest(profile) });
    expect(brief.source).toMatchObject({ inspirationItemId: "inspiration_1", revision: 4, rightsSnapshotDigest: digest });
    expect(brief.locale).toEqual({ contentLanguage: "ar", arabicVariety: "gulf" });
    expect(brief.influencePlan.map((item) => item.kind)).toEqual(["topic", "hook", "pacing", "structure"]);
    expect(brief.provider.prompt).toContain("العربية الخليجية");
    expect(brief.provider.prompt).toContain("تمرة");
    expect(brief.provider.avoid).toContain("Do not reproduce protected source wording, frames, audio, choreography, logos, likenesses, or distinctive scene composition.");
    expect(remixBriefProviderContract(brief)).toMatchObject({ prompt: brief.provider.prompt, digest: brief.digest });
  });

  it("does not authorize transformation for reference-only rights", () => {
    const brief = compileBrandAwareRemixBrief({ inspirationItemId: "inspiration_1", inspirationRevision: 4, sourceValue: source, brand: { id: "brand_1", revision: 7, acceptedAt: new Date("2026-09-04T08:00:00.000Z"), profile }, permittedRemix: "reference_only", createdAt: new Date("2026-09-04T10:00:00.000Z") });
    expect(brief.provider.transform).toEqual([]);
  });

  it("compiles an Arabic topic-only brief without admitting source media or expression", () => {
    const metadata = {
      ...source,
      sourceUrl: "https://www.youtube.com/watch?v=public-id",
      sourceAssetId: null,
      sourceMediaType: null,
      sourceName: "YouTube · Public channel",
      rightsStatus: "metadata_only",
      rightsSnapshot: null,
      permittedInfluence: ["topic"],
      creativePrimitives: { topics: ["روتين العمل الصباحي"], hookPattern: null, pacing: null, structure: [] },
      whyThisAppears: ["youtube_most_popular", "metadata_only_rights"],
    } as const;
    const evidenceDigest = `sha256:${"e".repeat(64)}` as const;
    const brief = compileBrandAwareMetadataBrief({ inspirationItemId: "inspiration_youtube", inspirationRevision: 1, sourceValue: metadata, brand: { id: "brand_1", revision: 7, acceptedAt: new Date("2026-09-04T08:00:00.000Z"), profile }, evidenceDigest, createdAt: new Date("2026-09-04T09:00:00.000Z") });

    expect(brief).toMatchObject({ schema: "brand-aware-remix-brief/v2", source: { usage: "metadata_topic_only", evidenceDigest, rightsSnapshotDigest: null }, locale: { contentLanguage: "ar", arabicVariety: "gulf" }, provider: { transform: [] } });
    expect(brief.influencePlan).toHaveLength(1);
    expect(brief.influencePlan[0]?.kind).toBe("topic");
    expect(brief.provider.prompt).toContain("العربية الخليجية");
    expect(brief.provider.prompt).toContain("right-to-left");
    expect(brief.provider.prompt).not.toContain(metadata.sourceUrl);
    expect(brief.provider.prompt).not.toContain("licensed");
    expect(brief.provider.avoid.join(" ")).toContain("Do not retrieve, download, quote, imitate, or send its video, thumbnail, audio, transcript, creator identity");
  });
});
