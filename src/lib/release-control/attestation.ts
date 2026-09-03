import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { releaseRecordInputSchema, type ReleaseRecordInput } from "./schemas";

export const RELEASE_SIGNER_ROLES = ["ci", "accessibility_auditor", "recovery_operator", "migration_operator", "product_signer", "engineering_signer"] as const;
export type ReleaseSignerRole = typeof RELEASE_SIGNER_ROLES[number];
export interface ReleaseAttestationKey { role: ReleaseSignerRole; secret: string }
export type ReleaseAttestationKeyring = Record<string, ReleaseAttestationKey>;

const signatureSchema = z.object({ keyId: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), role: z.enum(RELEASE_SIGNER_ROLES), issuedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }), signature: z.string().regex(/^hmac-sha256:[a-f0-9]{64}$/) }).strict();
export const releaseAttestationSchema = z.object({ schema: z.literal("release-attestation/v1"), workspaceId: z.string().min(1).max(200), record: releaseRecordInputSchema, signatures: z.array(signatureSchema).min(1).max(2) }).strict();
export type ReleaseAttestation = z.infer<typeof releaseAttestationSchema>;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function signedPayload(attestation: Omit<ReleaseAttestation, "signatures">, signature: Omit<ReleaseAttestation["signatures"][number], "signature">): string {
  return canonical({ ...attestation, signer: signature });
}

export function signReleaseAttestation(input: Omit<ReleaseAttestation, "signatures">, signer: Omit<ReleaseAttestation["signatures"][number], "signature">, secret: string): string {
  return `hmac-sha256:${createHmac("sha256", secret).update(signedPayload(input, signer)).digest("hex")}`;
}

function equalSignature(expected: string, actual: string): boolean { const a = Buffer.from(expected); const b = Buffer.from(actual); return a.length === b.length && timingSafeEqual(a, b); }
function artifactDigest(record: ReleaseRecordInput): string | null { return "artifactDigest" in record.document ? String(record.document.artifactDigest) : null; }

export function verifyReleaseAttestation(value: unknown, keyring: ReleaseAttestationKeyring, now: Date): ReleaseAttestation {
  const attestation = releaseAttestationSchema.parse(value); const unsigned = { schema: attestation.schema, workspaceId: attestation.workspaceId, record: attestation.record } as const;
  const roles = new Set<ReleaseSignerRole>(); const keyIds = new Set<string>();
  for (const item of attestation.signatures) {
    const key = keyring[item.keyId]; if (!key || key.role !== item.role || key.secret.length < 32) throw new TypeError("ATTESTATION_KEY_INVALID");
    if (new Date(item.issuedAt) > now || new Date(item.expiresAt) <= now) throw new TypeError("ATTESTATION_EXPIRED");
    const expected = signReleaseAttestation(unsigned, { keyId: item.keyId, role: item.role, issuedAt: item.issuedAt, expiresAt: item.expiresAt }, key.secret);
    if (!equalSignature(expected, item.signature)) throw new TypeError("ATTESTATION_SIGNATURE_INVALID");
    if (keyIds.has(item.keyId)) throw new TypeError("ATTESTATION_SIGNERS_NOT_INDEPENDENT");
    keyIds.add(item.keyId); roles.add(item.role);
  }
  const required = attestation.record.recordKind === "evidence" ? (attestation.record.document.kind === "performance" ? ["ci"] : ["accessibility_auditor"]) : attestation.record.recordKind === "recovery_objective" || attestation.record.recordKind === "restore_drill" ? ["recovery_operator"] : attestation.record.recordKind === "contract_migration" ? ["migration_operator"] : attestation.record.recordKind === "parity_requirement" ? ["product_signer", "engineering_signer"] : [];
  if (!required.length || required.some((role) => !roles.has(role as ReleaseSignerRole)) || roles.size !== required.length) throw new TypeError("ATTESTATION_ROLE_INVALID");
  if (!artifactDigest(attestation.record)) throw new TypeError("ATTESTATION_ARTIFACT_UNBOUND");
  const signerByRole = new Map(attestation.signatures.map((item) => [item.role, item.keyId]));
  if (attestation.record.recordKind === "evidence" && attestation.record.document.runner !== signerByRole.get(attestation.record.document.kind === "performance" ? "ci" : "accessibility_auditor")) throw new TypeError("ATTESTATION_ACTOR_MISMATCH");
  if (attestation.record.recordKind === "recovery_objective" && attestation.record.document.ownerUserId !== signerByRole.get("recovery_operator")) throw new TypeError("ATTESTATION_ACTOR_MISMATCH");
  if (attestation.record.recordKind === "restore_drill" && attestation.record.document.executedByUserId !== signerByRole.get("recovery_operator")) throw new TypeError("ATTESTATION_ACTOR_MISMATCH");
  if (attestation.record.recordKind === "parity_requirement" && (attestation.record.document.productSignoffUserId !== signerByRole.get("product_signer") || attestation.record.document.engineeringSignoffUserId !== signerByRole.get("engineering_signer"))) throw new TypeError("ATTESTATION_ACTOR_MISMATCH");
  return attestation;
}

export function parseReleaseAttestationKeyring(raw: string | undefined): ReleaseAttestationKeyring {
  if (!raw) return {}; const parsed = z.record(z.string(), z.object({ role: z.enum(RELEASE_SIGNER_ROLES), secret: z.string().min(32) }).strict()).parse(JSON.parse(raw)); return parsed;
}
