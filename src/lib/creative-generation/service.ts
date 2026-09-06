import { createHash } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { AdmittedGenerationInput, AdmittedGenerationResult } from "@/lib/model-routing/admitted-generation-service";
import type { ManagedCreditQuoteAcceptance } from "@/lib/model-routing/budget-authority";
import type { ExactModelRef, ModelDescriptor } from "@/lib/model-routing/types";
import { CREATIVE_PROMPT_COMPOSITION_VERSION } from "@/lib/model-routing/provider-input-composition";
import { buildCreativeBrief, compileCopyPrompt, compileVisualPlatePrompt, type AcceptedCreativeBrand } from "./brief";
import { parseGeneratedCopy, validateComposition, validateCopyForRequest } from "./composition";
import { CreativeError, creativeRequestSchema, type Composition, type CreativeRequest, type StructuredCopy } from "./contracts";
import { acceptVisualReview, creativeHandoff, inspectCreativePlate, type CreativePlateInspector } from "./review";
import type { CreativeSession, CreativeSessionStore } from "./session";

export interface CreativeActor { workspaceId: string; userId: string; role: string; planTier: string; }
export interface CreativeGenerationPorts {
  store: CreativeSessionStore;
  loadBrand(request: CreativeRequest): Promise<AcceptedCreativeBrand>;
  validateSourcesAndRights(request: CreativeRequest): Promise<void>;
  resolveModel(model: ExactModelRef): ModelDescriptor | null;
  admit(input: CreativeActor & { idempotencyKey: string; input: AdmittedGenerationInput }): Promise<AdmittedGenerationResult>;
  observe(workspaceId: string, stage: CreativeSession["stages"][number]): Promise<{ state: string; text?: string; plate?: NonNullable<CreativeSession["plate"]>; metadata: Record<string, unknown> }>;
  cancel(actor: CreativeActor, stage: CreativeSession["stages"][number], idempotencyKey: string): Promise<unknown>;
  inspector: CreativePlateInspector;
}

export class CreativeGenerationService {
  constructor(private readonly ports: CreativeGenerationPorts, private readonly now = () => new Date().toISOString()) {}
  async create(actor: CreativeActor, value: unknown) {
    const request = creativeRequestSchema.parse(value);
    if (actor.workspaceId !== request.workspaceId) throw new CreativeError("creative.errors.workspaceMismatch");
    const accepted = await this.ports.loadBrand(request);
    await this.ports.validateSourcesAndRights(request);
    const brief = buildCreativeBrief(request, accepted);
    const at = this.now();
    const id = `creative_${createHash("sha256").update(`${actor.workspaceId}:${request.idempotencyKey}`).digest("hex").slice(0, 32)}`;
    const session: CreativeSession = { schema: "creative-session/v1", id, workspaceId: actor.workspaceId, revision: 1, request, brief, copy: null, copyApproval: null, composition: null, stages: [], plate: null, visualReview: null, output: null, publicationReview: null, cancellationRequestedAt: null, createdByUserId: actor.userId, createdAt: at, updatedAt: at };
    return this.ports.store.create(session, request.idempotencyKey, canonicalDigest({ actor: actor.userId, request }));
  }
  async get(actor: CreativeActor, id: string) {
    const session = await this.requireSession(actor.workspaceId, id);
    const operations = await Promise.all(session.stages.map(async (stage) => ({ stage: stage.stage, attempt: stage.attempt, operationId: stage.operationId, ...(await this.ports.observe(actor.workspaceId, stage)) })));
    return { session, operations };
  }
  private async requireSession(workspaceId: string, id: string) { const session = await this.ports.store.get(workspaceId, id); if (!session) throw new CreativeError("creative.errors.notFound"); return session; }
  private mutable(session: CreativeSession) { if (session.cancellationRequestedAt) throw new CreativeError("creative.errors.cancelled"); }
  private mutate(actor: CreativeActor, id: string, expectedRevision: number, idempotencyKey: string, command: unknown, change: (current: CreativeSession) => CreativeSession) {
    return this.ports.store.mutate({ workspaceId: actor.workspaceId, id, userId: actor.userId, expectedRevision, idempotencyKey, requestDigest: canonicalDigest({ userId: actor.userId, id, expectedRevision, command }) }, (current) => { this.mutable(current); return change(current); });
  }
  async edit(actor: CreativeActor, id: string, input: { expectedRevision: number; idempotencyKey: string; copy: StructuredCopy; composition: Composition | null }) {
    return this.mutate(actor, id, input.expectedRevision, input.idempotencyKey, input, (session) => {
      const copy = validateCopyForRequest(input.copy, session.request);
      const copyChanged = !session.copy || canonicalDigest(copy) !== canonicalDigest(session.copy);
      if (session.copy && copyChanged && copy.revision !== session.copy.revision + 1) throw new CreativeError("creative.errors.revisionConflict");
      if (!session.copy && copy.revision !== 1) throw new CreativeError("creative.errors.revisionConflict");
      const composition = input.composition ? validateComposition(input.composition, copy) : null;
      if (composition && (!session.plate || composition.plate.assetId !== session.plate.assetId || composition.plate.digest !== session.plate.digest || canonicalDigest(composition.canvas) !== canonicalDigest(session.request.output))) throw new CreativeError("creative.errors.sourceBinding");
      if (composition && composition.revision !== (session.composition?.revision ?? 0) + 1 && canonicalDigest(composition) !== canonicalDigest(session.composition)) throw new CreativeError("creative.errors.revisionConflict");
      return { ...session, copy, composition, copyApproval: copyChanged ? null : session.copyApproval, output: null, publicationReview: null };
    });
  }
  async approveCopy(actor: CreativeActor, id: string, input: { expectedRevision: number; idempotencyKey: string; copyDigest: string }) {
    return this.mutate(actor, id, input.expectedRevision, input.idempotencyKey, input, (session) => {
      if (!session.copy || canonicalDigest(session.copy) !== input.copyDigest) throw new CreativeError("creative.errors.copyStale");
      return { ...session, copyApproval: { digest: input.copyDigest, userId: actor.userId, acceptedAt: this.now() } };
    });
  }
  async admit(actor: CreativeActor, id: string, input: { expectedRevision: number; idempotencyKey: string; stage: "copy" | "visual"; model: ExactModelRef & { provider: "replicate" }; managedQuoteAcceptance?: ManagedCreditQuoteAcceptance | null; regenerate: boolean }) {
    const session = await this.requireSession(actor.workspaceId, id); this.mutable(session);
    if (session.revision !== input.expectedRevision) throw new CreativeError("creative.errors.revisionConflict");
    if (input.stage === "visual" && (!session.copy || session.copyApproval?.digest !== canonicalDigest(session.copy))) throw new CreativeError("creative.errors.copyApprovalRequired");
    const previous = session.stages.filter((stage) => stage.stage === input.stage);
    if (previous.length && !input.regenerate) throw new CreativeError("creative.errors.regenerationExplicit");
    for (const stage of session.stages) {
      const observed = await this.ports.observe(actor.workspaceId, stage);
      if (!["succeeded", "failed_known", "cancelled"].includes(observed.state)) throw new CreativeError(observed.state === "outcome_unknown" ? "creative.errors.outcomeUnknown" : "creative.errors.operationPending");
    }
    await this.ports.validateSourcesAndRights(session.request);
    const attempt = previous.length + 1;
    const key = `creative:${id}:${input.stage}:${attempt}`;
    const prompt = input.stage === "copy" ? compileCopyPrompt(session.brief) : compileVisualPlatePrompt(session.brief);
    // The canonical registry currently qualifies media at 9:16 only. Refuse
    // incompatible dimensions before any quote/reservation or provider call.
    const model = this.ports.resolveModel(input.model);
    if (!model || model.qualification.status !== "qualified") throw new CreativeError("creative.errors.modelUnavailable");
    if (input.stage === "visual" && (session.request.output.aspectRatio !== "9:16" || model.qualification.outputShape.width !== session.request.output.width || model.qualification.outputShape.height !== session.request.output.height || session.request.output.format === "video" && model.qualification.outputShape.fps !== session.request.output.fps)) throw new CreativeError("creative.errors.modelOutputMismatch");
    const result = await this.ports.admit({ ...actor, idempotencyKey: key, input: {
      prompt, model: input.model, capability: input.stage === "copy" ? "text_generation" : session.request.output.format === "image" ? session.request.sourceAssets.length ? "image_to_image" : "text_to_image" : session.request.sourceAssets.length ? "image_to_video" : "text_to_video",
      contentLanguage: session.request.contentLanguage, arabicVariety: session.request.arabicVariety,
      quantity: input.stage === "visual" && session.request.output.format === "video" ? session.request.output.durationMs! / 1000 : 1,
      sourceAssetIds: input.stage === "copy" ? [] : session.request.sourceAssets.map((asset) => asset.assetId),
      rightsBasis: input.stage === "copy" ? "owned" : session.request.rights.basis, permittedRemix: input.stage === "copy" ? "reference_only" : session.request.rights.permittedRemix, rightsEvidenceIds: input.stage === "copy" ? [] : session.request.rights.evidenceIds,
      remixBrief: { preserve: [], transform: [], avoid: ["text", "watermarks", "protected marks"] },
      fundingMode: session.request.fundingMode, managedQuoteAcceptance: input.managedQuoteAcceptance, pinnedBrand: session.request.brand, promptVersion: CREATIVE_PROMPT_COMPOSITION_VERSION,
      creativeBinding: { sessionId: session.id, sessionRevision: session.revision, briefDigest: session.brief.digest as `sha256:${string}`, promptPolicyRevision: "arabic-safe-creative/v1", stage: input.stage, copyRevision: input.stage === "visual" ? session.copy!.revision : null, copyDigest: input.stage === "visual" ? canonicalDigest(session.copy) as `sha256:${string}` : null, output: { format: session.request.output.format, durationMs: session.request.output.durationMs } },
      ...(input.stage === "visual" ? { pinnedRightsSnapshot: { id: session.request.rights.snapshotId, revision: session.request.rights.revision, digest: session.request.rights.digest } } : {}),
    } });
    if (!result.ok) return { session, admission: result };
    const stage: CreativeSession["stages"][number] = { stage: input.stage, attempt, intentId: result.value.intentId, operationId: result.value.operation.id, model: input.model, createdAt: this.now() };
    try {
      const updated = await this.mutate(actor, id, input.expectedRevision, input.idempotencyKey, { stage: input.stage, attempt, model: input.model }, (current) => ({ ...current, stages: [...current.stages, stage] }));
      return { session: updated, admission: result };
    } catch (error) {
      const current = await this.requireSession(actor.workspaceId, id);
      if (current.stages.some((existing) => existing.intentId === stage.intentId)) return { session: current, admission: result };
      // No provider execution happened here. Cancel an unbound admission so a
      // concurrent edit/cancellation cannot strand its credit reservation.
      await this.ports.cancel(actor, stage, `${key}:unbound-cancel`);
      throw error;
    }
  }
  async collect(actor: CreativeActor, id: string, input: { expectedRevision: number; idempotencyKey: string; stage: "copy" | "visual" }) {
    const session = await this.requireSession(actor.workspaceId, id); this.mutable(session);
    const stage = session.stages.filter((item) => item.stage === input.stage).at(-1);
    if (!stage) throw new CreativeError("creative.errors.operationPending");
    const observed = await this.ports.observe(actor.workspaceId, stage);
    if (observed.state !== "succeeded") throw new CreativeError(observed.state === "outcome_unknown" ? "creative.errors.outcomeUnknown" : observed.state === "failed_known" ? "creative.errors.providerFailed" : "creative.errors.operationPending");
    if (input.stage === "copy") {
      const generated = parseGeneratedCopy(observed.text, session.request);
      const copy = { ...generated, revision: (session.copy?.revision ?? 0) + 1 };
      return this.mutate(actor, id, input.expectedRevision, input.idempotencyKey, input, (current) => ({ ...current, copy, copyApproval: null, composition: null, output: null, publicationReview: null }));
    }
    const plate = observed.plate;
    if (!plate || plate.intentId !== stage.intentId) throw new CreativeError("creative.errors.sourceBinding");
    const visualReview = await inspectCreativePlate(this.ports.inspector, { workspaceId: actor.workspaceId, assetId: plate.assetId, plateDigest: plate.digest });
    return this.mutate(actor, id, input.expectedRevision, input.idempotencyKey, input, (current) => ({ ...current, plate, visualReview, composition: null, output: null, publicationReview: null }));
  }
  async approveVisual(actor: CreativeActor, id: string, input: { expectedRevision: number; idempotencyKey: string; findingsDigest: string }) {
    return this.mutate(actor, id, input.expectedRevision, input.idempotencyKey, input, (session) => {
      if (!session.plate || !session.visualReview) throw new CreativeError("creative.errors.visualReviewRequired");
      return { ...session, visualReview: acceptVisualReview(session.visualReview, { plateDigest: session.plate.digest, acknowledgedFindingsDigest: input.findingsDigest, userId: actor.userId, at: this.now() }) };
    });
  }
  async approvePublication(actor: CreativeActor, id: string, input: { expectedRevision: number; idempotencyKey: string; outputDigest: string }) {
    return this.mutate(actor, id, input.expectedRevision, input.idempotencyKey, input, (session) => {
      if (!session.output || !session.composition || session.output.digest !== input.outputDigest) throw new CreativeError("creative.errors.renderRequired");
      const next = { ...session, publicationReview: { outputDigest: input.outputDigest, compositionDigest: canonicalDigest(session.composition), userId: actor.userId, acceptedAt: this.now() } };
      creativeHandoff(next);
      return next;
    });
  }
  async cancel(actor: CreativeActor, id: string, input: { expectedRevision: number; idempotencyKey: string }) {
    const session = await this.ports.store.mutate({ ...input, workspaceId: actor.workspaceId, id, userId: actor.userId, requestDigest: canonicalDigest({ action: "cancel", id, ...input }) }, (current) => ({ ...current, cancellationRequestedAt: current.cancellationRequestedAt ?? this.now() }));
    const outcomes = [];
    for (const stage of session.stages) {
      const operation = await this.ports.observe(actor.workspaceId, stage);
      if (!["succeeded", "failed_known", "cancelled"].includes(operation.state)) outcomes.push(await this.ports.cancel(actor, stage, `${input.idempotencyKey}:${stage.intentId}`));
    }
    return { session, outcomes };
  }
}
