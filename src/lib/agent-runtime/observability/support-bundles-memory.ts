import type {
  SupportBundleBindIntent,
  SupportBundleBindIntentRepository,
} from "./support-bundles";

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class InMemorySupportBundleBindIntentRepository
  implements SupportBundleBindIntentRepository
{
  readonly intents = new Map<string, SupportBundleBindIntent>();
  private tail: Promise<void> = Promise.resolve();
  private readonly bindTails = new Map<string, Promise<void>>();

  private key(workspaceId: string, idempotencyKey: string) {
    return `${workspaceId}:${idempotencyKey}`;
  }

  private async mutate<T>(operation: () => T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tail = previous.then(() => current);
    await previous;
    try {
      return operation();
    } finally {
      release();
    }
  }

  async withBindLock<T>(input: { workspaceId: string; idempotencyKey: string }, operation: () => Promise<T>) {
    const key = this.key(input.workspaceId, input.idempotencyKey);
    const previous = this.bindTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.bindTails.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.bindTails.get(key) === tail) this.bindTails.delete(key);
    }
  }

  acquirePrepared(intent: SupportBundleBindIntent) {
    return this.mutate(() => {
      const key = this.key(intent.workspaceId, intent.idempotencyKey);
      const existing = this.intents.get(key);
      if (existing) {
        return existing.requestDigest === intent.requestDigest
          ? { kind: "replayed" as const, intent: copy(existing) }
          : { kind: "conflict" as const };
      }
      this.intents.set(key, copy(intent));
      return { kind: "created" as const, intent: copy(intent) };
    });
  }

  markBound(input: {
    workspaceId: string;
    idempotencyKey: string;
    requestDigest: `sha256:${string}`;
    bundleId: string;
    boundAt: Date;
  }) {
    return this.mutate(() => {
      const key = this.key(input.workspaceId, input.idempotencyKey);
      const intent = this.intents.get(key);
      if (!intent || intent.requestDigest !== input.requestDigest) {
        return "conflict" as const;
      }
      if (intent.state === "bound" || intent.state === "cleanup") {
        return intent.bundleId === input.bundleId
          ? "replayed" as const
          : "conflict" as const;
      }
      if (intent.state !== "pending") return "conflict" as const;
      this.intents.set(key, {
        ...intent,
        state: "bound",
        bundleId: input.bundleId,
        payloadJson: null,
        updatedAt: input.boundAt,
      });
      return "bound" as const;
    });
  }

  deferPending(input: { workspaceId: string; idempotencyKey: string; requestDigest: `sha256:${string}`; retryAt: Date }) {
    return this.mutate(() => {
      const key = this.key(input.workspaceId, input.idempotencyKey);
      const intent = this.intents.get(key);
      if (!intent || intent.requestDigest !== input.requestDigest || intent.state !== "pending") return "conflict" as const;
      this.intents.set(key, { ...intent, updatedAt: input.retryAt });
      return "deferred" as const;
    });
  }

  markAbandoned(input: { workspaceId: string; idempotencyKey: string; requestDigest: `sha256:${string}`; abandonedAt: Date }) {
    return this.mutate(() => {
      const key = this.key(input.workspaceId, input.idempotencyKey);
      const intent = this.intents.get(key);
      if (!intent || intent.requestDigest !== input.requestDigest) return "conflict" as const;
      if (intent.state === "abandoned") return "replayed" as const;
      if (intent.state !== "pending") return "conflict" as const;
      this.intents.set(key, { ...intent, state: "abandoned", payloadJson: null, bundleId: null, updatedAt: input.abandonedAt });
      return "abandoned" as const;
    });
  }

  markCleanup(input: { workspaceId: string; bundleId: string; retryAt: Date }) {
    return this.mutate(() => {
      const entry = [...this.intents.entries()].find(([, intent]) => intent.workspaceId === input.workspaceId && intent.bundleId === input.bundleId);
      if (!entry) return "not_found" as const;
      const [key, intent] = entry;
      if (intent.state === "cleanup") return "replayed" as const;
      if (intent.state !== "bound") return "conflict" as const;
      this.intents.set(key, { ...intent, state: "cleanup", updatedAt: input.retryAt });
      return "cleanup" as const;
    });
  }

  deferCleanup(input: { id: string; retryAt: Date }) {
    return this.mutate(() => {
      const entry = [...this.intents.entries()].find(([, intent]) => intent.id === input.id);
      if (!entry || !(["cleanup", "abandoned"] as const).includes(entry[1].state as "cleanup" | "abandoned")) return "conflict" as const;
      this.intents.set(entry[0], { ...entry[1], updatedAt: input.retryAt });
      return "deferred" as const;
    });
  }


  async listPending(input: { at: Date; limit: number }) {
    return [...this.intents.values()]
      .filter((intent) => intent.state === "pending" && intent.updatedAt <= input.at)
      .sort(
        (left, right) =>
          left.updatedAt.getTime() - right.updatedAt.getTime() ||
          left.id.localeCompare(right.id),
      )
      .slice(0, input.limit)
      .map(copy);
  }

  async listCleanup(input: { at: Date; limit: number }) {
    return [...this.intents.values()]
      .filter((intent) => (intent.state === "cleanup" || intent.state === "abandoned") && intent.updatedAt <= input.at)
      .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime() || left.id.localeCompare(right.id))
      .slice(0, input.limit)
      .map(copy);
  }

}
