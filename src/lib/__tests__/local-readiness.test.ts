import { describe, expect, it } from "vitest";
import { buildLocalReadinessReport, type LocalReadinessFacts } from "../local-readiness";

const readyFacts = (overrides: Partial<LocalReadinessFacts> = {}): LocalReadinessFacts => ({
  generatedAt: new Date("2026-09-04T12:00:00.000Z"),
  workspaceId: "ws_local",
  workspaceExists: true,
  databaseConnected: true,
  databaseDetail: "Connected.",
  canonicalStorageConfigured: true,
  encryptionKeyConfigured: true,
  encryptionKeyValid: true,
  stepUpDeliveryConfigured: true,
  qualifiedReplicateModels: 2,
  qualificationDedicatedTokenConfigured: true,
  qualificationHarnessConfigured: true,
  qualificationSpendTrustConfigured: true,
  qualificationSigningTrustConfigured: true,
  legacyReplicateKeyConfigured: false,
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
  referralPayoutGatewayConfigured: true,
  trendWorkerAuthConfigured: true,
  youtubeTrendDiscoveryEnabled: true,
  youtubeTrendApiKeyConfigured: true,
  youtubeTrendDisclosuresConfigured: true,
  youtubeContentAdaptationApproved: true,
  activeYoutubeTrendSources: 1,
  activeLicensedTrendEntitlements: 2,
  releaseBuildId: "build-2026-09-05",
  releaseParityClaimAllowed: true,
  releaseParityRequiredCells: 18,
  releaseParityPassingCells: 18,
  releaseBlockerCount: 0,
  xAdsAttributionAvailable: true,
  xAdsAttributionBlockers: [],
  ...overrides,
});

describe("local generation readiness", () => {
  it("reports independently executable BYOK and managed lanes", () => {
    const report = buildLocalReadinessReport(readyFacts());
    expect(report).toMatchObject({ coreReady: true, byokReady: true, managedReady: true, trendIntelligenceReady: true, releaseParityReady: true });
    expect(report.checks.every((check) => check.status === "ready")).toBe(true);
  });

  it("explains every independent Trend Intelligence blocker", () => {
    const report = buildLocalReadinessReport(readyFacts({
      trendWorkerAuthConfigured: false,
      youtubeTrendApiKeyConfigured: false,
      youtubeTrendDisclosuresConfigured: false,
      activeYoutubeTrendSources: 0,
      activeLicensedTrendEntitlements: 0,
    }));

    expect(report.trendIntelligenceReady).toBe(false);
    expect(report.checks.find((check) => check.id === "trend_workers")).toMatchObject({ status: "blocked" });
    expect(report.checks.find((check) => check.id === "youtube_trends")).toMatchObject({
      status: "blocked",
      detail: expect.stringContaining("server-side YouTube Data API key"),
    });
    expect(report.checks.find((check) => check.id === "licensed_trends")).toMatchObject({
      status: "blocked",
      detail: expect.stringContaining("No active licensed trend entitlement"),
    });
  });

  it("does not claim BYOK readiness from an AI token without vault encryption", () => {
    const report = buildLocalReadinessReport(readyFacts({ encryptionKeyConfigured: false, encryptionKeyValid: false }));
    expect(report.byokReady).toBe(false);
    expect(report.checks.find((check) => check.id === "byok_encryption")).toMatchObject({ status: "blocked" });
    expect(report.managedReady).toBe(true);
  });

  it("keeps checkout optional while preserving generation readiness", () => {
    const report = buildLocalReadinessReport(readyFacts({ merchantConfigured: false, referralPayoutGatewayConfigured: false, stepUpDeliveryConfigured: false }));
    expect(report.byokReady).toBe(true);
    expect(report.managedReady).toBe(true);
    expect(report.checks.find((check) => check.id === "merchant")).toMatchObject({ status: "optional" });
    expect(report.checks.find((check) => check.id === "referral_payout_gateway")).toMatchObject({ status: "optional", detail: expect.stringContaining("remain durably submitted") });
    expect(report.checks.find((check) => check.id === "step_up_delivery")).toMatchObject({ status: "optional" });
  });

  it("keeps trend discovery independent while surfacing unapproved durable topic adaptation", () => {
    const report = buildLocalReadinessReport(readyFacts({ youtubeContentAdaptationApproved: false }));
    expect(report.trendIntelligenceReady).toBe(true);
    expect(report.checks.find((check) => check.id === "youtube_content_adaptation")).toMatchObject({ status: "optional", detail: expect.stringContaining("fail-closed") });
  });

  it("keeps advertising attribution separate and fail-closed", () => {
    const report = buildLocalReadinessReport(readyFacts({ xAdsAttributionAvailable: false, xAdsAttributionBlockers: ["OAUTH_CREDENTIALS_MISSING", "REGION_REVIEW_MISSING"] }));
    expect(report).toMatchObject({ coreReady: true, xAdsAttributionReady: false });
    expect(report.checks.find((check) => check.id === "x_ads_attribution")).toMatchObject({ status: "optional", detail: expect.stringContaining("OAUTH_CREDENTIALS_MISSING") });
  });

  it("fails closed when no signed release parity matrix is configured", () => {
    const report = buildLocalReadinessReport(readyFacts({
      releaseBuildId: "unconfigured",
      releaseParityClaimAllowed: false,
      releaseParityRequiredCells: 0,
      releaseParityPassingCells: 0,
      releaseBlockerCount: 1,
    }));

    expect(report).toMatchObject({ coreReady: true, releaseParityReady: false });
    expect(report.checks.find((check) => check.id === "release_parity")).toMatchObject({
      status: "blocked",
      detail: expect.stringContaining("No valid signed release manifest"),
    });
  });

  it("reports partial signed parity coverage without allowing the claim", () => {
    const report = buildLocalReadinessReport(readyFacts({
      releaseParityClaimAllowed: false,
      releaseParityRequiredCells: 18,
      releaseParityPassingCells: 12,
      releaseBlockerCount: 6,
    }));

    expect(report.releaseParityReady).toBe(false);
    expect(report.checks.find((check) => check.id === "release_parity")).toMatchObject({
      status: "blocked",
      detail: "12 of 18 required parity cell(s) pass for build build-2026-09-05; 6 release blocker(s) remain.",
    });
  });

  it("blocks both lanes when shared admission evidence is absent", () => {
    const report = buildLocalReadinessReport(readyFacts({ qualifiedReplicateModels: 0, acceptedBrand: false, verifiedReplicateRegion: false }));
    expect(report.coreReady).toBe(true);
    expect(report.byokReady).toBe(false);
    expect(report.managedReady).toBe(false);
  });

  it("does not claim a configured but missing Workspace is ready", () => {
    const report = buildLocalReadinessReport(readyFacts({ workspaceId: "missing-workspace", workspaceExists: false }));
    expect(report).toMatchObject({ workspaceId: "missing-workspace", coreReady: false, byokReady: false, managedReady: false });
    expect(report.checks.find((check) => check.id === "workspace")).toMatchObject({
      status: "blocked",
      detail: "Configured Workspace missing-workspace does not exist or is deleted.",
    });
  });

  it("explains why a legacy discovery key cannot qualify a model", () => {
    const report = buildLocalReadinessReport(readyFacts({
      qualifiedReplicateModels: 0,
      qualificationDedicatedTokenConfigured: false,
      qualificationHarnessConfigured: false,
      qualificationSpendTrustConfigured: false,
      qualificationSigningTrustConfigured: false,
      legacyReplicateKeyConfigured: true,
    }));
    expect(report.checks.find((check) => check.id === "qualification_setup")).toMatchObject({
      status: "blocked",
      detail: expect.stringContaining("legacy REPLICATE_API_KEY is present but is intentionally not reused"),
    });
  });
});
