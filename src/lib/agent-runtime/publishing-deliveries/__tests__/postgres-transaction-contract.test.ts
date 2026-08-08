import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/agent-runtime/publishing-deliveries/postgres-repository.ts",
  ),
  "utf8",
);

describe("Publishing Delivery Postgres transaction contract", () => {
  it("validates follow-up outbox identity before the first settlement write", () => {
    const settlement = source.slice(source.indexOf("async settleEffect("));
    const validation = settlement.indexOf(
      "retryOutboxIntent.generation !== delivery.nextOutboxGeneration",
    );
    const firstWrite = settlement.indexOf(
      "await tx.insert(runtimePublishingDeliveryEvents)",
    );
    expect(validation).toBeGreaterThan(0);
    expect(firstWrite).toBeGreaterThan(validation);
  });

  it("throws on invalid post-write rehydration so the transaction rolls back", () => {
    expect(source).toContain("class PublishingDeliveryTransactionRollback");
    expect(source.match(/requireWrittenRecord\(/g)?.length).toBeGreaterThanOrEqual(6);
    expect(source).not.toContain(
      "return stored\n          ? { kind: \"created\" as const, ...stored }\n          : { kind: \"unavailable\" as const }",
    );
  });
});
