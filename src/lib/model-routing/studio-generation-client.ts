"use client";

import { z } from "zod";
import { getActiveWorkspaceId, getStudioAssetDownloadUrl } from "@/lib/studio/client";
import type { ArabicVariety, ContentLanguage, ExactModelRef, GenerationCapability } from "./types";
import type { ManagedCreditQuote, ManagedCreditQuoteAcceptance } from "./budget-authority";

const terminalStates = new Set(["cancelled", "succeeded", "failed_known", "outcome_unknown"]);
const operationSchema = z.object({ id: z.string(), revision: z.number().int().positive(), state: z.string(), metadata: z.record(z.string(), z.unknown()).default({}) }).passthrough();
const responseSchema = z.object({ success: z.literal(true), intentId: z.string(), operation: operationSchema }).passthrough();
const executionSchema = z.object({ success: z.literal(true), result: z.object({ kind: z.literal("accepted"), operation: operationSchema, provider: z.object({ artifactIds: z.array(z.string()).optional(), textOutputIds: z.array(z.string()).optional() }).passthrough().optional() }) }).passthrough();
const workflowExecutionSchema = z.object({ success: z.literal(true), workflowRun: z.object({ id: z.string(), workflowId: z.string(), workflowRevisionId: z.string(), state: z.literal("accepted") }) }).passthrough();
const inspectionSchema = z.object({ success: z.literal(true), operation: operationSchema }).passthrough();
const managedCreditQuoteSchema = z.object({ schema: z.literal("managed-generation-credit-quote/v1"), quoteId: z.string(), intentId: z.string(), totalDebitUnits: z.number().int().positive(), currency: z.literal("USD"), subtotalMinor: z.number().int().nonnegative(), taxMinor: z.number().int().nonnegative(), totalMinor: z.number().int().nonnegative(), expiresAt: z.string().datetime(), pricingSnapshotDigest: z.string(), confirmationDigest: z.string() });
const errorSchema = z.object({ code: z.string().optional(), nextActions: z.array(z.object({ code: z.string() }).passthrough()).optional(), managedCreditQuote: managedCreditQuoteSchema.optional() }).passthrough();

export function classifyContentLanguage(value: string): ContentLanguage {
  let arabic = 0; let latin = 0;
  for (const character of Array.from(value.normalize("NFKC"))) {
    if (/\p{Script=Arabic}/u.test(character)) arabic++;
    else if (/\p{Script=Latin}/u.test(character)) latin++;
  }
  if (!arabic) return "en"; if (!latin) return "ar";
  const minority = Math.min(arabic, latin); const total = arabic + latin;
  return minority >= 3 && minority / total >= 0.15 ? "mixed" : arabic > latin ? "ar" : "en";
}

export interface StudioGenerationRequest {
  prompt: string; model: ExactModelRef; mode: "photo" | "video" | "copy"; sourceMediaType: "image" | "video" | null; sourceAssetIds: string[]; quantity: number;
  capability?: GenerationCapability;
  fundingMode: "byok" | "managed";
  personaId?: string | null;
  contentExecution?: { contentPieceId: string; contentPieceRevision: number } | null;
  blitzContext?: { itemId: string; expectedRevision: number } | null;
  contentLanguage?: ContentLanguage;
  arabicVariety: ArabicVariety | null; rightsBasis: "owned" | "licensed" | "public_domain" | "consented";
  permittedRemix: "reference_only" | "transform" | "derivative"; rightsEvidenceIds: string[];
  remixBrief: { preserve: string[]; transform: string[]; avoid: string[] }; idempotencyKey: string; signal: AbortSignal;
  confirmManagedCreditQuote?: (quote: ManagedCreditQuote) => Promise<boolean>;
}

export class StudioGenerationError extends Error { constructor(readonly code: string, readonly nextActionCode: string | null = null) { super(code); } }

export function resolveStudioGenerationCapability(input: Pick<StudioGenerationRequest, "capability" | "mode" | "sourceAssetIds" | "sourceMediaType">): GenerationCapability {
  return input.capability ?? (input.mode === "copy" ? "text_generation" : input.mode === "video" ? (input.sourceAssetIds.length ? input.sourceMediaType === "video" ? "video_to_video" : "image_to_video" : "text_to_video") : (input.sourceAssetIds.length ? "image_to_image" : "text_to_image"));
}

async function errorFrom(response: Response) { const parsed = errorSchema.safeParse(await response.json().catch(() => null)); return new StudioGenerationError(parsed.success ? parsed.data.code ?? "GENERATION_ADMISSION_FAILED" : "GENERATION_ADMISSION_FAILED", parsed.success ? parsed.data.nextActions?.[0]?.code ?? null : null); }

export async function runAdmittedStudioGeneration(input: StudioGenerationRequest): Promise<{ result: string; assetId: string | null; textOutputId: string | null; intentId: string; operationId: string }> {
  const workspaceId = getActiveWorkspaceId(); if (!workspaceId) throw new StudioGenerationError("WORKSPACE_REQUIRED");
  const capability = resolveStudioGenerationCapability(input);
  const contentLanguage = input.contentLanguage ?? classifyContentLanguage(input.prompt);
  const admissionBody = (managedQuoteAcceptance: ManagedCreditQuoteAcceptance | null) => ({ prompt: input.prompt, model: input.model, capability, contentLanguage, arabicVariety: contentLanguage === "en" ? null : input.arabicVariety, quantity: input.quantity, sourceAssetIds: input.sourceAssetIds, rightsBasis: input.rightsBasis, permittedRemix: input.permittedRemix, rightsEvidenceIds: input.rightsEvidenceIds, remixBrief: input.remixBrief, fundingMode: input.fundingMode, personaId: input.personaId ?? null, contentExecution: input.contentExecution ?? null, blitzContext: input.blitzContext ?? null, managedQuoteAcceptance });
  // Admission intentionally ignores the UI abort signal: it cannot spend, and
  // completing it gives the client a durable operation it can safely cancel.
  const requestAdmission = (acceptance: ManagedCreditQuoteAcceptance | null) => fetch("/api/studio/generations", { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId, "idempotency-key": input.idempotencyKey }, body: JSON.stringify(admissionBody(acceptance)) });
  let response = await requestAdmission(null);
  if (!response.ok && input.fundingMode === "managed") {
    const parsed = errorSchema.safeParse(await response.clone().json().catch(() => null));
    if (parsed.success && parsed.data.code === "MANAGED_CREDIT_CONFIRMATION_REQUIRED" && parsed.data.managedCreditQuote) {
      if (!input.confirmManagedCreditQuote) throw new StudioGenerationError("MANAGED_CREDIT_CONFIRMATION_UI_UNAVAILABLE");
      const quote = parsed.data.managedCreditQuote as ManagedCreditQuote;
      if (!(await input.confirmManagedCreditQuote(quote))) throw new StudioGenerationError("MANAGED_CREDIT_QUOTE_DECLINED");
      if (input.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      response = await requestAdmission({ quoteId: quote.quoteId, confirmationDigest: quote.confirmationDigest as `sha256:${string}` });
    }
  }
  if (!response.ok) throw await errorFrom(response);
  const admitted = responseSchema.safeParse(await response.json()); if (!admitted.success) throw new StudioGenerationError("GENERATION_RESPONSE_INVALID");
  let operation = admitted.data.operation;
  let providerTextOutputIds: string[] = [];
  const cancel = async () => {
    if (terminalStates.has(operation.state)) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const cancelled = await fetch(`/api/studio/operations/${encodeURIComponent(operation.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId, "idempotency-key": `simple-cancel:${operation.id}:${operation.revision}` }, body: JSON.stringify({ action: "cancel", expectedRevision: operation.revision }), keepalive: true }).catch(() => null);
      if (cancelled?.ok) return;
      const inspected = await fetch(`/api/studio/operations/${encodeURIComponent(operation.id)}`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store" }).catch(() => null);
      if (!inspected?.ok) return;
      const parsed = inspectionSchema.safeParse(await inspected.json());
      if (!parsed.success || terminalStates.has(parsed.data.operation.state)) return;
      operation = parsed.data.operation;
    }
  };
  const abort = () => { void cancel(); };
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    if (input.signal.aborted) { await cancel(); throw new DOMException("Cancelled", "AbortError"); }
    const executionUrl = input.contentExecution ? "/api/product-content/workflow-runs" : `/api/studio/model-routing/intents/${encodeURIComponent(admitted.data.intentId)}/execute`;
    const execution = await fetch(executionUrl, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId, "idempotency-key": `${input.idempotencyKey}:execute` }, body: JSON.stringify(input.contentExecution ? { intentId: admitted.data.intentId, prompt: input.prompt, sourceAssetIds: input.sourceAssetIds } : { prompt: input.prompt, sourceAssetIds: input.sourceAssetIds }), signal: input.signal });
    if (!execution.ok) throw await errorFrom(execution);
    if (input.contentExecution) {
      const executionResult = workflowExecutionSchema.safeParse(await execution.json());
      if (!executionResult.success) throw new StudioGenerationError("CONTENT_WORKFLOW_RESPONSE_INVALID");
    } else {
      const executionResult = executionSchema.safeParse(await execution.json());
      if (!executionResult.success) throw new StudioGenerationError("GENERATION_EXECUTION_RESPONSE_INVALID");
      operation = executionResult.data.result.operation;
      providerTextOutputIds = executionResult.data.result.provider?.textOutputIds ?? [];
    }
    for (let attempt = 0; attempt < 150 && !terminalStates.has(operation.state); attempt++) {
      await new Promise<void>((resolve, reject) => { const timer = window.setTimeout(resolve, 2_000); input.signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); }, { once: true }); });
      const polled = await fetch(`/api/studio/operations/${encodeURIComponent(operation.id)}`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store", signal: input.signal });
      if (!polled.ok) throw await errorFrom(polled); const parsed = inspectionSchema.safeParse(await polled.json()); if (!parsed.success) throw new StudioGenerationError("OPERATION_RESPONSE_INVALID"); operation = parsed.data.operation;
    }
  } finally { input.signal.removeEventListener("abort", abort); }
  if (!terminalStates.has(operation.state)) throw new StudioGenerationError("GENERATION_PENDING_RECOVERY", "inspect_operations");
  if (operation.state !== "succeeded") throw new StudioGenerationError(operation.state === "outcome_unknown" ? "PROVIDER_OUTCOME_UNKNOWN" : `GENERATION_${operation.state.toUpperCase()}`);
  if (input.mode === "copy") {
    const outputIds = Array.isArray(operation.metadata.textOutputIds) ? operation.metadata.textOutputIds.filter((item): item is string => typeof item === "string") : [];
    const outputId = outputIds[0] ?? providerTextOutputIds[0];
    if (!outputId) throw new StudioGenerationError("CANONICAL_TEXT_OUTPUT_RECEIPT_MISSING");
    const output = await fetch(`/api/studio/copy/outputs/${encodeURIComponent(outputId)}`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store", signal: input.signal });
    if (!output.ok) throw await errorFrom(output);
    const parsed = z.object({ success: z.literal(true), output: z.object({ content: z.string().min(1) }) }).safeParse(await output.json());
    if (!parsed.success) throw new StudioGenerationError("CANONICAL_TEXT_OUTPUT_INVALID");
    return { result: parsed.data.output.content, assetId: null, textOutputId: outputId, intentId: admitted.data.intentId, operationId: operation.id };
  }
  const metadataIds = Array.isArray(operation.metadata.artifactIds) ? operation.metadata.artifactIds.filter((item): item is string => typeof item === "string") : [];
  const assetId = metadataIds[0]; if (!assetId) throw new StudioGenerationError("CANONICAL_ARTIFACT_RECEIPT_MISSING");
  const download = await getStudioAssetDownloadUrl(assetId); return { result: download.downloadUrl, assetId, textOutputId: null, intentId: admitted.data.intentId, operationId: operation.id };
}
