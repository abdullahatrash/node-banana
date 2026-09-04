import { describe, expect, it } from "vitest";
import { validateBrandAwareBlitzGenerationContract } from "../blitz-generation-contract";

const brandDigest = `sha256:${"a".repeat(64)}`;
const rightsDigest = `sha256:${"b".repeat(64)}`;
const briefDigest = `sha256:${"c".repeat(64)}`;
const acceptedAt = new Date("2026-09-04T08:00:00.000Z");
const provider = { prompt: "Original brand direction", preserve: ["brand identity"], transform: ["wording"], avoid: ["source expression"] };
const payload = {
  inspirationItemId: "inspiration_1", sourceAttribution: "https://example.com/source", sourceAssetId: "asset_1", sourceMediaType: "video",
  rightsSnapshot: { id: "rights_1", revision: 1, digest: rightsDigest }, rightsBasis: "licensed", permittedRemix: "transform", rightsEvidenceIds: ["evidence_1"],
  contentLanguage: "ar", arabicVariety: "gulf", format: "video_hook_demo", rationale: "Original angle",
  remixBrief: {
    schema: "brand-aware-remix-brief/v1", brandProfile: { id: "brand_1", revision: 3, digest: brandDigest, acceptedAt: acceptedAt.toISOString() },
    source: { inspirationItemId: "inspiration_1", revision: 2, evidenceDigest: null, rightsSnapshotDigest: rightsDigest }, locale: { contentLanguage: "ar", arabicVariety: "gulf" },
    influencePlan: [{ kind: "topic", direction: "Use the licensed topic signal" }], brandDirection: { audience: "Founders", angle: "Launch", voice: ["clear"], offering: "Product", callToAction: "Try it" },
    provider, protectedExpressionExcluded: true, createdAt: "2026-09-04T09:00:00.000Z", digest: briefDigest,
  },
};
const request = { prompt: provider.prompt, capability: "video_to_video", contentLanguage: "ar", arabicVariety: "gulf", sourceAssetIds: ["asset_1"], rightsBasis: "licensed", permittedRemix: "transform", rightsEvidenceIds: ["evidence_1"], remixBrief: { preserve: provider.preserve, transform: provider.transform, avoid: provider.avoid } };
const brand = { id: "brand_1", revision: 3, digest: brandDigest, acceptedAt };

describe("Blitz generation admission contract", () => {
  it("accepts only the exact queued Brand, rights, source, locale, and prompt", () => {
    expect(validateBrandAwareBlitzGenerationContract({ payloadValue: payload, request, brand })).toMatchObject({ ok: true, brief: { digest: briefDigest } });
  });

  it.each([
    { request: { ...request, prompt: "tampered" } },
    { request: { ...request, sourceAssetIds: ["asset_other"] } },
    { request: { ...request, arabicVariety: "egyptian" } },
    { request: { ...request, rightsEvidenceIds: ["evidence_other"] } },
    { brand: { ...brand, revision: 4 } },
  ])("rejects a changed paid-generation boundary", (override) => {
    expect(validateBrandAwareBlitzGenerationContract({ payloadValue: payload, request: override.request ?? request, brand: override.brand ?? brand })).toEqual({ ok: false, code: "BLITZ_GENERATION_CONTRACT_MISMATCH" });
  });

  it("requires old generic proposals to be re-queued", () => {
    expect(validateBrandAwareBlitzGenerationContract({ payloadValue: { ...payload, remixBrief: { influences: ["topic"], protectedExpressionExcluded: true } }, request, brand })).toEqual({ ok: false, code: "BLITZ_BRIEF_SNAPSHOT_REQUIRED" });
  });
});
