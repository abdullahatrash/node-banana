import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import type { CreatorPersona, CreatorPersonaEvidence } from "./types";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/).transform((value) => value as `sha256:${string}`);
const httpsUrl = z.string().url().refine((value) => value.startsWith("https://"));
export const personaTrainingQualificationSchema = z.object({
  schema: z.literal("creator-persona-training-qualification/v1"),
  id: z.string().min(8).max(200), revision: z.number().int().positive(),
  provider: z.literal("replicate"), model: z.string().min(1).max(200), version: z.string().min(8).max(200), inputSchemaDigest: digest,
  providerPolicyVersion: z.string().min(1).max(200),
  contentLanguages: z.array(z.enum(["ar", "en"])).min(1), arabicVarieties: z.array(z.enum(["msa", "gulf", "egyptian", "levantine", "maghrebi"])),
  verifiedRegions: z.array(z.string().min(1).max(100)).min(1),
  priceUsd: z.object({ basis: z.literal("run"), amount: z.number().positive().max(100) }).strict(),
  sourceContract: z.object({ minimum: z.number().int().min(3).max(100), maximum: z.number().int().min(3).max(100), mediaTypes: z.array(z.enum(["image", "video"])).min(1) }).strict(),
  pricingSource: z.object({ sourceUrl: httpsUrl, digest, checkedAt: z.string().datetime({ offset: true }) }).strict(),
  qualificationRun: z.object({ id: z.string().min(8).max(200), digest, completedAt: z.string().datetime({ offset: true }) }).strict(),
  issuedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.sourceContract.maximum < value.sourceContract.minimum) context.addIssue({ code: "custom", path: ["sourceContract", "maximum"], message: "SOURCE_RANGE_INVALID" });
  if (value.contentLanguages.includes("ar") && value.arabicVarieties.length === 0) context.addIssue({ code: "custom", path: ["arabicVarieties"], message: "ARABIC_VARIETY_COVERAGE_REQUIRED" });
});
const envelopeSchema = z.object({ version: z.literal(1), qualifications: z.array(z.object({ attestation: personaTrainingQualificationSchema, signature: z.object({ algorithm: z.literal("ed25519"), keyId: z.string().min(1).max(100), value: z.string().min(40).max(500) }).strict() }).strict()).max(100) }).strict();
const keySchema = z.record(z.string().min(1).max(100), z.string().min(40).max(10_000));
export type PersonaTrainingQualification = z.infer<typeof personaTrainingQualificationSchema> & { digest: `sha256:${string}`; signingKeyId: string };

export function configuredPersonaTrainingQualifications(raw = process.env.PERSONA_TRAINING_QUALIFICATIONS_JSON, rawKeys = process.env.MODEL_QUALIFICATION_PUBLIC_KEYS_JSON, at = new Date()): PersonaTrainingQualification[] {
  if (!raw || !rawKeys) return [];
  let envelope: z.infer<typeof envelopeSchema>; let keys: z.infer<typeof keySchema>;
  try { envelope = envelopeSchema.parse(JSON.parse(raw)); keys = keySchema.parse(JSON.parse(rawKeys)); } catch { return []; }
  return envelope.qualifications.flatMap(({ attestation, signature }) => {
    const issuedAt = new Date(attestation.issuedAt), expiresAt = new Date(attestation.expiresAt), key = keys[signature.keyId];
    let authentic = false;
    try { authentic = Boolean(key) && verify(null, Buffer.from(canonicalJson(attestation)), createPublicKey(key), Buffer.from(signature.value, "base64url")); } catch { authentic = false; }
    if (!authentic || issuedAt > at || expiresAt <= at || expiresAt.getTime() - issuedAt.getTime() > 90 * 86_400_000) return [];
    return [{ ...attestation, digest: canonicalDigest(attestation) as `sha256:${string}`, signingKeyId: signature.keyId }];
  });
}

export function selectPersonaTrainingQualification(input: { persona: CreatorPersona; providerAcceptance: CreatorPersonaEvidence; qualifications: PersonaTrainingQualification[]; region?: string; sourceCount: number; sourceMediaTypes: string[] }) {
  const scope = input.providerAcceptance.scope;
  const matches = input.qualifications.filter((item) => item.provider === input.providerAcceptance.provider && item.model === scope.model && item.version === scope.modelVersion && item.inputSchemaDigest === scope.inputSchemaDigest && item.providerPolicyVersion === input.providerAcceptance.providerPolicyVersion && item.digest === scope.qualificationDigest && item.contentLanguages.includes(input.persona.contentLanguage) && (!input.persona.arabicVariety || item.arabicVarieties.includes(input.persona.arabicVariety)) && (!input.region || item.verifiedRegions.includes(input.region)) && input.sourceCount >= item.sourceContract.minimum && input.sourceCount <= item.sourceContract.maximum && input.sourceMediaTypes.every((type) => item.sourceContract.mediaTypes.includes(type as "image" | "video")) && Array.isArray(scope.acceptedUses) && scope.acceptedUses.includes("training"));
  return matches.sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}
