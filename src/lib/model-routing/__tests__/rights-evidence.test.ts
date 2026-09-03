import { describe, expect, it } from "vitest";
import { rightsEvidenceDigest, validateRightsEvidence } from "../rights-evidence";

const at = new Date("2026-09-03T00:00:00.000Z");
const unsigned = { schema: "inspiration-rights-evidence/v1" as const, id: "evidence", workspaceId: "ws", sourceAssetId: "asset", sourceDigest: `sha256:${"a".repeat(64)}` as `sha256:${string}`, basis: "licensed" as const, permittedRemix: "derivative" as const, issuer: { type: "license_authority" as const, id: "authority" }, verifier: { type: "workspace_member" as const, userId: "user" }, scope: { commercialUse: true, derivativeUse: true, modelInputUse: true, territories: ["worldwide"] }, evidenceDocumentAssetId: "license-document", sourceUrl: "https://example.com/license", issuedAt: new Date("2026-09-01T00:00:00.000Z"), verifiedAt: new Date("2026-09-02T00:00:00.000Z"), expiresAt: new Date("2026-10-01T00:00:00.000Z") };
const evidence = { ...unsigned, digest: rightsEvidenceDigest(unsigned) };

describe("typed Inspiration rights evidence", () => {
  it("requires exact immutable source coverage and valid scope", () => {
    expect(validateRightsEvidence({ workspaceId: "ws", basis: "licensed", permittedRemix: "derivative", sourceAssetIds: ["asset"], evidence: [evidence], at })).toEqual({ ok: true });
    expect(validateRightsEvidence({ workspaceId: "ws", basis: "licensed", permittedRemix: "derivative", sourceAssetIds: ["asset", "other"], evidence: [evidence], at })).toMatchObject({ ok: false, code: "RIGHTS_SOURCE_COVERAGE_REQUIRED" });
  });
  it("rejects arbitrary, tampered, expired, or under-scoped proof", () => {
    expect(validateRightsEvidence({ workspaceId: "ws", basis: "licensed", permittedRemix: "derivative", sourceAssetIds: ["asset"], evidence: [{ ...evidence, sourceUrl: null, evidenceDocumentAssetId: null }], at }).ok).toBe(false);
    expect(validateRightsEvidence({ workspaceId: "ws", basis: "licensed", permittedRemix: "derivative", sourceAssetIds: ["asset"], evidence: [{ ...evidence, expiresAt: at }], at }).ok).toBe(false);
    expect(validateRightsEvidence({ workspaceId: "ws", basis: "licensed", permittedRemix: "derivative", sourceAssetIds: ["asset"], evidence: [{ ...evidence, scope: { ...evidence.scope, derivativeUse: false } }], at }).ok).toBe(false);
  });
});
