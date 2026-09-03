import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "@/lib/agent-tools/canonical";
import { CURATED_MODELS, modelQualificationAttestationSchema } from "./catalog";

const MAX_QUALIFICATION_SPEND_USD = 0.4;
const inputSchema = z.object({
  attestation: modelQualificationAttestationSchema,
  signingKeyId: z.string().min(1).max(100),
}).strict();

export type QualificationRunnerInput = z.input<typeof inputSchema>;

/**
 * Signs operator-reviewed evidence without contacting Replicate. It cannot run
 * a prediction: the module deliberately has no HTTP or provider dependency.
 */
export function produceReplicateQualificationEnvelope(input: QualificationRunnerInput, privateKeyPem: string, at = new Date()) {
  const parsed = inputSchema.parse(input);
  const attestation = parsed.attestation;
  const curated = CURATED_MODELS.find((item) => item.provider === "replicate" && item.model === attestation.model);
  if (!curated) throw new Error("QUALIFICATION_MODEL_NOT_CURATED");
  if (attestation.capabilities.some((capability) => !curated.capabilities.includes(capability))) throw new Error("QUALIFICATION_CAPABILITY_NOT_CURATED");
  if (new Date(attestation.issuedAt) > at || new Date(attestation.expiresAt) <= at) throw new Error("QUALIFICATION_WINDOW_INVALID");
  const maximumSpend = attestation.executionPriceUsd.amount * attestation.maxQuantity;
  if (!Number.isFinite(maximumSpend) || maximumSpend >= MAX_QUALIFICATION_SPEND_USD) throw new Error("QUALIFICATION_BUDGET_CAP_EXCEEDED");
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("QUALIFICATION_SIGNING_KEY_INVALID");
  return {
    version: 1 as const,
    qualifications: [{
      attestation,
      signature: { algorithm: "ed25519" as const, keyId: parsed.signingKeyId, value: sign(null, Buffer.from(canonicalJson(attestation)), privateKey).toString("base64url") },
    }],
  };
}
