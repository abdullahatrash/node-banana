import { describe, expect, it } from "vitest";
import { evaluateReleaseReadiness, parseProductTelemetryEvent } from "../policy";
import type { AccessibilityCriterion, PerformanceMetric, ReleaseReadinessInput } from "../types";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const FUTURE = new Date("2026-09-04T12:00:00.000Z");
const criteria: AccessibilityCriterion[] = ["keyboard", "focus_visible", "focus_order", "contrast", "accessible_name", "error_identification", "language_metadata", "rtl_layout", "reflow", "target_size", "reduced_motion", "focus_restoration", "live_updates", "captions_transcripts", "arabic_screen_reader"];
const metrics: PerformanceMetric[] = ["largest_contentful_paint_ms", "interaction_to_next_paint_ms", "cumulative_layout_shift_milli", "critical_action_p95_ms", "api_p95_ms", "job_stage_p95_ms"];

function readyInput(): ReleaseReadinessInput {
  const evidence: ReleaseReadinessInput["evidence"] = [];
  for (const locale of ["ar", "en"] as const) {
    const direction = locale === "ar" ? "rtl" : "ltr";
    for (const cacheState of ["cold", "warm"] as const) for (const metric of metrics) evidence.push({ id: `perf-${locale}-${cacheState}-${metric}`, artifactDigest: `sha256:${"a".repeat(64)}`, kind: "performance", buildId: "build-1", collectedAt: NOW, expiresAt: FUTURE, outcome: "passed", locale, direction, client: "chromium-128", route: "/simple-studio/copy", metric, measured: 80, cacheState, userRegion: "mena", providerRegion: "me-central-1", criticalAction: metric === "critical_action_p95_ms" ? "generate" : null, jobStage: metric === "job_stage_p95_ms" ? "provider-run" : null });
    for (const criterion of criteria) evidence.push({ id: `a11y-${locale}-${criterion}`, artifactDigest: `sha256:${"b".repeat(64)}`, kind: "accessibility", buildId: "build-1", collectedAt: NOW, expiresAt: FUTURE, outcome: "passed", locale, direction, client: "chromium-128", route: "/simple-studio/copy", criterion, standard: "WCAG_2_2_AA" });
  }
  const performanceRequirements = (["ar", "en"] as const).flatMap((locale) => (["cold", "warm"] as const).flatMap((cacheState) => metrics.map((metric) => ({ id: `budget-${locale}-${cacheState}-${metric}`, route: "/simple-studio/copy", clientId: "chromium-128", locale, metric, budget: 100, cacheState, userRegion: "mena" as const, providerRegion: "me-central-1", criticalAction: metric === "critical_action_p95_ms" ? "generate" : null, jobStage: metric === "job_stage_p95_ms" ? "provider-run" : null }))));
  const requiredParityCells = (["rtl", "ltr"] as const).map((direction) => ({ id: `parity-copy-${direction}`, route: "/simple-studio/copy", feature: "brand-aware-copy", state: "success", role: "owner", entitlement: "pro", viewport: "desktop" as const, direction }));
  return {
    buildId: "build-1",
    evaluatedAt: NOW,
    requiredRoutes: ["/simple-studio/copy"],
    supportedClients: [{ id: "chromium-128", engine: "chromium", version: "128.0.0", capabilities: ["javascript", "screen-reader"] }],
    performanceRequirements,
    requiredDataClasses: ["workspace-content"],
    requiredContracts: ["generation-intent"],
    requiredParityCells,
    evidence,
    flags: [{ id: "flag-1", buildId: "build-1", ownerUserId: "owner-1", hypothesis: "Safer composer", createdAt: NOW, expiresAt: FUTURE, rolloutPercent: 10, safeDefault: "off", status: "active", evidenceIds: ["perf-ar-cold-largest_contentful_paint_ms", "perf-en-cold-largest_contentful_paint_ms"], eligibility: { roles: ["owner"], entitlements: ["pro"], locales: ["ar", "en"] }, dependencyFlagIds: [], telemetryEventName: "release_flag_evaluated", rollback: { mode: "automatic", triggerMetric: "error_rate", threshold: 0.05, windowMinutes: 15, ownerUserId: "owner-1" } }],
    incidents: [{ id: "incident-1", severity: "minor", status: "resolved", impactedServices: ["copy"], startedAt: NOW, resolvedAt: NOW, publicSummary: { ar: "تم الحل", en: "Resolved" }, operationOutcome: "none", creditRisk: "none", publishingRisk: "none" }],
    recoveryObjectives: [{ dataClass: "workspace-content", rpoSeconds: 300, rtoSeconds: 3_600, artifactDigest: `sha256:${"c".repeat(64)}`, backupEncryption: "KMS_ENVELOPE", backupRegions: ["me-central-1", "me-south-1"], pitrWindowSeconds: 86_400, artifactReconciliation: true, externalEffectReconciliation: true }],
    restoreDrills: [{ id: "drill-1", dataClass: "workspace-content", buildId: "build-1", startedAt: NOW, completedAt: NOW, observedDataLossSeconds: 30, observedRecoverySeconds: 600, outcome: "passed", expiresAt: FUTURE, artifactDigest: `sha256:${"d".repeat(64)}`, backupRegion: "me-central-1", pitrVerified: true, artifactReconciliationVerified: true, externalEffectReconciliationVerified: true }],
    contractMigrations: (["expand", "migrate", "contract"] as const).map((phase, index) => ({ id: `migration-${index}`, contract: "generation-intent", buildId: "build-1", phase, status: "verified", compatibilityVerified: true, rollbackVerified: true, observedAt: NOW, expiresAt: FUTURE, artifactDigest: `sha256:${"e".repeat(64)}`, resumable: true, cursorSchemaVersion: "v1", resumeCursorEvidenceDigest: `sha256:${"9".repeat(64)}`, compatibilityWindowStartsAt: new Date(NOW.getTime() - 1_000), compatibilityWindowEndsAt: FUTURE })),
    parity: requiredParityCells.map((cell) => ({ ...cell, buildId: "build-1", evaluatedAt: NOW, expiresAt: FUTURE, artifactDigest: `sha256:${"f".repeat(64)}`, evidenceIds: ["perf-ar-cold-largest_contentful_paint_ms", "perf-en-cold-largest_contentful_paint_ms"], productSignoffUserId: "product-1", designSignoffUserId: "design-1", engineeringSignoffUserId: "engineer-1", qaSignoffUserId: "qa-1", localizationAccessibilitySignoffUserId: "localization-1", status: "passed" })),
  };
}

describe("release readiness policy", () => {
  it("allows a claim only when every release control has current passing evidence", () => {
    expect(evaluateReleaseReadiness(readyInput())).toMatchObject({ releasable: true, parityClaimAllowed: true, blockers: [] });
  });

  it("fails closed for missing Arabic evidence, skipped checks, stale flags, unsafe migrations, incidents, and failed drills", () => {
    const input = readyInput();
    input.evidence = input.evidence.filter((item) => item.locale !== "ar");
    input.evidence[0] = { ...input.evidence[0]!, outcome: "skipped" };
    input.flags[0] = { ...input.flags[0]!, expiresAt: NOW };
    input.incidents[0] = { ...input.incidents[0]!, status: "monitoring", resolvedAt: null };
    input.restoreDrills[0] = { ...input.restoreDrills[0]!, observedRecoverySeconds: 4_000 };
    input.contractMigrations[0] = { ...input.contractMigrations[0]!, rollbackVerified: false };
    input.parity[0] = { ...input.parity[0]!, productSignoffUserId: null };

    const decision = evaluateReleaseReadiness(input);
    expect(decision.releasable).toBe(false);
    expect(decision.parityClaimAllowed).toBe(false);
    expect(new Set(decision.blockers.map((item) => item.code))).toEqual(expect.objectContaining(new Set(["EVIDENCE_MISSING", "EVIDENCE_UNRESOLVED", "FLAG_EXPIRED", "INCIDENT_ACTIVE", "RESTORE_DRILL_FAILED", "CONTRACT_MIGRATION_UNSAFE", "PARITY_UNVERIFIED"])));
  });
});

describe("privacy-safe product telemetry", () => {
  const base = { schema: "product-telemetry-event/v1", eventId: "pte_abcdefgh", workspacePseudonym: `wsp_${"a".repeat(32)}`, sessionPseudonym: `ses_${"b".repeat(32)}`, occurredAt: NOW, locale: "ar", direction: "rtl", consentRevision: "consent_rev1", consentPurpose: "product_analytics", regionClassification: "mena", buildId: "build-1" } as const;

  it("accepts only enumerated low-cardinality product facts", () => {
    expect(parseProductTelemetryEvent({ ...base, name: "generation_requested", properties: { mediaKind: "video", aspectRatio: "9:16", providerFamily: "replicate", brandProfileAttached: true } })).toMatchObject({ name: "generation_requested", locale: "ar", direction: "rtl" });
  });

  it("rejects prompts, content, asset identifiers, credentials, and arbitrary free text", () => {
    for (const forbidden of [
      { prompt: "make this viral" },
      { content: "customer copy" },
      { assetId: "asset-private" },
      { credential: "secret" },
      { note: "arbitrary user text" },
    ]) {
      expect(() => parseProductTelemetryEvent({ ...base, name: "generation_requested", properties: { mediaKind: "video", aspectRatio: "9:16", providerFamily: "replicate", brandProfileAttached: true, ...forbidden } })).toThrow("privacy-safe allowlist");
    }
  });

  it("rejects a locale-direction mismatch", () => {
    expect(() => parseProductTelemetryEvent({ ...base, direction: "ltr", name: "surface_viewed", properties: { surface: "dashboard", referrerKind: "direct" } })).toThrow("locale direction");
  });
});
