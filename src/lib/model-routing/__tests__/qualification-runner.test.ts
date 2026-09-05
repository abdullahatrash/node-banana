import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { CURATED_MODELS } from "../catalog";
import type { QualificationRunLedger } from "../qualification-ledger";
import { executeReplicateQualification, validateReplicateQualificationPlan, type QualificationExecutionPort } from "../qualification-runner";

const at = new Date("2026-09-04T00:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

function input(executionPriceUsd = 0.1) {
  const model = CURATED_MODELS[2]!;
  const brandReference = { assetId: "qualification-brand-logo", digest: `sha256:${"9".repeat(64)}` as const, url: "https://workspace.invalid/brand-logo.png" };
  return { signingKeyId: "offline-operator-key", runId: "qualification-run-001", attestation: {
    schema: "model-execution-qualification/v1" as const, id: "qualification-reviewed-001", revision: 1, provider: "replicate" as const, model: model.model,
    endpoint: "versioned" as const, version: "immutable-provider-version-001", inputSchemaDigest: `sha256:${"a".repeat(64)}` as const,
    capabilities: [...model.capabilities], contentLanguages: [...model.contentLanguages], arabicVarieties: [...model.arabicVarieties], verifiedRegions: ["replicate-us"], executionModes: ["async" as const],
    executionPriceUsd: { basis: "image" as const, amount: executionPriceUsd }, maxQuantity: 3, cancelAfterSeconds: 900, outputShape: { width: 1080, height: 1920, fps: null },
    inputContract: { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: "image", imageMode: "array" as const, safety: { parameterKey: "disable_safety_filter", safeValue: false }, lockedParameters: { disable_safety_filter: false } },
    license: { name: "Reviewed commercial license", commercialUse: true as const, derivativeUse: true, sourceUrl: "https://example.com/license", digest: `sha256:${"b".repeat(64)}` as const },
    pricingSource: { sourceUrl: "https://example.com/pricing", digest: `sha256:${"c".repeat(64)}` as const, checkedAt: "2026-09-03T00:00:00.000Z" },
    qualificationRun: { id: "untrusted-placeholder", digest: `sha256:${"d".repeat(64)}` as const, completedAt: "2026-09-03T01:00:00.000Z" },
    issuedAt: "2026-09-03T02:00:00.000Z", expiresAt: "2026-10-03T02:00:00.000Z",
  }, cases: [
    { id: "arabic-complete", capability: "text_to_image" as const, contentLanguage: "ar" as const, arabicVariety: "gulf" as const, prompt: "حملة عربية Brand 123", input: {}, billableQuantity: 1, brandReference, lifecycle: "complete" as const },
    { id: "english-remix", capability: "image_to_image" as const, contentLanguage: "en" as const, arabicVariety: null, prompt: "English brand campaign", input: { image: ["https://workspace.invalid/source.png"] }, billableQuantity: 1, brandReference, lifecycle: "complete" as const },
    { id: "cancel-on-start", capability: "text_to_image" as const, contentLanguage: "ar" as const, arabicVariety: "msa" as const, prompt: "اختبار الإلغاء", input: {}, billableQuantity: 1, brandReference, lifecycle: "cancel" as const },
  ] };
}

function port(overrides: Partial<QualificationExecutionPort> = {}): QualificationExecutionPort {
  let sequence = 0;
  const mediaItem = { contentDigest: `sha256:${"e".repeat(64)}` as const, width: 1080, height: 1920, durationSeconds: null, fps: null };
  return {
    identifyAccount: vi.fn().mockResolvedValue({ provider: "replicate", accountId: "replicate-account", credentialFingerprint: `sha256:${"8".repeat(64)}` }),
    authorizeSpend: vi.fn(async ({ model, version, capability, billableQuantity, pricingLineItems, maximumAmountUsd, pricingSourceDigest, caseId, account }) => {
      const authorization = { schema: "replicate-qualification-spend-authorization/v2" as const, authorizationId: `authorization-${caseId}`, ...account, model, version, capability, billableQuantity, pricingLineItems, maximumAmountUsd, expiresAt: "2026-09-05T00:00:00.000Z", pricingSourceDigest, source: "reviewed-pricing-contract" as const };
      return { ...authorization, digest: canonicalDigest(authorization) as `sha256:${string}`, signingKeyId: "spend-key" };
    }),
    inspectSchema: vi.fn().mockResolvedValue({ inputSchemaDigest: `sha256:${"a".repeat(64)}`, inputKeys: ["prompt", "image", "aspect_ratio", "disable_safety_filter"] }),
    submit: vi.fn(async ({ version, providerInput }) => ({ predictionId: `prediction-${++sequence}`, version, acceptedInput: providerInput })),
    recoverSubmission: vi.fn().mockResolvedValue(null),
    poll: vi.fn(async ({ version }) => ({ status: "succeeded" as const, version, output: "https://replicate.delivery/output.png" })),
    cancel: vi.fn(async ({ version }) => ({ status: "aborted" as const, version })),
    awaitWebhook: vi.fn(async ({ predictionId }) => ({ authentic: true, deliveryId: `delivery-${predictionId}`, status: predictionId === "prediction-3" ? "aborted" as const : "succeeded" as const })),
    ingest: vi.fn(async ({ caseId }) => ({ kind: "media" as const, receiptId: "artifact-1", contentDigest: `sha256:${"e".repeat(64)}` as const, itemCount: 1, items: [mediaItem], width: 1080, height: 1920, durationSeconds: null, fps: null, observedLanguages: [caseId.startsWith("arabic") ? "ar" as const : "en" as const], languageEvidenceDigest: `sha256:${"f".repeat(64)}` as const })),
    reconcile: vi.fn(async ({ predictionId, version }) => ({ status: predictionId === "prediction-3" ? "aborted" as const : "succeeded" as const, version })),
    observeSpend: vi.fn(async ({ predictionId, model, version, account }) => {
      const receipt = { schema: "replicate-qualification-spend-receipt/v1" as const, receiptId: `receipt-${predictionId}`, ...account, predictionId, model, version, currency: "USD" as const, amountUsd: 0.01, observedAt: at.toISOString(), source: "replicate-account-billing" as const, providerEvidence: { kind: "replicate_account_usage_export" as const, scope: "exact_prediction_charge" as const, digest: `sha256:${"4".repeat(64)}` as const, observedBy: "operator@example.com", notesDigest: `sha256:${"5".repeat(64)}` as const } };
      return { ...receipt, digest: canonicalDigest(receipt) as `sha256:${string}`, signingKeyId: "spend-key" };
    }),
    ...overrides,
  };
}

function ledger(overrides: Partial<QualificationRunLedger> = {}): QualificationRunLedger {
  let sequence = 0;
  return {
    begin: vi.fn().mockResolvedValue({ kind: "running" }),
    claimCase: vi.fn(async ({ runId, caseId }) => ({ kind: "submit" as const, claimToken: `claim-${++sequence}`, submissionKey: `qualification:${runId}:${caseId}` })),
    bindSubmission: vi.fn().mockResolvedValue(undefined),
    markOutcomeUnknown: vi.fn().mockResolvedValue(undefined),
    recordSpendReceipt: vi.fn().mockResolvedValue({ kind: "recorded", matrixObservedSpendUsd: 0.03 }),
    completeCase: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn(async ({ result }) => result),
    ...overrides,
  };
}

describe("executable Replicate qualification runner", () => {
  it("carries an official stable model target through every qualification operation", async () => {
    const source = input();
    const plan = { ...source, attestation: { ...source.attestation, endpoint: "official" as const, version: source.attestation.model } };
    const execution = port();
    await executeReplicateQualification(plan, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, ledger(), at);
    expect(execution.inspectSchema).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "official", model: plan.attestation.model, version: plan.attestation.model }));
    expect(execution.submit).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "official", model: plan.attestation.model, version: plan.attestation.model }));
    expect(execution.poll).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "official", model: plan.attestation.model, version: plan.attestation.model }));
  });

  it("executes schema, bilingual, safety, 9:16, webhook, cancellation, ingestion and reconciliation gates before signing", async () => {
    const execution = port();
    const durable = ledger();
    const result = await executeReplicateQualification(input(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, durable, at);
    const signed = result.envelope.qualifications[0]!;
    expect(verify(null, Buffer.from(canonicalJson(signed.attestation)), publicKey, Buffer.from(signed.signature.value, "base64url"))).toBe(true);
    expect(result.report).toMatchObject({ hardCapUsd: 0.4, maximumSpendUsd: 0.30000000000000004, observedSpendUsd: 0.03, providerAccountId: "replicate-account" });
    expect(execution.submit).toHaveBeenCalledTimes(3);
    expect(execution.authorizeSpend).toHaveBeenCalledWith(expect.objectContaining({ runId: "qualification-run-001", caseId: "arabic-complete" }));
    expect(execution.ingest).toHaveBeenCalledTimes(2);
    expect(execution.ingest).toHaveBeenCalledWith(expect.objectContaining({ caseId: "arabic-complete", contentLanguage: "ar" }));
    expect(execution.cancel).toHaveBeenCalledTimes(1);
    expect(execution.awaitWebhook).toHaveBeenCalledTimes(3);
    expect(execution.reconcile).toHaveBeenCalledTimes(3);
    expect(durable.begin).toHaveBeenCalledOnce();
    expect(durable.bindSubmission).toHaveBeenCalledTimes(3);
    expect(durable.recordSpendReceipt).toHaveBeenCalledTimes(3);
    expect(durable.completeCase).toHaveBeenCalledTimes(3);
    expect(signed.attestation.qualificationRun.digest).not.toBe(`sha256:${"d".repeat(64)}`);
    const accepted = vi.mocked(execution.submit).mock.calls.map(([call]) => call.providerInput.image);
    expect(accepted[0]).toEqual(["https://workspace.invalid/brand-logo.png"]);
    expect(accepted[1]).toEqual(["https://workspace.invalid/source.png", "https://workspace.invalid/brand-logo.png"]);
  });

  it("makes no paid calls when the provider-authorized matrix reaches the hard cap", async () => {
    const execution = port({ authorizeSpend: vi.fn(async ({ model, version, capability, billableQuantity, pricingLineItems, maximumAmountUsd, pricingSourceDigest, caseId, account }) => {
      const authorization = { schema: "replicate-qualification-spend-authorization/v2" as const, authorizationId: `authorization-${caseId}`, ...account, model, version, capability, billableQuantity, pricingLineItems, maximumAmountUsd, expiresAt: "2026-09-05T00:00:00.000Z", pricingSourceDigest, source: "reviewed-pricing-contract" as const };
      return { ...authorization, digest: canonicalDigest(authorization) as `sha256:${string}`, signingKeyId: "spend-key" };
    }) });
    const durable = ledger();
    await expect(executeReplicateQualification(input(0.14), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, durable, at)).rejects.toThrow("QUALIFICATION_BUDGET_CAP_EXCEEDED");
    expect(execution.submit).not.toHaveBeenCalled();
    expect(durable.begin).not.toHaveBeenCalled();
  });

  it("makes no paid call when authoritative cost is unavailable", async () => {
    const execution = port({ authorizeSpend: vi.fn().mockRejectedValue(new Error("QUALIFICATION_SPEND_AUTHORIZATION_UNAVAILABLE")) });
    const durable = ledger();
    await expect(executeReplicateQualification(input(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, durable, at)).rejects.toThrow("QUALIFICATION_SPEND_AUTHORIZATION_UNAVAILABLE");
    expect(execution.submit).not.toHaveBeenCalled();
    expect(durable.begin).not.toHaveBeenCalled();
  });

  it("makes no paid call when the durable account-wide matrix ceiling cannot reserve the run", async () => {
    const execution = port();
    const durable = ledger({ begin: vi.fn().mockRejectedValue(new Error("QUALIFICATION_ACCOUNT_BUDGET_CAP_EXCEEDED")) });
    await expect(executeReplicateQualification(input(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, durable, at)).rejects.toThrow("QUALIFICATION_ACCOUNT_BUDGET_CAP_EXCEEDED");
    expect(execution.identifyAccount).toHaveBeenCalledOnce();
    expect(execution.submit).not.toHaveBeenCalled();
  });

  it("stops the matrix before another paid call when authoritative spend is unavailable", async () => {
    const execution = port({ observeSpend: vi.fn().mockRejectedValue(new Error("QUALIFICATION_SPEND_RECEIPT_TIMEOUT")) });
    const durable = ledger();
    await expect(executeReplicateQualification(input(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, durable, at)).rejects.toThrow("QUALIFICATION_SPEND_RECEIPT_TIMEOUT");
    expect(execution.submit).toHaveBeenCalledOnce();
    expect(durable.markOutcomeUnknown).toHaveBeenCalledOnce();
  });

  it("does not sign after any incomplete evidence gate", async () => {
    const execution = port({ ingest: vi.fn().mockResolvedValue({ kind: "media", receiptId: "artifact", contentDigest: `sha256:${"e".repeat(64)}`, itemCount: 1, items: [{ contentDigest: `sha256:${"e".repeat(64)}`, width: 1024, height: 1024, durationSeconds: null, fps: null }], width: 1024, height: 1024, durationSeconds: null, fps: null, observedLanguages: ["ar", "en"], languageEvidenceDigest: `sha256:${"f".repeat(64)}` }) });
    const durable = ledger();
    await expect(executeReplicateQualification(input(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, durable, at)).rejects.toThrow("QUALIFICATION_OUTPUT_SHAPE_MISMATCH");
    expect(durable.markOutcomeUnknown).toHaveBeenCalledOnce();
  });

  it("rejects a valid 9:16 output that does not match the signed resolution", async () => {
    const mediaItem = { contentDigest: `sha256:${"e".repeat(64)}` as const, width: 720, height: 1280, durationSeconds: null, fps: null };
    const execution = port({ ingest: vi.fn().mockResolvedValue({ kind: "media", receiptId: "artifact", contentDigest: `sha256:${"e".repeat(64)}`, itemCount: 1, items: [mediaItem], width: 720, height: 1280, durationSeconds: null, fps: null, observedLanguages: ["ar", "en"], languageEvidenceDigest: `sha256:${"f".repeat(64)}` }) });
    await expect(executeReplicateQualification(input(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, ledger(), at)).rejects.toThrow("QUALIFICATION_OUTPUT_SHAPE_MISMATCH");
  });

  it("recovers a stale provider submission by stable key and never submits it again", async () => {
    const execution = port({ recoverSubmission: vi.fn().mockResolvedValue({ predictionId: "prediction-recovered", version: "immutable-provider-version-001" }) });
    const durable = ledger({
      claimCase: vi.fn(async ({ runId, caseId }) => caseId === "arabic-complete"
        ? { kind: "recover_submission" as const, claimToken: "claim-recovery", submissionKey: `qualification:${runId}:${caseId}` }
        : { kind: "completed" as const, result: { id: caseId, observedSpendUsd: 0.01 } }),
    });
    await executeReplicateQualification(input(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, durable, at);
    expect(execution.recoverSubmission).toHaveBeenCalledWith(expect.objectContaining({ submissionKey: "qualification:qualification-run-001:arabic-complete" }));
    expect(execution.submit).not.toHaveBeenCalled();
    expect(durable.bindSubmission).toHaveBeenCalledWith(expect.objectContaining({ predictionId: "prediction-recovered" }));
  });

  it("rejects a capability subset that runtime would refuse after a paid run", () => {
    const plan = input();
    const subset = {
      ...plan,
      attestation: { ...plan.attestation, capabilities: ["text_to_image"] },
      cases: [
        plan.cases[0],
        { ...plan.cases[1], capability: "text_to_image", input: {} },
        plan.cases[2],
      ],
    };
    expect(() => validateReplicateQualificationPlan(subset as never, at)).toThrow("QUALIFICATION_CAPABILITY_SET_MISMATCH");
  });

  it("binds megapixel-priced qualification cells to the exact provider media order", async () => {
    const model = CURATED_MODELS.find((candidate) => candidate.model === "black-forest-labs/flux-2-klein-4b")!;
    if (model.priceUsd.basis !== "components") throw new Error("test model must use component pricing");
    const brandReference = { assetId: "qualification-brand-logo", digest: `sha256:${"9".repeat(64)}` as const, url: "https://workspace.invalid/brand-logo.png" };
    const brandAsset = { url: brandReference.url, width: 1080, height: 1920 };
    const sourceAsset = { url: "https://workspace.invalid/source.png", width: 1080, height: 1920 };
    const plan = {
      signingKeyId: "offline-operator-key", runId: "qualification-klein-run-001",
      attestation: {
        schema: "model-execution-qualification/v1" as const, id: "qualification-klein-reviewed-001", revision: 1, provider: "replicate" as const, model: model.model,
        endpoint: "official" as const, version: model.model, inputSchemaDigest: `sha256:${"a".repeat(64)}` as const,
        capabilities: [...model.capabilities], contentLanguages: [...model.contentLanguages], arabicVarieties: [...model.arabicVarieties], verifiedRegions: ["replicate-us"], executionModes: ["async" as const],
        executionPriceUsd: { basis: "components" as const, components: model.priceUsd.components.map((component) => ({ ...component })) }, maxQuantity: 1, cancelAfterSeconds: 900, outputShape: { width: 1080, height: 1920, fps: null },
        inputContract: { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: "images", imageMode: "array" as const, safety: { parameterKey: "disable_safety_checker", safeValue: false }, lockedParameters: { disable_safety_checker: false, output_megapixels: 1, output_format: "jpg" } },
        license: { name: "Reviewed commercial license", commercialUse: true as const, derivativeUse: true, sourceUrl: "https://example.com/license", digest: `sha256:${"b".repeat(64)}` as const },
        pricingSource: { sourceUrl: "https://example.com/pricing", digest: `sha256:${"c".repeat(64)}` as const, checkedAt: "2026-09-03T00:00:00.000Z" },
        qualificationRun: { id: "untrusted-placeholder", digest: `sha256:${"d".repeat(64)}` as const, completedAt: "2026-09-03T01:00:00.000Z" },
        issuedAt: "2026-09-03T02:00:00.000Z", expiresAt: "2026-10-03T02:00:00.000Z",
      },
      cases: [
        { id: "arabic-brand-only", capability: "text_to_image" as const, contentLanguage: "ar" as const, arabicVariety: "gulf" as const, prompt: "حملة عربية", input: {}, billableQuantity: 1, pricingInputAssets: [brandAsset], brandReference, lifecycle: "complete" as const },
        { id: "english-image-remix", capability: "image_to_image" as const, contentLanguage: "en" as const, arabicVariety: null, prompt: "English brand remix", input: { images: [sourceAsset.url] }, billableQuantity: 1, pricingInputAssets: [sourceAsset, brandAsset], brandReference, lifecycle: "complete" as const },
        { id: "arabic-cancel", capability: "text_to_image" as const, contentLanguage: "ar" as const, arabicVariety: "msa" as const, prompt: "اختبار الإلغاء", input: {}, billableQuantity: 1, pricingInputAssets: [brandAsset], brandReference, lifecycle: "cancel" as const },
      ],
    };
    const checked = validateReplicateQualificationPlan(plan, at);
    expect(checked.summary.estimatedMaximumSpendUsd).toBeCloseTo(0.011296, 6);
    const execution = port({
      inspectSchema: vi.fn().mockResolvedValue({ inputSchemaDigest: `sha256:${"a".repeat(64)}`, inputKeys: ["prompt", "images", "aspect_ratio", "disable_safety_checker", "output_megapixels", "output_format"] }),
      observeSpend: vi.fn(async ({ predictionId, model: executedModel, version, account }) => {
        const receipt = { schema: "replicate-qualification-spend-receipt/v1" as const, receiptId: `receipt-${predictionId}`, ...account, predictionId, model: executedModel, version, currency: "USD" as const, amountUsd: 0.001, observedAt: at.toISOString(), source: "replicate-account-billing" as const, providerEvidence: { kind: "replicate_account_usage_export" as const, scope: "exact_prediction_charge" as const, digest: `sha256:${"4".repeat(64)}` as const, observedBy: "operator@example.com", notesDigest: `sha256:${"5".repeat(64)}` as const } };
        return { ...receipt, digest: canonicalDigest(receipt) as `sha256:${string}`, signingKeyId: "spend-key" };
      }),
    });
    const result = await executeReplicateQualification(plan, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, ledger(), at);
    expect(result.report.maximumSpendUsd).toBeCloseTo(0.011296, 6);
    expect(execution.authorizeSpend).toHaveBeenNthCalledWith(2, expect.objectContaining({ maximumAmountUsd: 0.005148, pricingLineItems: [{ basis: "input_megapixel", unitAmount: 0.001, quantity: 4.1472, maximumAmount: 0.004148 }, { basis: "output_megapixel", unitAmount: 0.001, quantity: 1, maximumAmount: 0.001 }] }));
  });

  it("qualifies bilingual brand-aware text output with text-specific ingestion evidence", async () => {
    const model = CURATED_MODELS.find((candidate) => candidate.capabilities.includes("text_generation"))!;
    const brandReference = { assetId: "qualification-brand-logo", digest: `sha256:${"9".repeat(64)}` as const, url: "https://workspace.invalid/brand-logo.png" };
    const plan = {
      signingKeyId: "offline-operator-key",
      runId: "qualification-text-run-001",
      attestation: {
        schema: "model-execution-qualification/v1" as const, id: "qualification-text-reviewed-001", revision: 1, provider: "replicate" as const, model: model.model,
        endpoint: "versioned" as const, version: "immutable-text-provider-version-001", inputSchemaDigest: `sha256:${"a".repeat(64)}` as const,
        capabilities: ["text_generation" as const], contentLanguages: ["ar" as const, "en" as const], arabicVarieties: ["msa" as const, "gulf" as const], verifiedRegions: ["replicate-us"], executionModes: ["async" as const],
        executionPriceUsd: { basis: "run" as const, amount: 0.01 }, maxQuantity: 1, cancelAfterSeconds: 900, outputShape: { width: null, height: null, fps: null },
        inputContract: { promptKey: "prompt", aspectRatioKey: null, quantityKey: null, imageKey: null, imageMode: "single" as const, safety: null, lockedParameters: {} },
        license: { name: "Reviewed commercial license", commercialUse: true as const, derivativeUse: false, sourceUrl: "https://example.com/license", digest: `sha256:${"b".repeat(64)}` as const },
        pricingSource: { sourceUrl: "https://example.com/pricing", digest: `sha256:${"c".repeat(64)}` as const, checkedAt: "2026-09-03T00:00:00.000Z" },
        qualificationRun: { id: "untrusted-placeholder", digest: `sha256:${"d".repeat(64)}` as const, completedAt: "2026-09-03T01:00:00.000Z" },
        issuedAt: "2026-09-03T02:00:00.000Z", expiresAt: "2026-10-03T02:00:00.000Z",
      },
      cases: [
        { id: "arabic-copy-complete", capability: "text_generation" as const, contentLanguage: "ar" as const, arabicVariety: "gulf" as const, prompt: "اكتب نسخة عربية للعلامة", input: {}, billableQuantity: 1, brandReference, lifecycle: "complete" as const },
        { id: "english-copy-complete", capability: "text_generation" as const, contentLanguage: "en" as const, arabicVariety: null, prompt: "Write English brand copy", input: {}, billableQuantity: 1, brandReference, lifecycle: "complete" as const },
        { id: "arabic-copy-cancel", capability: "text_generation" as const, contentLanguage: "ar" as const, arabicVariety: "msa" as const, prompt: "اختبار إلغاء النص", input: {}, billableQuantity: 1, brandReference, lifecycle: "cancel" as const },
      ],
    };
    const execution = port({
      authorizeSpend: vi.fn(async ({ model, version, capability, billableQuantity, pricingLineItems, maximumAmountUsd, pricingSourceDigest, caseId, account }) => {
        const authorization = { schema: "replicate-qualification-spend-authorization/v2" as const, authorizationId: `authorization-${caseId}`, ...account, model, version, capability, billableQuantity, pricingLineItems, maximumAmountUsd, expiresAt: "2026-09-05T00:00:00.000Z", pricingSourceDigest, source: "reviewed-pricing-contract" as const };
        return { ...authorization, digest: canonicalDigest(authorization) as `sha256:${string}`, signingKeyId: "spend-key" };
      }),
      inspectSchema: vi.fn().mockResolvedValue({ inputSchemaDigest: `sha256:${"a".repeat(64)}`, inputKeys: ["prompt"] }),
      ingest: vi.fn(async ({ caseId }) => ({ kind: "text" as const, receiptId: `text-${caseId}`, contentDigest: `sha256:${"e".repeat(64)}` as const, characterCount: 80, observedLanguages: [caseId.startsWith("english") ? "en" as const : "ar" as const], languageEvidenceDigest: `sha256:${"f".repeat(64)}` as const })),
    });
    const result = await executeReplicateQualification(plan, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, ledger(), at);
    expect(result.report).toMatchObject({ model: model.model, maximumSpendUsd: 0.03 });
    expect(execution.ingest).toHaveBeenCalledTimes(2);
  });
});
