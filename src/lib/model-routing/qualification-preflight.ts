import { createPublicKey } from "node:crypto";
import { z } from "zod";

export type QualificationPreflightCheck = {
  id: string;
  status: "ready" | "blocked";
  detail: string;
};

const publicKeyMapSchema = z.record(z.string().min(1).max(100), z.string().min(40).max(10_000));
const endpointKeys = [
  "QUALIFICATION_WEBHOOK_URL",
  "QUALIFICATION_WEBHOOK_OBSERVER_URL",
  "QUALIFICATION_INGESTION_URL",
  "QUALIFICATION_SPEND_OBSERVER_URL",
] as const;

function check(id: string, ready: boolean, detail: string): QualificationPreflightCheck {
  return { id, status: ready ? "ready" : "blocked", detail };
}

function safeEndpoint(value: string | undefined) {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}

function validEd25519KeyMap(raw: string | undefined, requiredKeyId?: string) {
  if (!raw?.trim()) return false;
  try {
    const keys = publicKeyMapSchema.parse(JSON.parse(raw));
    if (Object.keys(keys).length === 0 || (requiredKeyId && !keys[requiredKeyId])) return false;
    return Object.values(keys).every((pem) => createPublicKey(pem.replace(/\\n/g, "\n")).asymmetricKeyType === "ed25519");
  } catch {
    return false;
  }
}

/** Validates operator configuration without making network or provider calls. */
export function inspectReplicateQualificationEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  signingKeyId?: string,
) {
  const qualificationToken = environment.REPLICATE_QUALIFICATION_API_TOKEN?.trim();
  const tokenIsDedicated = Boolean(
    qualificationToken
    && qualificationToken !== environment.REPLICATE_API_KEY?.trim()
    && qualificationToken !== environment.REPLICATE_MANAGED_API_TOKEN?.trim(),
  );
  const endpointFailures = endpointKeys.filter((key) => !safeEndpoint(environment[key]));
  const spendTrustIsValid = validEd25519KeyMap(environment.QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON);
  const qualificationTrustIsValid = validEd25519KeyMap(environment.MODEL_QUALIFICATION_PUBLIC_KEYS_JSON, signingKeyId);
  const checks = [
    check(
      "dedicated_token",
      tokenIsDedicated,
      tokenIsDedicated
        ? "A dedicated qualification token is configured and differs from legacy and managed tokens."
        : "Set a dedicated REPLICATE_QUALIFICATION_API_TOKEN; do not reuse legacy, managed, or Workspace BYOK credentials.",
    ),
    check(
      "harness_token",
      Boolean(environment.QUALIFICATION_HARNESS_TOKEN?.trim()),
      environment.QUALIFICATION_HARNESS_TOKEN?.trim()
        ? "The qualification harness bearer secret is configured."
        : "Set QUALIFICATION_HARNESS_TOKEN for the operator-only harness.",
    ),
    check(
      "harness_endpoints",
      endpointFailures.length === 0,
      endpointFailures.length === 0
        ? "All webhook, observer, ingestion, and spend endpoints use HTTPS or loopback HTTP."
        : `Missing or unsafe endpoint variables: ${endpointFailures.join(", ")}.`,
    ),
    check(
      "spend_trust",
      spendTrustIsValid,
      spendTrustIsValid
        ? "The independent spend-receipt Ed25519 trust map is valid."
        : "Set QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON to a non-empty Ed25519 public-key map.",
    ),
    check(
      "qualification_trust",
      qualificationTrustIsValid,
      qualificationTrustIsValid
        ? signingKeyId
          ? `The runtime trust map contains Ed25519 signing key ${signingKeyId}.`
          : "The runtime model-qualification Ed25519 trust map is valid."
        : signingKeyId
          ? `MODEL_QUALIFICATION_PUBLIC_KEYS_JSON must contain Ed25519 signing key ${signingKeyId}.`
          : "Set MODEL_QUALIFICATION_PUBLIC_KEYS_JSON to a non-empty Ed25519 public-key map.",
    ),
  ];
  return { ready: checks.every((item) => item.status === "ready"), checks };
}
