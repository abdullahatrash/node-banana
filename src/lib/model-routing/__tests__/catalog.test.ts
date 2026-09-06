import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/agent-tools/canonical";
import { configuredCatalog, CURATED_MODELS, exactModelRef, findCuratedModel } from "../catalog";

const at = new Date("2026-09-03T00:00:00.000Z");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const keyId = "qualification-key";
const trustedKeys = JSON.stringify({ [keyId]: publicKey.export({ type: "spki", format: "pem" }).toString() });

function signedQualification(overrides: Record<string, unknown> = {}) {
  const model = CURATED_MODELS[0]!;
  const attestation = {
    schema: "model-execution-qualification/v1", id: "qualification-model-zero", revision: 3,
    provider: model.provider, model: model.model, endpoint: "versioned", version: "operator-reviewed-immutable-version-1",
    inputSchemaDigest: `sha256:${"a1".repeat(32)}`, capabilities: [...model.capabilities], contentLanguages: [...model.contentLanguages],
    arabicVarieties: [...model.arabicVarieties], verifiedRegions: ["replicate-us"], executionModes: ["async"],
    executionPriceUsd: { basis: "image", amount: 0.123 }, maxQuantity: 4, cancelAfterSeconds: 900,
    outputShape: { width: 1080, height: 1920, fps: null },
    inputContract: { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: null, imageMode: "single", safety: { parameterKey: "disable_safety_filter", safeValue: false }, lockedParameters: { disable_safety_filter: false, mode: "standard", resolution: "1080p" } },
    license: { name: "Commercial provider license", commercialUse: true, derivativeUse: true, sourceUrl: "https://example.com/license", digest: `sha256:${"b2".repeat(32)}` },
    pricingSource: { sourceUrl: "https://example.com/pricing", digest: `sha256:${"c3".repeat(32)}`, checkedAt: "2026-09-01T00:00:00.000Z" },
    qualificationRun: { id: "qualification-run-model-zero", digest: `sha256:${"d4".repeat(32)}`, completedAt: "2026-09-01T01:00:00.000Z" },
    issuedAt: "2026-09-01T02:00:00.000Z", expiresAt: "2026-10-01T02:00:00.000Z",
    ...overrides,
  };
  const signature = sign(null, Buffer.from(canonicalJson(attestation)), privateKey).toString("base64url");
  return JSON.stringify({ version: 1, qualifications: [{ attestation, signature: { algorithm: "ed25519", keyId, value: signature } }] });
}

describe("model qualification catalog", () => {
  it("publishes curated discovery defaults as non-executable", () => {
    expect(CURATED_MODELS).not.toHaveLength(0);
    expect(CURATED_MODELS.every((model) => model.qualification.status === "unqualified")).toBe(true);
    expect(CURATED_MODELS.map((model) => JSON.stringify(model)).join("\n")).not.toContain("pinned-2026");
    expect(CURATED_MODELS.find((model) => model.model === "wan-video/wan-2.7-videoedit")?.priceUsd).toEqual({ basis: "second", amount: 0.1 });
    expect(CURATED_MODELS.find((model) => model.model === "black-forest-labs/flux-2-klein-4b")?.priceUsd).toEqual({ basis: "components", components: [{ basis: "input_megapixel", amount: 0.001 }, { basis: "output_megapixel", amount: 0.001 }] });
  });

  it("qualifies only a trusted, immutable, unexpired signed attestation", () => {
    const catalog = configuredCatalog(signedQualification(), trustedKeys, at);
    const ref = exactModelRef(catalog[0]!);
    expect(ref).not.toBeNull();
    expect(findCuratedModel(ref!, catalog)).toBe(catalog[0]);
    expect(catalog[0]?.qualification).toMatchObject({ status: "qualified", evidence: { id: "qualification-model-zero", revision: 3, signingKeyId: keyId } });
    expect(exactModelRef(catalog[1]!)).toBeNull();
  });

  it("does not let qualification JSON authorize execution without a trusted signature", () => {
    expect(configuredCatalog(signedQualification(), undefined, at).every((item) => item.qualification.status === "unqualified")).toBe(true);
    expect(configuredCatalog(signedQualification(), JSON.stringify({ other: publicKey.export({ type: "spki", format: "pem" }).toString() }), at).every((item) => item.qualification.status === "unqualified")).toBe(true);
  });

  it("rejects tampered, expired, or overbroad language evidence", () => {
    const tampered = JSON.parse(signedQualification()) as { qualifications: Array<{ attestation: { executionPriceUsd: { amount: number } } }> };
    tampered.qualifications[0]!.attestation.executionPriceUsd.amount = 0.001;
    expect(configuredCatalog(JSON.stringify(tampered), trustedKeys, at)[0]?.qualification.status).toBe("unqualified");
    expect(configuredCatalog(signedQualification({ expiresAt: "2026-09-03T00:00:00.000Z" }), trustedKeys, at)[0]?.qualification.status).toBe("unqualified");
    expect(configuredCatalog(signedQualification({ contentLanguages: ["ar", "en", "mixed", "fr"] }), trustedKeys, at)[0]?.qualification.status).toBe("unqualified");
  });

  it("requires the exact safe value for positive and negative safety keys", () => {
    const unsafeNegative = signedQualification({ inputContract: { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: null, imageMode: "single", safety: { parameterKey: "disable_safety_filter", safeValue: false }, lockedParameters: { disable_safety_filter: true } } });
    expect(configuredCatalog(unsafeNegative, trustedKeys, at)[0]?.qualification.status).toBe("unqualified");
    const positive = signedQualification({ inputContract: { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: null, imageMode: "single", safety: { parameterKey: "safety_filter", safeValue: true }, lockedParameters: { safety_filter: true } } });
    expect(configuredCatalog(positive, trustedKeys, at)[0]?.qualification.status).toBe("qualified");
  });

  it("accepts evidenced provider-managed safety without inventing an API parameter", () => {
    const providerManaged = signedQualification({
      outputShape: { width: 768, height: 1376, fps: null },
      inputContract: {
        promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: "image_input", imageMode: "array",
        safety: { mode: "provider_managed", parameterKey: null, safeValue: null, evidenceSourceUrl: "https://example.com/safety", evidenceDigest: `sha256:${"e5".repeat(32)}` },
        lockedParameters: { resolution: "1K", output_format: "jpg" },
      },
    });
    const qualification = configuredCatalog(providerManaged, trustedKeys, at)[0]?.qualification;
    expect(qualification).toMatchObject({ status: "qualified", outputShape: { width: 768, height: 1376 }, inputContract: { safety: { mode: "provider_managed", parameterKey: null } } });
  });

  it("rejects guessed Brand fields and provider-native input key collisions", () => {
    const guessedBrandField = signedQualification({ inputContract: { promptKey: "prompt", brandContextKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: null, imageMode: "single", safety: { parameterKey: "disable_safety_filter", safeValue: false }, lockedParameters: { disable_safety_filter: false } } });
    expect(configuredCatalog(guessedBrandField, trustedKeys, at)[0]?.qualification.status).toBe("unqualified");
    const collision = signedQualification({ inputContract: { promptKey: "prompt", aspectRatioKey: "prompt", quantityKey: null, imageKey: null, imageMode: "single", safety: { parameterKey: "disable_safety_filter", safeValue: false }, lockedParameters: { disable_safety_filter: false } } });
    expect(configuredCatalog(collision, trustedKeys, at)[0]?.qualification.status).toBe("unqualified");
  });

  it("accepts a signed official-model endpoint only when its stable identifier matches the curated model", () => {
    const model = CURATED_MODELS[0]!;
    expect(configuredCatalog(signedQualification({ endpoint: "official", version: model.model }), trustedKeys, at)[0]?.qualification).toMatchObject({ status: "qualified", endpoint: "official", version: model.model });
    expect(configuredCatalog(signedQualification({ endpoint: "official", version: "other/model" }), trustedKeys, at)[0]?.qualification.status).toBe("unqualified");
  });
});
