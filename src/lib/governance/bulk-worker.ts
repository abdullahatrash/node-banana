import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import { workspaceGovernanceResources, workspaceMembers } from "@/lib/db/schema";
import type {
  BulkOperationItem,
  GovernanceAuditEvent,
  GovernanceBulkAuthorizationPort,
  GovernanceBulkCapabilityPort,
  GovernanceRepository,
  GovernanceResource,
} from "./types";

function audit(job: GovernanceResource, action: string, outcome: GovernanceAuditEvent["outcome"], now: Date): GovernanceAuditEvent {
  return { schema: "workspace-audit-event/v1", id: `audit_${randomUUID().replaceAll("-", "")}`, workspaceId: job.workspaceId, actor: { kind: "system", id: null }, capability: "bulk.process@1", action, resource: { kind: job.kind, id: job.id }, outcome, redactedDetails: {}, occurredAt: now };
}

function terminalStatus(items: BulkOperationItem[]): string {
  if (items.some((item) => item.state === "outcome_unknown")) return "outcome_unknown";
  if (items.some((item) => item.state === "failed_known")) return "failed_known";
  if (items.every((item) => item.state === "cancelled")) return "cancelled";
  if (items.some((item) => item.state === "cancelled")) return "cancelled";
  return "succeeded";
}

const BULK_LEASE_MS = 15 * 60_000;
interface BulkLease { id: string; claimedAt: string; expiresAt: string; attempt: number }
interface BulkJobBody {
  requestedByUserId: string; concurrency: number; cancellationRequestedAt: string | null;
  items: BulkOperationItem[]; lease: BulkLease | null; [key: string]: unknown;
}

export class GovernanceBulkWorker {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly authorization: GovernanceBulkAuthorizationPort,
    private readonly capabilities: GovernanceBulkCapabilityPort,
    private readonly clock: { now(): Date } = { now: () => new Date() },
  ) {}

  async process(input: { workspaceId: string; operationId: string }): Promise<void> {
    const found = await this.repository.getResource<BulkJobBody>({ workspaceId: input.workspaceId, kind: "bulk_operation", id: input.operationId });
    if (!found || ["succeeded", "failed_known", "outcome_unknown", "cancelled"].includes(found.status)) return;
    const claimed = await this.claim(found);
    if (!claimed) return;
    let job: GovernanceResource = claimed;

    while (true) {
      const body = job.body as BulkJobBody;
      if (job.status === "cancelling" || body.cancellationRequestedAt) {
        const items = body.items.map((item) => ["queued", "previewed"].includes(item.state) ? { ...item, state: "cancelled" as const, outcome: { safeReason: "cancelled_before_dispatch" } } : item);
        await this.transition(job, terminalStatus(items), { ...body, lease: null, items, completedAt: this.clock.now().toISOString() }, "cancel_bulk_processing", "completed");
        return;
      }
      const batch = body.items.filter((item) => item.state === "queued").slice(0, body.concurrency);
      if (!batch.length) {
        const final = terminalStatus(body.items);
        await this.transition(job, final, { ...body, lease: null, completedAt: this.clock.now().toISOString() }, "complete_bulk_processing", final === "succeeded" ? "completed" : "failed");
        return;
      }
      const batchIds = new Set(batch.map((item) => item.id));
      const renewedLease = body.lease ? { ...body.lease, expiresAt: new Date(this.clock.now().getTime() + BULK_LEASE_MS).toISOString() } : null;
      job = await this.transition(job, "running", { ...body, lease: renewedLease, items: body.items.map((item) => batchIds.has(item.id) ? { ...item, state: "running" } : item) }, "dispatch_bulk_batch", "accepted");
      const outcomes = await Promise.all(batch.map(async (item) => {
        const actor = await this.authorization.resolveActor({ sourceWorkspaceId: input.workspaceId, targetWorkspaceId: item.targetWorkspaceId, userId: body.requestedByUserId, capability: item.capability, targetKind: item.targetKind, targetId: item.targetId, evaluatedAt: this.clock.now() });
        if (!actor) return { item, result: { type: "failed_known" as const, code: "TARGET_WORKSPACE_FORBIDDEN" } };
        try {
          return { item, result: await this.capabilities.execute({ actor, capability: item.capability, capabilityInput: item.input, idempotencyKey: item.idempotencyKey }) };
        } catch {
          return { item, result: { type: "outcome_unknown" as const, safeReason: "dispatcher_transport_interrupted" } };
        }
      }));
      const latest = await this.repository.getResource({ workspaceId: input.workspaceId, kind: "bulk_operation", id: input.operationId });
      if (!latest) return;
      const latestBody = latest.body as typeof body;
      const byId = new Map(outcomes.map(({ item, result }) => [item.id, result]));
      const items = latestBody.items.map((item) => {
        const outcome = byId.get(item.id);
        if (!outcome || item.state !== "running") return item;
        if (outcome.type === "succeeded") return { ...item, state: "succeeded" as const, outcome: { output: outcome.output } };
        if (outcome.type === "failed_known") return { ...item, state: "failed_known" as const, outcome: { code: outcome.code } };
        return { ...item, state: "outcome_unknown" as const, outcome: { safeReason: outcome.safeReason } };
      });
      job = await this.transition(latest, latest.status, { ...latestBody, items }, "record_bulk_batch", "completed");
    }
  }

  async recoverExpired(input: { workspaceId: string }): Promise<number> {
    const now = this.clock.now();
    const jobs = (await this.repository.listResources<BulkJobBody>({ workspaceId: input.workspaceId, kinds: ["bulk_operation"] }))
      .filter((job) => ["running", "cancelling"].includes(job.status));
    const expired = jobs.filter((job) => !job.body.lease || new Date(job.body.lease.expiresAt) <= now);
    for (const job of expired) await this.process({ workspaceId: input.workspaceId, operationId: job.id });
    return expired.length;
  }

  private async claim(job: GovernanceResource<BulkJobBody>): Promise<GovernanceResource<BulkJobBody> | null> {
    const now = this.clock.now();
    if (job.body.lease && new Date(job.body.lease.expiresAt) > now) return null;
    if (!["queued", "running", "cancelling"].includes(job.status)) throw new Error("Bulk Operation is not claimable.");
    const interrupted = job.body.items.map((item) => item.state === "running" ? { ...item, state: "outcome_unknown" as const, outcome: { safeReason: "worker_interrupted_after_dispatch" } } : item);
    const lease: BulkLease = { id: `lease_${randomUUID().replaceAll("-", "")}`, claimedAt: now.toISOString(), expiresAt: new Date(now.getTime() + BULK_LEASE_MS).toISOString(), attempt: (job.body.lease?.attempt ?? 0) + 1 };
    const next: GovernanceResource<BulkJobBody> = { ...job, version: job.version + 1, status: job.status === "cancelling" ? "cancelling" : "running", body: { ...job.body, items: interrupted, lease, startedAt: (job.body.startedAt as string | undefined) ?? now.toISOString() }, updatedAt: now };
    const outcome = await this.repository.commit({ receipt: { workspaceId: job.workspaceId, capability: "bulk.claim@1", idempotencyKey: `bulk-claim-${job.id}-${job.version}-${lease.id}`, requestDigest: canonicalDigest({ operationId: job.id, version: job.version, lease }), result: { operationId: job.id, leaseId: lease.id }, createdAt: now }, mutations: [{ type: "update", expectedVersion: job.version, resource: next }], audit: audit(job, "claim_bulk_processing", "accepted", now) });
    return outcome.type === "committed" ? next : null;
  }

  private async transition(job: GovernanceResource, status: string, body: Record<string, unknown>, action: string, outcome: GovernanceAuditEvent["outcome"]): Promise<GovernanceResource> {
    const now = this.clock.now();
    const next: GovernanceResource = { ...job, version: job.version + 1, status, body, updatedAt: now };
    const committed = await this.repository.commit({ receipt: { workspaceId: job.workspaceId, capability: "bulk.process@1", idempotencyKey: `${action}-${job.id}-${job.version}`, requestDigest: canonicalDigest({ jobId: job.id, version: job.version, action }), result: { operationId: job.id, status }, createdAt: now }, mutations: [{ type: "update", expectedVersion: job.version, resource: next }], audit: audit(job, action, outcome, now) });
    if (committed.type === "conflict") throw new Error("Bulk Operation changed concurrently.");
    return next;
  }
}

export class DrizzleGovernanceBulkAuthorizationPort implements GovernanceBulkAuthorizationPort {
  async resolveActor(input: Parameters<GovernanceBulkAuthorizationPort["resolveActor"]>[0]) {
    const [membership] = await getDb().select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.targetWorkspaceId), eq(workspaceMembers.userId, input.userId))).limit(1);
    if (!membership) return null;
    if (input.sourceWorkspaceId === input.targetWorkspaceId) {
      return { workspaceId: input.targetWorkspaceId, userId: input.userId, legacyRole: membership.role };
    }
    const [assignment] = await getDb().select({ id: workspaceGovernanceResources.id }).from(workspaceGovernanceResources).where(and(
      eq(workspaceGovernanceResources.workspaceId, input.sourceWorkspaceId),
      eq(workspaceGovernanceResources.kind, "portfolio_assignment"),
      eq(workspaceGovernanceResources.status, "active"),
      sql`${workspaceGovernanceResources.body}->>'assigneeUserId' = ${input.userId}`,
      sql`${workspaceGovernanceResources.body}->>'sourceWorkspaceId' = ${input.sourceWorkspaceId}`,
      sql`${workspaceGovernanceResources.body}->>'targetWorkspaceId' = ${input.targetWorkspaceId}`,
      sql`${workspaceGovernanceResources.body}->'permissions' @> '["bulk"]'::jsonb`,
      sql`${workspaceGovernanceResources.body}->'capabilityAllowlist' @> ${JSON.stringify([input.capability])}::jsonb`,
      sql`${workspaceGovernanceResources.body}->'resourceAllowlist' @> ${JSON.stringify([{ kind: input.targetKind, id: input.targetId }])}::jsonb`,
      or(isNull(sql`${workspaceGovernanceResources.body}->>'expiresAt'`), gt(sql`(${workspaceGovernanceResources.body}->>'expiresAt')::timestamptz`, input.evaluatedAt)),
    )).limit(1);
    return assignment ? { workspaceId: input.targetWorkspaceId, userId: input.userId, legacyRole: membership.role, portfolioAssignmentId: assignment.id } : null;
  }
}

export class ApplicationGovernanceBulkCapabilityPort implements GovernanceBulkCapabilityPort {
  async execute(input: Parameters<GovernanceBulkCapabilityPort["execute"]>[0]) {
    const { dispatchCapability } = await import("@/lib/agent-runtime/server-dispatcher");
    const response = await dispatchCapability({ capability: input.capability, input: input.capabilityInput }, { securityContext: { kind: "human", workspaceId: input.actor.workspaceId, userId: input.actor.userId, role: input.actor.legacyRole, idempotencyKey: input.idempotencyKey } });
    if (response.type === "capability_error") return { type: "failed_known" as const, code: response.code };
    return { type: "succeeded" as const, output: response.output };
  }
}
