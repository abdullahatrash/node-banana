import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import { canonicalJson } from "@/lib/agent-tools/canonical";
import { authorizeQualificationSpend, importQualificationSpendEvidence, loadQualificationSpendSigningAuthority } from "../qualification-spend-evidence";

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privatePem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    publicKey: pair.publicKey,
  };
}

describe("qualification spend signing authority", () => {
  it("loads only a private key matching the independently trusted public key", () => {
    const pair = keys();
    const authority = loadQualificationSpendSigningAuthority({
      QUALIFICATION_SPEND_SIGNING_KEY_ID: "spend-key",
      QUALIFICATION_SPEND_SIGNING_PRIVATE_KEY: pair.privatePem,
      QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON: JSON.stringify({ "spend-key": pair.publicPem }),
    });
    const signed = authority.signPayload({ schema: "test/v1", amount: 0.01 });
    expect(authority.keyId).toBe("spend-key");
    expect(signed.payload.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(verify(null, Buffer.from(canonicalJson(signed.payload)), pair.publicKey, Buffer.from(signed.signature.value, "base64url"))).toBe(true);
  });

  it("rejects a private key that does not match the configured trust root", () => {
    const privatePair = keys();
    const trustedPair = keys();
    expect(() => loadQualificationSpendSigningAuthority({
      QUALIFICATION_SPEND_SIGNING_KEY_ID: "spend-key",
      QUALIFICATION_SPEND_SIGNING_PRIVATE_KEY: privatePair.privatePem,
      QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON: JSON.stringify({ "spend-key": trustedPair.publicPem }),
    })).toThrow("QUALIFICATION_SPEND_SIGNING_KEY_MISMATCH");
  });

  it("rejects values that cannot be represented by the append-only six-decimal ledger", async () => {
    const database = {} as never;
    const authority = {} as never;
    const account = { provider: "replicate" as const, accountId: "account", credentialFingerprint: `sha256:${"a".repeat(64)}` as const };
    await expect(authorizeQualificationSpend({ database, authority, at: new Date(), runId: "run", caseId: "case", model: "owner/model", version: "immutable-version", capability: "text_to_image", billableQuantity: 1, maximumAmountUsd: 0.0000001, pricingSourceDigest: `sha256:${"b".repeat(64)}`, account })).rejects.toThrow("QUALIFICATION_SPEND_AUTHORIZATION_PRECISION_INVALID");
    await expect(importQualificationSpendEvidence({ database, authority, at: new Date(), runId: "run", caseId: "case", predictionId: "prediction", amountUsd: 0.0000001, providerObservedAt: new Date(), providerEvidenceKind: "replicate_invoice", providerEvidenceDigest: `sha256:${"c".repeat(64)}`, importedBy: "operator", notes: "exact charge" })).rejects.toThrow("QUALIFICATION_SPEND_RECEIPT_PRECISION_INVALID");
  });
});
