export type CanonicalResourceKind = "run" | "run_event" | "artifact" | "usage_record" | "cost_valuation" | "budget_reservation" | "quota_reservation" | "quota_wait";

export interface ContractEvidenceReference {
  schema: "contract-evidence-reference/v1";
  workspaceId: string;
  resourceKind: CanonicalResourceKind;
  resourceId: string;
  version: number;
  digest: `sha256:${string}`;
}

export interface ObservabilityCursorCodec {
  encode(payload: { scope: "operational_metrics/v1"; workspaceId: string; recordedAt: string; id: string }): Promise<string>;
  decode(token: string): Promise<{ scope: "operational_metrics/v1"; workspaceId: string; recordedAt: string; id: string } | null>;
}

export type OperationalMetricName =
  | "runtime.run.count"
  | "runtime.provider.effect.count"
  | "runtime.quota.decision.count"
  | "runtime.artifact.bytes"
  | "runtime.queue.wait_ms";

export type OperationalMetricDimension =
  | { key: "status"; value: "accepted" | "waiting" | "completed" | "failed" | "outcome_unknown" }
  | { key: "outcome"; value: "succeeded" | "failed_known" | "outcome_unknown" | "denied" | "wait" }
  | { key: "boundary"; value: "run_admission" | "run_concurrency" | "provider_effect" | "usage_settlement" | "artifact_storage" }
  | { key: "provider_family"; value: "google" | "openai" | "kie" | "internal" | "unknown" }
  | { key: "operation_family"; value: "workflow" | "text" | "image" | "audio" | "video" | "storage" | "unknown" }
  | { key: "reason_family"; value: "capacity" | "policy" | "suspension" | "provider" | "persistence" | "validation" | "unknown" }
  | { key: "scope"; value: "workspace" | "principal" };

export interface OperationalMetricAggregate {
  schema: "operational-metric-aggregate/v1";
  id: string;
  workspaceId: string;
  name: OperationalMetricName;
  dimensions: OperationalMetricDimension[];
  windowStartsAt: Date;
  windowEndsAt: Date;
  count: number;
  sum: number;
  recordedAt: Date;
  expiresAt: Date;
}
export interface OperationalMetricDeltaInput {
  workspaceId: string;
  eventId: string;
  name: OperationalMetricName;
  dimensions: OperationalMetricDimension[];
  windowStartsAt: Date;
  windowEndsAt: Date;
  countDelta: number;
  sumDelta: number;
  recordedAt: Date;
}
export interface OperationalMetricsSink { emit(input: OperationalMetricDeltaInput): Promise<void>; }
export interface OperationalMetricCursor { recordedAt: Date; id: string; }

export interface DiagnosticTrace {
  schema: "diagnostic-trace/v1";
  operatorTraceRef: string;
  workspaceId: string;
  category: "authorization" | "provider" | "persistence" | "quota" | "budget" | "artifact" | "runtime";
  severity: "info" | "warning" | "error";
  code: string;
  stage: "admission" | "planning" | "execution" | "settlement" | "reconciliation" | "storage";
  outcome: "succeeded" | "failed" | "unknown" | "denied" | "waiting";
  providerFamily: "google" | "openai" | "kie" | "internal" | "unknown";
  httpStatus: number | null;
  retryable: boolean | null;
  durationMs: number | null;
  attempt: number | null;
  createdAt: Date;
  expiresAt: Date;
}
export interface DiagnosticTraceAccessAuditEvent { schema: "diagnostic-trace-access-audit-event/v1"; id: string; workspaceId: string; operatorTraceRef: string; operatorId: string; outcome: "granted" | "denied" | "not_found"; occurredAt: Date; }

export interface WorkspaceTelemetryOperatorGrant {
  schema: "workspace-telemetry-operator-grant/v1";
  id: string;
  workspaceId: string;
  operatorId: string;
  scopes: Array<"trace.read" | "support_bundle.read">;
  status: "active" | "revoked" | "expired";
  issuedByUserId: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedByUserId: string | null;
}
export interface OperatorGrantAuditEvent { schema: "operator-grant-audit-event/v1"; id: string; workspaceId: string; grantId: string; eventType: "grant.issued" | "grant.revoked" | "grant.expired"; actorType: "user" | "system"; actorId: string | null; occurredAt: Date; }

export interface ObservabilityRetentionPolicy {
  schema: "observability-retention-policy/v1";
  id: string;
  workspaceId: string;
  currentRevisionId: string;
  status: "active" | "expired";
  createdAt: Date;
  updatedAt: Date;
}

export interface ObservabilityRetentionRevision {
  schema: "observability-retention-revision/v1";
  id: string;
  policyId: string;
  workspaceId: string;
  revision: number;
  metricTtlSeconds: number;
  traceTtlSeconds: number;
  supportBundleTtlSeconds: number;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface SupportBundleConsent {
  schema: "support-bundle-consent/v1";
  grantedByUserId: string;
  purpose: "incident_diagnosis" | "support_case";
  selectionDigest: `sha256:${string}`;
  grantedAt: Date;
  expiresAt: Date;
}

export type SupportBundleProjectionKind = "run_summary" | "run_event_summary" | "artifact_metadata" | "usage_summary" | "cost_summary" | "budget_summary" | "quota_reservation_summary" | "quota_wait_summary";
export interface SupportBundleSelection { reference: ContractEvidenceReference; projectionKind: SupportBundleProjectionKind; projectedContentDigest: `sha256:${string}`; projectedSizeBytes: number; }

export interface SupportBundleRecord {
  schema: "support-bundle/v1";
  id: string;
  workspaceId: string;
  state: "stored" | "expired" | "revoked";
  selections: SupportBundleSelection[];
  consent: SupportBundleConsent;
  storageKey: string | null;
  contentDigest: `sha256:${string}` | null;
  sizeBytes: number;
  createdAt: Date;
  expiresAt: Date;
  storedAt: Date;
}

export type SupportBundleDto = Omit<SupportBundleRecord, "storageKey">;
export interface SupportBundleCleanupTarget { bundleId: string; workspaceId: string; storageKey: string; contentDigest: `sha256:${string}`; }

export interface SupportBundleAuditEvent {
  schema: "support-bundle-audit-event/v1";
  id: string;
  workspaceId: string;
  bundleId: string;
  eventType: "bundle.stored" | "bundle.expired" | "bundle.revoked" | "bundle.read" | "bundle.read_denied";
  actorType: "user" | "operator" | "system";
  actorId: string | null;
  occurredAt: Date;
}
export interface SupportBundleAccessAuditEvent { schema: "support-bundle-access-audit-event/v1"; id: string; workspaceId: string; bundleId: string; operatorId: string; outcome: "granted" | "denied" | "not_found"; occurredAt: Date; }

export interface ObservabilityRepository {
  getAdminReceipt(workspaceId: string, key: string): Promise<{ digest: string; resourceId: string } | null>;
  getRetentionPolicy(workspaceId: string): Promise<{ policy: ObservabilityRetentionPolicy; revision: ObservabilityRetentionRevision } | null>;
  appendRetentionRevision(input: { policy: ObservabilityRetentionPolicy; revision: ObservabilityRetentionRevision; idempotencyKey: string; digest: string }): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  applyMetricDelta(input: { aggregate: OperationalMetricAggregate; eventId: string; requestDigest: string; countDelta: number; sumDelta: number }): Promise<{ kind: "applied" | "replayed"; aggregate: OperationalMetricAggregate } | { kind: "conflict" | "unavailable" }>;
  listMetrics(input: { workspaceId: string; cursor: OperationalMetricCursor | null; limit: number; at: Date }): Promise<OperationalMetricAggregate[]>;
  appendTrace(trace: DiagnosticTrace): Promise<"created" | "replayed" | "conflict">;
  getTrace(workspaceId: string, operatorTraceRef: string, at: Date): Promise<DiagnosticTrace | null>;
  appendTraceAccessAudit(audit: DiagnosticTraceAccessAuditEvent): Promise<void>;
  appendOperatorGrant(input: { grant: WorkspaceTelemetryOperatorGrant; idempotencyKey: string; digest: string; audit: OperatorGrantAuditEvent }): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  getOperatorGrant(workspaceId: string, grantId: string): Promise<WorkspaceTelemetryOperatorGrant | null>;
  listOperatorGrants(input: { workspaceId: string; operatorId: string; at: Date; limit: number }): Promise<WorkspaceTelemetryOperatorGrant[]>;
  revokeOperatorGrant(input: { workspaceId: string; grantId: string; revokedByUserId: string; revokedAt: Date; audit: OperatorGrantAuditEvent }): Promise<"created" | "replayed" | "conflict">;
  createSupportBundle(input: { bundle: SupportBundleRecord; audit: SupportBundleAuditEvent; idempotencyKey: string; digest: string; bindIntentRequestDigest?: `sha256:${string}` }): Promise<"created" | "replayed" | "conflict" | "unavailable">;
  getSupportBundle(workspaceId: string, bundleId: string, at: Date): Promise<SupportBundleRecord | null>;
  getSupportBundleRecord(workspaceId: string, bundleId: string): Promise<SupportBundleRecord | null>;
  revokeSupportBundle(input: { workspaceId: string; bundleId: string; actorUserId: string; revokedAt: Date; audit: SupportBundleAuditEvent }): Promise<"created" | "replayed" | "conflict">;
  listSupportBundleAudit(input: { workspaceId: string; bundleId: string; limit: number }): Promise<SupportBundleAuditEvent[]>;
  appendSupportBundleAccessAudit(audit: SupportBundleAccessAuditEvent): Promise<void>;
  listSupportBundleCleanup(input: { at: Date; limit: number }): Promise<SupportBundleCleanupTarget[]>;
  acknowledgeSupportBundleCleanup(input: SupportBundleCleanupTarget): Promise<"cleared" | "replayed" | "conflict">;
  expire(at: Date, limit: number): Promise<{ traces: number; metrics: number; bundles: number; grants: number }>;
}
