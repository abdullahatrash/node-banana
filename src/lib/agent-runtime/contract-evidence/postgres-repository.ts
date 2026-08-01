import { and, desc, eq, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { getDb } from "@/lib/db";
import { runtimeContractEvidenceVersions } from "@/lib/db/schema";
import type {
  AppendContractEvidenceVersionInput,
  ContractEvidenceVersionRecord,
  MutableContractEvidenceProjectionKind,
  MutableContractEvidenceResourceKind,
} from "./types";
import {
  projectBudgetReservationContractEvidence,
  projectQuotaReservationContractEvidence,
  projectQuotaWaitContractEvidence,
  projectRunContractEvidence,
  type WorkflowRunContractEvidenceSource,
} from "./projectors";
import type { BudgetReservation } from "../budgets/types";
import type { QuotaReservation, QuotaWait } from "../quotas/types";

type Db = ReturnType<typeof getDb>;
export type ContractEvidenceTransaction = Parameters<
  Parameters<Db["transaction"]>[0]
>[0];

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_PROJECTION_KEY =
  /(^|[_-])(prompt|content|secret|token|password|ciphertext|credential|signed[_-]?url|authorization|headers?|provider[_-]?body)([_-]|$)/i;

const PROJECTION_BY_RESOURCE: Record<
  MutableContractEvidenceResourceKind,
  MutableContractEvidenceProjectionKind
> = {
  run: "run_summary",
  budget_reservation: "budget_summary",
  quota_reservation: "quota_reservation_summary",
  quota_wait: "quota_wait_summary",
};

const SCHEMA_BY_PROJECTION: Record<MutableContractEvidenceProjectionKind, string> = {
  run_summary: "support-run-summary/v1",
  budget_summary: "support-budget-summary/v1",
  quota_reservation_summary: "support-quota-reservation-summary/v1",
  quota_wait_summary: "support-quota-wait-summary/v1",
};

const KEYS_BY_PROJECTION: Record<MutableContractEvidenceProjectionKind, readonly string[]> = {
  run_summary: [
    "schema", "id", "workflowId", "workflowRevisionId", "state",
    "startSnapshotDigest", "finalSnapshotDigest", "sourceRunId", "rootRunId",
    "derivationDepth", "resumeAt", "failureCode", "acceptedAt", "startedAt",
    "completedAt", "updatedAt",
  ],
  budget_summary: [
    "schema", "id", "runId", "policyId", "policyRevisionId", "scope",
    "period", "currency", "reservedAmount", "heldAmount", "settledAmount",
    "releasedAmount", "state", "pricingSnapshotIds", "createdAt", "updatedAt",
  ],
  quota_reservation_summary: [
    "schema", "id", "runId", "transitionKey", "boundary", "subject", "policyId",
    "policyRevisionId", "scope", "kind", "dimension", "unit", "window",
    "reservationRule", "reservedAmount", "heldAmount", "settledAmount",
    "releasedAmount", "overageAmount", "state", "createdAt", "updatedAt",
  ],
  quota_wait_summary: [
    "schema", "id", "runId", "transitionKey", "boundary", "subject", "claims",
    "reasonCode", "eligibleAt", "state", "resumedBy", "resolutionReservationIds",
    "createdAt", "resolvedAt",
  ],
};

function assertExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Contract Evidence ${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`Contract Evidence ${label} is not a closed projection.`);
  }
}

function assertClosedProjection(
  projectionKind: MutableContractEvidenceProjectionKind,
  projection: Record<string, unknown>,
): void {
  assertExactKeys(projection, KEYS_BY_PROJECTION[projectionKind], "projection");
  if (projectionKind === "budget_summary") {
    assertExactKeys(projection.period, ["kind", "timezone", "startsAt", "endsAt"], "period");
  }
  if (projectionKind === "quota_reservation_summary") {
    assertExactKeys(projection.subject, ["kind", "id"], "subject");
    assertExactKeys(projection.window, ["kind", "timezone", "startsAt", "endsAt"], "window");
  }
  if (projectionKind === "quota_wait_summary") {
    assertExactKeys(projection.subject, ["kind", "id"], "subject");
    if (!Array.isArray(projection.claims)) {
      throw new TypeError("Contract Evidence claims must be an array.");
    }
    for (const claim of projection.claims) {
      assertExactKeys(claim, ["dimension", "unit", "amount"], "claim");
    }
    if (projection.resumedBy !== null) {
      assertExactKeys(projection.resumedBy, ["kind"], "resume actor");
    }
  }
}

const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/;
const SAFE_TIMEZONE = /^[A-Za-z0-9][A-Za-z0-9._+:/-]{0,127}$/;
const QUOTA_DIMENSION = /^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

function assertString(value: unknown, label: string, pattern?: RegExp): asserts value is string {
  if (typeof value !== "string" || (pattern && !pattern.test(value))) {
    throw new TypeError(`Contract Evidence ${label} is invalid.`);
  }
}

function assertNullableString(value: unknown, label: string, pattern?: RegExp): void {
  if (value !== null) assertString(value, label, pattern);
}

function assertOneOf(value: unknown, values: readonly string[], label: string): void {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`Contract Evidence ${label} is invalid.`);
  }
}

function assertTimestamp(value: unknown, label: string, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`Contract Evidence ${label} is invalid.`);
  }
}

function assertStringArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !SAFE_IDENTITY.test(item))) {
    throw new TypeError(`Contract Evidence ${label} is invalid.`);
  }
}

function assertProjectionValues(
  projectionKind: MutableContractEvidenceProjectionKind,
  projection: Record<string, unknown>,
): void {
  assertString(projection.id, "resource identity", SAFE_IDENTITY);
  if (projectionKind === "run_summary") {
    assertString(projection.workflowId, "Workflow identity", SAFE_IDENTITY);
    assertString(projection.workflowRevisionId, "Workflow Revision identity", SAFE_IDENTITY);
    assertOneOf(projection.state, ["accepted", "running", "waiting", "outcome_unknown", "completed", "failed"], "Run state");
    assertString(projection.startSnapshotDigest, "start digest", DIGEST);
    assertNullableString(projection.finalSnapshotDigest, "final digest", DIGEST);
    assertNullableString(projection.sourceRunId, "source Run identity", SAFE_IDENTITY);
    assertNullableString(projection.rootRunId, "root Run identity", SAFE_IDENTITY);
    if (!Number.isInteger(projection.derivationDepth) || (projection.derivationDepth as number) < 0) {
      throw new TypeError("Contract Evidence derivation depth is invalid.");
    }
    assertTimestamp(projection.resumeAt, "resume timestamp", true);
    assertNullableString(projection.failureCode, "failure code", FAILURE_CODE);
    assertTimestamp(projection.acceptedAt, "accepted timestamp");
    assertTimestamp(projection.startedAt, "started timestamp", true);
    assertTimestamp(projection.completedAt, "completed timestamp", true);
    assertTimestamp(projection.updatedAt, "updated timestamp");
    return;
  }
  if (projectionKind === "budget_summary") {
    assertString(projection.runId, "Run identity", SAFE_IDENTITY);
    assertString(projection.policyId, "Budget Policy identity", SAFE_IDENTITY);
    assertString(projection.policyRevisionId, "Budget Policy Revision identity", SAFE_IDENTITY);
    assertOneOf(projection.scope, ["workspace", "principal"], "Budget scope");
    const period = projection.period as Record<string, unknown>;
    assertOneOf(period.kind, ["calendar_day", "calendar_week", "calendar_month", "lifetime"], "Budget period");
    assertString(period.timezone, "Budget timezone", SAFE_TIMEZONE);
    assertTimestamp(period.startsAt, "Budget period start");
    assertTimestamp(period.endsAt, "Budget period end", true);
    assertString(projection.currency, "currency", /^[A-Z]{3}$/);
    for (const key of ["reservedAmount", "heldAmount", "settledAmount", "releasedAmount"] as const) {
      assertString(projection[key], key, DECIMAL);
    }
    assertOneOf(projection.state, ["held", "settled", "released", "outcome_unknown", "held_unknown_cost"], "Budget state");
    assertStringArray(projection.pricingSnapshotIds, "Pricing Snapshot identities");
    assertTimestamp(projection.createdAt, "created timestamp");
    assertTimestamp(projection.updatedAt, "updated timestamp");
    return;
  }
  if (projectionKind === "quota_reservation_summary") {
    assertNullableString(projection.runId, "Run identity", SAFE_IDENTITY);
    assertString(projection.transitionKey, "transition identity", SAFE_IDENTITY);
    assertOneOf(projection.boundary, ["run_admission", "run_concurrency", "provider_effect", "artifact_storage", "usage_settlement"], "Quota boundary");
    const subject = projection.subject as Record<string, unknown>;
    assertOneOf(subject.kind, ["run", "step_attempt", "artifact", "usage_settlement"], "Quota subject kind");
    assertString(subject.id, "Quota subject identity", SAFE_IDENTITY);
    assertString(projection.policyId, "Quota Policy identity", SAFE_IDENTITY);
    assertString(projection.policyRevisionId, "Quota Policy Revision identity", SAFE_IDENTITY);
    assertOneOf(projection.scope, ["workspace", "principal"], "Quota scope");
    assertOneOf(projection.kind, ["admission", "concurrency", "rate", "storage", "usage"], "Quota kind");
    assertString(projection.dimension, "Quota dimension", QUOTA_DIMENSION);
    assertOneOf(projection.unit, ["count", "byte", "millisecond", "megapixel"], "Quota unit");
    const window = projection.window as Record<string, unknown>;
    assertOneOf(window.kind, ["concurrent", "calendar_minute", "calendar_hour", "calendar_day", "calendar_week", "calendar_month", "lifetime"], "Quota window");
    assertString(window.timezone, "Quota timezone", SAFE_TIMEZONE);
    assertTimestamp(window.startsAt, "Quota window start");
    assertTimestamp(window.endsAt, "Quota window end", true);
    assertOneOf(projection.reservationRule, ["consume", "release_on_terminal", "release_on_transition"], "Quota reservation rule");
    for (const key of ["reservedAmount", "heldAmount", "settledAmount", "releasedAmount", "overageAmount"] as const) {
      assertString(projection[key], key, DECIMAL);
    }
    assertOneOf(projection.state, ["held", "settled", "released"], "Quota Reservation state");
    assertTimestamp(projection.createdAt, "created timestamp");
    assertTimestamp(projection.updatedAt, "updated timestamp");
    return;
  }
  assertString(projection.runId, "Run identity", SAFE_IDENTITY);
  assertString(projection.transitionKey, "transition identity", SAFE_IDENTITY);
  assertOneOf(projection.boundary, ["run_admission", "run_concurrency", "provider_effect", "artifact_storage", "usage_settlement"], "Quota boundary");
  const subject = projection.subject as Record<string, unknown>;
  assertOneOf(subject.kind, ["run", "step_attempt", "artifact", "usage_settlement"], "Quota subject kind");
  assertString(subject.id, "Quota subject identity", SAFE_IDENTITY);
  for (const claim of projection.claims as Array<Record<string, unknown>>) {
    assertString(claim.dimension, "Quota claim dimension", QUOTA_DIMENSION);
    assertOneOf(claim.unit, ["count", "byte", "millisecond", "megapixel"], "Quota claim unit");
    assertString(claim.amount, "Quota claim amount", DECIMAL);
  }
  assertOneOf(projection.reasonCode, ["QUOTA_RENEWABLE_CAPACITY_EXHAUSTED"], "Quota Wait reason");
  assertTimestamp(projection.eligibleAt, "eligibility timestamp", true);
  assertOneOf(projection.state, ["waiting", "resumed", "cancelled"], "Quota Wait state");
  if (projection.resumedBy !== null) {
    assertOneOf((projection.resumedBy as Record<string, unknown>).kind, ["human", "principal", "system"], "resume actor");
  }
  assertStringArray(projection.resolutionReservationIds, "resolution Reservation identities");
  assertTimestamp(projection.createdAt, "created timestamp");
  assertTimestamp(projection.resolvedAt, "resolved timestamp", true);
}

function canonicalSource(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalSource);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, canonicalSource(child)]),
    );
  }
  return value;
}

function deterministicProjection(
  resourceKind: MutableContractEvidenceResourceKind,
  source: Record<string, unknown>,
): Record<string, unknown> {
  switch (resourceKind) {
    case "run":
      return projectRunContractEvidence(source as unknown as WorkflowRunContractEvidenceSource);
    case "budget_reservation":
      return projectBudgetReservationContractEvidence(source as unknown as BudgetReservation);
    case "quota_reservation":
      return projectQuotaReservationContractEvidence(source as unknown as QuotaReservation);
    case "quota_wait":
      return projectQuotaWaitContractEvidence(source as unknown as QuotaWait);
  }
}

function canonicalEvidenceTime(
  resourceKind: MutableContractEvidenceResourceKind,
  source: Record<string, unknown>,
): Date | null {
  const value = resourceKind === "quota_wait"
    ? source.resolvedAt ?? source.createdAt
    : source.updatedAt;
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}

function assertSafeProjection(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Contract Evidence projection must be an object.");
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PROJECTION_KEY.test(key)) {
      throw new TypeError("Contract Evidence projection contains a forbidden field.");
    }
    if (Array.isArray(child)) {
      for (const item of child) assertSafeProjectionValue(item);
    } else {
      assertSafeProjectionValue(child);
    }
  }
}

function assertSafeProjectionValue(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertSafeProjectionValue(item);
    return;
  }
  assertSafeProjection(value);
}

function mapRecord(row: typeof runtimeContractEvidenceVersions.$inferSelect): ContractEvidenceVersionRecord {
  return {
    ...row,
    canonicalDigest: row.canonicalDigest as `sha256:${string}`,
    projectionDigest: row.projectionDigest as `sha256:${string}`,
  };
}

export async function appendContractEvidenceVersion(
  tx: ContractEvidenceTransaction,
  input: AppendContractEvidenceVersionInput,
): Promise<ContractEvidenceVersionRecord> {
  if (PROJECTION_BY_RESOURCE[input.resourceKind] !== input.projectionKind) {
    throw new TypeError("Contract Evidence projection does not match its resource kind.");
  }
  if (!input.workspaceId.trim() || !input.resourceId.trim()) {
    throw new TypeError("Contract Evidence identity is invalid.");
  }
  if (Number.isNaN(input.createdAt.getTime())) {
    throw new TypeError("Contract Evidence timestamp is invalid.");
  }
  if (
    input.projection.schema !== SCHEMA_BY_PROJECTION[input.projectionKind] ||
    input.projection.id !== input.resourceId
  ) {
    throw new TypeError("Contract Evidence projection identity is invalid.");
  }
  let source: Record<string, unknown>;
  if (input.canonicalSource && typeof input.canonicalSource === "object") {
    source = input.canonicalSource as Record<string, unknown>;
    if (source.id !== input.resourceId || source.workspaceId !== input.workspaceId) {
      throw new TypeError("Contract Evidence canonical identity is invalid.");
    }
  } else {
    throw new TypeError("Contract Evidence canonical source is invalid.");
  }
  assertClosedProjection(input.projectionKind, input.projection);
  assertProjectionValues(input.projectionKind, input.projection);
  assertSafeProjection(input.projection);
  const evidenceTime = canonicalEvidenceTime(input.resourceKind, source);
  if (!evidenceTime || evidenceTime.getTime() !== input.createdAt.getTime()) {
    throw new TypeError("Contract Evidence timestamp does not match its canonical source.");
  }
  if (canonicalDigest(deterministicProjection(input.resourceKind, source)) !== canonicalDigest(input.projection)) {
    throw new TypeError("Contract Evidence projection does not match its canonical source.");
  }
  const canonical = canonicalSource(input.canonicalSource);
  const canonicalDigestValue = canonicalDigest(canonical) as `sha256:${string}`;
  const projectionDigest = canonicalDigest(input.projection) as `sha256:${string}`;
  if (!DIGEST.test(canonicalDigestValue) || !DIGEST.test(projectionDigest)) {
    throw new TypeError("Contract Evidence digest is invalid.");
  }
  const lockKey = `${input.workspaceId}:${input.resourceKind}:${input.resourceId}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
  const [latest] = await tx
    .select({ version: runtimeContractEvidenceVersions.version })
    .from(runtimeContractEvidenceVersions)
    .where(and(
      eq(runtimeContractEvidenceVersions.workspaceId, input.workspaceId),
      eq(runtimeContractEvidenceVersions.resourceKind, input.resourceKind),
      eq(runtimeContractEvidenceVersions.resourceId, input.resourceId),
    ))
    .orderBy(desc(runtimeContractEvidenceVersions.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  const [inserted] = await tx.insert(runtimeContractEvidenceVersions).values({
    workspaceId: input.workspaceId,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    version,
    canonicalDigest: canonicalDigestValue,
    projectionKind: input.projectionKind,
    projection: input.projection,
    projectionDigest,
    createdAt: input.createdAt,
  }).returning();
  if (!inserted) throw new Error("Contract Evidence version was not persisted.");
  return mapRecord(inserted);
}

export async function getLatestContractEvidenceVersion(
  database: Db,
  input: {
    workspaceId: string;
    resourceKind: MutableContractEvidenceResourceKind;
    resourceId: string;
    projectionKind: MutableContractEvidenceProjectionKind;
  },
): Promise<ContractEvidenceVersionRecord | null> {
  const [row] = await database.select().from(runtimeContractEvidenceVersions).where(and(
    eq(runtimeContractEvidenceVersions.workspaceId, input.workspaceId),
    eq(runtimeContractEvidenceVersions.resourceKind, input.resourceKind),
    eq(runtimeContractEvidenceVersions.resourceId, input.resourceId),
    eq(runtimeContractEvidenceVersions.projectionKind, input.projectionKind),
  )).orderBy(desc(runtimeContractEvidenceVersions.version)).limit(1);
  if (!row) return null;
  if (
    row.workspaceId !== input.workspaceId ||
    row.resourceKind !== input.resourceKind ||
    row.resourceId !== input.resourceId ||
    row.projectionKind !== input.projectionKind ||
    row.projection.schema !== SCHEMA_BY_PROJECTION[row.projectionKind] ||
    row.projection.id !== row.resourceId ||
    !DIGEST.test(row.canonicalDigest) ||
    !DIGEST.test(row.projectionDigest) ||
    canonicalDigest(row.projection) !== row.projectionDigest
  ) return null;
  try {
    assertClosedProjection(row.projectionKind, row.projection);
    assertProjectionValues(row.projectionKind, row.projection);
    assertSafeProjection(row.projection);
  } catch {
    return null;
  }
  return mapRecord(row);
}
