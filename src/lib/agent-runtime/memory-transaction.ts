const TOKEN = Symbol("memory-transaction-token");

export interface MemoryTransactionToken {
  readonly [TOKEN]: MemoryTransactionCoordinator;
}

export const MEMORY_TRANSACTION_PARTICIPANT = Symbol.for(
  "node-banana.memory-transaction-participant/v1",
);

export interface MemoryTransactionParticipant {
  readonly [MEMORY_TRANSACTION_PARTICIPANT]: true;
  attachMemoryTransactionCoordinator(coordinator: MemoryTransactionCoordinator): void;
  checkpointMemoryState(token: MemoryTransactionToken): unknown;
  restoreMemoryState(token: MemoryTransactionToken, checkpoint: unknown): void;
}

export function isMemoryTransactionParticipant(
  value: unknown,
): value is MemoryTransactionParticipant {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Partial<MemoryTransactionParticipant>)[MEMORY_TRANSACTION_PARTICIPANT],
  );
}

export class MemoryTransactionCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private readonly active = new Set<MemoryTransactionToken>();

  async runExclusive<T>(
    operation: (token: MemoryTransactionToken) => Promise<T>,
  ): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tail = previous.then(() => current);
    await previous;
    const token = Object.freeze({ [TOKEN]: this }) as MemoryTransactionToken;
    this.active.add(token);
    try {
      return await operation(token);
    } finally {
      this.active.delete(token);
      release();
    }
  }

  isActive(token: MemoryTransactionToken | undefined): boolean {
    return Boolean(token && token[TOKEN] === this && this.active.has(token));
  }
}
