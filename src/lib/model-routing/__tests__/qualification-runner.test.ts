import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { canonicalJson } from "@/lib/agent-tools/canonical";
import { CURATED_MODELS } from "../catalog";
import type { QualificationRunLedger } from "../qualification-ledger";
import { executeReplicateQualification, type QualificationExecutionPort } from "../qualification-runner";

const at = new Date("2026-09-04T00:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

function input(maximumSpendUsd = 0.1) {
  const model = CURATED_MODELS[0]!;
  return { signingKeyId: "offline-operator-key", runId: "qualification-run-001", attestation: {
    schema: "model-execution-qualification/v1" as const, id: "qualification-reviewed-001", revision: 1, provider: "replicate" as const, model: model.model,
    endpoint: "versioned" as const, version: "immutable-provider-version-001", inputSchemaDigest: `sha256:${"a".repeat(64)}` as const,
    capabilities: [...model.capabilities], contentLanguages: [...model.contentLanguages], arabicVarieties: [...model.arabicVarieties], verifiedRegions: ["replicate-us"], executionModes: ["async" as const],
    executionPriceUsd: { basis: "image" as const, amount: 0.1 }, maxQuantity: 3, cancelAfterSeconds: 900, outputShape: { width: 1080, height: 1920, fps: null },
    inputContract: { promptKey: "prompt", brandContextKey: "brand_context", aspectRatioKey: "aspect_ratio", quantityKey: null, imageKey: null, imageMode: "single" as const, safety: { parameterKey: "disable_safety_filter", safeValue: false }, lockedParameters: { disable_safety_filter: false } },
    license: { name: "Reviewed commercial license", commercialUse: true as const, derivativeUse: true, sourceUrl: "https://example.com/license", digest: `sha256:${"b".repeat(64)}` as const },
    pricingSource: { sourceUrl: "https://example.com/pricing", digest: `sha256:${"c".repeat(64)}` as const, checkedAt: "2026-09-03T00:00:00.000Z" },
    qualificationRun: { id: "untrusted-placeholder", digest: `sha256:${"d".repeat(64)}` as const, completedAt: "2026-09-03T01:00:00.000Z" },
    issuedAt: "2026-09-03T02:00:00.000Z", expiresAt: "2026-10-03T02:00:00.000Z",
  }, cases: [
    { id: "arabic-complete", capability: "text_to_image" as const, contentLanguage: "ar" as const, arabicVariety: "gulf" as const, prompt: "حملة عربية Brand 123", input: {}, billableQuantity: 1, maximumSpendUsd, lifecycle: "complete" as const },
    { id: "english-complete", capability: "text_to_image" as const, contentLanguage: "en" as const, arabicVariety: null, prompt: "English brand campaign", input: {}, billableQuantity: 1, maximumSpendUsd, lifecycle: "complete" as const },
    { id: "cancel-on-start", capability: "text_to_image" as const, contentLanguage: "ar" as const, arabicVariety: "msa" as const, prompt: "اختبار الإلغاء", input: {}, billableQuantity: 1, maximumSpendUsd, lifecycle: "cancel" as const },
  ] };
}

function port(overrides: Partial<QualificationExecutionPort> = {}): QualificationExecutionPort {
  let sequence = 0;
  return {
    inspectSchema: vi.fn().mockResolvedValue({ inputSchemaDigest: `sha256:${"a".repeat(64)}`, inputKeys: ["prompt", "brand_context", "aspect_ratio", "disable_safety_filter"] }),
    submit: vi.fn(async ({ version, providerInput }) => ({ predictionId: `prediction-${++sequence}`, version, acceptedInput: providerInput })),
    recoverSubmission: vi.fn().mockResolvedValue(null),
    poll: vi.fn(async ({ version }) => ({ status: "succeeded" as const, version, output: "https://replicate.delivery/output.png" })),
    cancel: vi.fn(async ({ version }) => ({ status: "aborted" as const, version })),
    awaitWebhook: vi.fn(async ({ predictionId }) => ({ authentic: true, deliveryId: `delivery-${predictionId}`, status: predictionId === "prediction-3" ? "aborted" as const : "succeeded" as const })),
    ingest: vi.fn(async ({ caseId }) => ({ receiptId: "artifact-1", contentDigest: `sha256:${"e".repeat(64)}` as const, width: 1080, height: 1920, durationSeconds: null, observedLanguages: [caseId.startsWith("arabic") ? "ar" as const : "en" as const], languageEvidenceDigest: `sha256:${"f".repeat(64)}` as const })),
    reconcile: vi.fn(async ({ predictionId, version }) => ({ status: predictionId === "prediction-3" ? "aborted" as const : "succeeded" as const, version })),
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
    completeCase: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn(async ({ result }) => result),
    ...overrides,
  };
}

describe("executable Replicate qualification runner", () => {
  it("executes schema, bilingual, safety, 9:16, webhook, cancellation, ingestion and reconciliation gates before signing", async () => {
    const execution = port();
    const durable = ledger();
    const result = await executeReplicateQualification(input(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, durable, at);
    const signed = result.envelope.qualifications[0]!;
    expect(verify(null, Buffer.from(canonicalJson(signed.attestation)), publicKey, Buffer.from(signed.signature.value, "base64url"))).toBe(true);
    expect(result.report).toMatchObject({ hardCapUsd: 0.4, maximumSpendUsd: 0.30000000000000004 });
    expect(execution.submit).toHaveBeenCalledTimes(3);
    expect(execution.ingest).toHaveBeenCalledTimes(2);
    expect(execution.cancel).toHaveBeenCalledTimes(1);
    expect(execution.awaitWebhook).toHaveBeenCalledTimes(3);
    expect(execution.reconcile).toHaveBeenCalledTimes(3);
    expect(durable.begin).toHaveBeenCalledOnce();
    expect(durable.bindSubmission).toHaveBeenCalledTimes(3);
    expect(durable.completeCase).toHaveBeenCalledTimes(3);
    expect(signed.attestation.qualificationRun.digest).not.toBe(`sha256:${"d".repeat(64)}`);
  });

  it("makes no provider calls when the declared matrix reaches the hard cap", async () => {
    const execution = port();
    const durable = ledger();
    await expect(executeReplicateQualification(input(0.14), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, durable, at)).rejects.toThrow("QUALIFICATION_BUDGET_CAP_EXCEEDED");
    expect(execution.submit).not.toHaveBeenCalled();
    expect(durable.begin).not.toHaveBeenCalled();
  });

  it("does not sign after any incomplete evidence gate", async () => {
    const execution = port({ ingest: vi.fn().mockResolvedValue({ receiptId: "artifact", contentDigest: `sha256:${"e".repeat(64)}`, width: 1024, height: 1024, durationSeconds: null, observedLanguages: ["ar", "en"], languageEvidenceDigest: `sha256:${"f".repeat(64)}` }) });
    const durable = ledger();
    await expect(executeReplicateQualification(input(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, durable, at)).rejects.toThrow("QUALIFICATION_OUTPUT_NOT_9_16");
    expect(durable.markOutcomeUnknown).toHaveBeenCalledOnce();
  });

  it("recovers a stale provider submission by stable key and never submits it again", async () => {
    const execution = port({ recoverSubmission: vi.fn().mockResolvedValue({ predictionId: "prediction-recovered", version: "immutable-provider-version-001" }) });
    const durable = ledger({
      claimCase: vi.fn(async ({ runId, caseId }) => caseId === "arabic-complete"
        ? { kind: "recover_submission" as const, claimToken: "claim-recovery", submissionKey: `qualification:${runId}:${caseId}` }
        : { kind: "completed" as const, result: { id: caseId } }),
    });
    await executeReplicateQualification(input(), privateKey.export({ type: "pkcs8", format: "pem" }).toString(), execution, durable, at);
    expect(execution.recoverSubmission).toHaveBeenCalledWith(expect.objectContaining({ submissionKey: "qualification:qualification-run-001:arabic-complete" }));
    expect(execution.submit).not.toHaveBeenCalled();
    expect(durable.bindSubmission).toHaveBeenCalledWith(expect.objectContaining({ predictionId: "prediction-recovered" }));
  });
});
