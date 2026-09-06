import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";

export type PersonaAttestationInput = {
  workspaceId: string;
  personaId: string;
  issuer: string;
  subjectDigest: string;
  evidenceDigest: string;
  scope: Record<string, unknown>;
  effectiveAt: string;
  expiresAt: string;
};

export function personaAttestationMessage(input: PersonaAttestationInput) {
  return canonicalDigest({ schema: "creator-persona-attestation/v1", ...input });
}

export function verifyPersonaAttestation(input: PersonaAttestationInput, signature: string | null, secret = process.env.PERSONA_ATTESTATION_SECRET) {
  if (!secret || secret.length < 32 || !signature?.startsWith("hmac-sha256:")) return false;
  const expected = createHmac("sha256", secret).update(personaAttestationMessage(input)).digest("hex");
  const supplied = signature.slice("hmac-sha256:".length);
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}
