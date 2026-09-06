import "server-only";

import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { and, desc, eq, exists, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { readConfiguredSecret } from "@/lib/configured-secret";
import type { getDb } from "@/lib/db";
import { modelQualificationCases, modelQualificationRuns, modelQualificationSpendAuthorizations, modelQualificationSpendEvidenceImports, modelQualificationWebhookReceipts } from "./db-schema";
import type { QualificationProviderAccount, QualificationSpendAuthorization } from "./qualification-ledger";
import type { CostQuoteLineItem } from "./types";

type Db = ReturnType<typeof getDb>;
type Capability = QualificationSpendAuthorization["capability"];
type Environment = Readonly<Record<string, string | undefined>>;

export type QualificationSpendSigningAuthority = {
  keyId: string;
  signPayload<T extends Record<string, unknown>>(unsigned: T): { payload: T & { digest: `sha256:${string}` }; signature: { algorithm: "ed25519"; keyId: string; value: string } };
};

export function loadQualificationSpendSigningAuthority(environment: Environment = process.env): QualificationSpendSigningAuthority {
  const keyId = environment.QUALIFICATION_SPEND_SIGNING_KEY_ID?.trim();
  const privatePem = readConfiguredSecret(environment.QUALIFICATION_SPEND_SIGNING_PRIVATE_KEY)?.replace(/\\n/g, "\n");
  const trustRaw = environment.QUALIFICATION_SPEND_RECEIPT_PUBLIC_KEYS_JSON?.trim();
  if (!keyId || !privatePem || !trustRaw) throw new Error("QUALIFICATION_SPEND_SIGNING_AUTHORITY_REQUIRED");
  let trustedPem: string;
  try {
    const trust = JSON.parse(trustRaw) as Record<string, unknown>;
    if (typeof trust[keyId] !== "string") throw new Error();
    trustedPem = trust[keyId].replace(/\\n/g, "\n");
  } catch {
    throw new Error("QUALIFICATION_SPEND_SIGNING_TRUST_INVALID");
  }
  const privateKey = createPrivateKey(privatePem);
  const trustedPublicKey = createPublicKey(trustedPem);
  if (privateKey.asymmetricKeyType !== "ed25519" || trustedPublicKey.asymmetricKeyType !== "ed25519" || !createPublicKey(privateKey).equals(trustedPublicKey)) throw new Error("QUALIFICATION_SPEND_SIGNING_KEY_MISMATCH");
  return {
    keyId,
    signPayload<T extends Record<string, unknown>>(unsigned: T) {
      const payload = { ...unsigned, digest: canonicalDigest(unsigned) as `sha256:${string}` };
      return { payload, signature: { algorithm: "ed25519", keyId, value: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64url") } };
    },
  };
}

type AuthorizationInput = {
  runId: string;
  caseId: string;
  model: string;
  version: string;
  capability: Capability;
  billableQuantity: number;
  pricingLineItems: CostQuoteLineItem[];
  maximumAmountUsd: number;
  pricingSourceDigest: `sha256:${string}`;
  account: QualificationProviderAccount;
};

function sameAuthorization(row: typeof modelQualificationSpendAuthorizations.$inferSelect, input: AuthorizationInput) {
  const envelope = row.envelope as { authorization?: { pricingLineItems?: unknown } };
  return row.runId === input.runId && row.caseId === input.caseId && row.providerAccountId === input.account.accountId && row.credentialFingerprint === input.account.credentialFingerprint && row.model === input.model && row.modelVersion === input.version && row.capability === input.capability && Number(row.billableQuantity) === input.billableQuantity && Number(row.maximumAmountUsd) === input.maximumAmountUsd && row.pricingSourceDigest === input.pricingSourceDigest && canonicalDigest(envelope.authorization?.pricingLineItems) === canonicalDigest(input.pricingLineItems);
}

export async function authorizeQualificationSpend(input: AuthorizationInput & { database: Db; authority: QualificationSpendSigningAuthority; at: Date }) {
  if (!Number.isFinite(input.maximumAmountUsd) || input.maximumAmountUsd <= 0 || input.maximumAmountUsd >= 0.4) throw new Error("QUALIFICATION_SPEND_AUTHORIZATION_AMOUNT_INVALID");
  if (!Number.isFinite(input.billableQuantity) || input.billableQuantity <= 0 || input.billableQuantity > 600) throw new Error("QUALIFICATION_SPEND_AUTHORIZATION_QUANTITY_INVALID");
  const lineItemTotal = Number(input.pricingLineItems.reduce((sum, item) => sum + item.maximumAmount, 0).toFixed(6));
  if (!input.pricingLineItems.length || input.pricingLineItems.some((item) => !Number.isFinite(item.unitAmount) || item.unitAmount <= 0 || !Number.isFinite(item.quantity) || item.quantity < 0 || !Number.isFinite(item.maximumAmount) || item.maximumAmount < 0) || lineItemTotal !== Number(input.maximumAmountUsd.toFixed(6))) throw new Error("QUALIFICATION_SPEND_AUTHORIZATION_LINE_ITEMS_INVALID");
  if (Number(input.maximumAmountUsd.toFixed(6)) !== input.maximumAmountUsd || Number(input.billableQuantity.toFixed(6)) !== input.billableQuantity) throw new Error("QUALIFICATION_SPEND_AUTHORIZATION_PRECISION_INVALID");
  return input.database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`qualification-spend-authorization:${input.runId}:${input.caseId}`}, 0))`);
    const [existing] = await tx.select().from(modelQualificationSpendAuthorizations).where(and(eq(modelQualificationSpendAuthorizations.runId, input.runId), eq(modelQualificationSpendAuthorizations.caseId, input.caseId))).limit(1);
    if (existing) {
      if (!sameAuthorization(existing, input)) throw new Error("QUALIFICATION_SPEND_AUTHORIZATION_CONFLICT");
      return existing.envelope;
    }
    const identity = { runId: input.runId, caseId: input.caseId, provider: "replicate" as const, accountId: input.account.accountId, credentialFingerprint: input.account.credentialFingerprint, model: input.model, version: input.version, capability: input.capability, billableQuantity: input.billableQuantity, pricingLineItems: input.pricingLineItems, maximumAmountUsd: input.maximumAmountUsd, pricingSourceDigest: input.pricingSourceDigest };
    const authorizationId = `qsa_${canonicalDigest(identity).slice(-32)}`;
    const expiresAt = new Date(input.at.getTime() + 15 * 60_000);
    const signed = input.authority.signPayload({ schema: "replicate-qualification-spend-authorization/v2", authorizationId, provider: "replicate", accountId: input.account.accountId, credentialFingerprint: input.account.credentialFingerprint, model: input.model, version: input.version, capability: input.capability, billableQuantity: input.billableQuantity, pricingLineItems: input.pricingLineItems, maximumAmountUsd: input.maximumAmountUsd, expiresAt: expiresAt.toISOString(), pricingSourceDigest: input.pricingSourceDigest, source: "reviewed-pricing-contract" });
    const envelope = { authorization: signed.payload, signature: signed.signature };
    await tx.insert(modelQualificationSpendAuthorizations).values({ authorizationId, runId: input.runId, caseId: input.caseId, providerAccountId: input.account.accountId, credentialFingerprint: input.account.credentialFingerprint, model: input.model, modelVersion: input.version, capability: input.capability, billableQuantity: input.billableQuantity.toFixed(6), maximumAmountUsd: input.maximumAmountUsd.toFixed(6), pricingSourceDigest: input.pricingSourceDigest, payloadDigest: signed.payload.digest, signingKeyId: input.authority.keyId, envelope, expiresAt, createdAt: input.at });
    return envelope;
  });
}

export type QualificationSpendEvidenceImport = {
  runId: string;
  caseId: string;
  predictionId: string;
  amountUsd: number;
  providerObservedAt: Date;
  providerEvidenceKind: "replicate_account_usage_export" | "replicate_invoice" | "replicate_account_screenshot";
  providerEvidenceDigest: `sha256:${string}`;
  importedBy: string;
  notes: string;
};

export async function importQualificationSpendEvidence(input: QualificationSpendEvidenceImport & { database: Db; authority: QualificationSpendSigningAuthority; at: Date }) {
  if (!Number.isFinite(input.amountUsd) || input.amountUsd < 0) throw new Error("QUALIFICATION_SPEND_RECEIPT_AMOUNT_INVALID");
  if (Number(input.amountUsd.toFixed(6)) !== input.amountUsd) throw new Error("QUALIFICATION_SPEND_RECEIPT_PRECISION_INVALID");
  if (!/^sha256:[a-f0-9]{64}$/.test(input.providerEvidenceDigest)) throw new Error("QUALIFICATION_SPEND_RECEIPT_EVIDENCE_DIGEST_INVALID");
  if (input.importedBy.trim().length < 3 || input.importedBy.trim().length > 200 || input.notes.trim().length < 3 || input.notes.trim().length > 2_000) throw new Error("QUALIFICATION_SPEND_RECEIPT_REVIEW_INVALID");
  if (input.providerObservedAt > new Date(input.at.getTime() + 5 * 60_000)) throw new Error("QUALIFICATION_SPEND_RECEIPT_TIME_INVALID");
  return input.database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`qualification-spend-receipt:${input.predictionId}`}, 0))`);
    const [qualificationCase] = await tx.select().from(modelQualificationCases).where(and(eq(modelQualificationCases.runId, input.runId), eq(modelQualificationCases.caseId, input.caseId))).limit(1);
    const [run] = await tx.select().from(modelQualificationRuns).where(eq(modelQualificationRuns.id, input.runId)).limit(1);
    if (!qualificationCase || !run || qualificationCase.predictionId !== input.predictionId) throw new Error("QUALIFICATION_SPEND_RECEIPT_CASE_MISMATCH");
    const terminalDeliveries = await tx.select({ model: modelQualificationWebhookReceipts.model, version: modelQualificationWebhookReceipts.executedVersion, status: modelQualificationWebhookReceipts.providerStatus }).from(modelQualificationWebhookReceipts).where(and(eq(modelQualificationWebhookReceipts.runId, input.runId), eq(modelQualificationWebhookReceipts.caseId, input.caseId), eq(modelQualificationWebhookReceipts.predictionId, input.predictionId), inArray(modelQualificationWebhookReceipts.providerStatus, ["succeeded", "failed", "canceled", "aborted"])));
    if (terminalDeliveries.length === 0) throw new Error("QUALIFICATION_SPEND_RECEIPT_TERMINAL_EVIDENCE_REQUIRED");
    if (terminalDeliveries.some((delivery) => delivery.model !== run.model || delivery.version !== run.modelVersion) || new Set(terminalDeliveries.map((delivery) => delivery.status)).size !== 1) throw new Error("QUALIFICATION_SPEND_RECEIPT_TERMINAL_EVIDENCE_MISMATCH");
    if (input.providerObservedAt < new Date(run.createdAt.getTime() - 5 * 60_000)) throw new Error("QUALIFICATION_SPEND_RECEIPT_TIME_INVALID");
    if (input.amountUsd > Number(qualificationCase.maximumSpendUsd) + Number.EPSILON) throw new Error("QUALIFICATION_SPEND_RECEIPT_CAP_EXCEEDED");
    const notesDigest = canonicalDigest(input.notes.trim()) as `sha256:${string}`;
    const identity = { runId: input.runId, caseId: input.caseId, predictionId: input.predictionId, amountUsd: input.amountUsd, providerEvidenceKind: input.providerEvidenceKind, providerEvidenceDigest: input.providerEvidenceDigest, importedBy: input.importedBy, providerObservedAt: input.providerObservedAt.toISOString(), notesDigest };
    const receiptId = `qsr_${canonicalDigest(identity).slice(-32)}`;
    const signed = input.authority.signPayload({ schema: "replicate-qualification-spend-receipt/v1", receiptId, provider: "replicate", accountId: run.providerAccountId, credentialFingerprint: run.credentialFingerprint, predictionId: input.predictionId, model: run.model, version: run.modelVersion, currency: "USD", amountUsd: input.amountUsd, observedAt: input.providerObservedAt.toISOString(), source: "replicate-account-billing", providerEvidence: { kind: input.providerEvidenceKind, scope: "exact_prediction_charge", digest: input.providerEvidenceDigest, observedBy: input.importedBy.trim(), notesDigest } });
    const envelope = { receipt: signed.payload, signature: signed.signature };
    const [existing] = await tx.select().from(modelQualificationSpendEvidenceImports).where(eq(modelQualificationSpendEvidenceImports.predictionId, input.predictionId)).limit(1);
    if (existing) {
      if (existing.payloadDigest !== signed.payload.digest) throw new Error("QUALIFICATION_SPEND_RECEIPT_CONFLICT");
      return { kind: "replayed" as const, envelope: existing.envelope };
    }
    await tx.insert(modelQualificationSpendEvidenceImports).values({ receiptId, runId: input.runId, caseId: input.caseId, predictionId: input.predictionId, providerEvidenceKind: input.providerEvidenceKind, providerEvidenceDigest: input.providerEvidenceDigest, payloadDigest: signed.payload.digest, signingKeyId: input.authority.keyId, envelope, importedBy: input.importedBy.trim(), providerObservedAt: input.providerObservedAt, receivedAt: input.at });
    return { kind: "recorded" as const, envelope };
  });
}

export async function readQualificationSpendEvidence(input: { database: Db; predictionId: string; caseId: string }) {
  const [row] = await input.database.select().from(modelQualificationSpendEvidenceImports).where(and(eq(modelQualificationSpendEvidenceImports.predictionId, input.predictionId), eq(modelQualificationSpendEvidenceImports.caseId, input.caseId))).limit(1);
  return row?.envelope ?? null;
}

export async function listPendingQualificationSpendEvidence(input: { database: Db; limit: number }) {
  const terminalDeliveryExists = input.database.select({ value: sql`1` }).from(modelQualificationWebhookReceipts).where(and(eq(modelQualificationWebhookReceipts.runId, modelQualificationCases.runId), eq(modelQualificationWebhookReceipts.caseId, modelQualificationCases.caseId), eq(modelQualificationWebhookReceipts.predictionId, modelQualificationCases.predictionId), inArray(modelQualificationWebhookReceipts.providerStatus, ["succeeded", "failed", "canceled", "aborted"])));
  const rows = await input.database.select({ qualificationCase: modelQualificationCases, run: modelQualificationRuns }).from(modelQualificationCases).innerJoin(modelQualificationRuns, eq(modelQualificationRuns.id, modelQualificationCases.runId)).leftJoin(modelQualificationSpendEvidenceImports, eq(modelQualificationSpendEvidenceImports.predictionId, modelQualificationCases.predictionId)).where(and(isNotNull(modelQualificationCases.predictionId), isNull(modelQualificationCases.spendReceiptId), isNull(modelQualificationSpendEvidenceImports.receiptId), inArray(modelQualificationCases.state, ["submitted", "outcome_unknown"]), exists(terminalDeliveryExists))).orderBy(desc(modelQualificationCases.updatedAt)).limit(input.limit);
  return rows.map(({ qualificationCase, run }) => ({ runId: run.id, caseId: qualificationCase.caseId, predictionId: qualificationCase.predictionId!, predictionUrl: `https://replicate.com/p/${encodeURIComponent(qualificationCase.predictionId!)}`, providerAccountId: run.providerAccountId, model: run.model, version: run.modelVersion, maximumAmountUsd: Number(qualificationCase.maximumSpendUsd), credentialFingerprint: run.credentialFingerprint, submittedAt: qualificationCase.updatedAt.toISOString() }));
}
