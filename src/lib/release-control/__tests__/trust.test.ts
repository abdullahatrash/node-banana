import { describe, expect, it } from "vitest";
import { signReleaseAttestation, verifyReleaseAttestation } from "../attestation";
import { loadReleaseManifest, signReleaseManifest, type ReleaseManifest } from "../manifest";
import { signReleaseReadiness, verifyReleaseReadiness } from "../readiness-attestation";
import type { ReleaseReadinessDecision } from "../types";

const NOW = new Date("2026-09-03T12:00:00.000Z"); const FUTURE = "2026-09-04T12:00:00.000Z"; const SECRET = "a-secure-test-secret-with-at-least-32-bytes";

describe("trusted release evidence", () => {
  it("cryptographically binds the artifact, workspace, runner, and signer role", () => {
    const unsigned = { schema: "release-attestation/v1" as const, workspaceId: "workspace-1", record: { recordKind: "evidence" as const, document: { id: "perf-1", kind: "performance" as const, buildId: "build-1", collectedAt: NOW.toISOString(), expiresAt: FUTURE, outcome: "passed" as const, locale: "ar" as const, direction: "rtl" as const, client: "chromium-128", route: "/dashboard", metric: "largest_contentful_paint_ms" as const, measured: 1500, cacheState: "cold" as const, userRegion: "mena" as const, providerRegion: "me-central-1", criticalAction: null, jobStage: null, sampleCount: 20, runner: "ci-key", artifactDigest: `sha256:${"a".repeat(64)}` } } };
    const signer = { keyId: "ci-key", role: "ci" as const, issuedAt: NOW.toISOString(), expiresAt: FUTURE }; const signature = signReleaseAttestation(unsigned, signer, SECRET); const attestation = { ...unsigned, signatures: [{ ...signer, signature }] };
    const verified = verifyReleaseAttestation(attestation, { "ci-key": { role: "ci", secret: SECRET } }, NOW);
    expect(verified.record.recordKind).toBe("evidence");
    expect("artifactDigest" in verified.record.document ? verified.record.document.artifactDigest : null).toBe(`sha256:${"a".repeat(64)}`);
    expect(() => verifyReleaseAttestation({ ...attestation, record: { ...attestation.record, document: { ...attestation.record.document, artifactDigest: `sha256:${"b".repeat(64)}` } } }, { "ci-key": { role: "ci", secret: SECRET } }, NOW)).toThrow("ATTESTATION_SIGNATURE_INVALID");
  });

  it("requires five independent parity signers", () => {
    const document = { id: "parity-copy-rtl", route: "/dashboard", feature: "copy", state: "success", role: "owner", entitlement: "pro", viewport: "desktop" as const, direction: "rtl" as const, buildId: "build-1", evidenceIds: ["parity-reference", "parity-comparison", "parity-rationale"], productSignoffUserId: "product-key", engineeringSignoffUserId: "engineering-key", arabicLocalizationSignoffUserId: "localization-key", accessibilitySignoffUserId: "accessibility-key", securitySignoffUserId: "security-key", status: "passed" as const, evaluatedAt: NOW.toISOString(), expiresAt: FUTURE, artifactDigest: `sha256:${"c".repeat(64)}` };
    const unsigned = { schema: "release-attestation/v1" as const, workspaceId: "workspace-1", record: { recordKind: "parity_requirement" as const, document } };
    const signers = [{ keyId: "product-key", role: "product_signer" as const }, { keyId: "engineering-key", role: "engineering_signer" as const }, { keyId: "localization-key", role: "arabic_localization_signer" as const }, { keyId: "accessibility-key", role: "accessibility_signer" as const }, { keyId: "security-key", role: "security_signer" as const }].map((signer) => ({ ...signer, issuedAt: NOW.toISOString(), expiresAt: FUTURE }));
    const secrets = Object.fromEntries(signers.map((signer, index) => [signer.keyId, `${SECRET}-${index}`]));
    const value = { ...unsigned, signatures: signers.map((signer) => ({ ...signer, signature: signReleaseAttestation(unsigned, signer, secrets[signer.keyId]!) })) };
    const keyring = Object.fromEntries(signers.map((signer) => [signer.keyId, { role: signer.role, secret: secrets[signer.keyId]! }]));
    expect(verifyReleaseAttestation(value, keyring, NOW).signatures).toHaveLength(5);
    expect(() => verifyReleaseAttestation({ ...value, signatures: value.signatures.slice(0, 4) }, keyring, NOW)).toThrow("ATTESTATION_ROLE_INVALID");
  });
});

describe("server-owned release manifest", () => {
  const metrics = ["largest_contentful_paint_ms", "interaction_to_next_paint_ms", "cumulative_layout_shift_milli", "critical_action_p95_ms", "api_p95_ms", "job_stage_p95_ms"] as const;
  const supportedClients: ReleaseManifest["supportedClients"] = [
    ["chrome", "current", "chromium", "desktop", "desktop", ["keyboard", "mouse", "screen_reader"]],
    ["chrome", "previous", "chromium", "android", "mobile", ["touch", "screen_reader"]],
    ["safari", "current", "webkit", "ios", "mobile", ["touch", "screen_reader"]],
    ["safari", "previous", "webkit", "desktop", "desktop", ["keyboard", "mouse", "screen_reader"]],
    ["firefox", "current", "gecko", "desktop", "desktop", ["keyboard", "mouse", "screen_reader"]],
    ["firefox", "previous", "gecko", "desktop", "desktop", ["keyboard", "mouse", "screen_reader"]],
    ["edge", "current", "chromium", "desktop", "desktop", ["keyboard", "mouse", "screen_reader"]],
    ["edge", "previous", "chromium", "desktop", "desktop", ["keyboard", "mouse", "screen_reader"]],
  ].map(([browser, releaseChannel, engine, platform, deviceClass, inputModes], index) => ({ id: `${browser}-${releaseChannel}`, browser, releaseChannel, engine, version: `${130 - index}.0.0`, platform, deviceClass, minViewportWidth: 390, inputModes, capabilities: ["javascript", "screen-reader"] })) as ReleaseManifest["supportedClients"];
  const performanceRequirements = supportedClients.flatMap((client) => (["ar", "en"] as const).flatMap((locale) => (["cold", "warm"] as const).flatMap((cacheState) => metrics.map((metric) => ({ id: `budget-${client.id}-${locale}-${cacheState}-${metric}`, route: "/dashboard", clientId: client.id, locale, metric, budget: 2500, cacheState, userRegion: "mena" as const, providerRegion: "me-central-1", criticalAction: metric === "critical_action_p95_ms" ? "generate" : null, jobStage: metric === "job_stage_p95_ms" ? "provider-run" : null })))));
  const cells = (["rtl", "ltr"] as const).map((direction) => ({ id: `parity-copy-${direction}`, route: "/dashboard", feature: "copy", state: "success", role: "owner", entitlement: "pro", viewport: "desktop" as const, direction }));
  const manifest: ReleaseManifest = { schema: "release-manifest/v2", id: "manifest_prod", version: 4, workspaceId: "workspace-1", buildId: "build-1", requiredRoutes: ["/dashboard"], supportedClients, performanceRequirements, dataClasses: ["workspace-content"], contracts: ["generation/v2"], parityMatrix: { dimensions: { routes: ["/dashboard"], features: ["copy"], states: ["success"], roles: ["owner"], entitlements: ["pro"], viewports: ["desktop"], directions: ["rtl", "ltr"] }, cells }, issuedAt: NOW.toISOString(), expiresAt: FUTURE, keyId: "deployment-key" };
  it("accepts only a current signature bound to the exact workspace inventory", () => { const signature = signReleaseManifest(manifest, SECRET); expect(loadReleaseManifest({ raw: JSON.stringify(manifest), signature, secret: SECRET, workspaceId: "workspace-1", now: NOW })).toEqual(manifest); const tampered = { ...manifest, performanceRequirements: manifest.performanceRequirements.map((item, index) => index === 0 ? { ...item, budget: item.budget + 1 } : item) }; expect(() => loadReleaseManifest({ raw: JSON.stringify(tampered), signature, secret: SECRET, workspaceId: "workspace-1", now: NOW })).toThrow("RELEASE_MANIFEST_SIGNATURE_INVALID"); });
  it("fails closed for absent configuration", () => expect(() => loadReleaseManifest({ raw: undefined, signature: undefined, secret: undefined, workspaceId: "workspace-1", now: NOW })).toThrow("RELEASE_MANIFEST_MISSING"));
  it("rejects a manifest that omits a parity cross-product cell", () => { const incomplete = { ...manifest, parityMatrix: { ...manifest.parityMatrix, cells: manifest.parityMatrix.cells.slice(0, 1) } }; expect(() => loadReleaseManifest({ raw: JSON.stringify(incomplete), signature: signReleaseManifest(incomplete as ReleaseManifest, SECRET), secret: SECRET, workspaceId: "workspace-1", now: NOW })).toThrow("enumerate every required parity cell"); });
  it("rejects a client matrix missing a required browser release", () => { const incomplete = { ...manifest, supportedClients: manifest.supportedClients.filter((client) => !(client.browser === "edge" && client.releaseChannel === "previous")) }; expect(() => loadReleaseManifest({ raw: JSON.stringify(incomplete), signature: signReleaseManifest(incomplete as ReleaseManifest, SECRET), secret: SECRET, workspaceId: "workspace-1", now: NOW })).toThrow("previous edge"); });
});

describe("signed deployment readiness", () => {
  it("binds a fresh decision to its build and blockers", () => {
    const decision: ReleaseReadinessDecision = { schema: "release-readiness-decision/v1", buildId: "build-1", evaluatedAt: NOW, releasable: true, parityClaimAllowed: true, parityMatrix: { requiredCells: 2, passingCells: 2 }, blockers: [] };
    const attestation = signReleaseReadiness(decision, "release-key", SECRET);
    expect(verifyReleaseReadiness(decision, attestation, "release-key", SECRET, NOW)).toEqual(attestation);
    expect(() => verifyReleaseReadiness({ ...decision, releasable: false }, attestation, "release-key", SECRET, NOW)).toThrow("RELEASE_READINESS_SIGNATURE_INVALID");
  });
});
