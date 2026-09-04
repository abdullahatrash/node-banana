import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inspectReplicateQualificationEnvironment } from "../qualification-preflight";

const publicPem = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();

function readyEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    REPLICATE_QUALIFICATION_API_TOKEN: "qualification-secret",
    REPLICATE_API_KEY: "legacy-secret",
    REPLICATE_MANAGED_API_TOKEN: "managed-secret",
    QUALIFICATION_HARNESS_TOKEN: "harness-secret",
    QUALIFICATION_WEBHOOK_URL: "https://qualification.example/webhook",
    QUALIFICATION_WEBHOOK_OBSERVER_URL: "https://qualification.example/observer",
    QUALIFICATION_INGESTION_URL: "https://qualification.example/ingestion",
    QUALIFICATION_SPEND_OBSERVER_URL: "https://spend.example/qualification",
    QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON: JSON.stringify({ "spend-key": publicPem }),
    MODEL_QUALIFICATION_PUBLIC_KEYS_JSON: JSON.stringify({ "operator-key": publicPem }),
    ...overrides,
  };
}

describe("Replicate qualification environment preflight", () => {
  it("accepts dedicated secrets, safe endpoints, and independent Ed25519 trust maps", () => {
    const result = inspectReplicateQualificationEnvironment(readyEnvironment(), "operator-key");
    expect(result.ready).toBe(true);
    expect(result.checks).toHaveLength(5);
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

  it("rejects missing plan signing trust and unsafe public endpoints", () => {
    const result = inspectReplicateQualificationEnvironment(readyEnvironment({
      QUALIFICATION_INGESTION_URL: "http://qualification.example/ingestion",
      MODEL_QUALIFICATION_PUBLIC_KEYS_JSON: JSON.stringify({ "another-key": publicPem }),
    }), "operator-key");
    expect(result.ready).toBe(false);
    expect(result.checks.find((item) => item.id === "harness_endpoints")?.detail).toContain("QUALIFICATION_INGESTION_URL");
    expect(result.checks.find((item) => item.id === "qualification_trust")?.detail).toContain("operator-key");
  });
});
