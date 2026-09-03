import { describe, expect, it } from "vitest";
import { evaluateReleaseReadiness, parseProductTelemetryEvent } from "../policy";
import type { AccessibilityCriterion, ReleaseReadinessInput } from "../types";

const NOW = new Date("2026-09-03T12:00:00.000Z");
const FUTURE = new Date("2026-09-04T12:00:00.000Z");
const criteria: AccessibilityCriterion[] = ["keyboard", "focus_visible", "focus_order", "contrast", "accessible_name", "error_identification", "language_metadata", "rtl_layout", "reflow", "target_size", "reduced_motion"];

function readyInput(): ReleaseReadinessInput {
  const evidence: ReleaseReadinessInput["evidence"] = [];
  for (const locale of ["ar", "en"] as const) {
    const direction = locale === "ar" ? "rtl" : "ltr";
    evidence.push({ id: `perf-${locale}`, kind: "performance", buildId: "build-1", collectedAt: NOW, expiresAt: FUTURE, outcome: "passed", locale, direction, client: "chromium", route: "/simple-studio/copy", metric: "largest_contentful_paint_ms", measured: 1_900, budget: 2_500 });
    for (const criterion of criteria) evidence.push({ id: `a11y-${locale}-${criterion}`, kind: "accessibility", buildId: "build-1", collectedAt: NOW, expiresAt: FUTURE, outcome: "passed", locale, direction, client: "chromium", route: "/simple-studio/copy", criterion, standard: "WCAG_2_2_AA" });
  }
  return {
    buildId: "build-1",
    evaluatedAt: NOW,
    requiredRoutes: ["/simple-studio/copy"],
    supportedClients: ["chromium"],
    evidence,
    flags: [{ id: "flag-1", ownerUserId: "owner-1", hypothesis: "Safer composer", createdAt: NOW, expiresAt: FUTURE, rolloutPercent: 10, safeDefault: "off", status: "active", evidenceIds: ["perf-ar", "perf-en"] }],
    incidents: [{ id: "incident-1", severity: "minor", status: "resolved", impactedServices: ["copy"], startedAt: NOW, resolvedAt: NOW, publicSummary: { ar: "تم الحل", en: "Resolved" } }],
    recoveryObjectives: [{ dataClass: "workspace-content", rpoSeconds: 300, rtoSeconds: 3_600 }],
    restoreDrills: [{ id: "drill-1", dataClass: "workspace-content", buildId: "build-1", startedAt: NOW, completedAt: NOW, observedDataLossSeconds: 30, observedRecoverySeconds: 600, outcome: "passed", expiresAt: FUTURE }],
    contractMigrations: [{ id: "migration-1", contract: "generation-intent", buildId: "build-1", phase: "expand", status: "verified", compatibilityVerified: true, rollbackVerified: true, observedAt: NOW, expiresAt: FUTURE }],
    parity: [{ id: "parity-copy", feature: "Brand-aware copy", requiredLocales: ["ar", "en"], evidenceIds: ["perf-ar", "perf-en"], productSignoffUserId: "product-1", engineeringSignoffUserId: "engineer-1", status: "passed" }],
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
  const base = { schema: "product-telemetry-event/v1", eventId: "pte_abcdefgh", workspacePseudonym: `wsp_${"a".repeat(32)}`, sessionPseudonym: `ses_${"b".repeat(32)}`, occurredAt: NOW, locale: "ar", direction: "rtl", consentRevision: "consent_rev1", buildId: "build-1" } as const;

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
