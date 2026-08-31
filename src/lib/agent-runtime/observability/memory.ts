import type { DiagnosticTrace, DiagnosticTraceAccessAuditEvent, ObservabilityRepository, ObservabilityRetentionPolicy, ObservabilityRetentionRevision, OperationalMetricAggregate, OperatorGrantAuditEvent, SupportBundleAccessAuditEvent, SupportBundleAuditEvent, SupportBundleRecord, WorkspaceTelemetryOperatorGrant } from "./types";

function copy<T>(value: T): T { return structuredClone(value); }

export class InMemoryObservabilityRepository implements ObservabilityRepository {
  readonly policies = new Map<string, ObservabilityRetentionPolicy>();
  readonly revisions = new Map<string, ObservabilityRetentionRevision>();
  readonly adminReceipts = new Map<string, { digest: string; resourceId: string }>();
  readonly metrics = new Map<string, OperationalMetricAggregate>();
  readonly metricReceipts = new Map<string, { digest: string; aggregateId: string }>();
  readonly traces = new Map<string, DiagnosticTrace>();
  readonly traceAccessAudits = new Map<string, DiagnosticTraceAccessAuditEvent>();
  readonly bundles = new Map<string, SupportBundleRecord>();
  readonly audits = new Map<string, SupportBundleAuditEvent>();
  readonly bundleAccessAudits = new Map<string, SupportBundleAccessAuditEvent>();
  readonly bundleReceipts = new Map<string, { digest: string; resourceId: string }>();
  readonly grants = new Map<string, WorkspaceTelemetryOperatorGrant>();
  readonly grantAudits = new Map<string, OperatorGrantAuditEvent>();
  private tail: Promise<void> = Promise.resolve();

  private async mutate<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tail = previous.then(() => current);
    await previous;
    try { return await operation(); } finally { release(); }
  }
  async getAdminReceipt(workspaceId: string, key: string) { return copy(this.adminReceipts.get(`${workspaceId}:${key}`) ?? null); }
  async getRetentionPolicy(workspaceId: string) {
    const policy = this.policies.get(workspaceId);
    const revision = policy ? this.revisions.get(policy.currentRevisionId) : null;
    return policy && revision ? { policy: copy(policy), revision: copy(revision) } : null;
  }
  appendRetentionRevision(input: { policy: ObservabilityRetentionPolicy; revision: ObservabilityRetentionRevision; idempotencyKey: string; digest: string }) {
    return this.mutate(() => {
      const key = `${input.policy.workspaceId}:${input.idempotencyKey}`;
      const receipt = this.adminReceipts.get(key);
      if (receipt) return receipt.digest === input.digest ? "replayed" as const : "conflict" as const;
      const current = this.policies.get(input.policy.workspaceId);
      if (current && input.revision.revision !== (this.revisions.get(current.currentRevisionId)?.revision ?? 0) + 1) return "conflict" as const;
      const currentRevision = current ? this.revisions.get(current.currentRevisionId) : null;
      if (currentRevision && (input.revision.metricTtlSeconds > currentRevision.metricTtlSeconds || input.revision.traceTtlSeconds > currentRevision.traceTtlSeconds || input.revision.supportBundleTtlSeconds > currentRevision.supportBundleTtlSeconds)) return "conflict" as const;
      this.policies.set(input.policy.workspaceId, copy(input.policy));
      this.revisions.set(input.revision.id, copy(input.revision));
      this.adminReceipts.set(key, { digest: input.digest, resourceId: input.revision.id });
      return "created" as const;
    });
  }
  applyMetricDelta(input: { aggregate: OperationalMetricAggregate; eventId: string; requestDigest: string; countDelta: number; sumDelta: number }) { return this.mutate(() => { const key = `${input.aggregate.workspaceId}:${input.eventId}`; const receipt = this.metricReceipts.get(key); const prior = this.metrics.get(input.aggregate.id); if (receipt) return receipt.digest === input.requestDigest && prior ? { kind: "replayed" as const, aggregate: copy(prior) } : { kind: "conflict" as const }; const policy = this.policies.get(input.aggregate.workspaceId); const retention = policy ? this.revisions.get(policy.currentRevisionId) : null; if (!retention || input.aggregate.expiresAt.getTime() > input.aggregate.recordedAt.getTime() + retention.metricTtlSeconds * 1000) return { kind: "conflict" as const }; const next = prior ? { ...prior, count: prior.count + input.countDelta, sum: prior.sum + input.sumDelta, recordedAt: input.aggregate.recordedAt, expiresAt: input.aggregate.expiresAt } : copy(input.aggregate); this.metrics.set(next.id, next); this.metricReceipts.set(key, { digest: input.requestDigest, aggregateId: next.id }); return { kind: "applied" as const, aggregate: copy(next) }; }); }
  async listMetrics(input: { workspaceId: string; cursor: { recordedAt: Date; id: string } | null; limit: number; at: Date }) { return [...this.metrics.values()].filter((item) => item.workspaceId === input.workspaceId && item.expiresAt > input.at && (!input.cursor || item.recordedAt > input.cursor.recordedAt || (item.recordedAt.getTime() === input.cursor.recordedAt.getTime() && item.id > input.cursor.id))).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || a.id.localeCompare(b.id)).slice(0, input.limit).map(copy); }
  appendTrace(trace: DiagnosticTrace) { return this.mutate(() => { const policy = this.policies.get(trace.workspaceId); const retention = policy ? this.revisions.get(policy.currentRevisionId) : null; if (!retention || trace.expiresAt.getTime() > trace.createdAt.getTime() + retention.traceTtlSeconds * 1000) return "conflict" as const; const prior = this.traces.get(trace.operatorTraceRef); if (prior) return JSON.stringify(prior) === JSON.stringify(trace) ? "replayed" as const : "conflict" as const; this.traces.set(trace.operatorTraceRef, copy(trace)); return "created" as const; }); }
  async getTrace(workspaceId: string, operatorTraceRef: string, at: Date) { const trace = this.traces.get(operatorTraceRef); return trace?.workspaceId === workspaceId && trace.expiresAt > at ? copy(trace) : null; }
  appendTraceAccessAudit(audit: DiagnosticTraceAccessAuditEvent) { return this.mutate(() => { this.traceAccessAudits.set(audit.id, copy(audit)); }); }
  appendOperatorGrant(input: { grant: WorkspaceTelemetryOperatorGrant; idempotencyKey: string; digest: string; audit: OperatorGrantAuditEvent }) { return this.mutate(() => { const key = `grant:${input.grant.workspaceId}:${input.idempotencyKey}`; const receipt = this.adminReceipts.get(key); if (receipt) return receipt.digest === input.digest ? "replayed" as const : "conflict" as const; if (this.grants.has(input.grant.id)) return "conflict" as const; this.grants.set(input.grant.id, copy(input.grant)); this.grantAudits.set(input.audit.id, copy(input.audit)); this.adminReceipts.set(key, { digest: input.digest, resourceId: input.grant.id }); return "created" as const; }); }
  async getOperatorGrant(workspaceId: string, grantId: string) { const grant = this.grants.get(grantId); return grant?.workspaceId === workspaceId ? copy(grant) : null; }
  async listOperatorGrants(input: { workspaceId: string; operatorId: string; at: Date; limit: number }) { return [...this.grants.values()].filter((grant) => grant.workspaceId === input.workspaceId && grant.operatorId === input.operatorId && grant.status === "active" && grant.expiresAt > input.at).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id)).slice(0, input.limit).map(copy); }
  revokeOperatorGrant(input: { workspaceId: string; grantId: string; revokedByUserId: string; revokedAt: Date; audit: OperatorGrantAuditEvent }) { return this.mutate(() => { const grant = this.grants.get(input.grantId); if (!grant || grant.workspaceId !== input.workspaceId) return "conflict" as const; if (grant.status === "revoked") return grant.revokedByUserId === input.revokedByUserId ? "replayed" as const : "conflict" as const; this.grants.set(grant.id, { ...grant, status: "revoked", revokedAt: input.revokedAt, revokedByUserId: input.revokedByUserId }); this.grantAudits.set(input.audit.id, copy(input.audit)); return "created" as const; }); }
  createSupportBundle(input: { bundle: SupportBundleRecord; audit: SupportBundleAuditEvent; idempotencyKey: string; digest: string; bindIntentRequestDigest?: `sha256:${string}` }) {
    return this.mutate(() => {
      const key = `${input.bundle.workspaceId}:${input.idempotencyKey}`;
      const receipt = this.bundleReceipts.get(key);
      if (receipt) return receipt.digest === input.digest ? "replayed" as const : "conflict" as const;
      const policy = this.policies.get(input.bundle.workspaceId); const retention = policy ? this.revisions.get(policy.currentRevisionId) : null;
      if (!retention || input.bundle.expiresAt.getTime() > input.bundle.createdAt.getTime() + retention.supportBundleTtlSeconds * 1000) return "conflict" as const;
      if (this.bundles.has(input.bundle.id) || this.audits.has(input.audit.id)) return "conflict" as const;
      this.bundles.set(input.bundle.id, copy(input.bundle)); this.audits.set(input.audit.id, copy(input.audit)); this.bundleReceipts.set(key, { digest: input.digest, resourceId: input.bundle.id });
      return "created" as const;
    });
  }
  async getSupportBundle(workspaceId: string, bundleId: string, at: Date) { const bundle = this.bundles.get(bundleId); return bundle?.workspaceId === workspaceId && bundle.expiresAt > at && bundle.state !== "expired" && bundle.state !== "revoked" ? copy(bundle) : null; }
  async getSupportBundleRecord(workspaceId: string, bundleId: string) { const bundle = this.bundles.get(bundleId); return bundle?.workspaceId === workspaceId ? copy(bundle) : null; }
  revokeSupportBundle(input: { workspaceId: string; bundleId: string; actorUserId: string; revokedAt: Date; audit: SupportBundleAuditEvent }) { return this.mutate(() => { const bundle = this.bundles.get(input.bundleId); if (!bundle || bundle.workspaceId !== input.workspaceId) return "conflict" as const; if (bundle.state === "revoked") return "replayed" as const; if (bundle.state === "expired") return "conflict" as const; this.bundles.set(bundle.id, { ...bundle, state: "revoked" }); this.audits.set(input.audit.id, copy(input.audit)); return "created" as const; }); }
  async listSupportBundleAudit(input: { workspaceId: string; bundleId: string; limit: number }) { const lifecycle = [...this.audits.values()].filter((event) => event.workspaceId === input.workspaceId && event.bundleId === input.bundleId); const access = [...this.bundleAccessAudits.values()].filter((event) => event.workspaceId === input.workspaceId && event.bundleId === input.bundleId).map((event): SupportBundleAuditEvent => ({ schema: "support-bundle-audit-event/v1", id: event.id, workspaceId: event.workspaceId, bundleId: event.bundleId, eventType: event.outcome === "granted" ? "bundle.read" : "bundle.read_denied", actorType: "operator", actorId: event.operatorId, occurredAt: event.occurredAt })); return [...lifecycle, ...access].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id)).slice(0, input.limit).map(copy); }
  appendSupportBundleAccessAudit(audit: SupportBundleAccessAuditEvent) { return this.mutate(() => { this.bundleAccessAudits.set(audit.id, copy(audit)); }); }
  async listSupportBundleCleanup(input: { at: Date; limit: number }) { const values = [...this.bundles.values()]; return values.filter((bundle) => bundle.state !== "stored" && bundle.storageKey && bundle.contentDigest && !values.some((candidate) => candidate.state === "stored" && candidate.expiresAt > input.at && candidate.storageKey === bundle.storageKey)).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id)).slice(0, input.limit).map((bundle) => ({ bundleId: bundle.id, workspaceId: bundle.workspaceId, storageKey: bundle.storageKey!, contentDigest: bundle.contentDigest! })); }
  acknowledgeSupportBundleCleanup(input: { bundleId: string; workspaceId: string; storageKey: string; contentDigest: `sha256:${string}` }) { return this.mutate(() => { const bundle = this.bundles.get(input.bundleId); if (!bundle || bundle.workspaceId !== input.workspaceId || bundle.state === "stored") return "conflict" as const; if (!bundle.storageKey && !bundle.contentDigest) return "replayed" as const; if (bundle.storageKey !== input.storageKey || bundle.contentDigest !== input.contentDigest) return "conflict" as const; this.bundles.set(bundle.id, { ...bundle, storageKey: null, contentDigest: null }); return "cleared" as const; }); }
  expire(at: Date, limit: number) {
    return this.mutate(() => {
      let traces = 0, metrics = 0, bundles = 0, grants = 0;
      for (const [key, value] of this.traces) { if (traces >= limit) break; if (value.expiresAt <= at) { this.traces.delete(key); traces++; } }
      for (const [key, value] of this.metrics) { if (metrics >= limit) break; if (value.expiresAt <= at) { this.metrics.delete(key); metrics++; } }
      for (const [key, value] of this.bundles) { if (bundles >= limit) break; if (value.expiresAt <= at && value.state !== "expired" && value.state !== "revoked") { this.bundles.set(key, { ...value, state: "expired" }); const audit: SupportBundleAuditEvent = { schema: "support-bundle-audit-event/v1", id: `expire:${key}`, workspaceId: value.workspaceId, bundleId: key, eventType: "bundle.expired", actorType: "system", actorId: null, occurredAt: at }; this.audits.set(audit.id, audit); bundles++; } }
      for (const [key, value] of this.grants) { if (grants >= limit) break; if (value.expiresAt <= at && value.status === "active") { this.grants.set(key, { ...value, status: "expired" }); this.grantAudits.set(`expire:${key}`, { schema: "operator-grant-audit-event/v1", id: `expire:${key}`, workspaceId: value.workspaceId, grantId: key, eventType: "grant.expired", actorType: "system", actorId: null, occurredAt: at }); grants++; } }
      return { traces, metrics, bundles, grants };
    });
  }
}
