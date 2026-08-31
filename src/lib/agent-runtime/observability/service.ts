import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { ObservabilityError } from "./errors";
import type {
  ContractEvidenceReference, DiagnosticTrace, DiagnosticTraceAccessAuditEvent,
  ObservabilityRepository, ObservabilityRetentionPolicy, ObservabilityRetentionRevision,
  ObservabilityCursorCodec, OperationalMetricAggregate, OperationalMetricDeltaInput, OperationalMetricDimension, OperationalMetricName,
  SupportBundleAuditEvent, SupportBundleRecord,
  SupportBundleAccessAuditEvent,
  WorkspaceTelemetryOperatorGrant,
  OperatorGrantAuditEvent,
} from "./types";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const TTL_MAX = 31_536_000;
const TRACE_TTL_MAX = 2_592_000;
const BUNDLE_TTL_MAX = 604_800;
const TRACE_CATEGORIES = new Set(["authorization", "provider", "persistence", "quota", "budget", "artifact", "runtime"]);
const TRACE_SEVERITIES = new Set(["info", "warning", "error"]);
const TRACE_STAGES = new Set(["admission", "planning", "execution", "settlement", "reconciliation", "storage"]);
const TRACE_OUTCOMES = new Set(["succeeded", "failed", "unknown", "denied", "waiting"]);
const PROVIDERS = new Set(["google", "openai", "kie", "internal", "unknown"]);
const METRICS = new Set<OperationalMetricName>([
  "runtime.run.count", "runtime.provider.effect.count", "runtime.quota.decision.count",
  "runtime.artifact.bytes", "runtime.queue.wait_ms",
]);
const DIMENSIONS: Record<OperationalMetricDimension["key"], ReadonlySet<string>> = {
  status: new Set(["accepted", "waiting", "completed", "failed", "outcome_unknown"]),
  outcome: new Set(["succeeded", "failed_known", "outcome_unknown", "denied", "wait"]),
  boundary: new Set(["run_admission", "run_concurrency", "provider_effect", "usage_settlement", "artifact_storage"]),
  provider_family: new Set(["google", "openai", "kie", "internal", "unknown"]),
  operation_family: new Set(["workflow", "text", "image", "audio", "video", "storage", "unknown"]),
  reason_family: new Set(["capacity", "policy", "suspension", "provider", "persistence", "validation", "unknown"]),
  scope: new Set(["workspace", "principal"]),
};

function id(value: string, label: string): string {
  const clean = value.trim();
  if (!ID.test(clean)) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", `${label} is invalid.`);
  return clean;
}
function ttl(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 60 || value > TTL_MAX) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", `${label} is invalid.`);
  return value;
}
function plus(at: Date, seconds: number) { return new Date(at.getTime() + seconds * 1_000); }
function validDate(value: Date): boolean { return value instanceof Date && Number.isFinite(value.getTime()); }
function traceRef() { return `otr_${randomUUID().replaceAll("-", "")}`; }
export function supportBundleStorageKey(workspaceId: string, bundleIdentity: string, contentDigest: `sha256:${string}`): string {
  if (!ID.test(workspaceId) || !ID.test(bundleIdentity) || !DIGEST.test(contentDigest)) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Support Bundle storage identity is invalid.");
  return `runtime-support/${workspaceId}/${canonicalDigest({ workspaceId, bundleIdentity, contentDigest }).slice(7)}.json`;
}
function validReference(reference: ContractEvidenceReference, workspaceId: string) {
  return reference.schema === "contract-evidence-reference/v1" && reference.workspaceId === workspaceId &&
    ID.test(reference.resourceId) && Number.isSafeInteger(reference.version) && reference.version > 0 && DIGEST.test(reference.digest);
}
export function supportBundleSelectionDigest(selections: SupportBundleRecord["selections"]): `sha256:${string}` {
  return canonicalDigest(selections.map(({ reference, projectionKind, projectedContentDigest, projectedSizeBytes }) => ({ reference, projectionKind, projectedContentDigest, projectedSizeBytes }))) as `sha256:${string}`;
}
const PROJECTION_BY_RESOURCE: Record<ContractEvidenceReference["resourceKind"], string> = { run: "run_summary", run_event: "run_event_summary", artifact: "artifact_metadata", usage_record: "usage_summary", cost_valuation: "cost_summary", budget_reservation: "budget_summary", quota_reservation: "quota_reservation_summary", quota_wait: "quota_wait_summary" };

export class ObservabilityService {
  constructor(private readonly repository: ObservabilityRepository, private readonly cursorCodec: ObservabilityCursorCodec) {}

  async setRetention(input: { workspaceId: string; metricTtlSeconds: number; traceTtlSeconds: number; supportBundleTtlSeconds: number; actorUserId: string; idempotencyKey: string; recordedAt: Date }) {
    if (!validDate(input.recordedAt)) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Retention timestamp is invalid.");
    const workspaceId = id(input.workspaceId, "Workspace ID");
    const key = id(input.idempotencyKey, "Idempotency key");
    const desired = {
      metricTtlSeconds: ttl(input.metricTtlSeconds, "Metric TTL"),
      traceTtlSeconds: Math.min(ttl(input.traceTtlSeconds, "Trace TTL"), TRACE_TTL_MAX),
      supportBundleTtlSeconds: Math.min(ttl(input.supportBundleTtlSeconds, "Support Bundle TTL"), BUNDLE_TTL_MAX),
    };
    const actorUserId = id(input.actorUserId, "Actor User ID");
    const requestDigest = canonicalDigest({ workspaceId, ...desired, actorUserId });
    const receipt = await this.repository.getAdminReceipt(workspaceId, key);
    if (receipt) {
      if (receipt.digest !== requestDigest) throw new ObservabilityError("OBSERVABILITY_CONFLICT", "Retention mutation conflicts with prior evidence.");
      const current = await this.repository.getRetentionPolicy(workspaceId);
      if (!current || current.revision.id !== receipt.resourceId) throw new ObservabilityError("OBSERVABILITY_UNAVAILABLE", "Retention replay evidence is unavailable.");
      return current;
    }
    const current = await this.repository.getRetentionPolicy(workspaceId);
    if (current && (["metricTtlSeconds", "traceTtlSeconds", "supportBundleTtlSeconds"] as const).some((field) => desired[field] > current.revision[field])) {
      throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Retention revisions may only narrow TTLs.");
    }
    const policyId = current?.policy.id ?? `orp_${canonicalDigest({ workspaceId }).slice(7, 39)}`;
    const revisionNumber = (current?.revision.revision ?? 0) + 1;
    const revision: ObservabilityRetentionRevision = { schema: "observability-retention-revision/v1", id: `orr_${canonicalDigest({ policyId, revisionNumber, requestDigest }).slice(7, 39)}`, policyId, workspaceId, revision: revisionNumber, ...desired, createdByUserId: actorUserId, createdAt: input.recordedAt };
    const policy: ObservabilityRetentionPolicy = { schema: "observability-retention-policy/v1", id: policyId, workspaceId, currentRevisionId: revision.id, status: "active", createdAt: current?.policy.createdAt ?? input.recordedAt, updatedAt: input.recordedAt };
    const result = await this.repository.appendRetentionRevision({ policy, revision, idempotencyKey: key, digest: requestDigest });
    if (result === "conflict") throw new ObservabilityError("OBSERVABILITY_CONFLICT", "Retention mutation conflicts with prior evidence.");
    if (result === "unavailable") throw new ObservabilityError("OBSERVABILITY_UNAVAILABLE", "Retention persistence is unavailable.");
    return (await this.repository.getRetentionPolicy(workspaceId))!;
  }

  private async retention(workspaceId: string) {
    let current = await this.repository.getRetentionPolicy(workspaceId);
    if (!current) {
      const recordedAt = new Date(); const policyId = `orp_${canonicalDigest({ workspaceId }).slice(7, 39)}`; const digest = canonicalDigest({ workspaceId, default: "observability-retention/v1" });
      const revision: ObservabilityRetentionRevision = { schema: "observability-retention-revision/v1", id: `orr_${canonicalDigest({ policyId, digest }).slice(7, 39)}`, policyId, workspaceId, revision: 1, metricTtlSeconds: 2_592_000, traceTtlSeconds: 86_400, supportBundleTtlSeconds: 604_800, createdByUserId: null, createdAt: recordedAt };
      const policy: ObservabilityRetentionPolicy = { schema: "observability-retention-policy/v1", id: policyId, workspaceId, currentRevisionId: revision.id, status: "active", createdAt: recordedAt, updatedAt: recordedAt };
      const result = await this.repository.appendRetentionRevision({ policy, revision, idempotencyKey: "system:default-retention:v1", digest });
      if (result === "unavailable" || result === "conflict") throw new ObservabilityError("OBSERVABILITY_UNAVAILABLE", "Default observability retention is unavailable.");
      current = await this.repository.getRetentionPolicy(workspaceId);
    }
    if (!current || current.policy.status !== "active") throw new ObservabilityError("OBSERVABILITY_UNAVAILABLE", "Observability retention is unavailable.");
    return current.revision;
  }

  async getRetention(input: { workspaceId: string }) { const workspaceId = id(input.workspaceId, "Workspace ID"); await this.retention(workspaceId); return this.repository.getRetentionPolicy(workspaceId); }

  async recordMetricDelta(input: OperationalMetricDeltaInput) {
    const workspaceId = id(input.workspaceId, "Workspace ID");
    const eventId = id(input.eventId, "Metric event ID");
    if (!METRICS.has(input.name) || input.dimensions.length > 4 || input.dimensions.some((item) => !DIMENSIONS[item.key]?.has(item.value)) || new Set(input.dimensions.map((item) => item.key)).size !== input.dimensions.length || !validDate(input.windowStartsAt) || !validDate(input.windowEndsAt) || !validDate(input.recordedAt) || input.windowEndsAt <= input.windowStartsAt || !Number.isSafeInteger(input.countDelta) || input.countDelta < 0 || !Number.isFinite(input.sumDelta)) {
      throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Operational Metric violates the low-cardinality schema.");
    }
    const retention = await this.retention(workspaceId);
    const orderedDimensions = [...input.dimensions].sort((a, b) => a.key.localeCompare(b.key));
    const metricId = `oma_${canonicalDigest({ workspaceId, name: input.name, dimensions: orderedDimensions, windowStartsAt: input.windowStartsAt.toISOString(), windowEndsAt: input.windowEndsAt.toISOString() }).slice(7, 39)}`;
    const metric: OperationalMetricAggregate = {
      schema: "operational-metric-aggregate/v1", id: metricId, workspaceId,
      name: input.name, dimensions: structuredClone(orderedDimensions),
      windowStartsAt: new Date(input.windowStartsAt), windowEndsAt: new Date(input.windowEndsAt),
      count: input.countDelta, sum: input.sumDelta, recordedAt: new Date(input.recordedAt),
      expiresAt: plus(input.recordedAt, retention.metricTtlSeconds),
    };
    const requestDigest = canonicalDigest({ workspaceId, eventId, bucketId: metricId, countDelta: input.countDelta, sumDelta: input.sumDelta });
    const result = await this.repository.applyMetricDelta({ aggregate: metric, eventId, requestDigest, countDelta: input.countDelta, sumDelta: input.sumDelta });
    if (result.kind === "applied" || result.kind === "replayed") return result.aggregate;
    if (result.kind === "conflict") throw new ObservabilityError("OBSERVABILITY_CONFLICT", "Operational Metric delta conflicts with prior evidence.");
    throw new ObservabilityError("OBSERVABILITY_UNAVAILABLE", "Operational Metric persistence is unavailable.");
  }

  async listMetrics(input: { workspaceId: string; cursor: string | null; limit: number; at: Date }) {
    const workspaceId = id(input.workspaceId, "Workspace ID");
    if (!validDate(input.at) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Operational Metric page is invalid.");
    const decoded = input.cursor === null ? null : await this.cursorCodec.decode(input.cursor);
    if (input.cursor !== null && (!decoded || decoded.scope !== "operational_metrics/v1" || decoded.workspaceId !== workspaceId)) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Operational Metric cursor is invalid.");
    const recordedAt = decoded ? new Date(decoded.recordedAt) : null;
    if (recordedAt && (!validDate(recordedAt) || !ID.test(decoded!.id))) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Operational Metric cursor is invalid.");
    const rows = await this.repository.listMetrics({ workspaceId, cursor: recordedAt ? { recordedAt, id: decoded!.id } : null, limit: input.limit + 1, at: input.at });
    const hasMore = rows.length > input.limit;
    const metrics = rows.slice(0, input.limit);
    const last = metrics.at(-1);
    return { metrics, nextCursor: hasMore && last ? await this.cursorCodec.encode({ scope: "operational_metrics/v1", workspaceId, recordedAt: last.recordedAt.toISOString(), id: last.id }) : null };
  }

  async recordTrace(input: Omit<DiagnosticTrace, "schema" | "operatorTraceRef" | "expiresAt">) {
    const workspaceId = id(input.workspaceId, "Workspace ID");
    if (!TRACE_CATEGORIES.has(input.category) || !TRACE_SEVERITIES.has(input.severity) || !TRACE_STAGES.has(input.stage) || !TRACE_OUTCOMES.has(input.outcome) || !PROVIDERS.has(input.providerFamily) || !CODE.test(input.code) || (input.retryable !== null && typeof input.retryable !== "boolean") || !validDate(input.createdAt) || (input.httpStatus !== null && (!Number.isInteger(input.httpStatus) || input.httpStatus < 100 || input.httpStatus > 599)) || (input.durationMs !== null && (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0)) || (input.attempt !== null && (!Number.isSafeInteger(input.attempt) || input.attempt < 1))) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Diagnostic Trace is invalid.");
    const retention = await this.retention(workspaceId);
    const trace: DiagnosticTrace = {
      schema: "diagnostic-trace/v1", operatorTraceRef: traceRef(), workspaceId,
      category: input.category, severity: input.severity, code: input.code, stage: input.stage,
      outcome: input.outcome, providerFamily: input.providerFamily, httpStatus: input.httpStatus,
      retryable: input.retryable, durationMs: input.durationMs, attempt: input.attempt,
      createdAt: new Date(input.createdAt), expiresAt: plus(input.createdAt, retention.traceTtlSeconds),
    };
    const result = await this.repository.appendTrace(trace);
    if (result !== "created") throw new ObservabilityError("OBSERVABILITY_CONFLICT", "Operator Trace Reference conflicts.");
    return trace.operatorTraceRef;
  }

  async readTrace(input: { workspaceId: string; operatorTraceRef: string; operatorGrantId: string; operatorId: string; at: Date }) {
    if (!validDate(input.at)) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Trace read timestamp is invalid.");
    const workspaceId = id(input.workspaceId, "Workspace ID"); const operatorId = id(input.operatorId, "Operator ID");
    const audit = async (outcome: DiagnosticTraceAccessAuditEvent["outcome"], failClosed: boolean) => { const event: DiagnosticTraceAccessAuditEvent = { schema: "diagnostic-trace-access-audit-event/v1", id: `otaa_${randomUUID().replaceAll("-", "")}`, workspaceId, operatorTraceRef: input.operatorTraceRef, operatorId, outcome, occurredAt: input.at }; try { await this.repository.appendTraceAccessAudit(event); } catch { if (failClosed) throw new ObservabilityError("OBSERVABILITY_UNAVAILABLE", "Trace access audit persistence is unavailable."); } };
    try { await this.requireGrant({ workspaceId, grantId: input.operatorGrantId, operatorId, scope: "trace.read", at: input.at }); }
    catch (error) { await audit("denied", false); throw error; }
    if (!/^otr_[a-f0-9]{32}$/.test(input.operatorTraceRef)) { await audit("denied", false); throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Operator Trace Reference is invalid."); }
    const trace = await this.repository.getTrace(workspaceId, input.operatorTraceRef, input.at);
    await audit(trace ? "granted" : "not_found", true);
    return trace;
  }

  async issueOperatorGrant(input: { workspaceId: string; operatorId: string; scopes: WorkspaceTelemetryOperatorGrant["scopes"]; expiresAt: Date; issuedByUserId: string; actorRole: "owner" | "admin" | "member"; idempotencyKey: string; recordedAt: Date }) {
    const workspaceId = id(input.workspaceId, "Workspace ID");
    if (!(["owner", "admin"] as const).includes(input.actorRole as "owner" | "admin")) throw new ObservabilityError("OBSERVABILITY_FORBIDDEN", "Telemetry Operator Grant requires a Workspace owner or admin.");
    if (!validDate(input.expiresAt) || !validDate(input.recordedAt) || input.expiresAt <= input.recordedAt || input.expiresAt.getTime() - input.recordedAt.getTime() > 2_592_000_000 || !input.scopes.length || input.scopes.some((scope) => !["trace.read", "support_bundle.read"].includes(scope))) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Telemetry Operator Grant shape or TTL is invalid.");
    const operatorId = id(input.operatorId, "Operator ID"); const issuer = id(input.issuedByUserId, "Issuer User ID"); const key = id(input.idempotencyKey, "Idempotency key");
    const digest = canonicalDigest({ workspaceId, operatorId, scopes: [...new Set(input.scopes)].sort(), expiresAt: input.expiresAt.toISOString(), issuer });
    const grantId = `otg_${canonicalDigest({ workspaceId, key, digest }).slice(7, 39)}`;
    const grant: WorkspaceTelemetryOperatorGrant = { schema: "workspace-telemetry-operator-grant/v1", id: grantId, workspaceId, operatorId, scopes: [...new Set(input.scopes)].sort() as WorkspaceTelemetryOperatorGrant["scopes"], status: "active", issuedByUserId: issuer, issuedAt: input.recordedAt, expiresAt: input.expiresAt, revokedAt: null, revokedByUserId: null };
    const audit: OperatorGrantAuditEvent = { schema: "operator-grant-audit-event/v1", id: `oga_${canonicalDigest({ grantId, event: "grant.issued" }).slice(7, 39)}`, workspaceId, grantId, eventType: "grant.issued", actorType: "user", actorId: issuer, occurredAt: input.recordedAt };
    const result = await this.repository.appendOperatorGrant({ grant, idempotencyKey: key, digest, audit });
    if (result === "conflict") throw new ObservabilityError("OBSERVABILITY_CONFLICT", "Telemetry Operator Grant conflicts with immutable evidence.");
    if (result === "unavailable") throw new ObservabilityError("OBSERVABILITY_UNAVAILABLE", "Telemetry Operator Grant persistence is unavailable.");
    return (await this.repository.getOperatorGrant(workspaceId, grantId))!;
  }

  private async requireGrant(input: { workspaceId: string; grantId: string; operatorId: string; scope: WorkspaceTelemetryOperatorGrant["scopes"][number]; at: Date }) {
    if (!validDate(input.at)) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Operator Grant timestamp is invalid.");
    const grant = await this.repository.getOperatorGrant(id(input.workspaceId, "Workspace ID"), id(input.grantId, "Operator Grant ID"));
    if (!grant || grant.operatorId !== id(input.operatorId, "Operator ID") || grant.status !== "active" || grant.expiresAt <= input.at || !grant.scopes.includes(input.scope)) throw new ObservabilityError("OBSERVABILITY_FORBIDDEN", "An active Workspace Telemetry Operator Grant is required.");
    return grant;
  }

  listOperatorGrants(input: { workspaceId: string; operatorId: string; at: Date; limit: number }) { if (!validDate(input.at) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Operator Grant page is invalid."); return this.repository.listOperatorGrants({ workspaceId: id(input.workspaceId, "Workspace ID"), operatorId: id(input.operatorId, "Operator ID"), at: input.at, limit: input.limit }); }

  async revokeOperatorGrant(input: { workspaceId: string; grantId: string; revokedByUserId: string; actorRole: "owner" | "admin" | "member"; recordedAt: Date }) {
    if (!(["owner", "admin"] as const).includes(input.actorRole as "owner" | "admin")) throw new ObservabilityError("OBSERVABILITY_FORBIDDEN", "Grant revocation requires a Workspace owner or admin.");
    if (!validDate(input.recordedAt)) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Grant revocation timestamp is invalid.");
    const workspaceId = id(input.workspaceId, "Workspace ID"); const grantId = id(input.grantId, "Operator Grant ID"); const actor = id(input.revokedByUserId, "Actor User ID");
    const audit: OperatorGrantAuditEvent = { schema: "operator-grant-audit-event/v1", id: `oga_${canonicalDigest({ grantId, event: "grant.revoked" }).slice(7, 39)}`, workspaceId, grantId, eventType: "grant.revoked", actorType: "user", actorId: actor, occurredAt: input.recordedAt };
    const result = await this.repository.revokeOperatorGrant({ workspaceId, grantId, revokedByUserId: actor, revokedAt: input.recordedAt, audit });
    if (result === "conflict") throw new ObservabilityError("OBSERVABILITY_CONFLICT", "Grant revocation conflicts with immutable evidence.");
    return result;
  }

  async createStoredSupportBundle(input: { workspaceId: string; selections: SupportBundleRecord["selections"]; consent: SupportBundleRecord["consent"]; contentDigest: `sha256:${string}`; sizeBytes: number; idempotencyKey: string; storedAt: Date; recordedAt: Date; bindIntentRequestDigest?: `sha256:${string}` }) {
    const workspaceId = id(input.workspaceId, "Workspace ID");
    const idempotencyKey = id(input.idempotencyKey, "Idempotency key");
    id(input.consent.grantedByUserId, "Consent User ID");
    if (!validDate(input.recordedAt) || !validDate(input.storedAt) || input.storedAt > input.recordedAt || !validDate(input.consent.grantedAt) || !validDate(input.consent.expiresAt) || !input.selections.length || input.selections.length > 100 || input.consent.schema !== "support-bundle-consent/v1" || !["incident_diagnosis", "support_case"].includes(input.consent.purpose) || !DIGEST.test(input.consent.selectionDigest) || input.consent.selectionDigest !== supportBundleSelectionDigest(input.selections) || input.consent.expiresAt <= input.recordedAt || input.consent.grantedAt > input.storedAt || !DIGEST.test(input.contentDigest) || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > 10_000_000 || input.selections.some(({ reference, projectionKind, projectedContentDigest, projectedSizeBytes }) => !validReference(reference, workspaceId) || PROJECTION_BY_RESOURCE[reference.resourceKind] !== projectionKind || !DIGEST.test(projectedContentDigest) || !Number.isSafeInteger(projectedSizeBytes) || projectedSizeBytes < 1 || projectedSizeBytes > input.sizeBytes)) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Support Bundle consent or frozen manifest is invalid.");
    const retention = await this.retention(workspaceId);
    const expiresAt = new Date(Math.min(input.consent.expiresAt.getTime(), plus(input.recordedAt, retention.supportBundleTtlSeconds).getTime()));
    const storageKey = supportBundleStorageKey(workspaceId, idempotencyKey, input.contentDigest);
    const digest = canonicalDigest({ workspaceId, selections: input.selections, consent: input.consent, contentDigest: input.contentDigest, sizeBytes: input.sizeBytes, storageKey, expiresAt: expiresAt.toISOString() });
    const bundleId = `osb_${canonicalDigest({ workspaceId, key: idempotencyKey, digest }).slice(7, 39)}`;
    const bundle: SupportBundleRecord = { schema: "support-bundle/v1", id: bundleId, workspaceId, state: "stored", selections: structuredClone(input.selections), consent: structuredClone(input.consent), storageKey, contentDigest: input.contentDigest, sizeBytes: input.sizeBytes, createdAt: input.recordedAt, expiresAt, storedAt: input.storedAt };
    const audit: SupportBundleAuditEvent = { schema: "support-bundle-audit-event/v1", id: `osa_${canonicalDigest({ bundleId, event: "stored" }).slice(7, 39)}`, workspaceId, bundleId, eventType: "bundle.stored", actorType: "user", actorId: input.consent.grantedByUserId, occurredAt: input.recordedAt };
    const result = await this.repository.createSupportBundle({ bundle, audit, idempotencyKey, digest, bindIntentRequestDigest: input.bindIntentRequestDigest });
    if (result === "conflict") throw new ObservabilityError("OBSERVABILITY_CONFLICT", "Support Bundle conflicts with prior consent evidence.");
    if (result === "unavailable") throw new ObservabilityError("OBSERVABILITY_UNAVAILABLE", "Support Bundle persistence is unavailable.");
    const persisted = await this.repository.getSupportBundleRecord(workspaceId, bundleId);
    if (!persisted) throw new ObservabilityError("OBSERVABILITY_UNAVAILABLE", "Support Bundle replay evidence is unavailable.");
    const { storageKey: _storageKey, ...dto } = persisted;
    return dto;
  }

  async readSupportBundle(input: { workspaceId: string; bundleId: string; operatorGrantId: string; operatorId: string; at: Date }) {
    if (!validDate(input.at)) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Support Bundle read timestamp is invalid.");
    const workspaceId = id(input.workspaceId, "Workspace ID"); const bundleId = id(input.bundleId, "Support Bundle ID"); const operatorId = id(input.operatorId, "Operator ID");
    const audit = async (outcome: SupportBundleAccessAuditEvent["outcome"], failClosed: boolean) => { const event: SupportBundleAccessAuditEvent = { schema: "support-bundle-access-audit-event/v1", id: `osaa_${randomUUID().replaceAll("-", "")}`, workspaceId, bundleId, operatorId, outcome, occurredAt: input.at }; try { await this.repository.appendSupportBundleAccessAudit(event); } catch { if (failClosed) throw new ObservabilityError("OBSERVABILITY_UNAVAILABLE", "Support Bundle access audit persistence is unavailable."); } };
    try { await this.requireGrant({ workspaceId, grantId: input.operatorGrantId, operatorId, scope: "support_bundle.read", at: input.at }); }
    catch (error) { await audit("denied", false); throw error; }
    const bundle = await this.repository.getSupportBundle(workspaceId, bundleId, input.at);
    await audit(bundle ? "granted" : "not_found", true);
    if (!bundle) return null;
    const { storageKey: _storageKey, ...dto } = bundle;
    return dto;
  }

  async readSupportBundlePayload(input: { workspaceId: string; bundleId: string; operatorGrantId: string; operatorId: string; at: Date }) {
    const dto = await this.readSupportBundle(input);
    if (!dto) return null;
    const bundle = await this.repository.getSupportBundle(input.workspaceId, input.bundleId, input.at);
    if (!bundle?.storageKey || !bundle.contentDigest) return null;
    return { bundle: dto, storageKey: bundle.storageKey, contentDigest: bundle.contentDigest, sizeBytes: bundle.sizeBytes };
  }

  async revokeSupportBundle(input: { workspaceId: string; bundleId: string; actorUserId: string; actorRole: "owner" | "admin" | "member"; recordedAt: Date }) {
    if (!(input.actorRole === "owner" || input.actorRole === "admin") || !validDate(input.recordedAt)) throw new ObservabilityError("OBSERVABILITY_FORBIDDEN", "Support Bundle revocation requires a Workspace owner or admin.");
    const workspaceId = id(input.workspaceId, "Workspace ID"); const bundleId = id(input.bundleId, "Support Bundle ID"); const actor = id(input.actorUserId, "Actor User ID");
    const audit: SupportBundleAuditEvent = { schema: "support-bundle-audit-event/v1", id: `osa_${canonicalDigest({ bundleId, event: "revoked" }).slice(7, 39)}`, workspaceId, bundleId, eventType: "bundle.revoked", actorType: "user", actorId: actor, occurredAt: input.recordedAt };
    const result = await this.repository.revokeSupportBundle({ workspaceId, bundleId, actorUserId: actor, revokedAt: input.recordedAt, audit });
    if (result === "conflict") throw new ObservabilityError("OBSERVABILITY_CONFLICT", "Support Bundle revocation conflicts with immutable evidence.");
    return result;
  }

  listSupportBundleAudit(input: { workspaceId: string; bundleId: string; limit: number }) { if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Support Bundle audit page is invalid."); return this.repository.listSupportBundleAudit({ workspaceId: id(input.workspaceId, "Workspace ID"), bundleId: id(input.bundleId, "Support Bundle ID"), limit: input.limit }); }

  listSupportBundleCleanup(input: { at: Date; limit: number }) { if (!validDate(input.at) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Support Bundle cleanup page is invalid."); return this.repository.listSupportBundleCleanup(input); }
  acknowledgeSupportBundleCleanup(input: { bundleId: string; workspaceId: string; storageKey: string; contentDigest: `sha256:${string}` }) { const workspaceId = id(input.workspaceId, "Workspace ID"); const bundleId = id(input.bundleId, "Support Bundle ID"); if (!DIGEST.test(input.contentDigest) || !input.storageKey.startsWith(`runtime-support/${workspaceId}/`) || !/^runtime-support\/[A-Za-z0-9_.:-]+\/[a-f0-9]{64}\.json$/.test(input.storageKey)) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Support Bundle cleanup target is invalid."); return this.repository.acknowledgeSupportBundleCleanup({ ...input, workspaceId, bundleId }); }

  expire(at: Date, limit = 100) { if (!validDate(at) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new ObservabilityError("OBSERVABILITY_INVALID_INPUT", "Expiry request is invalid."); return this.repository.expire(at, limit); }
}
