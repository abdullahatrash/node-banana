import { createHmac } from "node:crypto";
import { evaluateReleaseReadiness, parseProductTelemetryEvent } from "./policy";
import { experimentSchema, releaseRecordInputSchema, type ReleaseRecordInput } from "./schemas";
import type { ReleaseControlRepository, StoredReleaseRecord } from "./repository";
import type { AccessibilityEvidence, ContractMigrationEvidence, ParityRequirement, PerformanceEvidence, PublicIncident, RecoveryObjective, ReleaseEvidence, ReleaseFlag, ReleaseReadinessDecision, RestoreDrillEvidence } from "./types";
import { verifyReleaseAttestation, type ReleaseAttestationKeyring } from "./attestation";
import type { ReleaseManifest } from "./manifest";

const dates = (value: Record<string, unknown>, keys: string[]): Record<string, unknown> => { const copy: Record<string, unknown> = { ...value }; for (const key of keys) if (typeof copy[key] === "string") copy[key] = new Date(copy[key] as string); return copy; };
const evidence = (value: Record<string, unknown>): ReleaseEvidence => dates(value, ["collectedAt", "expiresAt"]) as unknown as PerformanceEvidence | AccessibilityEvidence;
const flag = (value: Record<string, unknown>): ReleaseFlag => dates(value, ["createdAt", "expiresAt"]) as unknown as ReleaseFlag;
const incident = (value: Record<string, unknown>): PublicIncident => dates(value, ["startedAt", "resolvedAt"]) as unknown as PublicIncident;
const drill = (value: Record<string, unknown>): RestoreDrillEvidence => dates(value, ["startedAt", "completedAt", "expiresAt"]) as unknown as RestoreDrillEvidence;
const migration = (value: Record<string, unknown>): ContractMigrationEvidence => dates(value, ["observedAt", "expiresAt", "compatibilityWindowStartsAt", "compatibilityWindowEndsAt"]) as unknown as ContractMigrationEvidence;

function documentId(input: ReleaseRecordInput): string { return input.document.id; }
function documentBuild(input: ReleaseRecordInput): string | null { return "buildId" in input.document ? input.document.buildId : null; }
function documentExpiry(input: ReleaseRecordInput): Date | null { return "expiresAt" in input.document ? new Date(input.document.expiresAt) : null; }

function validateRecordSemantics(input: ReleaseRecordInput, userId: string): void {
  switch (input.recordKind) {
    case "evidence": if (new Date(input.document.expiresAt) <= new Date(input.document.collectedAt)) throw new TypeError("EVIDENCE_TIME_INVALID"); break;
    case "flag": if (input.document.ownerUserId !== userId) throw new TypeError("RELEASE_OWNER_MISMATCH"); if (new Date(input.document.expiresAt) <= new Date(input.document.createdAt)) throw new TypeError("FLAG_TIME_INVALID"); break;
    case "incident": if ((input.document.status === "resolved") !== Boolean(input.document.resolvedAt)) throw new TypeError("INCIDENT_STATE_INVALID"); break;
    case "recovery_objective": break;
    case "restore_drill": if (new Date(input.document.completedAt) < new Date(input.document.startedAt) || new Date(input.document.expiresAt) <= new Date(input.document.completedAt)) throw new TypeError("RESTORE_DRILL_TIME_INVALID"); break;
    case "contract_migration": if (new Date(input.document.expiresAt) <= new Date(input.document.observedAt) || new Date(input.document.compatibilityWindowEndsAt) <= new Date(input.document.compatibilityWindowStartsAt)) throw new TypeError("MIGRATION_TIME_INVALID"); break;
    case "parity_requirement": if (new Date(input.document.expiresAt) <= new Date(input.document.evaluatedAt)) throw new TypeError("PARITY_TIME_INVALID"); break;
    case "experiment": if (input.document.ownerUserId !== userId) throw new TypeError("RELEASE_OWNER_MISMATCH"); if (new Date(input.document.expiresAt) <= new Date(input.document.startsAt)) throw new TypeError("EXPERIMENT_TIME_INVALID"); break;
  }
}

export type PublicServiceStatus = "operational" | "degraded" | "majorOutage" | "criticalOutage" | "unknown";
export function derivePublicServiceStatus(incidents: Array<{ severity: "minor" | "major" | "critical"; status: string }>): PublicServiceStatus {
  const active = incidents.filter((item) => item.status !== "resolved");
  if (active.some((item) => item.severity === "critical")) return "criticalOutage";
  if (active.some((item) => item.severity === "major")) return "majorOutage";
  return active.length ? "degraded" : "operational";
}

export class ReleaseControlService {
  constructor(private readonly repository: ReleaseControlRepository, private readonly telemetrySecret: string, private readonly trust: { keyring?: ReleaseAttestationKeyring; manifest?: (workspaceId: string, now: Date) => ReleaseManifest; automationUserId?: string } = {}) {}
  async append(workspaceId: string, userId: string, value: unknown, idempotencyKey: string, now = new Date()) {
    const input = releaseRecordInputSchema.parse(value);
    if (["evidence", "recovery_objective", "restore_drill", "contract_migration", "parity_requirement"].includes(input.recordKind)) throw new TypeError("TRUSTED_ATTESTATION_REQUIRED");
    validateRecordSemantics(input, userId);
    return this.appendRecord(workspaceId, userId, input, idempotencyKey, now);
  }
  async appendAttested(value: unknown, idempotencyKey: string, now = new Date()) {
    if (!this.trust.automationUserId) throw new TypeError("RELEASE_AUTOMATION_USER_MISSING");
    const attestation = verifyReleaseAttestation(value, this.trust.keyring ?? {}, now); const input = attestation.record;
    validateRecordSemantics(input, this.trust.automationUserId);
    const document = { ...input.document, _attestation: attestation } as unknown as typeof input.document;
    return this.appendRecord(attestation.workspaceId, this.trust.automationUserId, { ...input, document } as ReleaseRecordInput, idempotencyKey, now);
  }
  private async appendRecord(workspaceId: string, userId: string, input: ReleaseRecordInput, idempotencyKey: string, now: Date) {
    if (input.recordKind === "contract_migration") {
      const requiredPredecessorPhase = input.document.phase === "migrate" ? "expand" : input.document.phase === "contract" ? "migrate" : null;
      if (!requiredPredecessorPhase && input.document.predecessorId) throw new TypeError("MIGRATION_PREDECESSOR_INVALID");
      if (requiredPredecessorPhase) {
        const records = await this.repository.listLatest(workspaceId, "contract_migration");
        const predecessor = records.find((record) => record.id === input.document.predecessorId)?.document;
        if (!predecessor || predecessor.phase !== requiredPredecessorPhase || predecessor.contract !== input.document.contract || predecessor.buildId !== input.document.buildId || predecessor.status !== "verified" || predecessor.compatibilityVerified !== true || predecessor.rollbackVerified !== true) throw new TypeError("MIGRATION_PREDECESSOR_UNVERIFIED");
      }
    }
    return this.repository.append({ workspaceId, kind: input.recordKind, id: documentId(input), buildId: documentBuild(input), document: input.document, expiresAt: documentExpiry(input), userId, idempotencyKey, now });
  }
  private subjectPseudonym(workspaceId: string, userId: string): string { return `sub_${createHmac("sha256", this.telemetrySecret).update(`telemetry-subject:${workspaceId}:${userId}`).digest("hex")}`; }
  async telemetry(workspaceId: string, userId: string, authContextId: string, regionClassification: "mena" | "non_mena" | "unknown", value: unknown, idempotencyKey: string, now = new Date()) {
    if (!value || typeof value !== "object" || Array.isArray(value) || ["workspacePseudonym", "sessionPseudonym", "consentRevision", "consentPurpose", "regionClassification"].some((key) => key in value)) throw new TypeError("TELEMETRY_NOT_ALLOWLISTED");
    const consent = await this.repository.getTelemetryConsent(workspaceId, userId); if (!consent || consent.status !== "active" || consent.purpose !== "product_analytics" || consent.expiresAt <= now) throw new TypeError("TELEMETRY_CONSENT_REQUIRED");
    const epoch = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const workspacePseudonym = `wsp_${createHmac("sha256", this.telemetrySecret).update(`workspace:${epoch}:${workspaceId}`).digest("hex")}`;
    const sessionPseudonym = `ses_${createHmac("sha256", this.telemetrySecret).update(`session:${epoch}:${authContextId}`).digest("hex")}`;
    const subjectPseudonym = this.subjectPseudonym(workspaceId, userId);
    const consentRevision = `consent_r${String(consent.revision).padStart(4, "0")}`;
    const event = parseProductTelemetryEvent({ ...value, workspacePseudonym, sessionPseudonym, consentRevision, consentPurpose: consent.purpose, regionClassification });
    if (event.occurredAt.getTime() > now.getTime() + 60_000 || event.occurredAt.getTime() < now.getTime() - 7 * 86_400_000) throw new TypeError("TELEMETRY_TIME_INVALID");
    if (event.name === "experiment_exposed" || event.name === "experiment_outcome") {
      const records = await this.repository.listLatest(workspaceId, "experiment"); const row = records.find((item) => item.id === event.properties.experimentId); if (!row) throw new TypeError("EXPERIMENT_NOT_ACTIVE");
      const experiment = experimentSchema.parse(row.document); if (experiment.status !== "active" || new Date(experiment.startsAt) > now || new Date(experiment.expiresAt) <= now) throw new TypeError("EXPERIMENT_NOT_ACTIVE");
      const assignment = await this.repository.getExperimentAssignment(workspaceId, experiment.id, subjectPseudonym); if (!assignment || assignment.assignmentRevision !== row.revision || assignment.expiresAt <= now) throw new TypeError("EXPERIMENT_ASSIGNMENT_REQUIRED");
      if (event.name === "experiment_exposed" && (event.properties.assignmentRevision !== assignment.assignmentRevision || event.properties.variant !== assignment.variant)) throw new TypeError("EXPERIMENT_ASSIGNMENT_MISMATCH");
      if (event.name === "experiment_outcome") {
        if (event.properties.assignmentRevision !== assignment.assignmentRevision || event.properties.metric !== experiment.metric) throw new TypeError("EXPERIMENT_METRIC_INVALID");
        const declared = new Set(experiment.guardrails.map((item) => item.metric)); const reported = event.properties.guardrailValues.map((item) => item.metric); if (reported.length !== declared.size || new Set(reported).size !== reported.length || reported.some((metric) => !declared.has(metric))) throw new TypeError("EXPERIMENT_GUARDRAIL_INVALID");
        if (!await this.repository.hasExperimentExposure({ workspaceId, experimentId: experiment.id, subjectPseudonym, assignmentRevision: assignment.assignmentRevision, exposureEventId: event.properties.exposureEventId })) throw new TypeError("EXPERIMENT_EXPOSURE_REQUIRED");
      }
    }
    const expiresAt = new Date(Math.min(consent.expiresAt.getTime(), now.getTime() + 90 * 86_400_000));
    return this.repository.appendTelemetry({ workspaceId, subjectPseudonym, event: event as unknown as Record<string, unknown>, idempotencyKey, now, expiresAt });
  }
  async assignExperiment(workspaceId: string, userId: string, experimentId: string, idempotencyKey: string, now = new Date()) {
    const records = await this.repository.listLatest(workspaceId, "experiment"); const row = records.find((item) => item.id === experimentId); if (!row) throw new TypeError("EXPERIMENT_NOT_ACTIVE");
    const experiment = experimentSchema.parse(row.document); const manifest = this.trust.manifest?.(workspaceId, now); if (!manifest || experiment.buildId !== manifest.buildId || experiment.status !== "active" || new Date(experiment.startsAt) > now || new Date(experiment.expiresAt) <= now) throw new TypeError("EXPERIMENT_NOT_ACTIVE");
    const subjectPseudonym = this.subjectPseudonym(workspaceId, userId); const bucket = Number.parseInt(createHmac("sha256", this.telemetrySecret).update(`experiment:${experiment.id}:${subjectPseudonym}:${row.revision}`).digest("hex").slice(0, 8), 16) % 10_000;
    const treatments = experiment.variants.filter((variant) => variant !== "control"); const variant = bucket < experiment.allocationPercent * 100 ? treatments[bucket % treatments.length]! : "control";
    return this.repository.assignExperiment({ workspaceId, experimentId, subjectPseudonym, assignmentRevision: row.revision, variant, expiresAt: new Date(experiment.expiresAt), idempotencyKey, now });
  }
  deleteExpiredTelemetry(now = new Date(), limit = 500) { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new TypeError("TELEMETRY_RETENTION_LIMIT_INVALID"); return this.repository.deleteExpiredTelemetry(now, limit); }
  getTelemetryConsent(workspaceId: string, userId: string) { return this.repository.getTelemetryConsent(workspaceId, userId); }
  setTelemetryConsent(workspaceId: string, userId: string, status: "active" | "revoked", requestedExpiry: Date, idempotencyKey: string, now = new Date()) { const max = new Date(now.getTime() + 366 * 86_400_000); if (!Number.isFinite(requestedExpiry.getTime()) || status === "active" && (requestedExpiry <= now || requestedExpiry > max)) throw new TypeError("TELEMETRY_CONSENT_EXPIRY_INVALID"); const expiresAt = status === "revoked" ? new Date(now.getTime() + 1) : requestedExpiry; return this.repository.setTelemetryConsent({ workspaceId, userId, subjectPseudonym: this.subjectPseudonym(workspaceId, userId), status, expiresAt, idempotencyKey, now }); }
  async snapshot(workspaceId: string) { const records = await this.repository.listLatest(workspaceId); return this.snapshotFrom(records); }
  async readiness(workspaceId: string, now = new Date()): Promise<ReleaseReadinessDecision> {
    let manifest: ReleaseManifest; try { if (!this.trust.manifest) throw new TypeError("RELEASE_MANIFEST_MISSING"); manifest = this.trust.manifest(workspaceId, now); } catch (cause) { return { schema: "release-readiness-decision/v1", buildId: "unconfigured", evaluatedAt: now, releasable: false, parityClaimAllowed: false, parityMatrix: { requiredCells: 0, passingCells: 0 }, blockers: [{ code: "RELEASE_MANIFEST_INVALID", subject: workspaceId, detail: cause instanceof Error ? cause.message : "RELEASE_MANIFEST_INVALID" }] }; }
    const records = await this.repository.listLatest(workspaceId); const trustedKinds = new Set(["evidence", "recovery_objective", "restore_drill", "contract_migration", "parity_requirement"]); const invalid: string[] = [];
    const admitted = records.filter((record) => { if (!trustedKinds.has(record.kind)) return true; try { const attestation = verifyReleaseAttestation(record.document._attestation, this.trust.keyring ?? {}, now); return attestation.workspaceId === workspaceId && attestation.record.recordKind === record.kind && attestation.record.document.id === record.id; } catch { invalid.push(`${record.kind}:${record.id}`); return false; } });
    const snapshot = this.snapshotFrom(admitted); const decision = evaluateReleaseReadiness({ buildId: manifest.buildId, evaluatedAt: now, requiredRoutes: manifest.requiredRoutes, supportedClients: manifest.supportedClients, performanceRequirements: manifest.performanceRequirements, requiredDataClasses: manifest.dataClasses, requiredContracts: manifest.contracts, requiredParityCells: manifest.parityMatrix.cells, evidence: snapshot.evidence, flags: snapshot.flags, incidents: snapshot.incidents, recoveryObjectives: snapshot.recoveryObjectives, restoreDrills: snapshot.restoreDrills, contractMigrations: snapshot.contractMigrations, parity: snapshot.parity });
    if (invalid.length) { decision.blockers.unshift(...invalid.map((subject) => ({ code: "ATTESTATION_INVALID" as const, subject, detail: "Trusted evidence has no valid current cryptographic attestation." }))); decision.releasable = false; decision.parityClaimAllowed = false; }
    return decision;
  }
  async publicIncidents(locale: "ar" | "en", statusWorkspaceId: string) { const rows = await this.repository.listPublicIncidents(statusWorkspaceId); return rows.map((row) => incident(row.document)).filter((item) => item.status !== "resolved" || (item.resolvedAt && item.resolvedAt.getTime() > Date.now() - 7 * 86_400_000)).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).map((item) => ({ id: item.id, severity: item.severity, status: item.status, impactedServices: item.impactedServices, startedAt: item.startedAt, resolvedAt: item.resolvedAt, summary: item.publicSummary[locale], operationOutcome: item.operationOutcome, creditRisk: item.creditRisk, publishingRisk: item.publishingRisk })); }
  private snapshotFrom(records: StoredReleaseRecord[]) { return { records, evidence: records.filter((r) => r.kind === "evidence").map((r) => evidence(r.document)), flags: records.filter((r) => r.kind === "flag").map((r) => flag(r.document)), incidents: records.filter((r) => r.kind === "incident").map((r) => incident(r.document)), recoveryObjectives: records.filter((r) => r.kind === "recovery_objective").map((r) => r.document as unknown as RecoveryObjective), restoreDrills: records.filter((r) => r.kind === "restore_drill").map((r) => drill(r.document)), contractMigrations: records.filter((r) => r.kind === "contract_migration").map((r) => migration(r.document)), parity: records.filter((r) => r.kind === "parity_requirement").map((r) => dates(r.document, ["evaluatedAt", "expiresAt"]) as unknown as ParityRequirement) }; }
}
