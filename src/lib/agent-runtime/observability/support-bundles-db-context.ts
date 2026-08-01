import { AsyncLocalStorage } from "node:async_hooks";
import { getDb } from "@/lib/db";

export type SupportBundleDbExecutor = ReturnType<typeof getDb>;

const bindExecutor = new AsyncLocalStorage<SupportBundleDbExecutor>();

export function getSupportBundleDbExecutor(): SupportBundleDbExecutor {
  return bindExecutor.getStore() ?? getDb();
}

export function runWithSupportBundleDbExecutor<T>(
  executor: SupportBundleDbExecutor,
  operation: () => Promise<T>,
): Promise<T> {
  return bindExecutor.run(executor, operation);
}
