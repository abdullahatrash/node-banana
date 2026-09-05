import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";

import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { isNineSixteenDimensions } from "./aspect-ratio";
import { CURATED_MODELS, modelQualificationAttestationSchema } from "./catalog";
import type { QualificationProviderAccount, QualificationRunLedger, QualificationSpendAuthorization, QualificationSpendReceipt } from "./qualification-ledger";
import { composeQualifiedProviderInput } from "./provider-input-composition";
import { imageMegapixels, priceExecution, quoteTotalUsd } from "./pricing";
import type { ReplicateEndpoint } from "./types";

export const MAX_QUALIFICATION_SPEND_USD = 0.4;

export const qualificationSmokeCaseSchema = z.object({
  id: z.string().min(3).max(100),
  capability: z.enum(["text_generation", "text_to_image", "image_to_image", "text_to_video", "image_to_video", "video_to_video"]),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(["msa", "gulf", "egyptian", "levantine", "maghrebi", "other"]).nullable(),
  prompt: z.string().min(1).max(5_000),
  input: z.record(z.string(), z.unknown()),
  billableQuantity: z.number().positive().max(600),
  pricingInputAssets: z.array(z.object({ url: z.string().url().refine((value) => new URL(value).protocol === "https:"), width: z.number().int().positive().max(16_384), height: z.number().int().positive().max(16_384) }).strict()).max(5).optional(),
  brandReference: z.object({ assetId: z.string().min(1).max(200), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/), url: z.string().url().refine((value) => new URL(value).protocol === "https:") }).strict(),
  lifecycle: z.enum(["complete", "cancel"]),
}).strict();

export const qualificationRunnerInputSchema = z.object({
  attestation: modelQualificationAttestationSchema,
  signingKeyId: z.string().min(1).max(100),
  runId: z.string().min(8).max(200),
  cases: z.array(qualificationSmokeCaseSchema).min(3).max(12),
}).strict();

export type QualificationRunnerInput = z.input<typeof qualificationRunnerInputSchema>;
export type QualificationSmokeCase = z.infer<typeof qualificationSmokeCaseSchema>;
export type QualificationIngestionReceipt = {
  kind: "media";
  receiptId: string;
  contentDigest: `sha256:${string}`;
  itemCount: number;
  items: Array<{
    contentDigest: `sha256:${string}`;
    width: number;
    height: number;
    durationSeconds: number | null;
    fps: number | null;
  }>;
  width: number;
  height: number;
  durationSeconds: number | null;
  fps: number | null;
  observedLanguages: Array<"ar" | "en">;
  languageEvidenceDigest: `sha256:${string}`;
} | {
  kind: "text";
  receiptId: string;
  contentDigest: `sha256:${string}`;
  characterCount: number;
  observedLanguages: Array<"ar" | "en">;
  languageEvidenceDigest: `sha256:${string}`;
};
export type QualificationRunOutput = {
  report: { schema: string; matrixId: string; providerAccountId: string; runId: string; model: string; version: string; hardCapUsd: number; maximumSpendUsd: number; observedSpendUsd: number; cases: Array<Record<string, unknown>>; completedAt: string };
  envelope: { version: 1; qualifications: Array<{ attestation: z.infer<typeof modelQualificationAttestationSchema>; signature: { algorithm: "ed25519"; keyId: string; value: string } }> };
};

type QualificationExecutionTarget = { endpoint: ReplicateEndpoint; model: string; version: string };

export interface QualificationExecutionPort {
  identifyAccount(): Promise<QualificationProviderAccount>;
  authorizeSpend(input: { runId: string; model: string; version: string; capability: QualificationSmokeCase["capability"]; billableQuantity: number; pricingLineItems: QualificationSpendAuthorization["pricingLineItems"]; maximumAmountUsd: number; pricingSourceDigest: `sha256:${string}`; caseId: string; account: QualificationProviderAccount }): Promise<QualificationSpendAuthorization>;
  inspectSchema(input: QualificationExecutionTarget): Promise<{ inputSchemaDigest: `sha256:${string}`; inputKeys: string[] }>;
  submit(input: QualificationExecutionTarget & { providerInput: Record<string, unknown>; cancelAfterSeconds: number; caseId: string; submissionKey: string }): Promise<{ predictionId: string; version: string; acceptedInput: Record<string, unknown> }>;
  recoverSubmission(input: QualificationExecutionTarget & { caseId: string; submissionKey: string }): Promise<{ predictionId: string; version: string } | null>;
  awaitWebhook(input: QualificationExecutionTarget & { predictionId: string; caseId: string }): Promise<{ authentic: boolean; deliveryId: string; status: "succeeded" | "failed" | "canceled" | "aborted" }>;
  poll(input: QualificationExecutionTarget & { predictionId: string; caseId: string }): Promise<{ status: "succeeded" | "failed" | "canceled" | "aborted"; version: string; output: unknown }>;
  cancel(input: QualificationExecutionTarget & { predictionId: string; caseId: string }): Promise<{ status: "canceled" | "aborted"; version: string }>;
  ingest(input: { predictionId: string; caseId: string; capability: QualificationSmokeCase["capability"]; contentLanguage: "ar" | "en"; output: unknown }): Promise<QualificationIngestionReceipt>;
  reconcile(input: QualificationExecutionTarget & { predictionId: string; caseId: string }): Promise<{ status: "succeeded" | "failed" | "canceled" | "aborted"; version: string }>;
  observeSpend(input: { predictionId: string; model: string; version: string; caseId: string; account: QualificationProviderAccount }): Promise<QualificationSpendReceipt>;
}

export const QUALIFICATION_MATRIX_ID = "replicate-production-qualification/v1";

function requireMatrixCoverage(cases: QualificationSmokeCase[]) {
  if (!cases.some((item) => item.contentLanguage === "ar" && item.arabicVariety)) throw new Error("QUALIFICATION_ARABIC_CELL_REQUIRED");
  if (!cases.some((item) => item.contentLanguage === "en" && item.arabicVariety === null)) throw new Error("QUALIFICATION_ENGLISH_CELL_REQUIRED");
  if (!cases.some((item) => item.lifecycle === "cancel")) throw new Error("QUALIFICATION_CANCELLATION_CELL_REQUIRED");
  if (!cases.some((item) => item.lifecycle === "complete")) throw new Error("QUALIFICATION_INGESTION_CELL_REQUIRED");
}

function qualificationBrand(cell: QualificationSmokeCase) {
  const value = {
    schema: "brand-context/v1" as const,
    profileId: `qualification:${cell.id}`,
    revision: 1,
    contentLanguage: cell.contentLanguage,
    identity: { companyName: "Tasmeemai qualification fixture", coreIdentity: "Provider contract verification" },
    offering: ["Qualified generation"],
    audiences: [{ name: "Qualification", description: "Contract verification", weight: 1 }],
    benefits: ["Deterministic evidence"], differentiators: ["Arabic-first"], positioning: "Safe qualification",
    voice: { descriptors: ["clear"], do: ["preserve the prompt"], doNot: ["invent claims"] }, palette: ["#000000"],
    constraints: { prohibitedClaims: ["guaranteed results"], prohibitedTopics: [] }, contentAngles: ["verification"],
    referenceAssets: [{ assetId: cell.brandReference.assetId, digest: cell.brandReference.digest as `sha256:${string}`, kind: "logo" as const }],
  };
  return { ...value, digest: canonicalDigest(value) as `sha256:${string}` };
}

function qualificationSourceUrls(cell: QualificationSmokeCase, imageKey: string | null) {
  if (!imageKey) return [];
  const value = cell.input[imageKey];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value as string[];
  return [];
}

function qualificationCaseQuote(base: z.infer<typeof modelQualificationAttestationSchema>, cell: QualificationSmokeCase, at: Date) {
  if (base.executionPriceUsd.basis !== "components") return priceExecution({ price: base.executionPriceUsd, unitQuantity: cell.billableQuantity, quotedAt: at, expiresAt: new Date(base.expiresAt) });
  const sourceUrls = qualificationSourceUrls(cell, base.inputContract.imageKey);
  const brand = qualificationBrand(cell);
  const composed = composeQualifiedProviderInput({ rawPrompt: cell.prompt, brand, sourceAssetIds: sourceUrls.map((_, index) => `qualification:${cell.id}:source:${index}`), sourceUrls, brandReferenceUrls: [{ assetId: cell.brandReference.assetId, url: cell.brandReference.url }], model: { provider: base.provider, model: base.model, version: base.version, inputSchemaDigest: base.inputSchemaDigest }, capability: cell.capability, contract: base.inputContract, aspectRatio: "9:16", quantity: cell.billableQuantity, baseInput: cell.input });
  const rawMedia = base.inputContract.imageKey ? composed.providerInput[base.inputContract.imageKey] : undefined;
  const mediaUrls = typeof rawMedia === "string" ? [rawMedia] : Array.isArray(rawMedia) && rawMedia.every((value) => typeof value === "string") ? rawMedia as string[] : [];
  const assets = cell.pricingInputAssets ?? [];
  if (assets.length !== mediaUrls.length || assets.some((asset, index) => asset.url !== mediaUrls[index])) throw new Error(`QUALIFICATION_PRICING_INPUT_EVIDENCE_MISMATCH:${cell.id}`);
  const rawOutputMegapixels = base.inputContract.lockedParameters.output_megapixels;
  const outputMegapixels = typeof rawOutputMegapixels === "number"
    ? rawOutputMegapixels
    : typeof rawOutputMegapixels === "string" && /^\d+(?:\.\d+)?$/.test(rawOutputMegapixels)
      ? Number(rawOutputMegapixels)
      : Number.NaN;
  if (!Number.isFinite(outputMegapixels) || outputMegapixels <= 0) throw new Error("QUALIFICATION_OUTPUT_MEGAPIXELS_NOT_LOCKED");
  const inputMegapixels = assets.reduce((sum, asset) => sum + imageMegapixels(asset.width, asset.height), 0);
  const pricingQuantities = base.executionPriceUsd.components.map((component) => ({ basis: component.basis, quantity: component.basis === "input_megapixel" ? inputMegapixels : outputMegapixels * cell.billableQuantity }));
  return priceExecution({ price: base.executionPriceUsd, unitQuantity: cell.billableQuantity, pricingQuantities, quotedAt: at, expiresAt: new Date(base.expiresAt) });
}

export type QualificationPlanPreflight = {
  schema: "replicate-qualification-plan-preflight/v1";
  runId: string;
  model: string;
  version: string;
  signingKeyId: string;
  capabilities: QualificationSmokeCase["capability"][];
  caseCount: number;
  estimatedMaximumSpendUsd: number;
  hardCapUsd: number;
};

/** Pure, no-network validation shared by the operator preflight and paid runner. */
export function validateReplicateQualificationPlan(input: QualificationRunnerInput, at = new Date()): {
  parsed: z.infer<typeof qualificationRunnerInputSchema>;
  summary: QualificationPlanPreflight;
} {
  const parsed = qualificationRunnerInputSchema.parse(input);
  const base = parsed.attestation;
  const curated = CURATED_MODELS.find((item) => item.provider === "replicate" && item.model === base.model);
  if (!curated) throw new Error("QUALIFICATION_MODEL_NOT_CURATED");
  const exactCapabilities = base.capabilities.length === curated.capabilities.length
    && base.capabilities.every((capability) => curated.capabilities.includes(capability));
  if (!exactCapabilities) throw new Error("QUALIFICATION_CAPABILITY_SET_MISMATCH");
  const issuedAt = new Date(base.issuedAt);
  const expiresAt = new Date(base.expiresAt);
  if (issuedAt > at || expiresAt <= at || expiresAt.getTime() - issuedAt.getTime() > 90 * 24 * 60 * 60_000) throw new Error("QUALIFICATION_WINDOW_INVALID");
  if (!base.contentLanguages.includes("ar") || !base.contentLanguages.includes("en")) throw new Error("QUALIFICATION_BILINGUAL_SUPPORT_REQUIRED");
  if (!base.verifiedRegions.includes("replicate-us") || !base.executionModes.includes("async")) throw new Error("QUALIFICATION_RUNTIME_COMPATIBILITY_REQUIRED");
  if (new Set(parsed.cases.map((cell) => cell.id)).size !== parsed.cases.length) throw new Error("QUALIFICATION_CASE_ID_DUPLICATE");
  requireMatrixCoverage(parsed.cases);
  for (const capability of base.capabilities) if (!parsed.cases.some((item) => item.capability === capability)) throw new Error(`QUALIFICATION_CAPABILITY_CELL_REQUIRED:${capability}`);
  for (const cell of parsed.cases) {
    if (!base.capabilities.includes(cell.capability)) throw new Error(`QUALIFICATION_CASE_CAPABILITY_MISMATCH:${cell.id}`);
    if (!base.contentLanguages.includes(cell.contentLanguage)) throw new Error(`QUALIFICATION_CASE_LANGUAGE_MISMATCH:${cell.id}`);
    if (cell.contentLanguage === "ar" && (!cell.arabicVariety || !base.arabicVarieties.includes(cell.arabicVariety))) throw new Error(`QUALIFICATION_CASE_ARABIC_VARIETY_MISMATCH:${cell.id}`);
    if (cell.contentLanguage === "en" && cell.arabicVariety !== null) throw new Error(`QUALIFICATION_CASE_ARABIC_VARIETY_MISMATCH:${cell.id}`);
    if (cell.billableQuantity > base.maxQuantity) throw new Error(`QUALIFICATION_CASE_QUANTITY_EXCEEDED:${cell.id}`);
    const sourceUrls = qualificationSourceUrls(cell, base.inputContract.imageKey);
    if (["image_to_image", "image_to_video", "video_to_video"].includes(cell.capability) && sourceUrls.length === 0) throw new Error(`QUALIFICATION_SOURCE_MEDIA_REQUIRED:${cell.id}`);
    if (sourceUrls.some((value) => {
      try { return new URL(value).protocol !== "https:"; } catch { return true; }
    })) throw new Error(`QUALIFICATION_SOURCE_MEDIA_URL_INVALID:${cell.id}`);
    qualificationCaseQuote(base, cell, at);
  }
  if (base.capabilities.some((capability) => ["image_to_image", "image_to_video", "video_to_video"].includes(capability)) && !base.license.derivativeUse) throw new Error("QUALIFICATION_DERIVATIVE_LICENSE_REQUIRED");
  if (base.capabilities.some((capability) => capability === "text_to_image" || capability === "text_to_video") && !parsed.cases.some((cell) => (cell.capability === "text_to_image" || cell.capability === "text_to_video") && qualificationSourceUrls(cell, base.inputContract.imageKey).length === 0)) throw new Error("QUALIFICATION_TEXT_ORIGIN_CELL_REQUIRED");
  const estimatedMaximumSpendUsd = parsed.cases.reduce((sum, cell) => sum + quoteTotalUsd(qualificationCaseQuote(base, cell, at)), 0);
  if (!Number.isFinite(estimatedMaximumSpendUsd) || estimatedMaximumSpendUsd <= 0 || estimatedMaximumSpendUsd >= MAX_QUALIFICATION_SPEND_USD) throw new Error("QUALIFICATION_BUDGET_CAP_EXCEEDED");
  return {
    parsed,
    summary: {
      schema: "replicate-qualification-plan-preflight/v1",
      runId: parsed.runId,
      model: base.model,
      version: base.version,
      signingKeyId: parsed.signingKeyId,
      capabilities: [...base.capabilities],
      caseCount: parsed.cases.length,
      estimatedMaximumSpendUsd,
      hardCapUsd: MAX_QUALIFICATION_SPEND_USD,
    },
  };
}

/** Executes every paid smoke cell once, stops below USD 0.40, and signs only complete evidence. */
export async function executeReplicateQualification(input: QualificationRunnerInput, privateKeyPem: string, execution: QualificationExecutionPort, ledger: QualificationRunLedger, at = new Date()): Promise<QualificationRunOutput> {
  const { parsed } = validateReplicateQualificationPlan(input, at);
  const base = parsed.attestation;
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("QUALIFICATION_SIGNING_KEY_INVALID");

  const requestDigest = canonicalDigest(parsed) as `sha256:${string}`;
  const pricingSourceDigest = base.pricingSource.digest as `sha256:${string}`;
  const account = await execution.identifyAccount();
  if (account.provider !== "replicate" || !account.accountId.trim() || !/^sha256:[a-f0-9]{64}$/.test(account.credentialFingerprint)) throw new Error("QUALIFICATION_ACCOUNT_IDENTITY_INVALID");
  const caseQuotes = parsed.cases.map((cell) => qualificationCaseQuote(base, cell, at));
  const spendAuthorizations = await Promise.all(parsed.cases.map((cell, index) => execution.authorizeSpend({ runId: parsed.runId, model: base.model, version: base.version, capability: cell.capability, billableQuantity: cell.billableQuantity, pricingLineItems: [...(caseQuotes[index]!.lineItems ?? [])], maximumAmountUsd: quoteTotalUsd(caseQuotes[index]!), pricingSourceDigest, caseId: cell.id, account })));
  const authoritativeMaximums = spendAuthorizations.map((authorization, index) => {
    const cell = parsed.cases[index]!;
    if (authorization.schema !== "replicate-qualification-spend-authorization/v2" || authorization.source !== "reviewed-pricing-contract" || !authorization.signingKeyId || !/^sha256:[a-f0-9]{64}$/.test(authorization.digest) || authorization.accountId !== account.accountId || authorization.credentialFingerprint !== account.credentialFingerprint || authorization.model !== base.model || authorization.version !== base.version || authorization.capability !== cell.capability || authorization.billableQuantity !== cell.billableQuantity || authorization.pricingSourceDigest !== base.pricingSource.digest || !Number.isFinite(authorization.maximumAmountUsd) || authorization.maximumAmountUsd <= 0 || new Date(authorization.expiresAt) <= at) throw new Error(`QUALIFICATION_SPEND_AUTHORIZATION_MISMATCH:${cell.id}`);
    const attestedMaximum = quoteTotalUsd(caseQuotes[index]!);
    if (canonicalDigest(authorization.pricingLineItems) !== canonicalDigest(caseQuotes[index]!.lineItems ?? [])) throw new Error(`QUALIFICATION_PRICING_LINE_ITEMS_MISMATCH:${cell.id}`);
    if (Math.abs(attestedMaximum - authorization.maximumAmountUsd) > Number.EPSILON) throw new Error(`QUALIFICATION_PRICING_PARITY_MISMATCH:${cell.id}`);
    return authorization.maximumAmountUsd;
  });
  const authoritativeMaximumSpend = authoritativeMaximums.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isFinite(authoritativeMaximumSpend) || authoritativeMaximumSpend <= 0 || authoritativeMaximumSpend >= MAX_QUALIFICATION_SPEND_USD) throw new Error("QUALIFICATION_BUDGET_CAP_EXCEEDED");
  const casePlans = parsed.cases.map((cell, index) => ({ caseId: cell.id, requestDigest: canonicalDigest(cell) as `sha256:${string}`, maximumSpendUsd: authoritativeMaximums[index]!, spendAuthorizationId: spendAuthorizations[index]!.authorizationId, spendAuthorizationDigest: spendAuthorizations[index]!.digest }));
  const begun = await ledger.begin({ matrixId: QUALIFICATION_MATRIX_ID, account, runId: parsed.runId, requestDigest, provider: "replicate", model: base.model, modelVersion: base.version, signingKeyId: parsed.signingKeyId, hardCapUsd: MAX_QUALIFICATION_SPEND_USD, reservedSpendUsd: authoritativeMaximumSpend, cases: casePlans, at });
  if (begun.kind === "completed") return begun.result as QualificationRunOutput;

  let reservedSpend = 0;
  let observedSpend = 0;
  const results: Array<Record<string, unknown>> = [];
  for (const [index, cell] of parsed.cases.entries()) {
    if (!base.capabilities.includes(cell.capability)) throw new Error(`QUALIFICATION_CASE_CAPABILITY_MISMATCH:${cell.id}`);
    const authoritativeMaximum = authoritativeMaximums[index]!;
    const nextSpend = reservedSpend + authoritativeMaximum;
    if (nextSpend >= MAX_QUALIFICATION_SPEND_USD) throw new Error("QUALIFICATION_BUDGET_CAP_EXCEEDED");
    reservedSpend = nextSpend;
    const casePlan = casePlans[index]!;
    const claim = await ledger.claimCase({ runId: parsed.runId, caseId: cell.id, requestDigest: casePlan.requestDigest, at });
    if (claim.kind === "busy") throw new Error(`QUALIFICATION_CASE_BUSY:${cell.id}`);
    if (claim.kind === "completed") { results.push(claim.result); continue; }
    const target = { endpoint: base.endpoint, model: base.model, version: base.version };
    const schema = await execution.inspectSchema(target);
    if (schema.inputSchemaDigest !== base.inputSchemaDigest) throw new Error(`QUALIFICATION_SCHEMA_MISMATCH:${cell.id}`);
    const requiredKeys = [base.inputContract.promptKey, base.inputContract.aspectRatioKey, base.inputContract.quantityKey, base.inputContract.imageKey, base.inputContract.safety?.parameterKey, ...Object.keys(base.inputContract.lockedParameters)].filter((value): value is string => Boolean(value));
    for (const requiredKey of requiredKeys) if (!schema.inputKeys.includes(requiredKey)) throw new Error(`QUALIFICATION_SCHEMA_KEY_MISSING:${cell.id}:${requiredKey}`);
    const sourceUrls = qualificationSourceUrls(cell, base.inputContract.imageKey);
    if (["image_to_image", "image_to_video", "video_to_video"].includes(cell.capability) && sourceUrls.length === 0) throw new Error(`QUALIFICATION_SOURCE_MEDIA_REQUIRED:${cell.id}`);
    const composed = composeQualifiedProviderInput({
      rawPrompt: cell.prompt,
      brand: qualificationBrand(cell),
      sourceAssetIds: sourceUrls.map((_, sourceIndex) => `qualification:${cell.id}:source:${sourceIndex}`),
      sourceUrls,
      brandReferenceUrls: [{ assetId: cell.brandReference.assetId, url: cell.brandReference.url }],
      model: { provider: base.provider, model: base.model, version: base.version, inputSchemaDigest: base.inputSchemaDigest },
      capability: cell.capability,
      contract: base.inputContract,
      aspectRatio: "9:16",
      quantity: cell.billableQuantity,
      baseInput: cell.input,
    });
    const providerInput = composed.providerInput;
    let submitted: { predictionId: string; version: string; acceptedInput: Record<string, unknown> };
    try {
      if (claim.kind === "submit") {
        submitted = await execution.submit({ ...target, providerInput, cancelAfterSeconds: base.cancelAfterSeconds, caseId: cell.id, submissionKey: claim.submissionKey });
      } else if (claim.kind === "recover_submission") {
        const recovered = await execution.recoverSubmission({ ...target, caseId: cell.id, submissionKey: claim.submissionKey });
        if (!recovered) throw new Error(`QUALIFICATION_SUBMISSION_IDENTITY_UNKNOWN:${cell.id}`);
        submitted = { ...recovered, acceptedInput: providerInput };
      } else {
        submitted = { predictionId: claim.predictionId, version: claim.executedVersion, acceptedInput: providerInput };
      }
      await ledger.bindSubmission({ runId: parsed.runId, caseId: cell.id, claimToken: claim.claimToken, predictionId: submitted.predictionId, executedVersion: submitted.version, at });
    } catch (error) {
      await ledger.markOutcomeUnknown({ runId: parsed.runId, caseId: cell.id, claimToken: claim.claimToken, at });
      throw error;
    }
    if (submitted.version !== base.version) throw new Error(`QUALIFICATION_VERSION_MISMATCH:${cell.id}`);
    if (canonicalDigest(submitted.acceptedInput) !== composed.providerInputDigest) throw new Error(`QUALIFICATION_ACCEPTED_INPUT_MISMATCH:${cell.id}`);
    if (base.inputContract.safety?.parameterKey && submitted.acceptedInput[base.inputContract.safety.parameterKey] !== base.inputContract.safety.safeValue) throw new Error(`QUALIFICATION_SAFETY_MISMATCH:${cell.id}`);
    try {
      let terminal: "succeeded" | "failed" | "canceled" | "aborted";
      let output: unknown = null;
      if (cell.lifecycle === "cancel") {
        const cancelled = await execution.cancel({ ...target, predictionId: submitted.predictionId, caseId: cell.id });
        if (cancelled.version !== base.version) throw new Error(`QUALIFICATION_VERSION_MISMATCH:${cell.id}`);
        terminal = cancelled.status;
      } else {
        const polled = await execution.poll({ ...target, predictionId: submitted.predictionId, caseId: cell.id });
        if (polled.version !== base.version || polled.status !== "succeeded") throw new Error(`QUALIFICATION_COMPLETION_FAILED:${cell.id}`);
        terminal = polled.status;
        output = polled.output;
      }
      const webhook = await execution.awaitWebhook({ ...target, predictionId: submitted.predictionId, caseId: cell.id });
      if (!webhook.authentic || webhook.status !== terminal) throw new Error(`QUALIFICATION_WEBHOOK_FAILED:${cell.id}`);
      const reconciled = await execution.reconcile({ ...target, predictionId: submitted.predictionId, caseId: cell.id });
      if (reconciled.version !== base.version || reconciled.status !== terminal) throw new Error(`QUALIFICATION_RECONCILIATION_FAILED:${cell.id}`);
      const receipt = await execution.observeSpend({ predictionId: submitted.predictionId, model: base.model, version: base.version, caseId: cell.id, account });
      if (receipt.schema !== "replicate-qualification-spend-receipt/v1" || receipt.source !== "replicate-account-billing" || !receipt.signingKeyId || !/^sha256:[a-f0-9]{64}$/.test(receipt.digest) || receipt.providerEvidence.scope !== "exact_prediction_charge" || !["replicate_account_usage_export", "replicate_invoice", "replicate_account_screenshot"].includes(receipt.providerEvidence.kind) || !/^sha256:[a-f0-9]{64}$/.test(receipt.providerEvidence.digest) || !/^sha256:[a-f0-9]{64}$/.test(receipt.providerEvidence.notesDigest) || !receipt.providerEvidence.observedBy.trim() || !Number.isFinite(Date.parse(receipt.observedAt)) || receipt.accountId !== account.accountId || receipt.credentialFingerprint !== account.credentialFingerprint || receipt.predictionId !== submitted.predictionId || receipt.model !== base.model || receipt.version !== base.version || receipt.currency !== "USD" || !Number.isFinite(receipt.amountUsd) || receipt.amountUsd < 0) throw new Error(`QUALIFICATION_SPEND_RECEIPT_MISMATCH:${cell.id}`);
      const spend = await ledger.recordSpendReceipt({ runId: parsed.runId, caseId: cell.id, claimToken: claim.claimToken, receipt, at });
      if (spend.matrixObservedSpendUsd >= MAX_QUALIFICATION_SPEND_USD || receipt.amountUsd > authoritativeMaximum + Number.EPSILON) throw new Error(`QUALIFICATION_OBSERVED_SPEND_CAP_EXCEEDED:${cell.id}`);
      let ingestion: Awaited<ReturnType<QualificationExecutionPort["ingest"]>> | null = null;
      if (cell.lifecycle === "complete") {
        ingestion = await execution.ingest({ predictionId: submitted.predictionId, caseId: cell.id, capability: cell.capability, contentLanguage: cell.contentLanguage, output });
        if (cell.capability === "text_generation") {
          if (ingestion.kind !== "text" || ingestion.characterCount <= 0) throw new Error(`QUALIFICATION_TEXT_OUTPUT_INVALID:${cell.id}`);
        } else if (ingestion.kind !== "media" || base.outputShape.width === null || base.outputShape.height === null || ingestion.itemCount !== ingestion.items.length || ingestion.items.length === 0 || ingestion.items.some((item) => !isNineSixteenDimensions(item.width, item.height) || item.width !== base.outputShape.width || item.height !== base.outputShape.height || (base.outputShape.fps === null ? item.fps !== null : item.fps === null || Math.abs(item.fps - base.outputShape.fps) > 0.1)) || ingestion.width !== ingestion.items[0]!.width || ingestion.height !== ingestion.items[0]!.height || ingestion.durationSeconds !== ingestion.items[0]!.durationSeconds || ingestion.fps !== ingestion.items[0]!.fps) throw new Error(`QUALIFICATION_OUTPUT_SHAPE_MISMATCH:${cell.id}`);
        if (!ingestion.observedLanguages.includes(cell.contentLanguage)) throw new Error(`QUALIFICATION_LANGUAGE_EVIDENCE_MISSING:${cell.id}`);
      }
      const result = { id: cell.id, capability: cell.capability, contentLanguage: cell.contentLanguage, arabicVariety: cell.arabicVariety, lifecycle: cell.lifecycle, maximumSpendUsd: authoritativeMaximum, spendAuthorizationId: spendAuthorizations[index]!.authorizationId, spendAuthorizationDigest: spendAuthorizations[index]!.digest, observedSpendUsd: receipt.amountUsd, spendReceiptId: receipt.receiptId, spendReceiptDigest: receipt.digest, predictionId: submitted.predictionId, terminal, schemaDigest: schema.inputSchemaDigest, providerCompositionDigest: composed.evidence.digest, composedPromptDigest: composed.evidence.composedPromptDigest, providerInputDigest: composed.providerInputDigest, safetyVerified: Boolean(base.inputContract.safety), safetyMode: base.inputContract.safety ? base.inputContract.safety.mode ?? "provider_input" : null, webhookDeliveryId: webhook.deliveryId, ingestion };
      await ledger.completeCase({ runId: parsed.runId, caseId: cell.id, claimToken: claim.claimToken, predictionId: submitted.predictionId, executedVersion: submitted.version, terminalStatus: terminal, result, at });
      results.push(result);
    } catch (error) {
      await ledger.markOutcomeUnknown({ runId: parsed.runId, caseId: cell.id, claimToken: claim.claimToken, at });
      throw error;
    }
  }

  const completedAt = at;
  observedSpend = results.reduce((sum, item) => {
    if (typeof item.observedSpendUsd !== "number" || !Number.isFinite(item.observedSpendUsd)) throw new Error("QUALIFICATION_OBSERVED_SPEND_EVIDENCE_MISSING");
    return sum + item.observedSpendUsd;
  }, 0);
  const report = { schema: "replicate-qualification-smoke-report/v1", matrixId: QUALIFICATION_MATRIX_ID, providerAccountId: account.accountId, runId: parsed.runId, model: base.model, version: base.version, hardCapUsd: MAX_QUALIFICATION_SPEND_USD, maximumSpendUsd: reservedSpend, observedSpendUsd: observedSpend, cases: results, completedAt: completedAt.toISOString() };
  const attestation = modelQualificationAttestationSchema.parse({ ...base, qualificationRun: { id: parsed.runId, digest: canonicalDigest(report), completedAt: completedAt.toISOString() } });
  const result = {
    report,
    envelope: { version: 1 as const, qualifications: [{ attestation, signature: { algorithm: "ed25519" as const, keyId: parsed.signingKeyId, value: sign(null, Buffer.from(canonicalJson(attestation)), privateKey).toString("base64url") } }] },
  };
  return ledger.completeRun({ runId: parsed.runId, requestDigest, result, at }) as Promise<QualificationRunOutput>;
}
