import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { detectQualificationTextLanguages, inspectQualificationArtifact, isAllowedQualificationArtifactUrl } from "../qualification-artifact-review";

describe("qualification artifact inspection", () => {
  it("detects Arabic and Latin script deterministically across the complete text", () => {
    expect(detectQualificationTextLanguages("إطلاق العلامة Brand launch")).toEqual(["ar", "en"]);
    expect(detectQualificationTextLanguages("حملة عربية")).toEqual(["ar"]);
    expect(detectQualificationTextLanguages("English copy")).toEqual(["en"]);
    expect(detectQualificationTextLanguages("1234 ✨")).toEqual([]);
  });

  it("produces content-bound automatic evidence for text without storing the text", async () => {
    const result = await inspectQualificationArtifact({ predictionId: "prediction-text", caseId: "arabic-copy", capability: "text_generation", contentLanguage: "ar", output: "مرحبا Brand" });
    expect(result.automaticallyObservedLanguages).toEqual(["ar", "en"]);
    expect(result.inspection).toMatchObject({ kind: "text", predictionId: "prediction-text", characterCount: 11, items: null });
    expect(result.inspection.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("مرحبا");
  });

  it("downloads, decodes, and proves every image output", async () => {
    const bytes = await sharp({ create: { width: 360, height: 640, channels: 3, background: "#123456" } }).png().toBuffer();
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(body, { status: 200, headers: { "content-type": "image/png", "content-length": String(bytes.length) } }));
    const result = await inspectQualificationArtifact({ predictionId: "prediction-images", caseId: "arabic-images", capability: "text_to_image", contentLanguage: "ar", output: ["https://replicate.delivery/one.png", "https://replicate.delivery/two.png"], fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.automaticallyObservedLanguages).toBeNull();
    expect(result.inspection).toMatchObject({ kind: "media", width: 360, height: 640, items: [{ width: 360, height: 640 }, { width: 360, height: 640 }] });
    expect(result.inspection.items).toHaveLength(2);
  });

  it("fails closed on untrusted output hosts", async () => {
    expect(isAllowedQualificationArtifactUrl("https://files.replicate.delivery/output.png", ["replicate.delivery"])).toBe(true);
    expect(isAllowedQualificationArtifactUrl("https://replicate.delivery.attacker.test/output.png", ["replicate.delivery"])).toBe(false);
    await expect(inspectQualificationArtifact({ predictionId: "prediction-bad", caseId: "bad-host", capability: "text_to_image", contentLanguage: "en", output: "https://attacker.test/output.png", fetcher: vi.fn() })).rejects.toThrow("QUALIFICATION_OUTPUT_HOST_NOT_ALLOWED");
  });
});
