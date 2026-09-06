import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import type { CreatorPersona, CreatorPersonaEvidence } from "../types";
import { configuredPersonaTrainingQualifications, selectPersonaTrainingQualification } from "../training-qualification";

const now = new Date("2026-09-04T12:00:00.000Z");
const digest = `sha256:${"a".repeat(64)}` as const;
const persona = { workspaceId: "ws", id: "persona", kind: "consented_likeness", state: "ready_to_train", name: "Creator", contentLanguage: "ar", arabicVariety: "gulf", disclosure: "AI Persona", revision: 4, reusableModelRef: null, retentionUntil: new Date("2027-01-01T00:00:00Z"), suspendedReasonCode: null, createdByUserId: "u", updatedByUserId: "u", createdAt: now, updatedAt: now, deletedAt: null } satisfies CreatorPersona;

function signedEnvelope() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const attestation = { schema: "creator-persona-training-qualification/v1", id: "training-qualification-1", revision: 1, provider: "replicate", model: "owner/trainer", version: "immutable-version", inputSchemaDigest: digest, providerPolicyVersion: "policy-1", contentLanguages: ["ar", "en"], arabicVarieties: ["gulf"], verifiedRegions: ["replicate-us"], priceUsd: { basis: "run", amount: 0.25 }, sourceContract: { minimum: 3, maximum: 20, mediaTypes: ["image"] }, pricingSource: { sourceUrl: "https://replicate.com/pricing", digest, checkedAt: "2026-09-04T00:00:00.000Z" }, qualificationRun: { id: "qualification-run-1", digest, completedAt: "2026-09-04T00:00:00.000Z" }, issuedAt: "2026-09-04T00:00:00.000Z", expiresAt: "2026-09-05T00:00:00.000Z" } as const;
  const signature = sign(null, Buffer.from(canonicalJson(attestation)), privateKey).toString("base64url");
  return { raw: JSON.stringify({ version: 1, qualifications: [{ attestation, signature: { algorithm: "ed25519", keyId: "key-1", value: signature } }] }), keys: JSON.stringify({ "key-1": publicKey.export({ type: "spki", format: "pem" }).toString() }), attestation };
}

describe("Persona training qualifications", () => {
  it("admits only an authentic, unexpired, exact training contract", () => {
    const fixture = signedEnvelope(); const qualifications = configuredPersonaTrainingQualifications(fixture.raw, fixture.keys, now);
    expect(qualifications).toHaveLength(1);
    const evidence = { workspaceId: "ws", id: "acceptance", personaId: "persona", personaRevision: 3, type: "provider_acceptance", issuer: "provider_policy_registry", subjectDigest: digest, scope: { model: fixture.attestation.model, modelVersion: fixture.attestation.version, inputSchemaDigest: digest, qualificationDigest: canonicalDigest(fixture.attestation), acceptedUses: ["training"] }, evidenceDigest: digest, provider: "replicate", providerPolicyVersion: "policy-1", effectiveAt: now, expiresAt: new Date("2026-10-01T00:00:00Z"), revokedAt: null, verifiedByUserId: "u", createdAt: now } satisfies CreatorPersonaEvidence;
    expect(selectPersonaTrainingQualification({ persona, providerAcceptance: evidence, qualifications, region: "replicate-us", sourceCount: 3, sourceMediaTypes: ["image"] })?.model).toBe("owner/trainer");
    expect(selectPersonaTrainingQualification({ persona, providerAcceptance: evidence, qualifications, region: "replicate-eu", sourceCount: 3, sourceMediaTypes: ["image"] })).toBeNull();
    expect(selectPersonaTrainingQualification({ persona, providerAcceptance: evidence, qualifications, region: "replicate-us", sourceCount: 2, sourceMediaTypes: ["image"] })).toBeNull();
  });

  it("fails closed for tampered and expired envelopes", () => {
    const fixture = signedEnvelope();
    expect(configuredPersonaTrainingQualifications(fixture.raw.replace("0.25", "0.24"), fixture.keys, now)).toEqual([]);
    expect(configuredPersonaTrainingQualifications(fixture.raw, fixture.keys, new Date("2026-09-06T00:00:00Z"))).toEqual([]);
  });
});
