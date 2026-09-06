import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { readConfiguredSecret } from "@/lib/configured-secret";
import type { getDb } from "@/lib/db";
import { modelQualificationCases, modelQualificationRuns, modelQualificationWebhookReceipts } from "./db-schema";

type Db = ReturnType<typeof getDb>;
export type QualificationWebhookStatus = "starting" | "processing" | "succeeded" | "failed" | "canceled" | "aborted";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function isQualificationHarnessAuthorized(authorization: string | null, environment: Readonly<Record<string, string | undefined>> = process.env) {
  const expected = readConfiguredSecret(environment.QUALIFICATION_HARNESS_TOKEN);
  const supplied = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || expected.length < 32 || !supplied) return false;
  return timingSafeEqual(digest(expected), digest(supplied));
}

export function resolveQualificationWebhookVersion(input: { model: string; modelVersion: string; providerModel: string | null; providerVersion: string | null }) {
  if (input.providerModel !== input.model) return null;
  if (input.modelVersion === input.model) return input.modelVersion;
  return input.providerVersion === input.modelVersion ? input.modelVersion : null;
}

export async function recordQualificationWebhook(input: {
  database: Db;
  eventId: string;
  caseId: string;
  submissionKey: string;
  predictionId: string;
  providerStatus: QualificationWebhookStatus;
  providerModel: string | null;
  providerVersion: string | null;
  payload: unknown;
  at: Date;
}) {
  return input.database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`qualification-webhook:${input.predictionId}`}, 0))`);
    const [qualificationCase] = await tx.select().from(modelQualificationCases).where(and(eq(modelQualificationCases.caseId, input.caseId), eq(modelQualificationCases.submissionKey, input.submissionKey))).for("update").limit(1);
    if (!qualificationCase) return { kind: "not_found" as const };
    const [run] = await tx.select().from(modelQualificationRuns).where(eq(modelQualificationRuns.id, qualificationCase.runId)).limit(1);
    if (!run) return { kind: "not_found" as const };
    const executedVersion = resolveQualificationWebhookVersion({ model: run.model, modelVersion: run.modelVersion, providerModel: input.providerModel, providerVersion: input.providerVersion });
    if (!executedVersion) return { kind: "version_mismatch" as const };
    const payloadDigest = canonicalDigest(input.payload);
    const [existingEvent] = await tx.select().from(modelQualificationWebhookReceipts).where(and(eq(modelQualificationWebhookReceipts.provider, "replicate"), eq(modelQualificationWebhookReceipts.eventId, input.eventId))).limit(1);
    if (existingEvent) return existingEvent.payloadDigest === payloadDigest && existingEvent.predictionId === input.predictionId && existingEvent.submissionKey === input.submissionKey
      ? { kind: "replayed" as const, runId: run.id }
      : { kind: "conflict" as const };
    const [foreignBinding] = await tx.select().from(modelQualificationWebhookReceipts).where(and(eq(modelQualificationWebhookReceipts.predictionId, input.predictionId), ne(modelQualificationWebhookReceipts.submissionKey, input.submissionKey))).limit(1);
    if (foreignBinding || (qualificationCase.predictionId && qualificationCase.predictionId !== input.predictionId)) return { kind: "conflict" as const };
    await tx.insert(modelQualificationWebhookReceipts).values({
      provider: "replicate",
      eventId: input.eventId,
      runId: run.id,
      caseId: input.caseId,
      submissionKey: input.submissionKey,
      predictionId: input.predictionId,
      model: run.model,
      executedVersion,
      providerStatus: input.providerStatus,
      payloadDigest,
      receivedAt: input.at,
    });
    return { kind: "accepted" as const, runId: run.id };
  });
}

type ObserverQuery = {
  database: Db;
  caseId: string;
  endpoint: "official" | "versioned";
  model: string;
  version: string;
} & ({ submissionKey: string; predictionId?: never } | { predictionId: string; submissionKey?: never });

export async function observeQualificationWebhook(input: ObserverQuery) {
  const predicates = [
    eq(modelQualificationWebhookReceipts.caseId, input.caseId),
    eq(modelQualificationWebhookReceipts.model, input.model),
    eq(modelQualificationWebhookReceipts.executedVersion, input.version),
  ];
  if (input.endpoint === "official" ? input.version !== input.model : input.version === input.model) return null;
  if (input.submissionKey !== undefined) predicates.push(eq(modelQualificationWebhookReceipts.submissionKey, input.submissionKey));
  else {
    predicates.push(eq(modelQualificationWebhookReceipts.predictionId, input.predictionId));
    predicates.push(inArray(modelQualificationWebhookReceipts.providerStatus, ["succeeded", "failed", "canceled", "aborted"]));
  }
  const [receipt] = await input.database.select().from(modelQualificationWebhookReceipts).where(and(...predicates)).orderBy(desc(modelQualificationWebhookReceipts.receivedAt)).limit(1);
  if (!receipt) return null;
  return input.submissionKey !== undefined
    ? { predictionId: receipt.predictionId, version: receipt.executedVersion }
    : { authentic: true as const, deliveryId: receipt.eventId, predictionId: receipt.predictionId, version: receipt.executedVersion, status: receipt.providerStatus as "succeeded" | "failed" | "canceled" | "aborted" };
}
