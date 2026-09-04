import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluatePersonaGate, type CreatorPersona, type CreatorPersonaEvidence } from "../types";
import { personaAttestationMessage, verifyPersonaAttestation } from "../attestation";
import { addPersonaEvidenceSchema, createPersonaSchema, requestPersonaTrainingSchema } from "../schemas";

const at = new Date("2026-09-04T12:00:00.000Z");
const digest = `sha256:${"a".repeat(64)}` as const;
const persona: CreatorPersona = { workspaceId: "ws", id: "p", kind: "consented_likeness", state: "active", name: "Creator", contentLanguage: "ar", arabicVariety: "gulf", disclosure: "AI-assisted likeness used with consent.", revision: 8, reusableModelRef: "model-ref", retentionUntil: new Date("2027-01-01T00:00:00Z"), suspendedReasonCode: null, createdByUserId: "u", updatedByUserId: "u", createdAt: at, updatedAt: at, deletedAt: null };
function evidence(type: CreatorPersonaEvidence["type"], overrides: Partial<CreatorPersonaEvidence> = {}): CreatorPersonaEvidence {
  return { workspaceId: "ws", id: type, personaId: "p", personaRevision: 4, type, issuer: type === "provider_acceptance" ? "provider_policy_registry" : type === "likeness_consent" ? "workspace_consent_officer" : "trust_review_service", subjectDigest: digest, scope: {}, evidenceDigest: digest, provider: type === "provider_acceptance" ? "replicate" : null, providerPolicyVersion: type === "provider_acceptance" ? "2026-09" : null, effectiveAt: new Date("2026-09-01T00:00:00Z"), expiresAt: new Date("2026-10-01T00:00:00Z"), revokedAt: null, verifiedByUserId: "u", createdAt: at, ...overrides };
}

describe("Creator Persona safety gates", () => {
  it("requires current consent, provider acceptance, disclosure, abuse review, active state, and retention", () => {
    expect(evaluatePersonaGate({ persona, evidence: [], at }).reasons).toEqual(["consent_missing", "provider_not_accepted", "disclosure_not_approved", "abuse_review_missing"]);
    expect(evaluatePersonaGate({ persona, evidence: [evidence("likeness_consent"), evidence("provider_acceptance"), evidence("disclosure_review"), evidence("abuse_review")], at }).admitted).toBe(true);
    expect(evaluatePersonaGate({ persona, evidence: [evidence("likeness_consent", { revokedAt: at }), evidence("provider_acceptance"), evidence("disclosure_review"), evidence("abuse_review")], at }).reasons).toContain("consent_expired");
  });

  it("requires Arabic variety and exact immutable training qualification", () => {
    expect(createPersonaSchema.safeParse({ action: "create", name: "A", kind: "synthetic", contentLanguage: "ar", arabicVariety: null, disclosure: "long enough disclosure", retentionUntil: "2027-01-01T00:00:00.000Z", idempotencyKey: "idem-key" }).success).toBe(false);
    expect(requestPersonaTrainingSchema.safeParse({ action: "request_training", expectedRevision: 4, provider: "replicate", model: "owner/model", modelVersion: "immutable-version", qualificationDigest: digest, idempotencyKey: "idem-key" }).success).toBe(true);
  });

  it("verifies non-human evidence with a constant-time server attestation", () => {
    const secret = "x".repeat(32);
    const input = { workspaceId: "ws", personaId: "p", issuer: "provider_policy_registry", subjectDigest: digest, evidenceDigest: digest, scope: { kind: "provider_acceptance", provider: "replicate" }, effectiveAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z" };
    const signature = `hmac-sha256:${createHmac("sha256", secret).update(personaAttestationMessage(input)).digest("hex")}`;
    expect(verifyPersonaAttestation(input, signature, secret)).toBe(true);
    expect(verifyPersonaAttestation({ ...input, workspaceId: "other" }, signature, secret)).toBe(false);
  });

  it("rejects issuer/type substitution", () => {
    const result = addPersonaEvidenceSchema.safeParse({ action: "add_evidence", expectedRevision: 1, issuer: "workspace_consent_officer", subjectDigest: digest, evidenceDigest: digest, scope: { kind: "provider_acceptance", provider: "replicate", model: "m", modelVersion: "v", policyVersion: "p", qualificationDigest: digest, acceptedUses: ["training"] }, effectiveAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z", issuerSignature: null, idempotencyKey: "idem-key" });
    expect(result.success).toBe(false);
  });
});
