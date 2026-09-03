import { createHmac } from "node:crypto";
import { ProductTelemetryEventSchema, evaluateReleaseReadiness } from "./policy";
import { releaseRecordInputSchema, type ReleaseRecordInput } from "./schemas";
import type { ReleaseControlRepository, StoredReleaseRecord } from "./repository";
import type { AccessibilityEvidence, ContractMigrationEvidence, ParityRequirement, PerformanceEvidence, PublicIncident, RecoveryObjective, ReleaseEvidence, ReleaseFlag, ReleaseReadinessDecision, RestoreDrillEvidence } from "./types";

const dates = (value: Record<string, unknown>, keys: string[]): Record<string, unknown> => { const copy: Record<string, unknown> = { ...value }; for (const key of keys) if (typeof copy[key] === "string") copy[key] = new Date(copy[key] as string); return copy; };
const evidence = (value: Record<string, unknown>): ReleaseEvidence => dates(value, ["collectedAt", "expiresAt"]) as unknown as PerformanceEvidence | AccessibilityEvidence;
const flag = (value: Record<string, unknown>): ReleaseFlag => dates(value, ["createdAt", "expiresAt"]) as unknown as ReleaseFlag;
const incident = (value: Record<string, unknown>): PublicIncident => dates(value, ["startedAt", "resolvedAt"]) as unknown as PublicIncident;
const drill = (value: Record<string, unknown>): RestoreDrillEvidence => dates(value, ["startedAt", "completedAt", "expiresAt"]) as unknown as RestoreDrillEvidence;
const migration = (value: Record<string, unknown>): ContractMigrationEvidence => dates(value, ["observedAt", "expiresAt"]) as unknown as ContractMigrationEvidence;

function documentId(input: ReleaseRecordInput): string { return input.document.id; }
function documentBuild(input: ReleaseRecordInput): string | null { return "buildId" in input.document ? input.document.buildId : null; }
function documentExpiry(input: ReleaseRecordInput): Date | null { return "expiresAt" in input.document ? new Date(input.document.expiresAt) : null; }

export class ReleaseControlService {
  constructor(private readonly repository: ReleaseControlRepository, private readonly telemetrySecret: string) {}
  async append(workspaceId: string, userId: string, value: unknown, idempotencyKey: string, now = new Date()) {
    const input = releaseRecordInputSchema.parse(value);
    return this.repository.append({ workspaceId, kind: input.recordKind, id: documentId(input), buildId: documentBuild(input), document: input.document, expiresAt: documentExpiry(input), userId, idempotencyKey, now });
  }
  async telemetry(workspaceId: string, value: unknown, idempotencyKey: string, now = new Date()) {
    if (!value || typeof value !== "object" || Array.isArray(value) || "workspacePseudonym" in value) throw new TypeError("TELEMETRY_NOT_ALLOWLISTED");
    const workspacePseudonym = `wsp_${createHmac("sha256", this.telemetrySecret).update(workspaceId).digest("hex")}`;
    const event = ProductTelemetryEventSchema.parse({ ...value, workspacePseudonym });
    if (event.occurredAt.getTime() > now.getTime() + 60_000 || event.occurredAt.getTime() < now.getTime() - 7 * 86_400_000) throw new TypeError("TELEMETRY_TIME_INVALID");
    return this.repository.appendTelemetry({ workspaceId, event: event as unknown as Record<string, unknown>, idempotencyKey, now });
  }
  async snapshot(workspaceId: string) { const records = await this.repository.listLatest(workspaceId); return this.snapshotFrom(records); }
  async readiness(workspaceId: string, buildId: string, requiredRoutes: string[], supportedClients: string[], now = new Date()): Promise<ReleaseReadinessDecision> {
    const snapshot = await this.snapshot(workspaceId);
    return evaluateReleaseReadiness({ buildId, evaluatedAt: now, requiredRoutes, supportedClients, evidence: snapshot.evidence, flags: snapshot.flags, incidents: snapshot.incidents, recoveryObjectives: snapshot.recoveryObjectives, restoreDrills: snapshot.restoreDrills, contractMigrations: snapshot.contractMigrations, parity: snapshot.parity });
  }
  async publicIncidents(locale: "ar" | "en") { const rows = await this.repository.listPublicIncidents(); return rows.map((row) => incident(row.document)).filter((item) => item.status !== "resolved" || (item.resolvedAt && item.resolvedAt.getTime() > Date.now() - 7 * 86_400_000)).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).map((item) => ({ id: item.id, severity: item.severity, status: item.status, impactedServices: item.impactedServices, startedAt: item.startedAt, resolvedAt: item.resolvedAt, summary: item.publicSummary[locale] })); }
  private snapshotFrom(records: StoredReleaseRecord[]) { return { records, evidence: records.filter((r) => r.kind === "evidence").map((r) => evidence(r.document)), flags: records.filter((r) => r.kind === "flag").map((r) => flag(r.document)), incidents: records.filter((r) => r.kind === "incident").map((r) => incident(r.document)), recoveryObjectives: records.filter((r) => r.kind === "recovery_objective").map((r) => r.document as unknown as RecoveryObjective), restoreDrills: records.filter((r) => r.kind === "restore_drill").map((r) => drill(r.document)), contractMigrations: records.filter((r) => r.kind === "contract_migration").map((r) => migration(r.document)), parity: records.filter((r) => r.kind === "parity_requirement").map((r) => r.document as unknown as ParityRequirement) }; }
}
