import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import {
  assets, creatorPersonaCommandReceipts, creatorPersonaEvidence, creatorPersonaEvents, socialAccounts,
  creatorPersonas, creatorPersonaTrainingAdmissions, creatorPersonaTrainingJobs, creatorPersonaTrainingSources, creatorPersonaUsages, workspaceProductRecords,
} from "@/lib/db/schema";
import { generationIntents } from "@/lib/model-routing/db-schema";
import { findCuratedModel } from "@/lib/model-routing/catalog";
import { parsePersonaTrainingAdmission, serializePersonaTrainingAdmission, type PersonaTrainingAdmissionPlan, type PersonaTrainingAdmissionSnapshot } from "./training-admission";
import { acceptedUseForPurpose, evaluatePersonaGate, parsePersonaModelRef, serializePersonaModelRef, type CreatorPersona, type CreatorPersonaEvidence, type PersonaReusableModelRef, type PersonaUsagePurpose } from "./types";

type Db = ReturnType<typeof getDb>;
type Actor = { workspaceId: string; userId: string };
export class CreatorPersonaError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "CreatorPersonaError"; }
}

const hydratePersona = (row: typeof creatorPersonas.$inferSelect): CreatorPersona => row as CreatorPersona;
const hydrateEvidence = (row: typeof creatorPersonaEvidence.$inferSelect): CreatorPersonaEvidence => row as CreatorPersonaEvidence;
const decimal = (value: number) => value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

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

  async getTrainingAdmissionContext(workspaceId: string, personaId: string) {
    const detail = await this.get(workspaceId, personaId);
    if (!detail) return null;
    const sources = await this.database.select({ assetId: creatorPersonaTrainingSources.assetId, mediaType: assets.type })
      .from(creatorPersonaTrainingSources)
      .innerJoin(assets, and(eq(assets.workspaceId, creatorPersonaTrainingSources.workspaceId), eq(assets.id, creatorPersonaTrainingSources.assetId)))
      .where(and(eq(creatorPersonaTrainingSources.workspaceId, workspaceId), eq(creatorPersonaTrainingSources.personaId, personaId)))
      .orderBy(asc(creatorPersonaTrainingSources.ordinal));
    const [failed] = await this.database.select({ id: creatorPersonaTrainingJobs.id })
      .from(creatorPersonaTrainingJobs)
      .where(and(eq(creatorPersonaTrainingJobs.workspaceId, workspaceId), eq(creatorPersonaTrainingJobs.personaId, personaId), eq(creatorPersonaTrainingJobs.state, "failed_known")))
      .orderBy(desc(creatorPersonaTrainingJobs.updatedAt), desc(creatorPersonaTrainingJobs.id)).limit(1);
    return { persona: detail.persona, evidence: detail.evidence, sources, latestFailedTrainingJobId: failed?.id ?? null };
  }

  async getTrainingAdmissionPlan(workspaceId: string, idempotencyKey: string): Promise<PersonaTrainingAdmissionPlan | null> {
    const [row] = await this.database.select().from(creatorPersonaTrainingAdmissions).where(and(eq(creatorPersonaTrainingAdmissions.workspaceId, workspaceId), eq(creatorPersonaTrainingAdmissions.idempotencyKey, idempotencyKey))).limit(1);
    return row ? { workspaceId: row.workspaceId, userId: row.createdByUserId, personaId: row.personaId, expectedRevision: row.expectedRevision, idempotencyKey: row.idempotencyKey, jobId: row.jobId, operationId: row.operationId, retryOfJobId: row.retryOfJobId, admission: parsePersonaTrainingAdmission(row.admissionSnapshot) } : null;
  }

  async createTrainingAdmissionPlan(input: PersonaTrainingAdmissionPlan): Promise<PersonaTrainingAdmissionPlan> {
    const requestDigest = canonicalDigest({ workspaceId: input.workspaceId, userId: input.userId, personaId: input.personaId, expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey });
    await this.database.insert(creatorPersonaTrainingAdmissions).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, personaId: input.personaId, expectedRevision: input.expectedRevision, jobId: input.jobId, operationId: input.operationId, requestDigest, admissionSnapshot: serializePersonaTrainingAdmission(input.admission), retryOfJobId: input.retryOfJobId, createdByUserId: input.userId, expiresAt: input.admission.quote.expiresAt, createdAt: input.admission.quote.quotedAt }).onConflictDoNothing();
    const persisted = await this.getTrainingAdmissionPlan(input.workspaceId, input.idempotencyKey);
    if (!persisted) throw new CreatorPersonaError("TRAINING_ADMISSION_PERSIST_FAILED");
    const persistedDigest = canonicalDigest({ workspaceId: persisted.workspaceId, userId: persisted.userId, personaId: persisted.personaId, expectedRevision: persisted.expectedRevision, idempotencyKey: persisted.idempotencyKey });
    if (persistedDigest !== requestDigest || persisted.jobId !== input.jobId) throw new CreatorPersonaError("IDEMPOTENCY_CONFLICT");
    return persisted;
  }

  async getAdmittedTrainingReplay(input: { workspaceId: string; userId: string; personaId: string; expectedRevision: number; idempotencyKey: string; jobId: string }) {
    const [receipt] = await this.database.select().from(creatorPersonaCommandReceipts).where(and(eq(creatorPersonaCommandReceipts.workspaceId, input.workspaceId), eq(creatorPersonaCommandReceipts.idempotencyKey, input.idempotencyKey), eq(creatorPersonaCommandReceipts.personaId, input.personaId))).limit(1);
    if (!receipt) return null;
    const [job] = await this.database.select().from(creatorPersonaTrainingJobs).where(and(eq(creatorPersonaTrainingJobs.workspaceId, input.workspaceId), eq(creatorPersonaTrainingJobs.id, input.jobId), eq(creatorPersonaTrainingJobs.personaId, input.personaId))).limit(1);
    if (!job || job.requestedByUserId !== input.userId || job.personaRevision !== input.expectedRevision + 1) throw new CreatorPersonaError("IDEMPOTENCY_CONFLICT");
    return receipt.result;
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

  async recordConsent(input: Actor & { personaId: string; expectedRevision: number; subjectReference: string; sourceAssetIds: string[]; allowedPurposes: Array<"training" | PersonaUsagePurpose>; geographies: string[]; effectiveAt: Date; expiresAt: Date; idempotencyKey: string }) {
    const uniqueIds = [...new Set(input.sourceAssetIds)];
    if (uniqueIds.length !== input.sourceAssetIds.length) throw new CreatorPersonaError("CONSENT_SOURCE_DUPLICATE");
    const rows = await this.database.select({ id: assets.id, checksum: assets.checksum, metadata: assets.metadata }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), inArray(assets.id, uniqueIds), isNull(assets.deletedAt)));
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (uniqueIds.some((id) => { const asset = byId.get(id); return !asset?.checksum || (asset.metadata as Record<string, unknown> | null)?.uploadState !== "ready"; })) throw new CreatorPersonaError("CONSENT_SOURCE_NOT_READY");
    const scope = { kind: "likeness_consent" as const, subjectReference: input.subjectReference, sourceAssetIds: uniqueIds, sourceDigests: uniqueIds.map((id) => ({ assetId: id, digest: byId.get(id)!.checksum })), allowedPurposes: input.allowedPurposes, geographies: input.geographies, revocable: true as const };
    return this.addEvidence({ workspaceId: input.workspaceId, userId: input.userId, personaId: input.personaId, expectedRevision: input.expectedRevision, issuer: "workspace_consent_officer", subjectDigest: canonicalDigest({ workspaceId: input.workspaceId, subjectReference: input.subjectReference }), evidenceDigest: canonicalDigest({ scope, effectiveAt: input.effectiveAt.toISOString(), expiresAt: input.expiresAt.toISOString() }), scope, effectiveAt: input.effectiveAt, expiresAt: input.expiresAt, idempotencyKey: input.idempotencyKey });
  }

  async revokeConsent(input: Actor & { personaId: string; expectedRevision: number; evidenceId: string; reasonCode: string; idempotencyKey: string }) {
    const requestDigest = canonicalDigest({ command: "revoke_consent", ...input });
    return this.database.transaction(async (tx) => {
      const replay = await this.replay(tx, input, input.idempotencyKey, requestDigest); if (replay) return replay;
      const [persona] = await tx.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId))).limit(1).for("update");
      const [evidence] = await tx.select().from(creatorPersonaEvidence).where(and(eq(creatorPersonaEvidence.workspaceId, input.workspaceId), eq(creatorPersonaEvidence.id, input.evidenceId), eq(creatorPersonaEvidence.personaId, input.personaId), eq(creatorPersonaEvidence.type, "likeness_consent"))).limit(1).for("update");
      if (!persona || !evidence) throw new CreatorPersonaError("CONSENT_EVIDENCE_NOT_FOUND");
      if (persona.revision !== input.expectedRevision) throw new CreatorPersonaError("REVISION_CONFLICT");
      if (persona.state === "deleted") throw new CreatorPersonaError("PERSONA_NOT_MUTABLE");
      if (evidence.revokedAt) throw new CreatorPersonaError("CONSENT_ALREADY_REVOKED");
      const now = this.now(), revision = persona.revision + 1;
      await tx.update(creatorPersonaEvidence).set({ revokedAt: now }).where(and(eq(creatorPersonaEvidence.workspaceId, input.workspaceId), eq(creatorPersonaEvidence.id, input.evidenceId), isNull(creatorPersonaEvidence.revokedAt)));
      await tx.update(creatorPersonaTrainingJobs).set({ state: "failed_known", failureCode: "CONSENT_REVOKED", updatedAt: now }).where(and(eq(creatorPersonaTrainingJobs.workspaceId, input.workspaceId), eq(creatorPersonaTrainingJobs.personaId, input.personaId), inArray(creatorPersonaTrainingJobs.state, ["queued", "admitted", "running", "waiting_provider", "outcome_unknown"])));
      await tx.update(creatorPersonas).set({ state: "consent_expired", revision, updatedByUserId: input.userId, updatedAt: now }).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId), eq(creatorPersonas.revision, input.expectedRevision)));
      await tx.insert(creatorPersonaEvents).values({ workspaceId: input.workspaceId, personaId: input.personaId, revision, id: randomUUID(), type: "persona.consent_revoked", actorUserId: input.userId, facts: { evidenceId: input.evidenceId, reasonCode: input.reasonCode, futureUseBlocked: true }, occurredAt: now });
      const result = { personaId: input.personaId, evidenceId: input.evidenceId, revision, state: "consent_expired", futureUseBlocked: true };
      await this.receipt(tx, { actor: input, idempotencyKey: input.idempotencyKey, requestDigest, personaId: input.personaId, revision, result, createdAt: now }); return result;
    });
  }

  async materializeExpiredConsents(input: { at: Date; limit?: number }) {
    return this.database.transaction(async (tx) => {
      const candidates = await tx.select().from(creatorPersonas).where(and(
        sql`${creatorPersonas.state} not in ('deleted', 'consent_expired')`,
        or(
          lte(creatorPersonas.retentionUntil, input.at),
          and(eq(creatorPersonas.kind, "consented_likeness"), sql`not exists (
            select 1 from ${creatorPersonaEvidence} evidence
            where evidence.workspace_id = ${creatorPersonas.workspaceId}
              and evidence.persona_id = ${creatorPersonas.id}
              and evidence.type = 'likeness_consent'
              and evidence.revoked_at is null
              and evidence.effective_at <= ${input.at}
              and evidence.expires_at > ${input.at}
          )`),
        ),
      )).orderBy(asc(creatorPersonas.updatedAt), asc(creatorPersonas.id)).limit(Math.min(input.limit ?? 100, 100)).for("update", { skipLocked: true });
      for (const persona of candidates) {
        const revision = persona.revision + 1;
        const reasonCode = persona.retentionUntil <= input.at ? "RETENTION_EXPIRED" : "CONSENT_EXPIRED";
        await tx.update(creatorPersonaTrainingJobs).set({ state: "failed_known", failureCode: reasonCode, updatedAt: input.at }).where(and(eq(creatorPersonaTrainingJobs.workspaceId, persona.workspaceId), eq(creatorPersonaTrainingJobs.personaId, persona.id), inArray(creatorPersonaTrainingJobs.state, ["queued", "admitted", "running", "waiting_provider", "outcome_unknown"])));
        await tx.update(creatorPersonas).set({ state: "consent_expired", revision, updatedAt: input.at }).where(and(eq(creatorPersonas.workspaceId, persona.workspaceId), eq(creatorPersonas.id, persona.id), eq(creatorPersonas.revision, persona.revision)));
        await tx.insert(creatorPersonaEvents).values({ workspaceId: persona.workspaceId, personaId: persona.id, revision, id: randomUUID(), type: "persona.consent_expired", actorUserId: null, facts: { reasonCode, futureUseBlocked: true, materializedBy: "persona-training-dispatch" }, occurredAt: input.at });
      }
      return { materialized: candidates.length };
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
      if (new Set(input.assetIds).size !== input.assetIds.length || input.assetIds.some((assetId) => { const asset = byId.get(assetId); const uploadState = (asset?.metadata as Record<string, unknown> | null)?.uploadState; return !asset || !asset.checksum || !asset.sizeBytes || !["image", "video"].includes(asset.type) || uploadState !== "ready"; })) throw new CreatorPersonaError("TRAINING_SOURCE_NOT_READY");
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

  async requestAdmittedTraining(input: Actor & { personaId: string; expectedRevision: number; jobId: string; operationId: string; retryOfJobId: string | null; admission: PersonaTrainingAdmissionSnapshot; idempotencyKey: string }) {
    const requestDigest = canonicalDigest({ command: "request_training", ...input });
    return this.database.transaction(async (tx) => {
      const replay = await this.replay(tx, input, input.idempotencyKey, requestDigest); if (replay) return replay;
      const [persona] = await tx.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId))).limit(1);
      if (!persona) throw new CreatorPersonaError("PERSONA_NOT_FOUND"); if (persona.revision !== input.expectedRevision) throw new CreatorPersonaError("REVISION_CONFLICT"); if (!["ready_to_train", "training_failed"].includes(persona.state)) throw new CreatorPersonaError("PERSONA_NOT_READY_TO_TRAIN");
      const evidence = (await tx.select().from(creatorPersonaEvidence).where(and(eq(creatorPersonaEvidence.workspaceId, input.workspaceId), eq(creatorPersonaEvidence.personaId, input.personaId)))).map(hydrateEvidence);
      const now = this.now();
      const gate = evaluatePersonaGate({ persona: hydratePersona(persona), evidence, at: now, requireActive: false }); if (!gate.admitted) throw new CreatorPersonaError("PERSONA_GATES_INCOMPLETE", gate.reasons.join(","));
      const qualification = input.admission.qualification;
      if (gate.evidence.providerAcceptance?.id !== input.admission.providerAcceptanceEvidenceId || gate.evidence.providerAcceptance.provider !== qualification.provider) throw new CreatorPersonaError("PROVIDER_ACCEPTANCE_MISMATCH");
      const acceptanceScope = gate.evidence.providerAcceptance.scope;
      if (acceptanceScope.model !== qualification.model || acceptanceScope.modelVersion !== qualification.version || acceptanceScope.inputSchemaDigest !== qualification.inputSchemaDigest || acceptanceScope.qualificationDigest !== qualification.digest || !Array.isArray(acceptanceScope.acceptedUses) || !acceptanceScope.acceptedUses.includes("training")) throw new CreatorPersonaError("PROVIDER_ACCEPTANCE_MISMATCH");
      if (input.admission.quote.currency !== "USD" || input.admission.quote.basis !== "run" || input.admission.quote.quantity !== 1 || input.admission.quote.amount !== qualification.priceUsd.amount || input.admission.reservationIds.length === 0) throw new CreatorPersonaError("TRAINING_QUOTE_INVALID");
      if (new Date(qualification.expiresAt) <= now || input.admission.quote.expiresAt <= now || input.admission.regionAdmission.evidenceExpiresAt <= now || !qualification.verifiedRegions.includes(input.admission.regionAdmission.region)) throw new CreatorPersonaError("TRAINING_ADMISSION_EXPIRED");
      const sources = await tx.select({ assetId: creatorPersonaTrainingSources.assetId, mediaType: assets.type, checksum: assets.checksum, expectedChecksum: creatorPersonaTrainingSources.assetChecksum, deletedAt: assets.deletedAt, uploadState: assets.metadata })
        .from(creatorPersonaTrainingSources).innerJoin(assets, and(eq(assets.workspaceId, creatorPersonaTrainingSources.workspaceId), eq(assets.id, creatorPersonaTrainingSources.assetId)))
        .where(and(eq(creatorPersonaTrainingSources.workspaceId, input.workspaceId), eq(creatorPersonaTrainingSources.personaId, input.personaId))).orderBy(asc(creatorPersonaTrainingSources.ordinal));
      if (sources.length < qualification.sourceContract.minimum || sources.length > qualification.sourceContract.maximum || sources.some((source) => !qualification.sourceContract.mediaTypes.includes(source.mediaType as "image" | "video") || source.deletedAt || source.checksum !== source.expectedChecksum || (source.uploadState as Record<string, unknown> | null)?.uploadState !== "ready")) throw new CreatorPersonaError("TRAINING_SOURCES_INVALID");
      if (persona.state === "training_failed") {
        const [latestFailed] = await tx.select({ id: creatorPersonaTrainingJobs.id }).from(creatorPersonaTrainingJobs).where(and(eq(creatorPersonaTrainingJobs.workspaceId, input.workspaceId), eq(creatorPersonaTrainingJobs.personaId, input.personaId), eq(creatorPersonaTrainingJobs.state, "failed_known"))).orderBy(desc(creatorPersonaTrainingJobs.updatedAt), desc(creatorPersonaTrainingJobs.id)).limit(1);
        if (!latestFailed || latestFailed.id !== input.retryOfJobId) throw new CreatorPersonaError("TRAINING_RETRY_LINEAGE_CHANGED");
      } else if (input.retryOfJobId) throw new CreatorPersonaError("TRAINING_RETRY_NOT_ALLOWED");
      const revision = persona.revision + 1;
      await tx.insert(creatorPersonaTrainingJobs).values({
        workspaceId: input.workspaceId, id: input.jobId, personaId: input.personaId, personaRevision: revision, state: "queued",
        provider: qualification.provider, model: qualification.model, modelVersion: qualification.version, qualificationDigest: qualification.digest,
        inputSchemaDigest: qualification.inputSchemaDigest, qualificationId: qualification.id, qualificationRevision: qualification.revision,
        qualificationExpiresAt: new Date(qualification.expiresAt), qualificationSnapshot: qualification,
        quoteAmountUsd: decimal(qualification.priceUsd.amount), quoteExpiresAt: input.admission.quote.expiresAt, reservationIds: input.admission.reservationIds,
        regionPolicyId: input.admission.regionAdmission.policyId, regionPolicyVersion: input.admission.regionAdmission.policyVersion,
        regionEvidenceDigest: input.admission.regionAdmission.evidenceDigest, region: input.admission.regionAdmission.region,
        regionRouteId: input.admission.regionAdmission.routeId, regionEvidenceExpiresAt: input.admission.regionAdmission.evidenceExpiresAt,
        retryOfJobId: input.retryOfJobId, providerAcceptanceEvidenceId: gate.evidence.providerAcceptance.id, operationId: input.operationId,
        requestedByUserId: input.userId, createdAt: now, updatedAt: now,
      });
      await tx.update(creatorPersonas).set({ state: "training", revision, updatedByUserId: input.userId, updatedAt: now }).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId), eq(creatorPersonas.revision, input.expectedRevision)));
      await tx.insert(creatorPersonaEvents).values({ workspaceId: input.workspaceId, personaId: input.personaId, revision, id: randomUUID(), type: input.retryOfJobId ? "persona.training_retried" : "persona.training_requested", actorUserId: input.userId, facts: { jobId: input.jobId, operationId: input.operationId, retryOfJobId: input.retryOfJobId, provider: qualification.provider, model: qualification.model, modelVersion: qualification.version, qualificationId: qualification.id, qualificationRevision: qualification.revision, quoteAmountUsd: decimal(input.admission.quote.amount), reservationIds: input.admission.reservationIds, region: input.admission.regionAdmission.region, regionEvidenceDigest: input.admission.regionAdmission.evidenceDigest }, occurredAt: now });
      const result = { personaId: input.personaId, revision, state: "training", trainingJobId: input.jobId, operationId: input.operationId, retryOfJobId: input.retryOfJobId }; await this.receipt(tx, { actor: input, idempotencyKey: input.idempotencyKey, requestDigest, personaId: input.personaId, revision, result, createdAt: now }); return result;
    });
  }

  async resolveTraining(input: Actor & { personaId: string; expectedRevision: number; trainingJobId: string; outcome: "succeeded" | "failed_known" | "outcome_unknown" | "cancelled"; resultModelRef: PersonaReusableModelRef | null; failureCode: string | null; idempotencyKey: string }) {
    const requestDigest = canonicalDigest({ command: "resolve_training", ...input });
    return this.database.transaction(async (tx) => {
      const replay = await this.replay(tx, input, input.idempotencyKey, requestDigest); if (replay) return replay;
      const [persona] = await tx.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId))).limit(1);
      const [job] = await tx.select().from(creatorPersonaTrainingJobs).where(and(eq(creatorPersonaTrainingJobs.workspaceId, input.workspaceId), eq(creatorPersonaTrainingJobs.id, input.trainingJobId), eq(creatorPersonaTrainingJobs.personaId, input.personaId))).limit(1);
      if (!persona || !job) throw new CreatorPersonaError("TRAINING_JOB_NOT_FOUND"); if (persona.revision !== input.expectedRevision) throw new CreatorPersonaError("REVISION_CONFLICT"); if (!["queued", "admitted", "running", "waiting_provider", "outcome_unknown"].includes(job.state)) throw new CreatorPersonaError("TRAINING_ALREADY_RESOLVED");
      if (input.outcome === "succeeded") {
        if (!input.resultModelRef || input.resultModelRef.trainingJobId !== job.id || input.resultModelRef.provider !== job.provider) throw new CreatorPersonaError("TRAINED_MODEL_REF_MISMATCH");
        const qualified = findCuratedModel(input.resultModelRef);
        if (!qualified || qualified.qualification.status !== "qualified" || qualified.qualification.evidence.digest !== input.resultModelRef.qualificationDigest) throw new CreatorPersonaError("TRAINED_MODEL_NOT_QUALIFIED");
      }
      const now = this.now(), revision = persona.revision + 1, state = input.outcome === "succeeded" ? "review" : input.outcome === "failed_known" ? "training_failed" : input.outcome === "cancelled" ? "ready_to_train" : "training";
      const encodedModelRef = input.resultModelRef ? serializePersonaModelRef(input.resultModelRef) : null;
      await tx.update(creatorPersonaTrainingJobs).set({ state: input.outcome, resultModelRef: encodedModelRef, failureCode: input.failureCode, updatedAt: now }).where(and(eq(creatorPersonaTrainingJobs.workspaceId, input.workspaceId), eq(creatorPersonaTrainingJobs.id, input.trainingJobId)));
      await tx.update(creatorPersonas).set({ state, reusableModelRef: input.outcome === "succeeded" ? encodedModelRef : persona.reusableModelRef, revision, updatedByUserId: input.userId, updatedAt: now }).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId), eq(creatorPersonas.revision, input.expectedRevision)));
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
        const model = parsePersonaModelRef(persona.reusableModelRef);
        if (!model) throw new CreatorPersonaError("TRAINED_MODEL_REQUIRED");
        const qualified = findCuratedModel(model);
        if (!qualified || qualified.qualification.status !== "qualified" || qualified.qualification.evidence.digest !== model.qualificationDigest) throw new CreatorPersonaError("TRAINED_MODEL_NOT_QUALIFIED");
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
      const model = parsePersonaModelRef(persona.reusableModelRef); if (!model) throw new CreatorPersonaError("TRAINED_MODEL_REQUIRED");
      const acceptance = gate.evidence.providerAcceptance!; const scope = acceptance.scope;
      if (scope.provider !== model.provider || scope.model !== model.model || scope.modelVersion !== model.version || scope.qualificationDigest !== model.qualificationDigest || !Array.isArray(scope.acceptedUses) || !scope.acceptedUses.includes(acceptedUseForPurpose(input.purpose))) throw new CreatorPersonaError("PERSONA_USE_NOT_ACCEPTED");
      if (!(await this.resourceExists(tx, input.workspaceId, input.purpose, input.resourceId))) throw new CreatorPersonaError("PERSONA_RESOURCE_NOT_FOUND");
      const now = this.now(), revision = persona.revision + 1, usageId = randomUUID();
      await tx.insert(creatorPersonaUsages).values({ workspaceId: input.workspaceId, id: usageId, personaId: input.personaId, personaRevision: persona.revision, purpose: input.purpose, resourceId: input.resourceId, consentEvidenceId: gate.evidence.consent?.id ?? null, providerAcceptanceEvidenceId: gate.evidence.providerAcceptance!.id, disclosureEvidenceId: gate.evidence.disclosure!.id, disclosure: persona.disclosure, boundByUserId: input.userId, createdAt: now });
      await tx.update(creatorPersonas).set({ revision, updatedByUserId: input.userId, updatedAt: now }).where(and(eq(creatorPersonas.workspaceId, input.workspaceId), eq(creatorPersonas.id, input.personaId), eq(creatorPersonas.revision, input.expectedRevision)));
      await tx.insert(creatorPersonaEvents).values({ workspaceId: input.workspaceId, personaId: input.personaId, revision, id: randomUUID(), type: "persona.usage_bound", actorUserId: input.userId, facts: { usageId, purpose: input.purpose, resourceId: input.resourceId }, occurredAt: now });
      const result = { personaId: input.personaId, revision, usageId, purpose: input.purpose, resourceId: input.resourceId }; await this.receipt(tx, { actor: input, idempotencyKey: input.idempotencyKey, requestDigest, personaId: input.personaId, revision, result, createdAt: now }); return result;
    });
  }

  private async resourceExists(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], workspaceId: string, purpose: PersonaUsagePurpose, resourceId: string) {
    if (purpose === "generation") return Boolean((await tx.select({ id: generationIntents.id }).from(generationIntents).where(and(eq(generationIntents.workspaceId, workspaceId), eq(generationIntents.id, resourceId))).limit(1))[0]);
    if (purpose === "channel") return Boolean((await tx.select({ id: socialAccounts.id }).from(socialAccounts).where(and(eq(socialAccounts.workspaceId, workspaceId), eq(socialAccounts.id, resourceId), eq(socialAccounts.disabled, false))).limit(1))[0]);
    const kind = purpose === "content_set" ? "media_set" : "blitz_item";
    return Boolean((await tx.select({ id: workspaceProductRecords.id }).from(workspaceProductRecords).where(and(eq(workspaceProductRecords.workspaceId, workspaceId), eq(workspaceProductRecords.id, resourceId), eq(workspaceProductRecords.kind, kind), isNull(workspaceProductRecords.archivedAt))).limit(1))[0]);
  }

  async resolveUsage(input: { workspaceId: string; personaId: string; purpose: PersonaUsagePurpose; resourceId: string }) {
    const detail = await this.get(input.workspaceId, input.personaId); if (!detail) throw new CreatorPersonaError("PERSONA_NOT_FOUND");
    const usage = detail.usages.find((item) => item.purpose === input.purpose && item.resourceId === input.resourceId); if (!usage) throw new CreatorPersonaError("PERSONA_USAGE_NOT_BOUND");
    return { ...(await this.prepareUsage({ workspaceId: input.workspaceId, personaId: input.personaId, purpose: input.purpose })), usageId: usage.id, resourceId: input.resourceId };
  }

  async prepareUsage(input: { workspaceId: string; personaId: string; purpose: PersonaUsagePurpose }) {
    const detail = await this.get(input.workspaceId, input.personaId); if (!detail) throw new CreatorPersonaError("PERSONA_NOT_FOUND");
    const gate = evaluatePersonaGate({ persona: detail.persona, evidence: detail.evidence, at: this.now() }); if (!gate.admitted) throw new CreatorPersonaError("PERSONA_USAGE_DENIED", gate.reasons.join(","));
    const model = parsePersonaModelRef(detail.persona.reusableModelRef); if (!model) throw new CreatorPersonaError("TRAINED_MODEL_REQUIRED");
    const scope = gate.evidence.providerAcceptance!.scope;
    if (scope.provider !== model.provider || scope.model !== model.model || scope.modelVersion !== model.version || scope.qualificationDigest !== model.qualificationDigest || !Array.isArray(scope.acceptedUses) || !scope.acceptedUses.includes(acceptedUseForPurpose(input.purpose))) throw new CreatorPersonaError("PERSONA_USE_NOT_ACCEPTED");
    return { personaId: detail.persona.id, personaRevision: detail.persona.revision, purpose: input.purpose, model, disclosure: detail.persona.disclosure, evidence: { consentEvidenceId: gate.evidence.consent?.id ?? null, providerAcceptanceEvidenceId: gate.evidence.providerAcceptance!.id, disclosureEvidenceId: gate.evidence.disclosure!.id, abuseReviewEvidenceId: gate.evidence.abuseReview!.id } };
  }

  async claimTrainingDispatch(input: { at: Date; staleBefore: Date }) {
    return this.database.transaction(async (tx) => {
      const [job] = await tx.select().from(creatorPersonaTrainingJobs).where(or(
        eq(creatorPersonaTrainingJobs.state, "queued"),
        and(inArray(creatorPersonaTrainingJobs.state, ["admitted", "running", "waiting_provider", "outcome_unknown"]), lte(creatorPersonaTrainingJobs.updatedAt, input.staleBefore)),
      )).orderBy(asc(creatorPersonaTrainingJobs.updatedAt), asc(creatorPersonaTrainingJobs.id)).limit(1).for("update", { skipLocked: true });
      if (!job) return null;
      const [persona] = await tx.select().from(creatorPersonas).where(and(eq(creatorPersonas.workspaceId, job.workspaceId), eq(creatorPersonas.id, job.personaId))).limit(1);
      if (!persona || persona.state !== "training" || persona.revision !== job.personaRevision) {
        await tx.update(creatorPersonaTrainingJobs).set({ state: "failed_known", failureCode: "PERSONA_REVISION_DIVERGED", updatedAt: input.at }).where(and(eq(creatorPersonaTrainingJobs.workspaceId, job.workspaceId), eq(creatorPersonaTrainingJobs.id, job.id)));
        return null;
      }
      const sources = await tx.select({ assetId: creatorPersonaTrainingSources.assetId, ordinal: creatorPersonaTrainingSources.ordinal, expectedChecksum: creatorPersonaTrainingSources.assetChecksum, checksum: assets.checksum, storageProvider: assets.storageProvider, storageKey: assets.storageKey, deletedAt: assets.deletedAt, metadata: assets.metadata }).from(creatorPersonaTrainingSources).innerJoin(assets, and(eq(assets.workspaceId, creatorPersonaTrainingSources.workspaceId), eq(assets.id, creatorPersonaTrainingSources.assetId))).where(and(eq(creatorPersonaTrainingSources.workspaceId, job.workspaceId), eq(creatorPersonaTrainingSources.personaId, job.personaId))).orderBy(asc(creatorPersonaTrainingSources.ordinal));
      const invalid = sources.length < 3 || sources.some((source) => source.deletedAt || source.storageProvider !== "s3" || !source.storageKey || source.checksum !== source.expectedChecksum || (source.metadata as Record<string, unknown> | null)?.uploadState !== "ready");
      if (invalid) {
        await tx.update(creatorPersonaTrainingJobs).set({ state: "running", updatedAt: input.at }).where(and(eq(creatorPersonaTrainingJobs.workspaceId, job.workspaceId), eq(creatorPersonaTrainingJobs.id, job.id), eq(creatorPersonaTrainingJobs.state, job.state)));
        return { ...job, previousState: job.state, state: "running" as const, sources, invalidFailureCode: "TRAINING_SOURCE_CHANGED" as const };
      }
      await tx.update(creatorPersonaTrainingJobs).set({ state: "running", updatedAt: input.at }).where(and(eq(creatorPersonaTrainingJobs.workspaceId, job.workspaceId), eq(creatorPersonaTrainingJobs.id, job.id), eq(creatorPersonaTrainingJobs.state, job.state)));
      return { ...job, previousState: job.state, state: "running" as const, sources, invalidFailureCode: null };
    });
  }

  async recordProviderTraining(input: { workspaceId: string; trainingJobId: string; providerJobRef: string; at: Date }) {
    await this.database.update(creatorPersonaTrainingJobs).set({ state: "waiting_provider", providerJobRef: input.providerJobRef, updatedAt: input.at }).where(and(eq(creatorPersonaTrainingJobs.workspaceId, input.workspaceId), eq(creatorPersonaTrainingJobs.id, input.trainingJobId), inArray(creatorPersonaTrainingJobs.state, ["running", "outcome_unknown", "waiting_provider"])));
  }

  async markTrainingOutcomeUnknown(input: { workspaceId: string; trainingJobId: string; failureCode: string; at: Date }) {
    await this.database.update(creatorPersonaTrainingJobs).set({ state: "outcome_unknown", failureCode: input.failureCode, updatedAt: input.at }).where(and(eq(creatorPersonaTrainingJobs.workspaceId, input.workspaceId), eq(creatorPersonaTrainingJobs.id, input.trainingJobId), inArray(creatorPersonaTrainingJobs.state, ["running", "admitted", "waiting_provider", "outcome_unknown"])));
  }
}
