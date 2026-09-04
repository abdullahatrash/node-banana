import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inspectReplicateQualificationEnvironment } from "../qualification-preflight";

const spendPair = generateKeyPairSync("ed25519");
const publicPem = spendPair.publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = spendPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function readyEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    REPLICATE_QUALIFICATION_API_TOKEN: "qualification-secret",
    REPLICATE_API_KEY: "legacy-secret",
    REPLICATE_MANAGED_API_TOKEN: "managed-secret",
    QUALIFICATION_HARNESS_TOKEN: "harness-secret-at-least-32-characters",
    QUALIFICATION_WEBHOOK_URL: "https://qualification.example/webhook",
    QUALIFICATION_WEBHOOK_OBSERVER_URL: "https://qualification.example/observer",
    QUALIFICATION_INGESTION_URL: "https://qualification.example/ingestion",
    QUALIFICATION_SPEND_OBSERVER_URL: "https://spend.example/qualification",
    QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON: JSON.stringify({ "spend-key": publicPem }),
    QUALIFICATION_SPEND_SIGNING_KEY_ID: "spend-key",
    QUALIFICATION_SPEND_SIGNING_PRIVATE_KEY: privatePem,
    MODEL_QUALIFICATION_PUBLIC_KEYS_JSON: JSON.stringify({ "operator-key": publicPem }),
    ...overrides,
  };
}

describe("Replicate qualification environment preflight", () => {
  it("accepts dedicated secrets, safe endpoints, and independent Ed25519 trust maps", () => {
    const result = inspectReplicateQualificationEnvironment(readyEnvironment(), "operator-key");
    expect(result.ready).toBe(true);
    expect(result.checks).toHaveLength(6);
  });

  it("rejects reuse of a legacy token without exposing any token value", () => {
    const environment = readyEnvironment({ REPLICATE_QUALIFICATION_API_TOKEN: "legacy-secret" });
    const result = inspectReplicateQualificationEnvironment(environment, "operator-key");
    expect(result.ready).toBe(false);
    expect(result.checks.find((item) => item.id === "dedicated_token")?.status).toBe("blocked");
    expect(JSON.stringify(result)).not.toContain("legacy-secret");
  });

  it("rejects example-file placeholders as credentials", () => {
    const result = inspectReplicateQualificationEnvironment(readyEnvironment({
      REPLICATE_QUALIFICATION_API_TOKEN: "your_replicate_api_key_here",
      QUALIFICATION_HARNESS_TOKEN: "replace_me",
    }), "operator-key");
    expect(result.ready).toBe(false);
    expect(result.checks.find((item) => item.id === "dedicated_token")?.status).toBe("blocked");
    expect(result.checks.find((item) => item.id === "harness_token")?.status).toBe("blocked");
  });

  it("rejects a weak harness bearer secret", () => {
    const result = inspectReplicateQualificationEnvironment(readyEnvironment({ QUALIFICATION_HARNESS_TOKEN: "too-short" }), "operator-key");
    expect(result.ready).toBe(false);
    expect(result.checks.find((item) => item.id === "harness_token")?.detail).toContain("at least 32 characters");
  });

  it("rejects missing plan signing trust and unsafe public endpoints", () => {
    const result = inspectReplicateQualificationEnvironment(readyEnvironment({
      QUALIFICATION_INGESTION_URL: "http://qualification.example/ingestion",
      MODEL_QUALIFICATION_PUBLIC_KEYS_JSON: JSON.stringify({ "another-key": publicPem }),
    }), "operator-key");
    expect(result.ready).toBe(false);
    expect(result.checks.find((item) => item.id === "harness_endpoints")?.detail).toContain("QUALIFICATION_INGESTION_URL");
    expect(result.checks.find((item) => item.id === "qualification_trust")?.detail).toContain("operator-key");
  });

  it("rejects a spend signing key that does not match its public trust root", () => {
    const otherPrivate = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const result = inspectReplicateQualificationEnvironment(readyEnvironment({ QUALIFICATION_SPEND_SIGNING_PRIVATE_KEY: otherPrivate }), "operator-key");
    expect(result.ready).toBe(false);
    expect(result.checks.find((item) => item.id === "spend_signing_authority")?.status).toBe("blocked");
  });
});
