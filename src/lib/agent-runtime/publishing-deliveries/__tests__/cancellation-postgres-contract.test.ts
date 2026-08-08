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
const transitionSource = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/agent-runtime/publishing-deliveries/cancellation-transition.ts",
  ),
  "utf8",
);
const memorySource = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/agent-runtime/publishing-deliveries/memory.ts",
  ),
  "utf8",
);

function method(name: string, next: string): string {
  return source.slice(source.indexOf(`async ${name}(`), source.indexOf(`async ${next}(`));
}

describe("Publishing Delivery cancellation Postgres transaction contract", () => {
  it("shares the pure cancellation and settlement plans with the memory repository", () => {
    for (const repositorySource of [source, memorySource]) {
      expect(repositorySource).toContain("planPublishingDeliveryCancellation({");
      expect(repositorySource).toContain("normalizePublishingDeliverySettlement({");
    }
  });

  it("uses one Delivery-then-lease lock order at every provider boundary", () => {
    for (const body of [
      method("prepareEffect", "beginEffectContact"),
      method("beginEffectContact", "failBeforeEffect"),
      method("failBeforeEffect", "settleEffect"),
      source.slice(source.indexOf("async settleEffect(")),
    ]) {
      expect(body.indexOf("from(runtimePublishingDeliveries)")).toBeGreaterThan(0);
      expect(body.indexOf("from(runtimePublishingDeliveryExecutionLeases)"))
        .toBeGreaterThan(body.indexOf("from(runtimePublishingDeliveries)"));
    }
  });

  it("never persists a retry or relaunch after cancellation wins", () => {
    const settlement = source.slice(source.indexOf("async settleEffect("));
    const normalization = settlement.indexOf("normalizePublishingDeliverySettlement");
    const normalizedIntent = settlement.indexOf("const { outcome, retryOutboxIntent }");
    const outboxInsert = settlement.indexOf(
      "await tx.insert(runtimePublishingDeliveryOutboxIntents)",
    );
    expect(normalization).toBeGreaterThan(0);
    expect(normalizedIntent).toBeGreaterThan(normalization);
    expect(outboxInsert).toBeGreaterThan(normalizedIntent);
    expect(transitionSource).toContain('failureCode: "CANCELLED_AFTER_EFFECT_CONTACT"');
    expect(settlement).toContain("if (retryOutboxIntent)");
    expect(settlement).not.toContain("if (input.retryOutboxIntent)");
  });

  it("terminalizes expired contacted cancellation without granting a restart lease", () => {
    const acquire = method("acquireLease", "renewLease");
    const cancellation = acquire.indexOf('delivery.desiredState === "cancel"');
    const unknownWrite = acquire.indexOf('state: "outcome_unknown"');
    const leaseGrant = acquire.indexOf("const leaseToken = randomUUID()");
    expect(cancellation).toBeGreaterThan(0);
    expect(unknownWrite).toBeGreaterThan(cancellation);
    expect(leaseGrant).toBeGreaterThan(unknownWrite);
    expect(acquire).toContain('return { kind: "terminal" as const }');
  });

  it("rechecks Human admission, exact grant evidence, expiry, and revocation under lock", () => {
    const lock = source.slice(
      source.indexOf("async function lockCancellationAuthorization("),
      source.indexOf("async function storedRelease("),
    );
    expect(lock).toContain("agentSecurityEvents");
    expect(lock).toContain('eq(agentSecurityEvents.eventType, "authorization.allowed")');
    expect(lock).toContain("CANCELLATION_HUMAN_AUTHORIZATION_TTL_MS");
    expect(lock).toContain("publishing-delivery-cancellation-human-grant-evidence/v1");
    expect(lock).toContain("runtimePublishingApprovalAuthorityRevocations");
    expect(lock).toContain('.for("update")');
  });
});
