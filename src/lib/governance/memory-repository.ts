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
        return existing.requestDigest === input.receipt.requestDigest
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
