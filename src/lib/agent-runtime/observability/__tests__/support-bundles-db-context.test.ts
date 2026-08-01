import { describe, expect, it, vi } from "vitest";
import {
  getSupportBundleDbExecutor,
  type SupportBundleDbExecutor,
} from "../support-bundles-db-context";
import { DrizzleSupportBundleBindIntentRepository } from "../support-bundles-postgres";

describe("support bundle bind database context", () => {
  it("reuses the advisory-locked executor and opens nested work as a savepoint", async () => {
    let baseTransactions = 0;
    let savepoints = 0;
    const execute = vi.fn(async () => undefined);
    let transactionExecutor!: SupportBundleDbExecutor;
    const transactionRecord = {
      execute,
      transaction: async (operation: (executor: SupportBundleDbExecutor) => Promise<unknown>) => {
        savepoints += 1;
        return operation(transactionExecutor);
      },
    };
    transactionExecutor = transactionRecord as unknown as SupportBundleDbExecutor;
    const baseRecord = {
      transaction: async (operation: (executor: SupportBundleDbExecutor) => Promise<unknown>) => {
        baseTransactions += 1;
        return operation(transactionExecutor);
      },
    } as unknown as SupportBundleDbExecutor;
    const repository = new DrizzleSupportBundleBindIntentRepository(() => baseRecord);

    await repository.withBindLock(
      { workspaceId: "workspace_1", idempotencyKey: "bundle_1" },
      async () => {
        expect(getSupportBundleDbExecutor()).toBe(transactionExecutor);
        await getSupportBundleDbExecutor().transaction(async () => "nested");
      },
    );

    expect(baseTransactions).toBe(1);
    expect(savepoints).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
