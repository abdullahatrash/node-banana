import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  GovernanceAuditEvent,
  GovernanceCanonicalEffect,
  GovernanceCommit,
  GovernanceCommitResult,
  GovernanceRepository,
  GovernanceResource,
  GovernanceResourceKind,
  GovernanceReceipt,
  GovernanceSecretDelivery,
} from "./types";

function copy<T>(value: T): T {
  return structuredClone(value);
}

function resourceKey(workspaceId: string, kind: string, id: string): string {
  return `${workspaceId}\u0000${kind}\u0000${id}`;
}

function receiptKey(receipt: Pick<GovernanceReceipt, "workspaceId" | "capability" | "idempotencyKey">) {
  return `${receipt.workspaceId}\u0000${receipt.capability}\u0000${receipt.idempotencyKey}`;
}

export class InMemoryGovernanceRepository implements GovernanceRepository {
  readonly resources = new Map<string, GovernanceResource>();
  readonly receipts = new Map<string, GovernanceReceipt>();
  readonly secretDeliveries = new Map<string, GovernanceSecretDelivery>();
  readonly audit: GovernanceAuditEvent[] = [];
  readonly canonicalEffects: GovernanceCanonicalEffect[] = [];
  private tail: Promise<void> = Promise.resolve();

  async findReceipt(input: {
    workspaceId: string;
    capability: string;
    idempotencyKey: string;
  }): Promise<GovernanceReceipt | null> {
    const value = this.receipts.get(receiptKey(input));
    return value ? copy(value) : null;
  }

  async findSecretDelivery(input: { workspaceId: string; capability: string; idempotencyKey: string }) {
    const value = this.secretDeliveries.get(receiptKey(input));
    return value ? copy(value) : null;
  }

  async purgeExpiredSecretDeliveries(input: { expiredBefore: Date; limit: number }) {
    const expired = [...this.secretDeliveries.entries()]
      .filter(([, delivery]) => delivery.expiresAt <= input.expiredBefore)
      .sort(([, left], [, right]) => left.expiresAt.getTime() - right.expiresAt.getTime())
      .slice(0, Math.min(Math.max(input.limit, 1), 1_000));
    for (const [key] of expired) this.secretDeliveries.delete(key);
    return expired.length;
  }

  async listClaimableMembershipProjections(input: { evaluatedAt: Date; limit: number }) {
    return [...this.resources.values()]
      .filter((item) => {
        if (item.kind !== "membership_projection") return false;
        if (item.status === "queued") return true;
        const body = item.body as { nextAttemptAt?: string; lease?: { expiresAt?: string } | null };
        if (item.status === "retry_pending") return Boolean(body.nextAttemptAt && new Date(body.nextAttemptAt) <= input.evaluatedAt);
        return item.status === "processing" && Boolean(body.lease?.expiresAt && new Date(body.lease.expiresAt) <= input.evaluatedAt);
      })
      .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime())
      .slice(0, Math.min(Math.max(input.limit, 1), 500))
      .map(copy);
  }

  async listClaimableGovernanceJobs(input: { evaluatedAt: Date; after?: import("./types").GovernanceJobCursor; limit: number }) {
    const terminalLease = (resource: GovernanceResource) => {
      const lease = (resource.body as { lease?: { expiresAt?: string } }).lease;
      return !lease?.expiresAt || new Date(lease.expiresAt) <= input.evaluatedAt;
    };
    const claimable = (resource: GovernanceResource) => {
      if (["audit_export", "workspace_export", "workspace_import"].includes(resource.kind)) return resource.status === "queued" || (resource.status === "running" && terminalLease(resource));
      if (resource.kind === "bulk_operation") return ["queued", "cancelling"].includes(resource.status) || (resource.status === "running" && terminalLease(resource));
      if (resource.kind === "deletion_receipt") {
        if (resource.status === "delayed") return Object.values((resource.body as { outcomes?: Record<string, { state: string; retryAt?: string }> }).outcomes ?? {}).some((outcome) => outcome.state === "delayed" && outcome.retryAt && new Date(outcome.retryAt) <= input.evaluatedAt);
        return resource.status === "queued" || (resource.status === "running" && terminalLease(resource));
      }
      if (resource.kind === "safety_appeal") return resource.status === "revalidation_queued" || (resource.status === "revalidation_running" && terminalLease(resource));
      return resource.kind === "approval_request" && ["pending", "escalated"].includes(resource.status);
    };
    const compare = (left: GovernanceResource, right: GovernanceResource) => left.updatedAt.getTime() - right.updatedAt.getTime() || left.workspaceId.localeCompare(right.workspaceId) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
    const after = input.after;
    return [...this.resources.values()].filter(claimable).sort(compare).filter((resource) => !after || compare(resource, { ...resource, updatedAt: after.updatedAt, workspaceId: after.workspaceId, kind: after.kind, id: after.id }) > 0).slice(0, input.limit).map(copy);
  }

  async getResource<T = Record<string, unknown>>(input: {
    workspaceId: string;
    kind: GovernanceResourceKind;
    id: string;
  }): Promise<GovernanceResource<T> | null> {
    const value = this.resources.get(resourceKey(input.workspaceId, input.kind, input.id));
    return value ? (copy(value) as GovernanceResource<T>) : null;
  }

  async listResources<T = Record<string, unknown>>(input: {
    workspaceId: string;
    kinds?: GovernanceResourceKind[];
    status?: string;
  }): Promise<GovernanceResource<T>[]> {
    const kinds = input.kinds ? new Set(input.kinds) : null;
    return [...this.resources.values()]
      .filter((resource) =>
        resource.workspaceId === input.workspaceId &&
        (!kinds || kinds.has(resource.kind)) &&
        (!input.status || resource.status === input.status))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((resource) => copy(resource) as GovernanceResource<T>);
  }

  async listAudit(input: { workspaceId: string; afterSequence?: number; limit: number }) {
    return this.audit
      .filter((event) =>
        event.workspaceId === input.workspaceId &&
        (event.sequence ?? 0) > (input.afterSequence ?? 0))
      .slice(0, input.limit)
      .map(copy);
  }

  async commit(input: GovernanceCommit): Promise<GovernanceCommitResult> {
    let release = () => {};
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const key = receiptKey(input.receipt);
      const existing = this.receipts.get(key);
      if (existing) {
        return existing.requestDigest === input.receipt.requestDigest &&
          (existing.actorIdentity ?? null) === (input.receipt.actorIdentity ?? null) &&
          (existing.authContextDigest ?? null) === (input.receipt.authContextDigest ?? null)
          ? { type: "replayed", result: copy(existing.result) }
          : { type: "conflict" };
      }
      for (const mutation of input.mutations) {
        const id = resourceKey(
          mutation.resource.workspaceId,
          mutation.resource.kind,
          mutation.resource.id,
        );
        const current = this.resources.get(id);
        if (
          (mutation.type === "create" && current) ||
          (mutation.type === "update" &&
            (!current || current.version !== mutation.expectedVersion))
        ) return { type: "conflict" };
      }
      for (const mutation of input.mutations) {
        this.resources.set(
          resourceKey(mutation.resource.workspaceId, mutation.resource.kind, mutation.resource.id),
          copy(mutation.resource),
        );
      }
      this.canonicalEffects.push(...copy(input.canonicalEffects ?? []));
      const audit = copy(input.audit);
      audit.sequence = this.audit.length + 1;
      this.audit.push(audit);
      this.receipts.set(key, copy(input.receipt));
      if (input.secretDelivery) this.secretDeliveries.set(key, copy(input.secretDelivery));
      return { type: "committed", result: copy(input.receipt.result) };
    } finally {
      release();
    }
  }

  digest(): string {
    return canonicalDigest({
      resources: [...this.resources.values()],
      audit: this.audit,
    });
  }
}
