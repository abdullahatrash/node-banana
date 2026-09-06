import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { OperationStatusService } from "@/lib/agent-runtime/operation-status/service";
import type { GenerationBudgetAuthority, ManagedCreditQuoteAcceptance } from "@/lib/model-routing/budget-authority";
import type { GenerationRegionAuthority } from "@/lib/model-routing/generation-region";
import type { CreatorPersona, CreatorPersonaEvidence } from "./types";
import { evaluatePersonaGate } from "./types";
import { configuredPersonaTrainingQualifications, selectPersonaTrainingQualification, type PersonaTrainingQualification } from "./training-qualification";

export interface PersonaTrainingAdmissionSnapshot {
  schema: "creator-persona-training-admission/v1";
  qualification: PersonaTrainingQualification;
  quote: { currency: "USD"; amount: number; basis: "run"; quantity: 1; quotedAt: Date; expiresAt: Date };
  reservationIds: string[];
  regionAdmission: { policyId: string; policyVersion: number; evidenceDigest: `sha256:${string}`; region: string; routeId: string; evidenceExpiresAt: Date };
  providerAcceptanceEvidenceId: string;
}

export interface PersonaTrainingAdmissionPlan {
  workspaceId: string; userId: string; personaId: string; expectedRevision: number; idempotencyKey: string;
  jobId: string; operationId: string; retryOfJobId: string | null; admission: PersonaTrainingAdmissionSnapshot;
}

const persistedAdmissionSchema = z.object({
  schema: z.literal("creator-persona-training-admission/v1"), qualification: z.any(),
  quote: z.object({ currency: z.literal("USD"), amount: z.number().positive(), basis: z.literal("run"), quantity: z.literal(1), quotedAt: z.string().datetime(), expiresAt: z.string().datetime() }),
  reservationIds: z.array(z.string()),
  regionAdmission: z.object({ policyId: z.string(), policyVersion: z.number().int().positive(), evidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), region: z.string(), routeId: z.string(), evidenceExpiresAt: z.string().datetime() }),
  providerAcceptanceEvidenceId: z.string(),
}).strict();

export function serializePersonaTrainingAdmission(value: PersonaTrainingAdmissionSnapshot): Record<string, unknown> {
  return { ...value, quote: { ...value.quote, quotedAt: value.quote.quotedAt.toISOString(), expiresAt: value.quote.expiresAt.toISOString() }, regionAdmission: { ...value.regionAdmission, evidenceExpiresAt: value.regionAdmission.evidenceExpiresAt.toISOString() } };
}

export function parsePersonaTrainingAdmission(value: unknown): PersonaTrainingAdmissionSnapshot {
  const parsed = persistedAdmissionSchema.parse(value);
  return { ...parsed, qualification: parsed.qualification as PersonaTrainingQualification, quote: { ...parsed.quote, quotedAt: new Date(parsed.quote.quotedAt), expiresAt: new Date(parsed.quote.expiresAt) }, regionAdmission: { ...parsed.regionAdmission, evidenceDigest: parsed.regionAdmission.evidenceDigest as `sha256:${string}`, evidenceExpiresAt: new Date(parsed.regionAdmission.evidenceExpiresAt) } };
}

export interface PersonaTrainingAdmissionRepository {
  getTrainingAdmissionContext(workspaceId: string, personaId: string): Promise<{ persona: CreatorPersona; evidence: CreatorPersonaEvidence[]; sources: Array<{ assetId: string; mediaType: string }>; latestFailedTrainingJobId: string | null } | null>;
  requestAdmittedTraining(input: { workspaceId: string; userId: string; personaId: string; expectedRevision: number; jobId: string; operationId: string; retryOfJobId: string | null; admission: PersonaTrainingAdmissionSnapshot; idempotencyKey: string }): Promise<Record<string, unknown>>;
  getTrainingAdmissionPlan(workspaceId: string, idempotencyKey: string): Promise<PersonaTrainingAdmissionPlan | null>;
  createTrainingAdmissionPlan(input: PersonaTrainingAdmissionPlan): Promise<PersonaTrainingAdmissionPlan>;
  getAdmittedTrainingReplay(input: { workspaceId: string; userId: string; personaId: string; expectedRevision: number; idempotencyKey: string; jobId: string }): Promise<Record<string, unknown> | null>;
}

function stableUuid(workspaceId: string, key: string) {
  const hex = createHash("sha256").update(`persona-training:${workspaceId}:${key}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export class PersonaTrainingAdmissionService {
  constructor(
    private readonly repository: PersonaTrainingAdmissionRepository,
    private readonly budgets: GenerationBudgetAuthority,
    private readonly regions: GenerationRegionAuthority,
    private readonly operations: Pick<OperationStatusService, "create" | "transition">,
    private readonly qualifications = () => configuredPersonaTrainingQualifications(),
    private readonly now = () => new Date(),
  ) {}

  async request(input: { workspaceId: string; userId: string; personaId: string; expectedRevision: number; idempotencyKey: string; managedQuoteAcceptance?: ManagedCreditQuoteAcceptance | null }) {
    const at = this.now(); const jobId = stableUuid(input.workspaceId, input.idempotencyKey), operationId = `persona_training:${jobId}`;
    const replay = await this.repository.getAdmittedTrainingReplay({ ...input, jobId });
    if (replay) return { kind: "admitted" as const, result: replay };
    const context = await this.repository.getTrainingAdmissionContext(input.workspaceId, input.personaId);
    if (!context || context.persona.revision !== input.expectedRevision) return { kind: "denied" as const, code: context ? "REVISION_CONFLICT" : "PERSONA_NOT_FOUND" };
    if (!["ready_to_train", "training_failed"].includes(context.persona.state)) return { kind: "denied" as const, code: "PERSONA_NOT_READY_TO_TRAIN" };
    const gate = evaluatePersonaGate({ persona: context.persona, evidence: context.evidence, at, requireActive: false });
    if (!gate.admitted || !gate.evidence.providerAcceptance) return { kind: "denied" as const, code: "PERSONA_GATES_INCOMPLETE" };
    let plan = await this.repository.getTrainingAdmissionPlan(input.workspaceId, input.idempotencyKey);
    if (plan && (plan.userId !== input.userId || plan.personaId !== input.personaId || plan.expectedRevision !== input.expectedRevision || plan.jobId !== jobId)) return { kind: "denied" as const, code: "IDEMPOTENCY_CONFLICT" };
    if (!plan) {
      const qualification = selectPersonaTrainingQualification({ persona: context.persona, providerAcceptance: gate.evidence.providerAcceptance, qualifications: this.qualifications(), sourceCount: context.sources.length, sourceMediaTypes: context.sources.map((source) => source.mediaType) });
      if (!qualification) return { kind: "denied" as const, code: "TRAINING_MODEL_NOT_QUALIFIED" };
      const model = { provider: qualification.provider, model: qualification.model, version: qualification.version, inputSchemaDigest: qualification.inputSchemaDigest } as const;
      const region = await this.regions.admit({ workspaceId: input.workspaceId, model, at });
      if (region.kind !== "admitted" || !qualification.verifiedRegions.includes(region.evidence.region)) return { kind: "denied" as const, code: region.kind === "denied" ? region.code : "TRAINING_REGION_NOT_QUALIFIED" };
      const expiresAt = new Date(Math.min(at.getTime() + 5 * 60_000, new Date(qualification.expiresAt).getTime(), region.evidence.evidenceExpiresAt.getTime()));
      const quote = { currency: "USD" as const, amount: qualification.priceUsd.amount, basis: "run" as const, quantity: 1 as const, quotedAt: at, expiresAt };
      plan = await this.repository.createTrainingAdmissionPlan({ ...input, jobId, operationId, retryOfJobId: context.persona.state === "training_failed" ? context.latestFailedTrainingJobId : null, admission: { schema: "creator-persona-training-admission/v1", qualification, quote, reservationIds: [], regionAdmission: region.evidence, providerAcceptanceEvidenceId: gate.evidence.providerAcceptance.id } });
    }
    const { qualification, quote, regionAdmission } = plan.admission;
    const selected = selectPersonaTrainingQualification({ persona: context.persona, providerAcceptance: gate.evidence.providerAcceptance, qualifications: this.qualifications(), region: regionAdmission.region, sourceCount: context.sources.length, sourceMediaTypes: context.sources.map((source) => source.mediaType) });
    if (!selected || selected.id !== qualification.id || selected.revision !== qualification.revision || selected.digest !== qualification.digest || canonicalDigest(selected) !== canonicalDigest(qualification) || quote.expiresAt <= at) return { kind: "denied" as const, code: "TRAINING_ADMISSION_EXPIRED" };
    const model = { provider: qualification.provider, model: qualification.model, version: qualification.version, inputSchemaDigest: qualification.inputSchemaDigest } as const;
    const region = await this.regions.revalidate({ workspaceId: input.workspaceId, model, evidence: regionAdmission, at });
    if (region.kind !== "admitted") return { kind: "denied" as const, code: region.code };
    const reservation = await this.budgets.reserve({ workspaceId: input.workspaceId, principalId: input.userId, intentId: `persona-training:${jobId}`, model, quote, fundingMode: "managed", managedQuoteAcceptance: input.managedQuoteAcceptance ?? null, at });
    if (reservation.kind === "confirmation_required") return { kind: "confirmation_required" as const, quote: reservation.quote };
    if (reservation.kind !== "reserved") return { kind: "denied" as const, code: reservation.code };
    let operation: Awaited<ReturnType<typeof this.operations.create>>;
    try { operation = await this.operations.create({ workspaceId: input.workspaceId, operationId, kind: "persona_training", resourceId: jobId, actor: { type: "human", userId: input.userId }, metadata: { provider: model.provider, model: model.model, version: model.version, inputSchemaDigest: model.inputSchemaDigest, qualificationDigest: qualification.digest, personaId: input.personaId, quoteAmountUsd: quote.amount, quoteCurrency: quote.currency, quoteQuantity: 1, quoteBasis: quote.basis, reservationIds: reservation.reservationIds, region: regionAdmission.region, regionPolicyId: regionAdmission.policyId, regionPolicyVersion: regionAdmission.policyVersion, regionEvidenceDigest: regionAdmission.evidenceDigest, nextAction: "await_provider_dispatch" }, idempotencyKey: `persona-training-operation:${jobId}` }); }
    catch { if (reservation.disposition === "created") await this.budgets.release({ workspaceId: input.workspaceId, intentId: `persona-training:${jobId}`, at }); return { kind: "unavailable" as const, code: "PERSONA_TRAINING_OPERATION_UNAVAILABLE" }; }
    if (operation.kind !== "applied" && operation.kind !== "replayed") { if (reservation.disposition === "created") await this.budgets.release({ workspaceId: input.workspaceId, intentId: `persona-training:${jobId}`, at }); return { kind: "unavailable" as const, code: "PERSONA_TRAINING_OPERATION_UNAVAILABLE" }; }
    try {
      const result = await this.repository.requestAdmittedTraining({ ...input, jobId, operationId, retryOfJobId: plan.retryOfJobId, admission: { ...plan.admission, reservationIds: reservation.reservationIds } });
      await this.operations.transition({ workspaceId: input.workspaceId, operationId, expectedRevision: operation.operation.revision, to: "admitted", reasonCode: "persona.training_admitted", actor: { type: "system", service: "persona-training-admission" }, metadata: { nextAction: "await_provider_dispatch" }, idempotencyKey: `persona-training-admitted:${jobId}` });
      return { kind: "admitted" as const, result };
    } catch (error) {
      if (reservation.disposition === "created") await this.budgets.release({ workspaceId: input.workspaceId, intentId: `persona-training:${jobId}`, at });
      await this.operations.transition({ workspaceId: input.workspaceId, operationId, expectedRevision: operation.operation.revision, to: "failed_known", reasonCode: "persona.training_admission_failed", actor: { type: "system", service: "persona-training-admission" }, metadata: { reasonCode: error instanceof Error ? error.message : "PERSONA_TRAINING_ADMISSION_FAILED", nextAction: "correct_and_retry" }, idempotencyKey: `persona-training-admission-failed:${jobId}` });
      throw error;
    }
  }

  async revalidate(claim: {
    workspaceId: string; personaId: string; provider: string; model: string; modelVersion: string; qualificationDigest: string;
    inputSchemaDigest: string | null; qualificationId: string | null; qualificationRevision: number | null;
    providerAcceptanceEvidenceId: string; regionPolicyId: string | null; regionPolicyVersion: number | null;
    regionEvidenceDigest: string | null; region: string | null; regionRouteId: string | null; regionEvidenceExpiresAt: Date | null;
  }) {
    const at = this.now();
    const context = await this.repository.getTrainingAdmissionContext(claim.workspaceId, claim.personaId);
    if (!context) return { kind: "denied" as const, code: "PERSONA_NOT_FOUND" };
    const gate = evaluatePersonaGate({ persona: context.persona, evidence: context.evidence, at, requireActive: false });
    if (!gate.admitted || gate.evidence.providerAcceptance?.id !== claim.providerAcceptanceEvidenceId) return { kind: "denied" as const, code: "PERSONA_GATES_CHANGED" };
    const qualification = selectPersonaTrainingQualification({ persona: context.persona, providerAcceptance: gate.evidence.providerAcceptance, qualifications: this.qualifications(), region: claim.region ?? undefined, sourceCount: context.sources.length, sourceMediaTypes: context.sources.map((source) => source.mediaType) });
    if (qualification && (qualification.id !== claim.qualificationId || qualification.revision !== claim.qualificationRevision || qualification.provider !== claim.provider || qualification.model !== claim.model || qualification.version !== claim.modelVersion || qualification.inputSchemaDigest !== claim.inputSchemaDigest || qualification.digest !== claim.qualificationDigest)) return { kind: "denied" as const, code: "TRAINING_QUALIFICATION_CHANGED" };
    if (!qualification || new Date(qualification.expiresAt) <= at) return { kind: "denied" as const, code: "TRAINING_QUALIFICATION_EXPIRED" };
    if (!claim.regionPolicyId || !claim.regionPolicyVersion || !claim.regionEvidenceDigest || !claim.region || !claim.regionRouteId || !claim.regionEvidenceExpiresAt) return { kind: "denied" as const, code: "TRAINING_REGION_ADMISSION_MISSING" };
    const model = { provider: qualification.provider, model: qualification.model, version: qualification.version, inputSchemaDigest: qualification.inputSchemaDigest } as const;
    const region = await this.regions.revalidate({ workspaceId: claim.workspaceId, model, at, evidence: { policyId: claim.regionPolicyId, policyVersion: claim.regionPolicyVersion, evidenceDigest: claim.regionEvidenceDigest as `sha256:${string}`, region: claim.region, routeId: claim.regionRouteId, evidenceExpiresAt: claim.regionEvidenceExpiresAt } });
    return region.kind === "admitted" ? { kind: "admitted" as const } : { kind: "denied" as const, code: region.code };
  }

  releasePreStart(input: { workspaceId: string; id: string }) {
    return this.budgets.release({ workspaceId: input.workspaceId, intentId: `persona-training:${input.id}`, at: this.now() });
  }
}
