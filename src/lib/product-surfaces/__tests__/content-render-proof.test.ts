import { describe, expect, it, vi } from "vitest";
import { contentFormatDefinition } from "../content-format-definition";
import { buildQualifiedContentRenderProof, ContentRenderProofError, createConfiguredContentRenderProofVerifier, type ContentRenderInspectionReport } from "../content-render-proof";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const at = new Date("2026-09-04T10:00:00.000Z");
const report: ContentRenderInspectionReport = {
  assetId: "asset_output",
  contentDigest: digest("a"),
  width: 1080,
  height: 1920,
  durationSeconds: 15,
  checks: {
    fonts: { status: "passed", fontManifestDigest: digest("b"), missingGlyphCount: 0 },
    bidi: { status: "passed", paragraphCount: 2, visualOrderDigest: digest("c") },
    captions: { status: "passed", cueCount: 4, overflowCount: 0, cueLayoutDigest: digest("d") },
    timing: { status: "passed", firstFrameMs: 0, lastFrameMs: 15_000, audioSyncMaxDriftMs: 30, timelineDigest: digest("e") },
    safeAreas: { status: "passed", violationCount: 0, layoutDigest: digest("f"), preset: "short-form-v1" },
  },
  producedAt: at.toISOString(),
};

function build(overrides: Partial<ContentRenderInspectionReport> = {}) {
  const definition = contentFormatDefinition("wall_of_text");
  return buildQualifiedContentRenderProof({ definition, definitionDigest: digest("9"), inputAssets: [{ assetId: "source", type: "video", contentDigest: digest("8") }], output: { assetId: "asset_output", contentDigest: digest("a") }, intentId: "intent", operationId: "operation", contentLanguage: "ar", report: { ...report, ...overrides }, verifier: { id: "render-proof", version: "1", qualificationDigest: digest("7") }, verifiedAt: at });
}

describe("qualified Content Render Proof", () => {
  it("binds independently inspected fonts, bidi, captions, timing, and safe areas to final bytes", () => {
    const proof = build();
    expect(proof).toMatchObject({ schema: "content-render-proof/v2", status: "passed", output: { assetId: "asset_output", width: 1080, height: 1920 }, checks: { fonts: { missingGlyphCount: 0 }, bidi: { paragraphCount: 2 }, captions: { overflowCount: 0 }, safeAreas: { violationCount: 0 } }, verifier: { kind: "qualified_internal", adapterId: "render-proof" } });
    expect(proof.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("fails closed on wrong bytes, missing Arabic bidi proof, caption N/A, bad timing, or non-9:16 output", () => {
    expect(() => build({ contentDigest: digest("0") })).toThrow(ContentRenderProofError);
    expect(() => build({ checks: { ...report.checks, bidi: { ...report.checks.bidi, paragraphCount: 0 } } })).toThrow(ContentRenderProofError);
    expect(() => build({ checks: { ...report.checks, captions: { status: "not_applicable", cueCount: 0, overflowCount: 0, cueLayoutDigest: null } } })).toThrow(ContentRenderProofError);
    expect(() => build({ checks: { ...report.checks, timing: { ...report.checks.timing, lastFrameMs: 16_000 } } })).toThrow(ContentRenderProofError);
    expect(() => build({ width: 1080, height: 1080 })).toThrow(ContentRenderProofError);
  });

  it("requires a configured qualified verifier and pins its returned identity", async () => {
    const request = { assetId: "asset_output", contentDigest: digest("a"), downloadUrl: "https://signed.test/output", requirements: { aspectRatio: "9:16" as const, minimumDurationSeconds: 4, maximumDurationSeconds: 60, captionsRequired: true, bidiRequired: true, safeAreaPreset: "short-form-v1" as const } };
    await expect(createConfiguredContentRenderProofVerifier({}).inspect(request)).rejects.toMatchObject({ code: "CONTENT_RENDER_PROOF_UNAVAILABLE" });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ verifierId: "render-proof", verifierVersion: "1", report }), { status: 200 }));
    const verifier = createConfiguredContentRenderProofVerifier({ endpoint: "https://verifier.test/inspect", token: "secret", verifierId: "render-proof", verifierVersion: "1", qualificationDigest: digest("7"), fetchImpl });
    await expect(verifier.inspect(request)).resolves.toMatchObject({ verifier: { id: "render-proof", version: "1" }, report: { contentDigest: digest("a") } });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
