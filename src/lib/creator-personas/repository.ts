import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import {
  assets, creatorPersonaCommandReceipts, creatorPersonaEvidence, creatorPersonaEvents,
  creatorPersonas, creatorPersonaTrainingJobs, creatorPersonaTrainingSources, creatorPersonaUsages,
} from "@/lib/db/schema";
import { evaluatePersonaGate, type CreatorPersona, type CreatorPersonaEvidence, type PersonaUsagePurpose } from "./types";

type Db = ReturnType<typeof getDb>;
type Actor = { workspaceId: string; userId: string };
export class CreatorPersonaError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "CreatorPersonaError"; }
}

const hydratePersona = (row: typeof creatorPersonas.$inferSelect): CreatorPersona => row as CreatorPersona;
const hydrateEvidence = (row: typeof creatorPersonaEvidence.$inferSelect): CreatorPersonaEvidence => row as CreatorPersonaEvidence;

export class CreatorPersonaRepository {
  constructor(private readonly database: Db = getDb(), private readonly now = () => new Date()) {}

  async list(workspaceId: string, input: { state?: string[]; before?: { updatedAt: Date; id: string }; limit: number }) {
    const filters = [eq(creatorPersonas.workspaceId, workspaceId), isNull(creatorPersonas.deletedAt)];
    if (input.state?.length) filters.push(inArray(creatorPersonas.state, input.state));
    if (input.before) filters.push(sql`(${creatorPersonas.updatedAt}, ${creatorPersonas.id}) < (${input.before.updatedAt}, ${input.before.id})`);
    return (await this.database.select().from(creatorPersonas).where(and(...filters)).orderBy(desc(creatorPersonas.updatedAt), desc(creatorPersonas.id)).limit(Math.min(input.limit, 100))).map(hydratePersona);
  }

  async get(workspaceId: string, personaId: string) {
    const [persona] = await this.database.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, workspaceId), eq(creatorPersonas.id, personaId))).limit(1);
    if (!persona) return null;
    const [evidence, sources, jobs, usages] = await Promise.all([
      this.database.select().from(creatorPersonaEvidence).where(and(eq(creatorPersonaEvidence.workspaceId, workspaceId), eq(creatorPersonaEvidence.personaId, personaId))).orderBy(desc(creatorPersonaEvidence.createdAt)),
      this.database.select().from(creatorPersonaTrainingSources).where(and(eq(creatorPersonaTrainingSources.workspaceId, workspaceId), eq(creatorPersonaTrainingSources.personaId, personaId))).orderBy(asc(creatorPersonaTrainingSources.ordinal)),
      this.database.select().from(creatorPersonaTrainingJobs).where(and(eq(creatorPersonaTrainingJobs.workspaceId, workspaceId), eq(creatorPersonaTrainingJobs.personaId, personaId))).orderBy(desc(creatorPersonaTrainingJobs.createdAt)).limit(20),
      this.database.select().from(creatorPersonaUsages).where(and(eq(creatorPersonaUsages.workspaceId, workspaceId), eq(creatorPersonaUsages.personaId, personaId))).orderBy(desc(creatorPersonaUsages.createdAt)).limit(100),
    ]);
    return { persona: hydratePersona(persona), evidence: evidence.map(hydrateEvidence), sources, jobs, usages };
  }

  private async replay(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], actor: Actor, idempotencyKey: string, requestDigest: string) {
    const [receipt] = await tx.select().from(creatorPersonaCommandReceipts).where(and(eq(creatorPersonaCommandReceipts.workspaceId, actor.workspaceId), eq(creatorPersonaCommandReceipts.idempotencyKey, idempotencyKey))).limit(1);
    if (!receipt) return null;
    if (receipt.requestDigest !== requestDigest) throw new CreatorPersonaError("IDEMPOTENCY_CONFLICT");
    return receipt.result;
  }

  private async receipt(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], input: { actor: Actor; idempotencyKey: string; requestDigest: string; personaId: string; revision: number; result: Record<string, unknown>; createdAt: Date }) {
    await tx.insert(creatorPersonaCommandReceipts).values({ workspaceId: input.actor.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest: input.requestDigest, personaId: input.personaId, resultRevision: input.revision, result: input.result, createdAt: input.createdAt });
  }

  async create(input: Actor & { name: string; kind: "synthetic" | "consented_likeness"; contentLanguage: "ar" | "en"; arabicVariety: CreatorPersona["arabicVariety"]; disclosure: string; retentionUntil: Date; idempotencyKey: string }) {
    if (input.retentionUntil <= this.now()) throw new CreatorPersonaError("RETENTION_WINDOW_INVALID");
    const requestDigest = canonicalDigest({ command: "create", ...input, retentionUntil: input.retentionUntil.toISOString() });
    return this.database.transaction(async (tx) => {
      const replay = await this.replay(tx, input, input.idempotencyKey, requestDigest); if (replay) return replay;
      const now = this.now(), id = randomUUID(), state = input.kind === "synthetic" ? "consent_review" : "consent_review";
      await tx.insert(creatorPersonas).values({ workspaceId: input.workspaceId, id, kind: input.kind, state, name: input.name, contentLanguage: input.contentLanguage, arabicVariety: input.arabicVariety, disclosure: input.disclosure, revision: 1, retentionUntil: input.retentionUntil, createdByUserId: input.userId, updatedByUserId: input.userId, createdAt: now, updatedAt: now });
      await tx.insert(creatorPersonaEvents).values({ workspaceId: input.workspaceId, personaId: id, revision: 1, id: randomUUID(), type: "persona.created", actorUserId: input.userId, facts: { kind: input.kind, contentLanguage: input.contentLanguage }, occurredAt: now });
      const result = { personaId: id, revision: 1, state }; await this.receipt(tx, { actor: input, idempotencyKey: input.idempotencyKey, requestDigest, personaId: id, revision: 1, result, createdAt: now }); return result;
    });
  }

  async addEvidence(input: Actor & { personaId: string; expectedRevision: number; issuer: CreatorPersonaEvidence["issuer"]; subjectDigest: string; evidenceDigest: string; scope: Record<string, unknown> & { kind: CreatorPersonaEvidence["type"] }; effectiveAt: Date; expiresAt: Date; idempotencyKey: string }) {
    const requestDigest = canonicalDigest({ command: "add_evidence", ...input, effectiveAt: input.effectiveAt.toISOString(), expiresAt: input.expiresAt.toISOString() });
    return this.database.transaction(async (tx) => {
      const replay = await this.replay(tx, input, input.idempotencyKey, requestDigest); if (replay) return replay;
      const [persona] = await tx.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId))).limit(1);
      if (!persona) throw new CreatorPersonaError("PERSONA_NOT_FOUND");
      if (persona.revision !== input.expectedRevision) throw new CreatorPersonaError("REVISION_CONFLICT");
      if (["deleted", "suspended"].includes(persona.state)) throw new CreatorPersonaError("PERSONA_NOT_MUTABLE");
      const now = this.now(), revision = persona.revision + 1, evidenceId = randomUUID();
      const provider = input.scope.kind === "provider_acceptance" ? String(input.scope.provider) : null;
      const providerPolicyVersion = input.scope.kind === "provider_acceptance" ? String(input.scope.policyVersion) : null;
      await tx.insert(creatorPersonaEvidence).values({ workspaceId: input.workspaceId, id: evidenceId, personaId: input.personaId, personaRevision: revision, type: input.scope.kind, issuer: input.issuer, subjectDigest: input.subjectDigest, scope: input.scope, evidenceDigest: input.evidenceDigest, provider, providerPolicyVersion, effectiveAt: input.effectiveAt, expiresAt: input.expiresAt, verifiedByUserId: input.userId, createdAt: now });
      const existing = (await tx.select().from(creatorPersonaEvidence).where(and(eq(creatorPersonaEvidence.workspaceId, input.workspaceId), eq(creatorPersonaEvidence.personaId, input.personaId)))).map(hydrateEvidence);
      const gate = evaluatePersonaGate({ persona: hydratePersona(persona), evidence: [...existing, hydrateEvidence({ workspaceId: input.workspaceId, id: evidenceId, personaId: input.personaId, personaRevision: revision, type: input.scope.kind, issuer: input.issuer, subjectDigest: input.subjectDigest, scope: input.scope, evidenceDigest: input.evidenceDigest, provider, providerPolicyVersion, effectiveAt: input.effectiveAt, expiresAt: input.expiresAt, revokedAt: null, verifiedByUserId: input.userId, createdAt: now })], at: now, requireActive: false });
      const state = gate.admitted ? "ready_to_train" : "consent_review";
      await tx.update(creatorPersonas).set({ state, revision, updatedByUserId: input.userId, updatedAt: now }).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId), eq(creatorPersonas.revision, input.expectedRevision)));
      await tx.insert(creatorPersonaEvents).values({ workspaceId: input.workspaceId, personaId: input.personaId, revision, id: randomUUID(), type: "persona.evidence_added", actorUserId: input.userId, facts: { evidenceId, evidenceType: input.scope.kind, state }, occurredAt: now });
      const result = { personaId: input.personaId, evidenceId, revision, state, pendingGates: gate.reasons }; await this.receipt(tx, { actor: input, idempotencyKey: input.idempotencyKey, requestDigest, personaId: input.personaId, revision, result, createdAt: now }); return result;
    });
  }

  async attachSources(input: Actor & { personaId: string; expectedRevision: number; assetIds: string[]; consentEvidenceId: string | null; idempotencyKey: string }) {
    const requestDigest = canonicalDigest({ command: "attach_sources", ...input });
    return this.database.transaction(async (tx) => {
      const replay = await this.replay(tx, input, input.idempotencyKey, requestDigest); if (replay) return replay;
      const [persona] = await tx.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId))).limit(1);
      if (!persona) throw new CreatorPersonaError("PERSONA_NOT_FOUND"); if (persona.revision !== input.expectedRevision) throw new CreatorPersonaError("REVISION_CONFLICT");
      const sourceAssets = await tx.select().from(assets).where(and(eq(assets.workspaceId, input.workspaceId), inArray(assets.id, input.assetIds), isNull(assets.deletedAt)));
      const byId = new Map(sourceAssets.map((asset) => [asset.id, asset]));
      if (input.assetIds.some((assetId) => { const asset = byId.get(assetId); return !asset || !asset.checksum || !asset.sizeBytes || !["image", "video"].includes(asset.type); })) throw new CreatorPersonaError("TRAINING_SOURCE_NOT_READY");
      if (persona.kind === "consented_likeness" && !input.consentEvidenceId) throw new CreatorPersonaError("CONSENT_EVIDENCE_REQUIRED");
      if (input.consentEvidenceId) {
        const [consent] = await tx.select().from(creatorPersonaEvidence).where(and(eq(creatorPersonaEvidence.workspaceId, input.workspaceId), eq(creatorPersonaEvidence.personaId, input.personaId), eq(creatorPersonaEvidence.id, input.consentEvidenceId), eq(creatorPersonaEvidence.type, "likeness_consent"))).limit(1);
        if (!consent || consent.revokedAt || consent.expiresAt <= this.now()) throw new CreatorPersonaError("CONSENT_EVIDENCE_INVALID");
        const covered = new Set(Array.isArray((consent.scope as Record<string, unknown>).sourceAssetIds) ? (consent.scope as { sourceAssetIds: string[] }).sourceAssetIds : []);
        if (input.assetIds.some((assetId) => !covered.has(assetId))) throw new CreatorPersonaError("SOURCE_NOT_COVERED_BY_CONSENT");
      }
      const now = this.now(), revision = persona.revision + 1;
      await tx.delete(creatorPersonaTrainingSources).where(and(eq(creatorPersonaTrainingSources.workspaceId, input.workspaceId), eq(creatorPersonaTrainingSources.personaId, input.personaId)));
      await tx.insert(creatorPersonaTrainingSources).values(input.assetIds.map((assetId, ordinal) => ({ workspaceId: input.workspaceId, personaId: input.personaId, assetId, ordinal, assetChecksum: byId.get(assetId)!.checksum!, consentEvidenceId: input.consentEvidenceId, createdAt: now })));
      await tx.update(creatorPersonas).set({ revision, updatedByUserId: input.userId, updatedAt: now }).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId), eq(creatorPersonas.revision, input.expectedRevision)));
      await tx.insert(creatorPersonaEvents).values({ workspaceId: input.workspaceId, personaId: input.personaId, revision, id: randomUUID(), type: "persona.sources_attached", actorUserId: input.userId, facts: { assetIds: input.assetIds, consentEvidenceId: input.consentEvidenceId }, occurredAt: now });
      const result = { personaId: input.personaId, revision, sourceCount: input.assetIds.length }; await this.receipt(tx, { actor: input, idempotencyKey: input.idempotencyKey, requestDigest, personaId: input.personaId, revision, result, createdAt: now }); return result;
    });
  }

  async requestTraining(input: Actor & { personaId: string; expectedRevision: number; provider: string; model: string; modelVersion: string; qualificationDigest: string; idempotencyKey: string }) {
    const requestDigest = canonicalDigest({ command: "request_training", ...input });
    return this.database.transaction(async (tx) => {
      const replay = await this.replay(tx, input, input.idempotencyKey, requestDigest); if (replay) return replay;
      const [persona] = await tx.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId))).limit(1);
      if (!persona) throw new CreatorPersonaError("PERSONA_NOT_FOUND"); if (persona.revision !== input.expectedRevision) throw new CreatorPersonaError("REVISION_CONFLICT"); if (persona.state !== "ready_to_train") throw new CreatorPersonaError("PERSONA_NOT_READY_TO_TRAIN");
      const evidence = (await tx.select().from(creatorPersonaEvidence).where(and(eq(creatorPersonaEvidence.workspaceId, input.workspaceId), eq(creatorPersonaEvidence.personaId, input.personaId)))).map(hydrateEvidence);
      const gate = evaluatePersonaGate({ persona: hydratePersona(persona), evidence, at: this.now(), requireActive: false }); if (!gate.admitted) throw new CreatorPersonaError("PERSONA_GATES_INCOMPLETE", gate.reasons.join(","));
      if (gate.evidence.providerAcceptance?.provider !== input.provider) throw new CreatorPersonaError("PROVIDER_ACCEPTANCE_MISMATCH");
      const acceptanceScope = gate.evidence.providerAcceptance.scope;
      if (acceptanceScope.model !== input.model || acceptanceScope.modelVersion !== input.modelVersion || acceptanceScope.qualificationDigest !== input.qualificationDigest || !Array.isArray(acceptanceScope.acceptedUses) || !acceptanceScope.acceptedUses.includes("training")) throw new CreatorPersonaError("PROVIDER_ACCEPTANCE_MISMATCH");
      const sources = await tx.select().from(creatorPersonaTrainingSources).where(and(eq(creatorPersonaTrainingSources.workspaceId, input.workspaceId), eq(creatorPersonaTrainingSources.personaId, input.personaId)));
      if (sources.length < 3) throw new CreatorPersonaError("TRAINING_SOURCES_INSUFFICIENT");
      const now = this.now(), revision = persona.revision + 1, jobId = randomUUID(), operationId = `persona_training:${jobId}`;
      await tx.insert(creatorPersonaTrainingJobs).values({ workspaceId: input.workspaceId, id: jobId, personaId: input.personaId, personaRevision: revision, state: "queued", provider: input.provider, model: input.model, modelVersion: input.modelVersion, qualificationDigest: input.qualificationDigest, providerAcceptanceEvidenceId: gate.evidence.providerAcceptance.id, operationId, requestedByUserId: input.userId, createdAt: now, updatedAt: now });
      await tx.update(creatorPersonas).set({ state: "training", revision, updatedByUserId: input.userId, updatedAt: now }).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId), eq(creatorPersonas.revision, input.expectedRevision)));
      await tx.insert(creatorPersonaEvents).values({ workspaceId: input.workspaceId, personaId: input.personaId, revision, id: randomUUID(), type: "persona.training_requested", actorUserId: input.userId, facts: { jobId, operationId, provider: input.provider, model: input.model, modelVersion: input.modelVersion }, occurredAt: now });
      const result = { personaId: input.personaId, revision, state: "training", trainingJobId: jobId, operationId }; await this.receipt(tx, { actor: input, idempotencyKey: input.idempotencyKey, requestDigest, personaId: input.personaId, revision, result, createdAt: now }); return result;
    });
  }

  async resolveTraining(input: Actor & { personaId: string; expectedRevision: number; trainingJobId: string; outcome: "succeeded" | "failed_known" | "outcome_unknown" | "cancelled"; resultModelRef: string | null; failureCode: string | null; idempotencyKey: string }) {
    const requestDigest = canonicalDigest({ command: "resolve_training", ...input });
    return this.database.transaction(async (tx) => {
      const replay = await this.replay(tx, input, input.idempotencyKey, requestDigest); if (replay) return replay;
      const [persona] = await tx.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId))).limit(1);
      const [job] = await tx.select().from(creatorPersonaTrainingJobs).where(and(eq(creatorPersonaTrainingJobs.workspaceId, input.workspaceId), eq(creatorPersonaTrainingJobs.id, input.trainingJobId), eq(creatorPersonaTrainingJobs.personaId, input.personaId))).limit(1);
      if (!persona || !job) throw new CreatorPersonaError("TRAINING_JOB_NOT_FOUND"); if (persona.revision !== input.expectedRevision) throw new CreatorPersonaError("REVISION_CONFLICT"); if (!["queued", "admitted", "running", "waiting_provider", "outcome_unknown"].includes(job.state)) throw new CreatorPersonaError("TRAINING_ALREADY_RESOLVED");
      const now = this.now(), revision = persona.revision + 1, state = input.outcome === "succeeded" ? "review" : input.outcome === "failed_known" ? "training_failed" : input.outcome === "cancelled" ? "ready_to_train" : "training";
      await tx.update(creatorPersonaTrainingJobs).set({ state: input.outcome, resultModelRef: input.resultModelRef, failureCode: input.failureCode, updatedAt: now }).where(and(eq(creatorPersonaTrainingJobs.workspaceId, input.workspaceId), eq(creatorPersonaTrainingJobs.id, input.trainingJobId)));
      await tx.update(creatorPersonas).set({ state, reusableModelRef: input.outcome === "succeeded" ? input.resultModelRef : persona.reusableModelRef, revision, updatedByUserId: input.userId, updatedAt: now }).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId), eq(creatorPersonas.revision, input.expectedRevision)));
      await tx.insert(creatorPersonaEvents).values({ workspaceId: input.workspaceId, personaId: input.personaId, revision, id: randomUUID(), type: `persona.training_${input.outcome}`, actorUserId: input.userId, facts: { trainingJobId: input.trainingJobId, failureCode: input.failureCode }, occurredAt: now });
      const result = { personaId: input.personaId, revision, state, trainingJobId: input.trainingJobId, operationId: job.operationId }; await this.receipt(tx, { actor: input, idempotencyKey: input.idempotencyKey, requestDigest, personaId: input.personaId, revision, result, createdAt: now }); return result;
    });
  }

  async activate(input: Actor & { personaId: string; expectedRevision: number; idempotencyKey: string }) { return this.changeState({ ...input, command: "activate", requiredState: "review", nextState: "active", reasonCode: null }); }
  async suspend(input: Actor & { personaId: string; expectedRevision: number; reasonCode: string; idempotencyKey: string }) { return this.changeState({ ...input, command: "suspend", requiredState: null, nextState: "suspended", reasonCode: input.reasonCode }); }
  async delete(input: Actor & { personaId: string; expectedRevision: number; idempotencyKey: string }) { return this.changeState({ ...input, command: "delete", requiredState: null, nextState: "deleted", reasonCode: null }); }

  private async changeState(input: Actor & { personaId: string; expectedRevision: number; idempotencyKey: string; command: string; requiredState: string | null; nextState: string; reasonCode: string | null }) {
    const requestDigest = canonicalDigest(input);
    return this.database.transaction(async (tx) => {
      const replay = await this.replay(tx, input, input.idempotencyKey, requestDigest); if (replay) return replay;
      const [persona] = await tx.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId))).limit(1);
      if (!persona) throw new CreatorPersonaError("PERSONA_NOT_FOUND"); if (persona.revision !== input.expectedRevision) throw new CreatorPersonaError("REVISION_CONFLICT"); if (persona.state === "deleted" || (input.requiredState && persona.state !== input.requiredState)) throw new CreatorPersonaError("INVALID_STATE_TRANSITION");
      if (input.nextState === "active") {
        if (!persona.reusableModelRef) throw new CreatorPersonaError("TRAINED_MODEL_REQUIRED");
        const evidence = (await tx.select().from(creatorPersonaEvidence).where(and(eq(creatorPersonaEvidence.workspaceId, input.workspaceId), eq(creatorPersonaEvidence.personaId, input.personaId)))).map(hydrateEvidence);
        const gate = evaluatePersonaGate({ persona: hydratePersona(persona), evidence, at: this.now(), requireActive: false });
        if (!gate.admitted) throw new CreatorPersonaError("PERSONA_GATES_INCOMPLETE", gate.reasons.join(","));
      }
      const now = this.now(), revision = persona.revision + 1;
      await tx.update(creatorPersonas).set({ state: input.nextState, suspendedReasonCode: input.reasonCode, revision, updatedByUserId: input.userId, updatedAt: now, deletedAt: input.nextState === "deleted" ? now : null }).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId), eq(creatorPersonas.revision, input.expectedRevision)));
      await tx.insert(creatorPersonaEvents).values({ workspaceId: input.workspaceId, personaId: input.personaId, revision, id: randomUUID(), type: `persona.${input.command}`, actorUserId: input.userId, facts: { reasonCode: input.reasonCode }, occurredAt: now });
      const result = { personaId: input.personaId, revision, state: input.nextState }; await this.receipt(tx, { actor: input, idempotencyKey: input.idempotencyKey, requestDigest, personaId: input.personaId, revision, result, createdAt: now }); return result;
    });
  }

  async bindUsage(input: Actor & { personaId: string; expectedRevision: number; purpose: PersonaUsagePurpose; resourceId: string; idempotencyKey: string }) {
    const requestDigest = canonicalDigest({ command: "bind_usage", ...input });
    return this.database.transaction(async (tx) => {
      const replay = await this.replay(tx, input, input.idempotencyKey, requestDigest); if (replay) return replay;
      const [persona] = await tx.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId))).limit(1); if (!persona) throw new CreatorPersonaError("PERSONA_NOT_FOUND"); if (persona.revision !== input.expectedRevision) throw new CreatorPersonaError("REVISION_CONFLICT");
      const evidence = (await tx.select().from(creatorPersonaEvidence).where(and(eq(creatorPersonaEvidence.workspaceId, input.workspaceId), eq(creatorPersonaEvidence.personaId, input.personaId)))).map(hydrateEvidence); const gate = evaluatePersonaGate({ persona: hydratePersona(persona), evidence, at: this.now() }); if (!gate.admitted) throw new CreatorPersonaError("PERSONA_USAGE_DENIED", gate.reasons.join(","));
      const now = this.now(), revision = persona.revision + 1, usageId = randomUUID();
      await tx.insert(creatorPersonaUsages).values({ workspaceId: input.workspaceId, id: usageId, personaId: input.personaId, personaRevision: persona.revision, purpose: input.purpose, resourceId: input.resourceId, consentEvidenceId: gate.evidence.consent?.id ?? null, providerAcceptanceEvidenceId: gate.evidence.providerAcceptance!.id, disclosureEvidenceId: gate.evidence.disclosure!.id, disclosure: persona.disclosure, boundByUserId: input.userId, createdAt: now });
      await tx.update(creatorPersonas).set({ revision, updatedByUserId: input.userId, updatedAt: now }).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId), eq(creatorPersonas.revision, input.expectedRevision)));
      await tx.insert(creatorPersonaEvents).values({ workspaceId: input.workspaceId, personaId: input.personaId, revision, id: randomUUID(), type: "persona.usage_bound", actorUserId: input.userId, facts: { usageId, purpose: input.purpose, resourceId: input.resourceId }, occurredAt: now });
      const result = { personaId: input.personaId, revision, usageId, purpose: input.purpose, resourceId: input.resourceId }; await this.receipt(tx, { actor: input, idempotencyKey: input.idempotencyKey, requestDigest, personaId: input.personaId, revision, result, createdAt: now }); return result;
    });
  }
}
