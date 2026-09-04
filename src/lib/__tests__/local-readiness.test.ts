import { describe, expect, it } from "vitest";
import { buildLocalReadinessReport, type LocalReadinessFacts } from "../local-readiness";

const readyFacts = (overrides: Partial<LocalReadinessFacts> = {}): LocalReadinessFacts => ({
  generatedAt: new Date("2026-09-04T12:00:00.000Z"),
  workspaceId: "ws_local",
  databaseConnected: true,
  databaseDetail: "Connected.",
  canonicalStorageConfigured: true,
  encryptionKeyConfigured: true,
  encryptionKeyValid: true,
  stepUpDeliveryConfigured: true,
  qualifiedReplicateModels: 2,
  acceptedBrand: true,
  verifiedReplicateRegion: true,
  replicateVaultKey: true,
  replicateVaultKeyValidated: true,
  managedReplicateKey: true,
  managedReplicateRevision: true,
  activePlans: 4,
  activeCreditPacks: 3,
  availableCredits: 250,
  merchantConfigured: true,
  ...overrides,
});

describe("local generation readiness", () => {
  it("reports independently executable BYOK and managed lanes", () => {
    const report = buildLocalReadinessReport(readyFacts());
    expect(report).toMatchObject({ coreReady: true, byokReady: true, managedReady: true });
    expect(report.checks.every((check) => check.status === "ready")).toBe(true);
  });

  it("does not claim BYOK readiness from an AI token without vault encryption", () => {
    const report = buildLocalReadinessReport(readyFacts({ encryptionKeyConfigured: false, encryptionKeyValid: false }));
    expect(report.byokReady).toBe(false);
    expect(report.checks.find((check) => check.id === "byok_encryption")).toMatchObject({ status: "blocked" });
    expect(report.managedReady).toBe(true);
  });

  it("keeps checkout optional while preserving generation readiness", () => {
    const report = buildLocalReadinessReport(readyFacts({ merchantConfigured: false, stepUpDeliveryConfigured: false }));
    expect(report.byokReady).toBe(true);
    expect(report.managedReady).toBe(true);
    expect(report.checks.find((check) => check.id === "merchant")).toMatchObject({ status: "optional" });
    expect(report.checks.find((check) => check.id === "step_up_delivery")).toMatchObject({ status: "optional" });
  });

  it("blocks both lanes when shared admission evidence is absent", () => {
    const report = buildLocalReadinessReport(readyFacts({ qualifiedReplicateModels: 0, acceptedBrand: false, verifiedReplicateRegion: false }));
    expect(report.coreReady).toBe(true);
    expect(report.byokReady).toBe(false);
    expect(report.managedReady).toBe(false);
  });
});
