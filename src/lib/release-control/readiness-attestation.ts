import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ReleaseReadinessDecision } from "./types";

const schema = z.object({ schema: z.literal("release-readiness-attestation/v1"), keyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/), buildId: z.string().min(1).max(120), evaluatedAt: z.string().datetime({ offset: true }), signature: z.string().regex(/^hmac-sha256:[a-f0-9]{64}$/) }).strict();
export type ReleaseReadinessAttestation = z.infer<typeof schema>;

function canonical(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; }
function payload(decision: ReleaseReadinessDecision, keyId: string): Record<string, unknown> { return { keyId, decision: JSON.parse(JSON.stringify(decision)) as unknown }; }

export function signReleaseReadiness(decision: ReleaseReadinessDecision, keyId: string, secret: string): ReleaseReadinessAttestation {
  if (secret.length < 32) throw new TypeError("RELEASE_READINESS_SIGNING_SECRET_INVALID");
  return { schema: "release-readiness-attestation/v1", keyId, buildId: decision.buildId, evaluatedAt: decision.evaluatedAt.toISOString(), signature: `hmac-sha256:${createHmac("sha256", secret).update(canonical(payload(decision, keyId))).digest("hex")}` };
}

export function verifyReleaseReadiness(decision: ReleaseReadinessDecision, value: unknown, expectedKeyId: string, secret: string, now: Date): ReleaseReadinessAttestation {
  const attestation = schema.parse(value); if (attestation.keyId !== expectedKeyId || attestation.buildId !== decision.buildId || attestation.evaluatedAt !== decision.evaluatedAt.toISOString() || new Date(attestation.evaluatedAt) > now || new Date(attestation.evaluatedAt).getTime() < now.getTime() - 5 * 60_000) throw new TypeError("RELEASE_READINESS_ATTESTATION_INVALID");
  const expected = signReleaseReadiness(decision, expectedKeyId, secret).signature; const a = Buffer.from(expected); const b = Buffer.from(attestation.signature); if (a.length !== b.length || !timingSafeEqual(a, b)) throw new TypeError("RELEASE_READINESS_SIGNATURE_INVALID"); return attestation;
}
