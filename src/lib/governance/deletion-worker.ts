import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { GovernanceAuditEvent, GovernanceRepository, GovernanceResource } from "./types";

export type GovernanceDeletionSystemOutcome =
  | { state: "deleted" | "not_found"; evidenceRef: string }
  | { state: "retained"; evidenceRef: string; reason: string }
  | { state: "delayed"; retryAt: string; reason: string }
  | { state: "failed_known" | "outcome_unknown"; reason: string };

export interface GovernanceDeletionAdapter {
  delete(input: { workspaceId: string; system: string; resourceKind: string; resourceId: string; retentionClass: string; idempotencyKey: string }): Promise<GovernanceDeletionSystemOutcome>;
}

export const FAIL_CLOSED_GOVERNANCE_DELETION_ADAPTER: GovernanceDeletionAdapter = {
  delete: async () => ({ state: "failed_known", reason: "DELETION_ADAPTER_NOT_CONFIGURED" }),
};

interface DeletionJobBody {
  resourceKind: string;
  resourceId: string;
  retentionClass: string;
  systems: string[];
  outcomes: Record<string, GovernanceDeletionSystemOutcome>;
  lease?: DeletionLease | null;
  [key: string]: unknown;
}

function audit(job: GovernanceResource, outcome: GovernanceAuditEvent["outcome"], now: Date): GovernanceAuditEvent {
  return { schema: "workspace-audit-event/v1", id: `audit_${randomUUID().replaceAll("-", "")}`, workspaceId: job.workspaceId, actor: { kind: "system", id: null }, capability: "retention.deletions.process@1", action: "process_deletion", resource: { kind: job.kind, id: job.id }, outcome, redactedDetails: {}, occurredAt: now };
}

export class GovernanceDeletionWorker {
  constructor(private readonly repository: GovernanceRepository, private readonly adapter: GovernanceDeletionAdapter = FAIL_CLOSED_GOVERNANCE_DELETION_ADAPTER, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  async process(input: { workspaceId: string; deletionReceiptId: string }): Promise<void> {
    const found = await this.repository.getResource<DeletionJobBody>({ workspaceId: input.workspaceId, kind: "deletion_receipt", id: input.deletionReceiptId });
    if (!found || ["completed", "completed_hold", "failed_known", "outcome_unknown"].includes(found.status)) return;
    const job = await this.claim(found);
    if (!job) return;
    const now = this.clock.now();
    const body = job.body;
    const outcomes = { ...body.outcomes };
    for (const system of body.systems) {
      const previous = outcomes[system];
      if (previous && !["delayed"].includes(previous.state)) continue;
      try {
        outcomes[system] = await this.adapter.delete({ workspaceId: input.workspaceId, system, resourceKind: body.resourceKind, resourceId: body.resourceId, retentionClass: body.retentionClass, idempotencyKey: `${job.id}:${system}` });
      } catch {
        outcomes[system] = { state: "outcome_unknown", reason: "ADAPTER_TRANSPORT_INTERRUPTED" };
      }
    }
    const values = Object.values(outcomes);
    const status = values.some((item) => item.state === "outcome_unknown") ? "outcome_unknown" : values.some((item) => item.state === "failed_known") ? "failed_known" : values.some((item) => item.state === "delayed") ? "delayed" : "completed";
    const next: GovernanceResource<DeletionJobBody> = { ...job, version: job.version + 1, status, body: { ...body, lease: null, outcomes, completedAt: status === "completed" ? now.toISOString() : null }, updatedAt: now };
    const mutations: Parameters<GovernanceRepository["commit"]>[0]["mutations"] = [{ type: "update", expectedVersion: job.version, resource: next }];
    let tombstoneId: string | null = null;
    if (status === "completed") {
      tombstoneId = `${body.resourceKind}:${body.resourceId}`;
      mutations.push({ type: "create", expectedVersion: null, resource: { id: tombstoneId, workspaceId: input.workspaceId, kind: "tombstone", version: 1, status: "active", body: { resourceKind: body.resourceKind, resourceId: body.resourceId, deletionReceiptId: job.id, systemOutcomes: outcomes, retainedEvidenceOnly: values.some((item) => item.state === "retained") }, createdByUserId: job.createdByUserId, createdAt: now, updatedAt: now } });
    }
    const committed = await this.repository.commit({ receipt: { workspaceId: input.workspaceId, capability: "retention.deletions.process@1", idempotencyKey: `deletion-${job.id}-${job.version}`, requestDigest: canonicalDigest({ deletionReceiptId: job.id, version: job.version, outcomes }), result: { deletionReceiptId: job.id, status, tombstoneId }, createdAt: now }, mutations, audit: audit(job, status === "completed" ? "completed" : "failed", now) });
    if (committed.type === "conflict") throw new Error("Deletion request changed concurrently.");
  }

  async recoverExpired(input: { workspaceId: string }): Promise<number> {
    const now = this.clock.now();
    const jobs = (await this.repository.listResources<DeletionJobBody>({ workspaceId: input.workspaceId, kinds: ["deletion_receipt"] }))
      .filter((job) => job.status === "running" && (!job.body.lease || new Date(job.body.lease.expiresAt) <= now));
    for (const job of jobs) await this.process({ workspaceId: input.workspaceId, deletionReceiptId: job.id });
    return jobs.length;
  }

  private async claim(job: GovernanceResource<DeletionJobBody>): Promise<GovernanceResource<DeletionJobBody> | null> {
    const now = this.clock.now();
    if (job.status === "running" && job.body.lease && new Date(job.body.lease.expiresAt) > now) return null;
    if (!["queued", "delayed", "running"].includes(job.status)) return null;
    const lease: DeletionLease = { id: `lease_${randomUUID().replaceAll("-", "")}`, fence: (job.body.lease?.fence ?? 0) + 1, expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString() };
    const next: GovernanceResource<DeletionJobBody> = { ...job, version: job.version + 1, status: "running", body: { ...job.body, lease }, updatedAt: now };
    const committed = await this.repository.commit({ receipt: { workspaceId: job.workspaceId, capability: "retention.deletions.claim@1", idempotencyKey: `deletion-claim-${job.id}-${job.version}-${lease.id}`, requestDigest: canonicalDigest({ id: job.id, version: job.version, lease }), result: { deletionReceiptId: job.id, lease }, createdAt: now }, mutations: [{ type: "update", expectedVersion: job.version, resource: next }], audit: audit(job, "accepted", now) });
    return committed.type === "committed" ? next : null;
  }
}

interface DeletionLease { id: string; fence: number; expiresAt: string }
