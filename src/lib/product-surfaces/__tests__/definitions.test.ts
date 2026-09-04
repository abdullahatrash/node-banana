import { describe, expect, it } from "vitest";
import { AUTOMATION_STEPS, CONTENT_FORMATS, parseProductPayload, productCreateSchema } from "../definitions";

describe("product surface definitions", () => {
  it("keeps the observed twelve formats and ten automation steps explicit", () => {
    expect(CONTENT_FORMATS).toHaveLength(12);
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
});
