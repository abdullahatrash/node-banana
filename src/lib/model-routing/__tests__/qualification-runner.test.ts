import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/agent-tools/canonical";
import { CURATED_MODELS } from "../catalog";
import { produceReplicateQualificationEnvelope } from "../qualification-runner";

const at = new Date("2026-09-04T00:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
function input(maxQuantity = 3, amount = 0.1) {
  const model = CURATED_MODELS[0]!;
  return { signingKeyId: "offline-operator-key", attestation: {
    schema: "model-execution-qualification/v1" as const, id: "qualification-reviewed-001", revision: 1, provider: "replicate" as const, model: model.model,
    endpoint: "versioned" as const, version: "immutable-provider-version-001", inputSchemaDigest: `sha256:${"a".repeat(64)}` as const,
    capabilities: [...model.capabilities], contentLanguages: [...model.contentLanguages], arabicVarieties: [...model.arabicVarieties], verifiedRegions: ["replicate-us"], executionModes: ["async" as const],
    executionPriceUsd: { basis: "image" as const, amount }, maxQuantity, cancelAfterSeconds: 900, outputShape: { width: 1080, height: 1920, fps: null },
    inputContract: { promptKey: "prompt", brandContextKey: "brand_context", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: null, imageMode: "single" as const, safety: { parameterKey: "disable_safety_filter", safeValue: false }, lockedParameters: { disable_safety_filter: false } },
    license: { name: "Reviewed commercial license", commercialUse: true as const, derivativeUse: true, sourceUrl: "https://example.com/license", digest: `sha256:${"b".repeat(64)}` as const },
    pricingSource: { sourceUrl: "https://example.com/pricing", digest: `sha256:${"c".repeat(64)}` as const, checkedAt: "2026-09-03T00:00:00.000Z" },
    qualificationRun: { id: "offline-qualification-run-001", digest: `sha256:${"d".repeat(64)}` as const, completedAt: "2026-09-03T01:00:00.000Z" },
    issuedAt: "2026-09-03T02:00:00.000Z", expiresAt: "2026-10-03T02:00:00.000Z",
  } };
}

describe("offline Replicate qualification runner", () => {
  it("produces a verifiable signed envelope without a provider client", () => {
    const envelope = produceReplicateQualificationEnvelope(input(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), at);
    const signed = envelope.qualifications[0]!;
    expect(verify(null, Buffer.from(canonicalJson(signed.attestation)), publicKey, Buffer.from(signed.signature.value, "base64url"))).toBe(true);
  });

  it("rejects a maximum run cost at or above USD 0.40", () => {
    expect(() => produceReplicateQualificationEnvelope(input(4, 0.1), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), at)).toThrow("QUALIFICATION_BUDGET_CAP_EXCEEDED");
  });
});
