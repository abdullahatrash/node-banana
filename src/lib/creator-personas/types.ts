export const PERSONA_STATES = [
  "draft", "consent_review", "ready_to_train", "training", "review",
  "active", "training_failed", "suspended", "consent_expired", "deleted",
] as const;
export type CreatorPersonaState = (typeof PERSONA_STATES)[number];
export type CreatorPersonaKind = "synthetic" | "consented_likeness";
export type PersonaEvidenceType = "likeness_consent" | "provider_acceptance" | "disclosure_review" | "abuse_review";
export type PersonaUsagePurpose = "generation" | "content_set" | "channel" | "blitz";

export interface CreatorPersona {
  workspaceId: string;
  id: string;
  kind: CreatorPersonaKind;
  state: CreatorPersonaState;
  name: string;
  contentLanguage: "ar" | "en";
  arabicVariety: "msa" | "gulf" | "egyptian" | "levantine" | "maghrebi" | null;
  disclosure: string;
  revision: number;
  reusableModelRef: string | null;
  retentionUntil: Date;
  suspendedReasonCode: string | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
export interface CreatorPersonaEvidence {
  workspaceId: string;
  id: string;
  personaId: string;
  personaRevision: number;
  type: PersonaEvidenceType;
  issuer: "workspace_consent_officer" | "provider_policy_registry" | "trust_review_service";
  subjectDigest: `sha256:${string}`;
  scope: Record<string, unknown>;
  evidenceDigest: `sha256:${string}`;
  provider: string | null;
  providerPolicyVersion: string | null;
  effectiveAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  verifiedByUserId: string;
  createdAt: Date;
}

export interface PersonaGateResult {
  admitted: boolean;
  reasons: Array<"not_active" | "retention_expired" | "consent_missing" | "consent_expired" | "provider_not_accepted" | "disclosure_not_approved" | "abuse_review_missing">;
  evidence: {
    consent: CreatorPersonaEvidence | null;
    providerAcceptance: CreatorPersonaEvidence | null;
    disclosure: CreatorPersonaEvidence | null;
    abuseReview: CreatorPersonaEvidence | null;
  };
}

export function evaluatePersonaGate(input: {
  persona: CreatorPersona;
  evidence: CreatorPersonaEvidence[];
  at: Date;
  requireActive?: boolean;
}): PersonaGateResult {
  const current = (type: PersonaEvidenceType) => input.evidence
    .filter((item) => item.type === type && !item.revokedAt && item.effectiveAt <= input.at && item.expiresAt > input.at)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const consent = current("likeness_consent");
  const providerAcceptance = current("provider_acceptance");
  const disclosure = current("disclosure_review");
  const abuseReview = current("abuse_review");
  const reasons: PersonaGateResult["reasons"] = [];
  if (input.requireActive !== false && input.persona.state !== "active") reasons.push("not_active");
  if (input.persona.retentionUntil <= input.at) reasons.push("retention_expired");
  if (input.persona.kind === "consented_likeness" && !consent) {
    const anyConsent = input.evidence.some((item) => item.type === "likeness_consent");
    reasons.push(anyConsent ? "consent_expired" : "consent_missing");
  }
  if (!providerAcceptance) reasons.push("provider_not_accepted");
  if (!disclosure) reasons.push("disclosure_not_approved");
  if (!abuseReview) reasons.push("abuse_review_missing");
  return { admitted: reasons.length === 0, reasons, evidence: { consent, providerAcceptance, disclosure, abuseReview } };
}
