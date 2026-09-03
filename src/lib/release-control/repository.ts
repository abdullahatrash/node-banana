import { createHash } from "node:crypto";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { experimentAssignments, productTelemetryConsents, productTelemetryEvents, releaseControlMutationReceipts, releaseControlRecords } from "./db-schema";

type Db = ReturnType<typeof getDb>;
export type ReleaseRecordKind = "evidence" | "flag" | "incident" | "recovery_objective" | "restore_drill" | "contract_migration" | "parity_requirement" | "experiment";
export interface StoredReleaseRecord { workspaceId: string; kind: ReleaseRecordKind; id: string; revision: number; buildId: string | null; document: Record<string, unknown>; createdByUserId: string; createdAt: Date; expiresAt: Date | null }
export interface TelemetryConsent { schema: "product-telemetry-consent/v1"; workspaceId: string; userId: string; revision: number; purpose: "product_analytics"; status: "active" | "revoked"; issuedAt: Date; expiresAt: Date }
export interface ExperimentAssignment { schema: "experiment-assignment/v1"; workspaceId: string; experimentId: string; subjectPseudonym: string; assignmentRevision: number; variant: string; assignedAt: Date; expiresAt: Date }

function digest(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

export class ReleaseControlConflictError extends Error { constructor() { super("IDEMPOTENCY_CONFLICT"); } }

export class ReleaseControlRepository {
  constructor(private readonly database: () => Db) {}

  async listLatest(workspaceId: string, kind?: ReleaseRecordKind): Promise<StoredReleaseRecord[]> {
    const rows = await this.database().selectDistinctOn([releaseControlRecords.kind, releaseControlRecords.id]).from(releaseControlRecords)
      .where(and(eq(releaseControlRecords.workspaceId, workspaceId), kind ? eq(releaseControlRecords.kind, kind) : undefined))
      .orderBy(releaseControlRecords.kind, releaseControlRecords.id, desc(releaseControlRecords.revision));
    return rows.map((row) => ({ ...row, kind: row.kind as ReleaseRecordKind, document: row.document, createdAt: new Date(row.createdAt), expiresAt: row.expiresAt ? new Date(row.expiresAt) : null }));
  }

  async listPublicIncidents(statusWorkspaceId: string): Promise<Array<{ document: Record<string, unknown>; createdAt: Date }>> {
    const rows = await this.database().selectDistinctOn([releaseControlRecords.workspaceId, releaseControlRecords.id], { document: releaseControlRecords.document, createdAt: releaseControlRecords.createdAt })
      .from(releaseControlRecords).where(and(eq(releaseControlRecords.workspaceId, statusWorkspaceId), eq(releaseControlRecords.kind, "incident")))
      .orderBy(releaseControlRecords.workspaceId, releaseControlRecords.id, desc(releaseControlRecords.revision));
    return rows.map((row) => ({ document: row.document, createdAt: new Date(row.createdAt) }));
  }

  async append(input: { workspaceId: string; kind: ReleaseRecordKind; id: string; buildId: string | null; document: Record<string, unknown>; expiresAt: Date | null; userId: string; idempotencyKey: string; now: Date }): Promise<{ record: StoredReleaseRecord; replayed: boolean }> {
    const requestDigest = digest({ kind: input.kind, id: input.id, buildId: input.buildId, document: input.document });
    return this.database().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`release:${input.workspaceId}:${input.kind}:${input.id}`}, 0))`);
      const [receipt] = await tx.select().from(releaseControlMutationReceipts).where(and(eq(releaseControlMutationReceipts.workspaceId, input.workspaceId), eq(releaseControlMutationReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (receipt) {
        if (receipt.requestDigest !== requestDigest) throw new ReleaseControlConflictError();
        return { record: receipt.response as unknown as StoredReleaseRecord, replayed: true };
      }
      const [current] = await tx.select({ revision: releaseControlRecords.revision }).from(releaseControlRecords).where(and(eq(releaseControlRecords.workspaceId, input.workspaceId), eq(releaseControlRecords.kind, input.kind), eq(releaseControlRecords.id, input.id))).orderBy(desc(releaseControlRecords.revision)).limit(1);
      const record: StoredReleaseRecord = { workspaceId: input.workspaceId, kind: input.kind, id: input.id, revision: (current?.revision ?? 0) + 1, buildId: input.buildId, document: input.document, createdByUserId: input.userId, createdAt: input.now, expiresAt: input.expiresAt };
      await tx.insert(releaseControlRecords).values(record);
      await tx.insert(releaseControlMutationReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest, response: record as unknown as Record<string, unknown>, createdAt: input.now });
      return { record, replayed: false };
    });
  }

  async appendTelemetry(input: { workspaceId: string; subjectPseudonym: string; event: Record<string, unknown>; idempotencyKey: string; now: Date; expiresAt: Date }): Promise<{ replayed: boolean }> {
    const requestDigest = digest(input.event);
    return this.database().transaction(async (tx) => {
      const [receipt] = await tx.select().from(releaseControlMutationReceipts).where(and(eq(releaseControlMutationReceipts.workspaceId, input.workspaceId), eq(releaseControlMutationReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (receipt) { if (receipt.requestDigest !== requestDigest) throw new ReleaseControlConflictError(); return { replayed: true }; }
      const properties = input.event.properties as Record<string, unknown>;
      await tx.insert(productTelemetryEvents).values({ workspaceId: input.workspaceId, eventId: String(input.event.eventId), workspacePseudonym: String(input.event.workspacePseudonym), sessionPseudonym: String(input.event.sessionPseudonym), subjectPseudonym: input.subjectPseudonym, regionClassification: String(input.event.regionClassification), name: String(input.event.name), experimentId: typeof properties.experimentId === "string" ? properties.experimentId : null, assignmentRevision: typeof properties.assignmentRevision === "number" ? properties.assignmentRevision : null, occurredAt: new Date(String(input.event.occurredAt)), receivedAt: input.now, expiresAt: input.expiresAt, event: input.event }).onConflictDoNothing();
      await tx.insert(releaseControlMutationReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest, response: { accepted: true }, createdAt: input.now });
      return { replayed: false };
    });
  }

  async getExperimentAssignment(workspaceId: string, experimentId: string, subjectPseudonym: string): Promise<ExperimentAssignment | null> {
    const [row] = await this.database().select().from(experimentAssignments).where(and(eq(experimentAssignments.workspaceId, workspaceId), eq(experimentAssignments.experimentId, experimentId), eq(experimentAssignments.subjectPseudonym, subjectPseudonym))).orderBy(desc(experimentAssignments.assignmentRevision)).limit(1);
    return row ? { schema: "experiment-assignment/v1", ...row, assignedAt: new Date(row.assignedAt), expiresAt: new Date(row.expiresAt) } : null;
  }

  async assignExperiment(input: { workspaceId: string; experimentId: string; subjectPseudonym: string; assignmentRevision: number; variant: string; expiresAt: Date; idempotencyKey: string; now: Date }): Promise<{ assignment: ExperimentAssignment; replayed: boolean }> {
    const requestDigest = digest({ type: "experiment_assignment", experimentId: input.experimentId, subjectPseudonym: input.subjectPseudonym, assignmentRevision: input.assignmentRevision, variant: input.variant });
    return this.database().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`experiment-assignment:${input.workspaceId}:${input.experimentId}:${input.subjectPseudonym}`}, 0))`);
      const [receipt] = await tx.select().from(releaseControlMutationReceipts).where(and(eq(releaseControlMutationReceipts.workspaceId, input.workspaceId), eq(releaseControlMutationReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (receipt) { if (receipt.requestDigest !== requestDigest) throw new ReleaseControlConflictError(); return { assignment: receipt.response as unknown as ExperimentAssignment, replayed: true }; }
      const assignment: ExperimentAssignment = { schema: "experiment-assignment/v1", workspaceId: input.workspaceId, experimentId: input.experimentId, subjectPseudonym: input.subjectPseudonym, assignmentRevision: input.assignmentRevision, variant: input.variant, assignedAt: input.now, expiresAt: input.expiresAt };
      await tx.insert(experimentAssignments).values(assignment).onConflictDoNothing();
      await tx.insert(releaseControlMutationReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest, response: assignment as unknown as Record<string, unknown>, createdAt: input.now });
      return { assignment, replayed: false };
    });
  }

  async hasExperimentExposure(input: { workspaceId: string; experimentId: string; subjectPseudonym: string; assignmentRevision: number; exposureEventId: string }): Promise<boolean> {
    const [row] = await this.database().select({ eventId: productTelemetryEvents.eventId }).from(productTelemetryEvents).where(and(eq(productTelemetryEvents.workspaceId, input.workspaceId), eq(productTelemetryEvents.experimentId, input.experimentId), eq(productTelemetryEvents.subjectPseudonym, input.subjectPseudonym), eq(productTelemetryEvents.assignmentRevision, input.assignmentRevision), eq(productTelemetryEvents.name, "experiment_exposed"), eq(productTelemetryEvents.eventId, input.exposureEventId))).limit(1);
    return Boolean(row);
  }

  async deleteExpiredTelemetry(now: Date, limit: number): Promise<number> {
    const rows = await this.database().select({ workspaceId: productTelemetryEvents.workspaceId, eventId: productTelemetryEvents.eventId }).from(productTelemetryEvents).where(lte(productTelemetryEvents.expiresAt, now)).limit(limit);
    for (const row of rows) await this.database().delete(productTelemetryEvents).where(and(eq(productTelemetryEvents.workspaceId, row.workspaceId), eq(productTelemetryEvents.eventId, row.eventId)));
    return rows.length;
  }

  async backfillTelemetryPrivacyFields(limit: number): Promise<{ processed: number; remaining: number; status: "running" | "completed" }> {
    const result = await this.database().execute(sql`select * from backfill_product_telemetry_privacy_fields(${limit})`);
    const row = (result as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0] ?? (result as unknown as Array<Record<string, unknown>>)[0];
    if (!row) throw new Error("TELEMETRY_BACKFILL_RESULT_MISSING");
    const status = row.status === "completed" ? "completed" : "running";
    return { processed: Number(row.processed), remaining: Number(row.remaining), status };
  }

  async getTelemetryConsent(workspaceId: string, userId: string): Promise<TelemetryConsent | null> {
    const [row] = await this.database().select().from(productTelemetryConsents).where(and(eq(productTelemetryConsents.workspaceId, workspaceId), eq(productTelemetryConsents.userId, userId))).orderBy(desc(productTelemetryConsents.revision)).limit(1);
    return row ? { schema: "product-telemetry-consent/v1", workspaceId: row.workspaceId, userId: row.userId, revision: row.revision, purpose: "product_analytics", status: row.status as "active" | "revoked", issuedAt: new Date(row.issuedAt), expiresAt: new Date(row.expiresAt) } : null;
  }

  async setTelemetryConsent(input: { workspaceId: string; userId: string; subjectPseudonym: string; status: "active" | "revoked"; expiresAt: Date; idempotencyKey: string; now: Date }): Promise<{ consent: TelemetryConsent; replayed: boolean }> {
    const requestDigest = digest({ type: "telemetry_consent", userId: input.userId, status: input.status, expiresAt: input.expiresAt.toISOString() });
    return this.database().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`telemetry-consent:${input.workspaceId}:${input.userId}`}, 0))`);
      const [receipt] = await tx.select().from(releaseControlMutationReceipts).where(and(eq(releaseControlMutationReceipts.workspaceId, input.workspaceId), eq(releaseControlMutationReceipts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (receipt) { if (receipt.requestDigest !== requestDigest) throw new ReleaseControlConflictError(); return { consent: receipt.response as unknown as TelemetryConsent, replayed: true }; }
      const [current] = await tx.select({ revision: productTelemetryConsents.revision }).from(productTelemetryConsents).where(and(eq(productTelemetryConsents.workspaceId, input.workspaceId), eq(productTelemetryConsents.userId, input.userId))).orderBy(desc(productTelemetryConsents.revision)).limit(1);
      const consent: TelemetryConsent = { schema: "product-telemetry-consent/v1", workspaceId: input.workspaceId, userId: input.userId, revision: (current?.revision ?? 0) + 1, purpose: "product_analytics", status: input.status, issuedAt: input.now, expiresAt: input.expiresAt };
      await tx.insert(productTelemetryConsents).values(consent);
      if (input.status === "revoked") { await tx.delete(productTelemetryEvents).where(and(eq(productTelemetryEvents.workspaceId, input.workspaceId), eq(productTelemetryEvents.subjectPseudonym, input.subjectPseudonym))); await tx.delete(experimentAssignments).where(and(eq(experimentAssignments.workspaceId, input.workspaceId), eq(experimentAssignments.subjectPseudonym, input.subjectPseudonym))); }
      await tx.insert(releaseControlMutationReceipts).values({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, requestDigest, response: consent as unknown as Record<string, unknown>, createdAt: input.now }); return { consent, replayed: false };
    });
  }
}
