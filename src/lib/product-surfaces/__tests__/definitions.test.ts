import { describe, expect, it } from "vitest";
import { AUTOMATION_STEPS, CONTENT_FORMATS, parseProductPayload, productCreateSchema } from "../definitions";

describe("product surface definitions", () => {
  it("keeps the observed eleven named formats plus Custom and ten automation steps explicit", () => {
    expect(CONTENT_FORMATS).toEqual([
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
    ]);
    expect(new Set(CONTENT_FORMATS).size).toBe(12);
    expect(AUTOMATION_STEPS).toHaveLength(10);
    expect(new Set(AUTOMATION_STEPS).size).toBe(10);
  });

  it("validates rights-aware inspiration evidence", () => {
    expect(() => parseProductPayload("inspiration_item", {
      sourceUrl: "https://example.com/video/1",
      sourceName: "Licensed feed",
      capturedAt: "2026-09-04T10:00:00.000Z",
      metricsObservedAt: "2026-09-04T10:00:00.000Z",
      metrics: { views: 1200, likes: 70 },
      region: "MENA",
      contentLanguage: "ar",
      arabicVariety: "gulf",
      format: "video_hook_demo",
      rightsStatus: "licensed",
      permittedInfluence: ["topic", "pacing"],
      whyThisAppears: ["Recent in your market"],
      tags: ["commerce"],
    })).not.toThrow();
    expect(() => parseProductPayload("inspiration_item", {
      sourceUrl: "https://example.com/video/1",
      sourceName: "Unknown",
      capturedAt: "2026-09-04T10:00:00.000Z",
      metricsObservedAt: "2026-09-04T10:00:00.000Z",
      metrics: { views: 1, likes: 0 },
      region: "",
      contentLanguage: "ar",
      arabicVariety: "msa",
      format: "slideshow",
      rightsStatus: "licensed",
      permittedInfluence: [],
      whyThisAppears: [],
      tags: [],
    })).toThrow();
  });

  it("preserves immutable provider provenance, rights, and ranking evidence on ingested trends", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const parsed = parseProductPayload("inspiration_item", {
      sourceUrl: "https://example.com/video/1", sourceName: "Official feed", capturedAt: "2026-09-04T10:00:00.000Z",
      metricsObservedAt: "2026-09-04T10:00:00.000Z", metrics: { views: 1200, likes: 70 }, region: "GCC",
      contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo", rightsStatus: "metadata_only",
      permittedInfluence: ["topic"], whyThisAppears: ["fresh_metrics"], tags: ["commerce"],
      trendEvidence: {
        schema: "inspiration-trend-evidence/v1",
        source: { sourceId: "source-1", sourceKind: "official_api", adapterKey: "official", externalItemId: "external-1", sourceContentDigest: digest, capturedAt: "2026-09-04T10:00:00.000Z", publishedAt: "2026-09-04T09:00:00.000Z", observationDigest: digest },
        rights: { status: "metadata_only", evidenceRef: "official:terms", evidenceDigest: digest, observedAt: "2026-09-04T10:00:00.000Z", expiresAt: null },
        ranking: { schema: "inspiration-trend-ranking/v1", score: 7000, signals: { freshness: 100, recency: 100, performance: 50, brandFit: 50, region: 100, language: 100, arabicVariety: 100, format: 50, rights: 45, preference: 50 }, reasonCodes: ["fresh_metrics"], brandProfile: null, eligibleForDiscovery: true, eligibleForBlitz: false, evaluatedAt: "2026-09-04T10:00:00.000Z", digest },
      },
    });

    expect(parsed.trendEvidence).toMatchObject({ source: { adapterKey: "official", externalItemId: "external-1" }, ranking: { score: 7000, eligibleForBlitz: false } });
  });

  it("rejects a state that does not belong to its resource lifecycle", () => {
    const result = productCreateSchema.safeParse({
      kind: "creator_persona",
      title: "Persona",
      state: "published",
      payload: {},
      idempotencyKey: "request-123",
    });
    expect(result.success).toBe(false);
  });

  it("requires a complete campaign configuration", () => {
    expect(() => parseProductPayload("campaign_automation", {
      currentStep: 10,
      name: "Launch",
      formatMix: { slideshow: 50, talking_head_ugc: 50 },
      remixRatio: 50,
      inspirationIds: [],
      contentLanguage: "ar",
      arabicVariety: "msa",
      personaIds: [],
      mediaSetIds: [],
      channelIds: [],
      variantsPerChannel: 1,
      cadence: { timezone: "Asia/Riyadh", startAt: null, endAt: null, postsPerWeek: 3 },
      execution: { mode: "managed", modelPolicy: "workspace-default", creditCeiling: 20, budgetCents: 5000 },
      reviewMode: "request_human",
      autoPublishGrantId: null,
      validationErrors: [],
    })).not.toThrow();
  });

  it("requires immutable Workflow references before campaign activation", () => {
    const payload = parseProductPayload("campaign_automation", {
      currentStep: 10, name: "Launch", formatMix: { slideshow: 100 }, remixRatio: 0,
      inspirationIds: [], contentLanguage: "ar", arabicVariety: "msa", personaIds: [], mediaSetIds: [], channelIds: [], variantsPerChannel: 1,
      cadence: { timezone: "Asia/Riyadh", startAt: null, endAt: null, postsPerWeek: 3 },
      execution: { mode: "managed", modelPolicy: "workspace-default", creditCeiling: 20, budgetCents: 5000 },
      reviewMode: "request_human", autoPublishGrantId: null, validationErrors: [],
    });
    expect(payload).toMatchObject({ execution: { workflow: null }, runtime: null });
  });

  it("keeps Blitz rejection feedback structured while normalizing legacy records", () => {
    const base = {
      sourceAttribution: "https://example.com/source",
      remixBrief: { influences: ["topic"], protectedExpressionExcluded: true },
      rationale: "A rights-cleared proposal",
    };

    expect(parseProductPayload("blitz_item", {
      ...base,
      rejectionReasons: [{ code: "brand_mismatch", note: "Tone is too formal" }],
    })).toMatchObject({
      rejectionReasons: [{ code: "brand_mismatch", note: "Tone is too formal" }],
    });
    expect(parseProductPayload("blitz_item", {
      ...base,
      rejectionReasons: ["Legacy free-form reason"],
    })).toMatchObject({
      rejectionReasons: [{ code: "other", note: "Legacy free-form reason" }],
    });
  });
});
