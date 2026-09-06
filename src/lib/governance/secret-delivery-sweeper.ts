import type { GovernanceRepository } from "./types";

export class GovernanceSecretDeliverySweeper {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly clock: { now(): Date } = { now: () => new Date() },
  ) {}

  purge(input: { limit: number }): Promise<number> {
    return this.repository.purgeExpiredSecretDeliveries({
      expiredBefore: this.clock.now(),
      limit: input.limit,
    });
  }
}
