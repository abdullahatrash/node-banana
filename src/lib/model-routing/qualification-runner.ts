import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";

import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { CURATED_MODELS, modelQualificationAttestationSchema } from "./catalog";

export const MAX_QUALIFICATION_SPEND_USD = 0.4;

const smokeCaseSchema = z.object({
  id: z.string().min(3).max(100),
  capability: z.enum(["text_to_image", "image_to_image", "text_to_video", "image_to_video", "video_to_video"]),
  contentLanguage: z.enum(["ar", "en"]),
  arabicVariety: z.enum(["msa", "gulf", "egyptian", "levantine", "maghrebi", "other"]).nullable(),
  prompt: z.string().min(1).max(5_000),
  input: z.record(z.string(), z.unknown()),
  billableQuantity: z.number().positive().max(600),
  maximumSpendUsd: z.number().positive().max(0.39),
  lifecycle: z.enum(["complete", "cancel"]),
}).strict();

const inputSchema = z.object({
  attestation: modelQualificationAttestationSchema,
  signingKeyId: z.string().min(1).max(100),
  runId: z.string().min(8).max(200),
  cases: z.array(smokeCaseSchema).min(3).max(12),
}).strict();

export type QualificationRunnerInput = z.input<typeof inputSchema>;
export type QualificationSmokeCase = z.infer<typeof smokeCaseSchema>;

export interface QualificationExecutionPort {
  inspectSchema(input: { model: string; version: string }): Promise<{ inputSchemaDigest: `sha256:${string}`; inputKeys: string[] }>;
  submit(input: { model: string; version: string; providerInput: Record<string, unknown>; cancelAfterSeconds: number; caseId: string }): Promise<{ predictionId: string; version: string; acceptedInput: Record<string, unknown> }>;
  awaitWebhook(input: { predictionId: string; version: string; caseId: string }): Promise<{ authentic: boolean; deliveryId: string; status: "succeeded" | "failed" | "canceled" | "aborted" }>;
  poll(input: { predictionId: string; version: string; caseId: string }): Promise<{ status: "succeeded" | "failed" | "canceled" | "aborted"; version: string; output: unknown }>;
  cancel(input: { predictionId: string; version: string; caseId: string }): Promise<{ status: "canceled" | "aborted"; version: string }>;
  ingest(input: { predictionId: string; caseId: string; capability: QualificationSmokeCase["capability"]; output: unknown }): Promise<{ receiptId: string; contentDigest: `sha256:${string}`; width: number; height: number; durationSeconds: number | null; observedLanguages: Array<"ar" | "en">; languageEvidenceDigest: `sha256:${string}` }>;
  reconcile(input: { predictionId: string; version: string; caseId: string }): Promise<{ status: "succeeded" | "failed" | "canceled" | "aborted"; version: string }>;
}

function requireMatrixCoverage(cases: QualificationSmokeCase[]) {
  if (!cases.some((item) => item.contentLanguage === "ar" && item.arabicVariety)) throw new Error("QUALIFICATION_ARABIC_CELL_REQUIRED");
  if (!cases.some((item) => item.contentLanguage === "en" && item.arabicVariety === null)) throw new Error("QUALIFICATION_ENGLISH_CELL_REQUIRED");
  if (!cases.some((item) => item.lifecycle === "cancel")) throw new Error("QUALIFICATION_CANCELLATION_CELL_REQUIRED");
  if (!cases.some((item) => item.lifecycle === "complete")) throw new Error("QUALIFICATION_INGESTION_CELL_REQUIRED");
}

/** Executes every paid smoke cell once, stops below USD 0.40, and signs only complete evidence. */
export async function executeReplicateQualification(input: QualificationRunnerInput, privateKeyPem: string, execution: QualificationExecutionPort, at = new Date()) {
  const parsed = inputSchema.parse(input);
  const base = parsed.attestation;
  const curated = CURATED_MODELS.find((item) => item.provider === "replicate" && item.model === base.model);
  if (!curated) throw new Error("QUALIFICATION_MODEL_NOT_CURATED");
  if (base.capabilities.some((capability) => !curated.capabilities.includes(capability))) throw new Error("QUALIFICATION_CAPABILITY_NOT_CURATED");
  if (new Date(base.issuedAt) > at || new Date(base.expiresAt) <= at) throw new Error("QUALIFICATION_WINDOW_INVALID");
  requireMatrixCoverage(parsed.cases);
  const declaredSpend = parsed.cases.reduce((sum, item) => sum + item.maximumSpendUsd, 0);
  if (!Number.isFinite(declaredSpend) || declaredSpend >= MAX_QUALIFICATION_SPEND_USD) throw new Error("QUALIFICATION_BUDGET_CAP_EXCEEDED");
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("QUALIFICATION_SIGNING_KEY_INVALID");

  let reservedSpend = 0;
  const results: Array<Record<string, unknown>> = [];
  for (const cell of parsed.cases) {
    if (!base.capabilities.includes(cell.capability)) throw new Error(`QUALIFICATION_CASE_CAPABILITY_MISMATCH:${cell.id}`);
    const authoritativeMaximum = base.executionPriceUsd.amount * cell.billableQuantity;
    if (!Number.isFinite(authoritativeMaximum) || cell.maximumSpendUsd + Number.EPSILON < authoritativeMaximum) throw new Error(`QUALIFICATION_CASE_PRICE_UNDERSTATED:${cell.id}`);
    const nextSpend = reservedSpend + cell.maximumSpendUsd;
    if (nextSpend >= MAX_QUALIFICATION_SPEND_USD) throw new Error("QUALIFICATION_BUDGET_CAP_EXCEEDED");
    reservedSpend = nextSpend;
    const schema = await execution.inspectSchema({ model: base.model, version: base.version });
    if (schema.inputSchemaDigest !== base.inputSchemaDigest) throw new Error(`QUALIFICATION_SCHEMA_MISMATCH:${cell.id}`);
    for (const requiredKey of [base.inputContract.promptKey, base.inputContract.brandContextKey]) if (!schema.inputKeys.includes(requiredKey)) throw new Error(`QUALIFICATION_SCHEMA_KEY_MISSING:${cell.id}:${requiredKey}`);
    const providerInput: Record<string, unknown> = { ...structuredClone(cell.input), [base.inputContract.promptKey]: cell.prompt, [base.inputContract.brandContextKey]: JSON.stringify({ qualification: true, contentLanguage: cell.contentLanguage, arabicVariety: cell.arabicVariety }) };
    if (base.inputContract.aspectRatioKey) providerInput[base.inputContract.aspectRatioKey] = "9:16";
    if (base.inputContract.safety) providerInput[base.inputContract.safety.parameterKey] = base.inputContract.safety.safeValue;
    for (const [key, value] of Object.entries(base.inputContract.lockedParameters)) providerInput[key] = value;
    const submitted = await execution.submit({ model: base.model, version: base.version, providerInput, cancelAfterSeconds: base.cancelAfterSeconds, caseId: cell.id });
    if (submitted.version !== base.version) throw new Error(`QUALIFICATION_VERSION_MISMATCH:${cell.id}`);
    if (base.inputContract.safety && submitted.acceptedInput[base.inputContract.safety.parameterKey] !== base.inputContract.safety.safeValue) throw new Error(`QUALIFICATION_SAFETY_MISMATCH:${cell.id}`);
    let terminal: "succeeded" | "failed" | "canceled" | "aborted";
    let ingestion: Awaited<ReturnType<QualificationExecutionPort["ingest"]>> | null = null;
    if (cell.lifecycle === "cancel") {
      const cancelled = await execution.cancel({ predictionId: submitted.predictionId, version: base.version, caseId: cell.id });
      if (cancelled.version !== base.version) throw new Error(`QUALIFICATION_VERSION_MISMATCH:${cell.id}`);
      terminal = cancelled.status;
    } else {
      const polled = await execution.poll({ predictionId: submitted.predictionId, version: base.version, caseId: cell.id });
      if (polled.version !== base.version || polled.status !== "succeeded") throw new Error(`QUALIFICATION_COMPLETION_FAILED:${cell.id}`);
      terminal = polled.status;
      ingestion = await execution.ingest({ predictionId: submitted.predictionId, caseId: cell.id, capability: cell.capability, output: polled.output });
      if (ingestion.width * 16 !== ingestion.height * 9) throw new Error(`QUALIFICATION_OUTPUT_NOT_9_16:${cell.id}`);
      if (!ingestion.observedLanguages.includes(cell.contentLanguage)) throw new Error(`QUALIFICATION_LANGUAGE_EVIDENCE_MISSING:${cell.id}`);
    }
    const webhook = await execution.awaitWebhook({ predictionId: submitted.predictionId, version: base.version, caseId: cell.id });
    if (!webhook.authentic || webhook.status !== terminal) throw new Error(`QUALIFICATION_WEBHOOK_FAILED:${cell.id}`);
    const reconciled = await execution.reconcile({ predictionId: submitted.predictionId, version: base.version, caseId: cell.id });
    if (reconciled.version !== base.version || reconciled.status !== terminal) throw new Error(`QUALIFICATION_RECONCILIATION_FAILED:${cell.id}`);
    results.push({ id: cell.id, capability: cell.capability, contentLanguage: cell.contentLanguage, arabicVariety: cell.arabicVariety, lifecycle: cell.lifecycle, maximumSpendUsd: cell.maximumSpendUsd, predictionId: submitted.predictionId, terminal, schemaDigest: schema.inputSchemaDigest, safetyVerified: Boolean(base.inputContract.safety), webhookDeliveryId: webhook.deliveryId, ingestion });
  }

  const completedAt = new Date();
  const report = { schema: "replicate-qualification-smoke-report/v1", runId: parsed.runId, model: base.model, version: base.version, hardCapUsd: MAX_QUALIFICATION_SPEND_USD, maximumSpendUsd: reservedSpend, cases: results, completedAt: completedAt.toISOString() };
  const attestation = modelQualificationAttestationSchema.parse({ ...base, qualificationRun: { id: parsed.runId, digest: canonicalDigest(report), completedAt: completedAt.toISOString() } });
  return {
    report,
    envelope: { version: 1 as const, qualifications: [{ attestation, signature: { algorithm: "ed25519" as const, keyId: parsed.signingKeyId, value: sign(null, Buffer.from(canonicalJson(attestation)), privateKey).toString("base64url") } }] },
  };
}
