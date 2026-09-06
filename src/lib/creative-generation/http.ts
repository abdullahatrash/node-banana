import { z } from "zod";
import { NextResponse } from "next/server";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { executeAdmittedGeneration } from "@/lib/model-routing/execute-admitted-generation";
import { compileCopyPrompt, compileVisualPlatePrompt } from "./brief";
import { compositionSchema, CreativeError, digestSchema, structuredCopySchema } from "./contracts";
import { CREATIVE_GENERATION, CREATIVE_STORE, renderStoredCreative } from "./production";
import { creativeHandoff } from "./review";
import type { CreativeActor } from "./service";

const revision = z.number().int().positive();
const model = z.object({ provider: z.literal("replicate"), model: z.string().min(1).max(200), version: z.string().min(3).max(200), inputSchemaDigest: digestSchema }).strict();
const stage = z.enum(["copy", "visual"]);
export const creativeCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), expectedRevision: revision, copy: structuredCopySchema, composition: compositionSchema.nullable() }).strict(),
  z.object({ action: z.literal("approve_copy"), expectedRevision: revision, copyDigest: digestSchema }).strict(),
  z.object({ action: z.literal("admit"), expectedRevision: revision, stage, model, regenerate: z.boolean(), managedQuoteAcceptance: z.object({ quoteId: z.string().uuid(), confirmationDigest: digestSchema }).strict().nullable().optional() }).strict(),
  z.object({ action: z.literal("execute"), expectedRevision: revision, stage }).strict(),
  z.object({ action: z.literal("collect"), expectedRevision: revision, stage }).strict(),
  z.object({ action: z.literal("approve_visual"), expectedRevision: revision, findingsDigest: digestSchema }).strict(),
  z.object({ action: z.literal("approve_publication"), expectedRevision: revision, outputDigest: digestSchema }).strict(),
  z.object({ action: z.literal("cancel"), expectedRevision: revision }).strict(),
  z.object({ action: z.literal("handoff"), expectedRevision: revision }).strict(),
  z.object({ action: z.literal("render"), expectedRevision: revision, mode: z.enum(["preview", "export"]), draft: z.object({ copy: structuredCopySchema, composition: compositionSchema }).strict().optional() }).strict(),
]);

export function assertCreativeRelease() {
  // This capability is not enabled until its complete product and runtime
  // evidence matrix is accepted. An operator switch does not grant spending.
  if (process.env.CREATIVE_GENERATION_ENABLED !== "true") throw new CreativeError("creative.errors.unavailable");
}

export function creativeHttpError(error: unknown) {
  const code = error instanceof CreativeError ? error.code : error instanceof z.ZodError ? "creative.errors.invalidInput" : "creative.errors.unavailable";
  const status = code === "creative.errors.notFound" ? 404 : code === "creative.errors.forbidden" ? 403 : code === "creative.errors.unavailable" ? 503 : code.includes("Conflict") || code.includes("Stale") ? 409 : 422;
  return noStoreJson({ success: false, code }, { status });
}

export async function dispatchCreativeCommand(actor: CreativeActor, id: string, idempotencyKey: string, value: unknown, signal: AbortSignal) {
  const command = creativeCommandSchema.parse(value);
  const base = { expectedRevision: command.expectedRevision, idempotencyKey };
  switch (command.action) {
    case "edit": return noStoreJson({ success: true, session: await CREATIVE_GENERATION.edit(actor, id, { ...base, copy: command.copy, composition: command.composition }) });
    case "approve_copy": return noStoreJson({ success: true, session: await CREATIVE_GENERATION.approveCopy(actor, id, { ...base, copyDigest: command.copyDigest }) });
    case "admit": {
      const result = await CREATIVE_GENERATION.admit(actor, id, { ...base, stage: command.stage, model: command.model, regenerate: command.regenerate, managedQuoteAcceptance: command.managedQuoteAcceptance ? { quoteId: command.managedQuoteAcceptance.quoteId, confirmationDigest: command.managedQuoteAcceptance.confirmationDigest as `sha256:${string}` } : null });
      return noStoreJson({ success: result.admission.ok, ...result, ...(!result.admission.ok ? { code: result.admission.code === "MANAGED_CREDIT_CONFIRMATION_REQUIRED" ? "creative.errors.quoteConfirmation" : result.admission.status === 402 ? "creative.errors.insufficientCredits" : "creative.errors.admissionRejected" } : {}) }, { status: result.admission.status });
    }
    case "execute": {
      const session = await CREATIVE_STORE.get(actor.workspaceId, id);
      if (!session) throw new CreativeError("creative.errors.notFound");
      if (session.cancellationRequestedAt) throw new CreativeError("creative.errors.cancelled");
      if (session.revision !== command.expectedRevision) throw new CreativeError("creative.errors.revisionConflict");
      const selected = session.stages.filter((entry) => entry.stage === command.stage).at(-1);
      if (!selected) throw new CreativeError("creative.errors.operationPending");
      const result = await executeAdmittedGeneration({ ...actor, intentId: selected.intentId, prompt: command.stage === "copy" ? compileCopyPrompt(session.brief) : compileVisualPlatePrompt(session.brief), sourceAssetIds: command.stage === "copy" ? [] : session.request.sourceAssets.map((asset) => asset.assetId), idempotencyKey: `creative-execute:${selected.intentId}` });
      return noStoreJson({ success: result.ok, result, ...(!result.ok ? { code: "creative.errors.admissionRejected" } : {}) }, { status: result.status });
    }
    case "collect": return noStoreJson({ success: true, session: await CREATIVE_GENERATION.collect(actor, id, { ...base, stage: command.stage }) });
    case "approve_visual": return noStoreJson({ success: true, session: await CREATIVE_GENERATION.approveVisual(actor, id, { ...base, findingsDigest: command.findingsDigest }) });
    case "approve_publication": return noStoreJson({ success: true, session: await CREATIVE_GENERATION.approvePublication(actor, id, { ...base, outputDigest: command.outputDigest }) });
    case "cancel": return noStoreJson({ success: true, ...await CREATIVE_GENERATION.cancel(actor, id, base) });
    case "handoff": {
      const session = await CREATIVE_STORE.get(actor.workspaceId, id);
      if (!session) throw new CreativeError("creative.errors.notFound");
      if (session.revision !== command.expectedRevision) throw new CreativeError("creative.errors.revisionConflict");
      return noStoreJson({ success: true, handoff: creativeHandoff(session) });
    }
    case "render": {
      const result = await renderStoredCreative(actor, id, { ...base, mode: command.mode, draft: command.draft, signal });
      if (result.kind === "export") return noStoreJson({ success: true, session: result.session });
      return new NextResponse(new Uint8Array(result.buffer), { headers: { "content-type": result.receipt.output.mimeType, "cache-control": "private, no-store", "x-creative-render-digest": result.receipt.digest, "x-creative-review-required": "true" } });
    }
  }
}
