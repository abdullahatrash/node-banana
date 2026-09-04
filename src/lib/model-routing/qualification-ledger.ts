import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { getDb } from "@/lib/db";
import { modelQualificationCases, modelQualificationRuns } from "./db-schema";

type Db = ReturnType<typeof getDb>;

export type QualificationCasePlan = {
  caseId: string;
  requestDigest: `sha256:${string}`;
  maximumSpendUsd: number;
};

export type QualificationCaseClaim =
  | { kind: "submit"; claimToken: string; submissionKey: string }
  | { kind: "recover_submission"; claimToken: string; submissionKey: string }
  | { kind: "recover_prediction"; claimToken: string; submissionKey: string; predictionId: string; executedVersion: string }
  | { kind: "completed"; result: Record<string, unknown> }
  | { kind: "busy" };

export interface QualificationRunLedger {
  begin(input: { runId: string; requestDigest: `sha256:${string}`; provider: "replicate"; model: string; modelVersion: string; signingKeyId: string; hardCapUsd: number; reservedSpendUsd: number; cases: QualificationCasePlan[]; at: Date }): Promise<{ kind: "running" } | { kind: "completed"; result: Record<string, unknown> }>;
  claimCase(input: { runId: string; caseId: string; requestDigest: `sha256:${string}`; at: Date }): Promise<QualificationCaseClaim>;
  bindSubmission(input: { runId: string; caseId: string; claimToken: string; predictionId: string; executedVersion: string; at: Date }): Promise<void>;
  markOutcomeUnknown(input: { runId: string; caseId: string; claimToken: string; at: Date }): Promise<void>;
  completeCase(input: { runId: string; caseId: string; claimToken: string; predictionId: string; executedVersion: string; terminalStatus: "succeeded" | "failed" | "canceled" | "aborted"; result: Record<string, unknown>; at: Date }): Promise<void>;
  completeRun(input: { runId: string; requestDigest: `sha256:${string}`; result: Record<string, unknown>; at: Date }): Promise<Record<string, unknown>>;
}

const leaseMilliseconds = 60_000;
const submissionKey = (runId: string, caseId: string) => `qualification:${runId}:${caseId}`;

export class PostgresQualificationRunLedger implements QualificationRunLedger {
  constructor(private readonly database: Db) {}

  async begin(input: Parameters<QualificationRunLedger["begin"]>[0]) {
    return this.database.transaction(async (tx) => {
      await tx.insert(modelQualificationRuns).values({ id: input.runId, requestDigest: input.requestDigest, provider: input.provider, model: input.model, modelVersion: input.modelVersion, signingKeyId: input.signingKeyId, state: "running", hardCapUsd: input.hardCapUsd.toFixed(6), reservedSpendUsd: input.reservedSpendUsd.toFixed(6), result: null, createdAt: input.at, updatedAt: input.at, completedAt: null }).onConflictDoNothing();
      const [run] = await tx.select().from(modelQualificationRuns).where(eq(modelQualificationRuns.id, input.runId)).for("update").limit(1);
      if (!run || run.requestDigest !== input.requestDigest || run.model !== input.model || run.modelVersion !== input.modelVersion || run.signingKeyId !== input.signingKeyId || Number(run.reservedSpendUsd) !== Number(input.reservedSpendUsd.toFixed(6))) throw new Error("QUALIFICATION_RUN_IDEMPOTENCY_CONFLICT");
      if (run.state === "completed") {
        if (!run.result) throw new Error("QUALIFICATION_RUN_RESULT_MISSING");
        return { kind: "completed" as const, result: run.result };
      }
      if (run.state !== "running") throw new Error("QUALIFICATION_RUN_BLOCKED");
      for (const item of input.cases) {
        await tx.insert(modelQualificationCases).values({ runId: input.runId, caseId: item.caseId, requestDigest: item.requestDigest, state: "reserved", maximumSpendUsd: item.maximumSpendUsd.toFixed(6), submissionKey: submissionKey(input.runId, item.caseId), predictionId: null, executedVersion: null, terminalStatus: null, result: null, leaseOwner: null, leaseExpiresAt: null, createdAt: input.at, updatedAt: input.at, completedAt: null }).onConflictDoNothing();
        const [row] = await tx.select().from(modelQualificationCases).where(and(eq(modelQualificationCases.runId, input.runId), eq(modelQualificationCases.caseId, item.caseId))).limit(1);
        if (!row || row.requestDigest !== item.requestDigest || Number(row.maximumSpendUsd) !== Number(item.maximumSpendUsd.toFixed(6))) throw new Error(`QUALIFICATION_CASE_IDEMPOTENCY_CONFLICT:${item.caseId}`);
      }
      return { kind: "running" as const };
    });
  }

  async claimCase(input: Parameters<QualificationRunLedger["claimCase"]>[0]): Promise<QualificationCaseClaim> {
    return this.database.transaction(async (tx) => {
      const [row] = await tx.select().from(modelQualificationCases).where(and(eq(modelQualificationCases.runId, input.runId), eq(modelQualificationCases.caseId, input.caseId))).for("update").limit(1);
      if (!row || row.requestDigest !== input.requestDigest) throw new Error(`QUALIFICATION_CASE_NOT_FOUND_OR_CHANGED:${input.caseId}`);
      if (row.state === "completed") {
        if (!row.result) throw new Error(`QUALIFICATION_CASE_RESULT_MISSING:${input.caseId}`);
        return { kind: "completed", result: row.result };
      }
      if (row.leaseExpiresAt && row.leaseExpiresAt > input.at) return { kind: "busy" };
      const claimToken = randomUUID();
      const leaseExpiresAt = new Date(input.at.getTime() + leaseMilliseconds);
      if (row.predictionId) {
        if (!row.executedVersion) throw new Error(`QUALIFICATION_EXECUTED_VERSION_MISSING:${input.caseId}`);
        await tx.update(modelQualificationCases).set({ leaseOwner: claimToken, leaseExpiresAt, updatedAt: input.at }).where(and(eq(modelQualificationCases.runId, input.runId), eq(modelQualificationCases.caseId, input.caseId)));
        return { kind: "recover_prediction", claimToken, submissionKey: row.submissionKey, predictionId: row.predictionId, executedVersion: row.executedVersion };
      }
      const staleSubmission = row.state === "submitting" || row.state === "outcome_unknown";
      await tx.update(modelQualificationCases).set({ state: staleSubmission ? "outcome_unknown" : "submitting", leaseOwner: claimToken, leaseExpiresAt, updatedAt: input.at }).where(and(eq(modelQualificationCases.runId, input.runId), eq(modelQualificationCases.caseId, input.caseId)));
      return staleSubmission ? { kind: "recover_submission", claimToken, submissionKey: row.submissionKey } : { kind: "submit", claimToken, submissionKey: row.submissionKey };
    });
  }

  async bindSubmission(input: Parameters<QualificationRunLedger["bindSubmission"]>[0]) {
    const rows = await this.database.update(modelQualificationCases).set({ state: "submitted", predictionId: input.predictionId, executedVersion: input.executedVersion, leaseExpiresAt: new Date(input.at.getTime() + leaseMilliseconds), updatedAt: input.at }).where(and(eq(modelQualificationCases.runId, input.runId), eq(modelQualificationCases.caseId, input.caseId), eq(modelQualificationCases.leaseOwner, input.claimToken))).returning({ caseId: modelQualificationCases.caseId });
    if (!rows.length) throw new Error(`QUALIFICATION_CASE_LEASE_LOST:${input.caseId}`);
  }

  async markOutcomeUnknown(input: Parameters<QualificationRunLedger["markOutcomeUnknown"]>[0]) {
    await this.database.update(modelQualificationCases).set({ state: "outcome_unknown", leaseOwner: null, leaseExpiresAt: null, updatedAt: input.at }).where(and(eq(modelQualificationCases.runId, input.runId), eq(modelQualificationCases.caseId, input.caseId), eq(modelQualificationCases.leaseOwner, input.claimToken)));
  }

  async completeCase(input: Parameters<QualificationRunLedger["completeCase"]>[0]) {
    const rows = await this.database.update(modelQualificationCases).set({ state: "completed", predictionId: input.predictionId, executedVersion: input.executedVersion, terminalStatus: input.terminalStatus, result: input.result, leaseOwner: null, leaseExpiresAt: null, updatedAt: input.at, completedAt: input.at }).where(and(eq(modelQualificationCases.runId, input.runId), eq(modelQualificationCases.caseId, input.caseId), eq(modelQualificationCases.leaseOwner, input.claimToken))).returning({ caseId: modelQualificationCases.caseId });
    if (!rows.length) throw new Error(`QUALIFICATION_CASE_LEASE_LOST:${input.caseId}`);
  }

  async completeRun(input: Parameters<QualificationRunLedger["completeRun"]>[0]) {
    return this.database.transaction(async (tx) => {
      const rows = await tx.select({ state: modelQualificationCases.state }).from(modelQualificationCases).where(eq(modelQualificationCases.runId, input.runId));
      if (!rows.length || rows.some((row) => row.state !== "completed")) throw new Error("QUALIFICATION_RUN_INCOMPLETE");
      const [run] = await tx.select().from(modelQualificationRuns).where(eq(modelQualificationRuns.id, input.runId)).for("update").limit(1);
      if (!run || run.requestDigest !== input.requestDigest) throw new Error("QUALIFICATION_RUN_IDEMPOTENCY_CONFLICT");
      if (run.state === "completed") return run.result ?? input.result;
      await tx.update(modelQualificationRuns).set({ state: "completed", result: input.result, updatedAt: input.at, completedAt: input.at }).where(eq(modelQualificationRuns.id, input.runId));
      return input.result;
    });
  }
}
