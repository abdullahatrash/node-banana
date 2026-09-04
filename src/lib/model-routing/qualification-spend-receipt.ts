import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";

import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import type { QualificationProviderAccount, QualificationSpendAuthorization, QualificationSpendReceipt } from "./qualification-ledger";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const payloadSchema = z.object({
  schema: z.literal("replicate-qualification-spend-receipt/v1"),
  receiptId: z.string().min(8).max(200),
  provider: z.literal("replicate"),
  accountId: z.string().min(1).max(200),
  credentialFingerprint: digest,
  predictionId: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  version: z.string().min(8).max(200),
  currency: z.literal("USD"),
  amountUsd: z.number().nonnegative().max(1_000_000),
  observedAt: z.string().datetime({ offset: true }),
  source: z.literal("replicate-account-billing"),
  providerEvidence: z.object({ kind: z.enum(["replicate_account_usage_export", "replicate_invoice", "replicate_account_screenshot"]), scope: z.literal("exact_prediction_charge"), digest, observedBy: z.string().min(3).max(200), notesDigest: digest }).strict(),
  digest,
}).strict();

const envelopeSchema = z.object({
  receipt: payloadSchema,
  signature: z.object({ algorithm: z.literal("ed25519"), keyId: z.string().min(1).max(100), value: z.string().min(40).max(500) }).strict(),
}).strict();

const authorizationPayloadSchema = z.object({
  schema: z.literal("replicate-qualification-spend-authorization/v1"), authorizationId: z.string().min(8).max(200), provider: z.literal("replicate"), accountId: z.string().min(1).max(200), credentialFingerprint: digest,
  model: z.string().min(1).max(200), version: z.string().min(8).max(200), capability: z.enum(["text_generation", "text_to_image", "image_to_image", "text_to_video", "image_to_video", "video_to_video"]), billableQuantity: z.number().positive().max(600), maximumAmountUsd: z.number().positive().max(1_000_000), expiresAt: z.string().datetime({ offset: true }), pricingSourceDigest: digest, source: z.literal("reviewed-pricing-contract"), digest,
}).strict();
const authorizationEnvelopeSchema = z.object({ authorization: authorizationPayloadSchema, signature: z.object({ algorithm: z.literal("ed25519"), keyId: z.string().min(1).max(100), value: z.string().min(40).max(500) }).strict() }).strict();

export type QualificationSpendReceiptEnvelope = z.infer<typeof envelopeSchema>;

function trustedSignature(payload: Record<string, unknown>, signature: { keyId: string; value: string }, trustedKeys: Readonly<Record<string, string>>) {
  const publicKeyPem = trustedKeys[signature.keyId];
  if (!publicKeyPem) throw new Error("QUALIFICATION_SPEND_RECEIPT_KEY_UNTRUSTED");
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(signature.value, "base64url"))) throw new Error("QUALIFICATION_SPEND_RECEIPT_SIGNATURE_INVALID");
}

export function verifyQualificationSpendAuthorization(value: unknown, trustedKeys: Readonly<Record<string, string>>, expected: { account: QualificationProviderAccount; model: string; version: string; capability: QualificationSpendAuthorization["capability"]; billableQuantity: number; maximumAmountUsd: number; pricingSourceDigest: string }): QualificationSpendAuthorization {
  const envelope = authorizationEnvelopeSchema.parse(value);
  const { authorization, signature } = envelope;
  const { digest: claimedDigest, ...unsigned } = authorization;
  if (canonicalDigest(unsigned) !== claimedDigest) throw new Error("QUALIFICATION_SPEND_AUTHORIZATION_DIGEST_INVALID");
  trustedSignature(authorization, signature, trustedKeys);
  if (authorization.provider !== expected.account.provider || authorization.accountId !== expected.account.accountId || authorization.credentialFingerprint !== expected.account.credentialFingerprint || authorization.model !== expected.model || authorization.version !== expected.version || authorization.capability !== expected.capability || authorization.billableQuantity !== expected.billableQuantity || authorization.maximumAmountUsd !== expected.maximumAmountUsd || authorization.pricingSourceDigest !== expected.pricingSourceDigest) throw new Error("QUALIFICATION_SPEND_AUTHORIZATION_IDENTITY_MISMATCH");
  return { ...authorization, credentialFingerprint: authorization.credentialFingerprint as `sha256:${string}`, pricingSourceDigest: authorization.pricingSourceDigest as `sha256:${string}`, digest: authorization.digest as `sha256:${string}`, signingKeyId: signature.keyId };
}

export function verifyQualificationSpendReceipt(
  value: unknown,
  trustedKeys: Readonly<Record<string, string>>,
  expected: { account: QualificationProviderAccount; predictionId: string; model: string; version: string },
): QualificationSpendReceipt {
  const envelope = envelopeSchema.parse(value);
  const { receipt, signature } = envelope;
  const { digest: claimedDigest, ...unsigned } = receipt;
  if (canonicalDigest(unsigned) !== claimedDigest) throw new Error("QUALIFICATION_SPEND_RECEIPT_DIGEST_INVALID");
  trustedSignature(receipt, signature, trustedKeys);
  if (receipt.provider !== expected.account.provider || receipt.accountId !== expected.account.accountId || receipt.credentialFingerprint !== expected.account.credentialFingerprint || receipt.predictionId !== expected.predictionId || receipt.model !== expected.model || receipt.version !== expected.version) throw new Error("QUALIFICATION_SPEND_RECEIPT_IDENTITY_MISMATCH");
  return { ...receipt, credentialFingerprint: receipt.credentialFingerprint as `sha256:${string}`, providerEvidence: { ...receipt.providerEvidence, digest: receipt.providerEvidence.digest as `sha256:${string}`, notesDigest: receipt.providerEvidence.notesDigest as `sha256:${string}` }, digest: receipt.digest as `sha256:${string}`, signingKeyId: signature.keyId };
}
