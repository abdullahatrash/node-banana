import { describe, expect, it } from "vitest";
import { signReleaseAttestation, verifyReleaseAttestation } from "../attestation";
import { loadReleaseManifest, signReleaseManifest, type ReleaseManifest } from "../manifest";

const NOW = new Date("2026-09-03T12:00:00.000Z"); const FUTURE = "2026-09-04T12:00:00.000Z"; const SECRET = "a-secure-test-secret-with-at-least-32-bytes";

describe("trusted release evidence", () => {
  it("cryptographically binds the artifact, workspace, runner, and signer role", () => {
    const unsigned = { schema: "release-attestation/v1" as const, workspaceId: "workspace-1", record: { recordKind: "evidence" as const, document: { id: "perf-1", kind: "performance" as const, buildId: "build-1", collectedAt: NOW.toISOString(), expiresAt: FUTURE, outcome: "passed" as const, locale: "ar" as const, direction: "rtl" as const, client: "chromium", route: "/dashboard", metric: "largest_contentful_paint_ms" as const, measured: 1500, budget: 2500, sampleCount: 20, runner: "ci-key", artifactDigest: `sha256:${"a".repeat(64)}` } } };
    const signer = { keyId: "ci-key", role: "ci" as const, issuedAt: NOW.toISOString(), expiresAt: FUTURE }; const signature = signReleaseAttestation(unsigned, signer, SECRET); const attestation = { ...unsigned, signatures: [{ ...signer, signature }] };
    const verified = verifyReleaseAttestation(attestation, { "ci-key": { role: "ci", secret: SECRET } }, NOW);
    expect(verified.record.recordKind).toBe("evidence");
    expect("artifactDigest" in verified.record.document ? verified.record.document.artifactDigest : null).toBe(`sha256:${"a".repeat(64)}`);
    expect(() => verifyReleaseAttestation({ ...attestation, record: { ...attestation.record, document: { ...attestation.record.document, artifactDigest: `sha256:${"b".repeat(64)}` } } }, { "ci-key": { role: "ci", secret: SECRET } }, NOW)).toThrow("ATTESTATION_SIGNATURE_INVALID");
  });

  it("requires independent product and engineering signers", () => {
    const document = { id: "parity-copy", feature: "Copy", buildId: "build-1", requiredLocales: ["ar", "en"] as ("ar" | "en")[], evidenceIds: ["perf-1"], productSignoffUserId: "product-key", engineeringSignoffUserId: "engineering-key", status: "passed" as const, evaluatedAt: NOW.toISOString(), expiresAt: FUTURE, artifactDigest: `sha256:${"c".repeat(64)}` };
    const unsigned = { schema: "release-attestation/v1" as const, workspaceId: "workspace-1", record: { recordKind: "parity_requirement" as const, document } };
    const product = { keyId: "product-key", role: "product_signer" as const, issuedAt: NOW.toISOString(), expiresAt: FUTURE }; const engineering = { keyId: "engineering-key", role: "engineering_signer" as const, issuedAt: NOW.toISOString(), expiresAt: FUTURE };
    const value = { ...unsigned, signatures: [{ ...product, signature: signReleaseAttestation(unsigned, product, SECRET) }, { ...engineering, signature: signReleaseAttestation(unsigned, engineering, `${SECRET}-other`) }] };
    expect(verifyReleaseAttestation(value, { "product-key": { role: "product_signer", secret: SECRET }, "engineering-key": { role: "engineering_signer", secret: `${SECRET}-other` } }, NOW).signatures).toHaveLength(2);
  });
});

describe("server-owned release manifest", () => {
  const manifest: ReleaseManifest = { schema: "release-manifest/v1", id: "manifest_prod", version: 3, workspaceId: "workspace-1", buildId: "build-1", requiredRoutes: ["/dashboard"], supportedClients: ["chromium"], dataClasses: ["workspace-content"], contracts: ["generation/v2"], parityRequirementIds: ["parity-copy"], issuedAt: NOW.toISOString(), expiresAt: FUTURE, keyId: "deployment-key" };
  it("accepts only a current signature bound to the exact workspace inventory", () => { const signature = signReleaseManifest(manifest, SECRET); expect(loadReleaseManifest({ raw: JSON.stringify(manifest), signature, secret: SECRET, workspaceId: "workspace-1", now: NOW })).toEqual(manifest); expect(() => loadReleaseManifest({ raw: JSON.stringify({ ...manifest, requiredRoutes: ["/settings"] }), signature, secret: SECRET, workspaceId: "workspace-1", now: NOW })).toThrow("RELEASE_MANIFEST_SIGNATURE_INVALID"); });
  it("fails closed for absent configuration", () => expect(() => loadReleaseManifest({ raw: undefined, signature: undefined, secret: undefined, workspaceId: "workspace-1", now: NOW })).toThrow("RELEASE_MANIFEST_MISSING"));
});
