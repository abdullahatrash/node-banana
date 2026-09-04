import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { verifyQualificationSpendAuthorization, verifyQualificationSpendReceipt } from "../qualification-spend-receipt";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const account = { provider: "replicate" as const, accountId: "provider-account", credentialFingerprint: `sha256:${"8".repeat(64)}` as const };

function envelope(amountUsd = 0.012) {
  const unsigned = { schema: "replicate-qualification-spend-receipt/v1" as const, receiptId: "receipt-prediction-1", ...account, predictionId: "prediction-1", model: "owner/model", version: "immutable-version-1", currency: "USD" as const, amountUsd, observedAt: "2026-09-04T00:00:00.000Z", source: "replicate-account-billing" as const };
  const receipt = { ...unsigned, digest: canonicalDigest(unsigned) as `sha256:${string}` };
  return { receipt, signature: { algorithm: "ed25519" as const, keyId: "billing-key", value: sign(null, Buffer.from(canonicalJson(receipt)), privateKey).toString("base64url") } };
}

function authorizationEnvelope() {
  const unsigned = { schema: "replicate-qualification-spend-authorization/v1" as const, authorizationId: "authorization-case-1", ...account, model: "owner/model", version: "immutable-version-1", capability: "image_to_video" as const, billableQuantity: 5, maximumAmountUsd: 0.025, expiresAt: "2026-09-05T00:00:00.000Z", source: "replicate-account-billing" as const };
  const authorization = { ...unsigned, digest: canonicalDigest(unsigned) as `sha256:${string}` };
  return { authorization, signature: { algorithm: "ed25519" as const, keyId: "billing-key", value: sign(null, Buffer.from(canonicalJson(authorization)), privateKey).toString("base64url") } };
}

describe("qualification spend receipts", () => {
  it("accepts only a signed receipt bound to credential, account, prediction and immutable model version", () => {
    const result = verifyQualificationSpendReceipt(envelope(), { "billing-key": publicKey.export({ type: "spki", format: "pem" }).toString() }, { account, predictionId: "prediction-1", model: "owner/model", version: "immutable-version-1" });
    expect(result).toMatchObject({ amountUsd: 0.012, signingKeyId: "billing-key", ...account });
  });

  it("rejects cost tampering and identity replay", () => {
    const trusted = { "billing-key": publicKey.export({ type: "spki", format: "pem" }).toString() };
    const altered = envelope();
    altered.receipt.amountUsd = 0.39;
    expect(() => verifyQualificationSpendReceipt(altered, trusted, { account, predictionId: "prediction-1", model: "owner/model", version: "immutable-version-1" })).toThrow("QUALIFICATION_SPEND_RECEIPT_DIGEST_INVALID");
    expect(() => verifyQualificationSpendReceipt(envelope(), trusted, { account, predictionId: "prediction-other", model: "owner/model", version: "immutable-version-1" })).toThrow("QUALIFICATION_SPEND_RECEIPT_IDENTITY_MISMATCH");
  });

  it("verifies the credential-bound maximum before any paid submission", () => {
    const trusted = { "billing-key": publicKey.export({ type: "spki", format: "pem" }).toString() };
    const result = verifyQualificationSpendAuthorization(authorizationEnvelope(), trusted, { account, model: "owner/model", version: "immutable-version-1", capability: "image_to_video", billableQuantity: 5 });
    expect(result).toMatchObject({ maximumAmountUsd: 0.025, signingKeyId: "billing-key", ...account });
    expect(() => verifyQualificationSpendAuthorization(authorizationEnvelope(), trusted, { account, model: "owner/model", version: "immutable-version-1", capability: "text_to_video", billableQuantity: 5 })).toThrow("QUALIFICATION_SPEND_AUTHORIZATION_IDENTITY_MISMATCH");
  });
});
