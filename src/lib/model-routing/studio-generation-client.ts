"use client";

import { z } from "zod";
import { getActiveWorkspaceId, getStudioAssetDownloadUrl } from "@/lib/studio/client";
import type { ArabicVariety, ContentLanguage, ExactModelRef, GenerationCapability } from "./types";

const terminalStates = new Set(["cancelled", "succeeded", "failed_known", "outcome_unknown"]);
const operationSchema = z.object({ id: z.string(), revision: z.number().int().positive(), state: z.string(), metadata: z.record(z.string(), z.unknown()).default({}) }).passthrough();
const responseSchema = z.object({ success: z.literal(true), operation: operationSchema, provider: z.object({ artifactIds: z.array(z.string()).optional() }).passthrough().optional() }).passthrough();
const inspectionSchema = z.object({ success: z.literal(true), operation: operationSchema }).passthrough();
const errorSchema = z.object({ code: z.string().optional(), nextActions: z.array(z.object({ code: z.string() }).passthrough()).optional() }).passthrough();

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
  prompt: string; model: ExactModelRef; mode: "photo" | "video"; sourceMediaType: "image" | "video" | null; sourceAssetIds: string[]; quantity: number;
  arabicVariety: ArabicVariety; rightsBasis: "owned" | "licensed" | "public_domain" | "consented";
  permittedRemix: "reference_only" | "transform" | "derivative"; rightsEvidenceIds: string[];
  remixBrief: { preserve: string[]; transform: string[]; avoid: string[] }; idempotencyKey: string; signal: AbortSignal;
}

export class StudioGenerationError extends Error { constructor(readonly code: string, readonly nextActionCode: string | null = null) { super(code); } }

async function errorFrom(response: Response) { const parsed = errorSchema.safeParse(await response.json().catch(() => null)); return new StudioGenerationError(parsed.success ? parsed.data.code ?? "GENERATION_ADMISSION_FAILED" : "GENERATION_ADMISSION_FAILED", parsed.success ? parsed.data.nextActions?.[0]?.code ?? null : null); }

export async function runAdmittedStudioGeneration(input: StudioGenerationRequest): Promise<{ result: string; assetId: string }> {
  const workspaceId = getActiveWorkspaceId(); if (!workspaceId) throw new StudioGenerationError("WORKSPACE_REQUIRED");
  const capability: GenerationCapability = input.mode === "video" ? (input.sourceAssetIds.length ? input.sourceMediaType === "video" ? "video_to_video" : "image_to_video" : "text_to_video") : (input.sourceAssetIds.length ? "image_to_image" : "text_to_image");
  const contentLanguage = classifyContentLanguage(input.prompt);
  const response = await fetch("/api/studio/generations", { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId, "idempotency-key": input.idempotencyKey }, body: JSON.stringify({ prompt: input.prompt, model: input.model, capability, contentLanguage, arabicVariety: contentLanguage === "en" ? null : input.arabicVariety, quantity: input.quantity, sourceAssetIds: input.sourceAssetIds, rightsBasis: input.rightsBasis, permittedRemix: input.permittedRemix, rightsEvidenceIds: input.rightsEvidenceIds, remixBrief: input.remixBrief }), signal: input.signal });
  if (!response.ok) throw await errorFrom(response);
  const admitted = responseSchema.safeParse(await response.json()); if (!admitted.success) throw new StudioGenerationError("GENERATION_RESPONSE_INVALID");
  let operation = admitted.data.operation; const abort = () => { if (terminalStates.has(operation.state)) return; void fetch(`/api/studio/operations/${encodeURIComponent(operation.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId, "idempotency-key": `simple-cancel:${operation.id}:${crypto.randomUUID()}` }, body: JSON.stringify({ action: "cancel", expectedRevision: operation.revision }), keepalive: true }).catch(() => {}); };
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    for (let attempt = 0; attempt < 150 && !terminalStates.has(operation.state); attempt++) {
      await new Promise<void>((resolve, reject) => { const timer = window.setTimeout(resolve, 2_000); input.signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); }, { once: true }); });
      const polled = await fetch(`/api/studio/operations/${encodeURIComponent(operation.id)}`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store", signal: input.signal });
      if (!polled.ok) throw await errorFrom(polled); const parsed = inspectionSchema.safeParse(await polled.json()); if (!parsed.success) throw new StudioGenerationError("OPERATION_RESPONSE_INVALID"); operation = parsed.data.operation;
    }
  } finally { input.signal.removeEventListener("abort", abort); }
  if (operation.state !== "succeeded") throw new StudioGenerationError(operation.state === "outcome_unknown" ? "PROVIDER_OUTCOME_UNKNOWN" : `GENERATION_${operation.state.toUpperCase()}`);
  const metadataIds = Array.isArray(operation.metadata.artifactIds) ? operation.metadata.artifactIds.filter((item): item is string => typeof item === "string") : [];
  const assetId = metadataIds[0] ?? admitted.data.provider?.artifactIds?.[0]; if (!assetId) throw new StudioGenerationError("CANONICAL_ARTIFACT_RECEIPT_MISSING");
  const download = await getStudioAssetDownloadUrl(assetId); return { result: download.downloadUrl, assetId };
}
