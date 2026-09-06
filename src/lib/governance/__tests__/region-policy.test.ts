import { describe, expect, it } from "vitest";
import {
  ConfiguredGovernanceRegionVerifier,
  signGovernanceRegionDeploymentEvidence,
  type GovernanceRegionDeploymentEvidenceUnsigned,
} from "../region-policy";
import { GOVERNANCE_REGION_ROUTE_CATALOG } from "../region-route-catalog";

const key = Buffer.alloc(32, 7);
const evaluatedAt = new Date("2026-09-04T12:00:00.000Z");

function unsigned(overrides: Partial<GovernanceRegionDeploymentEvidenceUnsigned> = {}): GovernanceRegionDeploymentEvidenceUnsigned {
  return {
    schema: "governance-region-deployment-evidence/v1",
    keyId: "region-key",
    deploymentId: "deployment-a",
    region: "me-central-1",
    issuedAt: "2026-09-04T11:00:00.000Z",
    expiresAt: "2026-10-04T11:00:00.000Z",
    routes: GOVERNANCE_REGION_ROUTE_CATALOG.map((route) => ({
      kind: route.kind,
      routeId: route.routeId,
      region: route.key === "replicateProcessing" ? "replicate-us" : "me-central-1",
    })),
    sources: [{
      url: "https://replicate.com/docs/topics/site-policy/subprocessors/",
      digest: `sha256:${"a".repeat(64)}`,
      checkedAt: "2026-09-04T10:00:00.000Z",
    }],
    ...overrides,
  };
}

describe("governance region evidence", () => {
  it("signs and verifies a complete route manifest with an independent provider region", async () => {
    const verifier = new ConfiguredGovernanceRegionVerifier(new Map([["region-key", key]]));
    const evidence = signGovernanceRegionDeploymentEvidence(unsigned(), key);

    await expect(verifier.verify({ workspaceId: "workspace-a", region: "me-central-1", evidence, evaluatedAt }))
      .resolves.toMatchObject({
        status: "verified",
        evidence: {
          region: "me-central-1",
          routes: expect.arrayContaining([{ kind: "processing", routeId: "provider:replicate", region: "replicate-us" }]),
        },
      });
  });

  it("rejects stale source review and a primary region not backed by asset storage", async () => {
    const verifier = new ConfiguredGovernanceRegionVerifier(new Map([["region-key", key]]));
    const stale = unsigned({ sources: [{
      url: "https://replicate.com/docs/topics/site-policy/subprocessors/",
      digest: `sha256:${"b".repeat(64)}`,
      checkedAt: "2026-07-01T00:00:00.000Z",
    }] });
    await expect(verifier.verify({ workspaceId: "workspace-a", region: stale.region, evidence: signGovernanceRegionDeploymentEvidence(stale, key), evaluatedAt }))
      .resolves.toEqual({ status: "pending", reason: "INVALID_SCOPE" });

    const mismatched = unsigned({ region: "eu-west-1" });
    await expect(verifier.verify({ workspaceId: "workspace-a", region: mismatched.region, evidence: signGovernanceRegionDeploymentEvidence(mismatched, key), evaluatedAt }))
      .resolves.toEqual({ status: "pending", reason: "INVALID_SCOPE" });
  });

  it("refuses undersized signing and verification keys", async () => {
    expect(() => signGovernanceRegionDeploymentEvidence(unsigned(), Buffer.alloc(16)))
      .toThrow("GOVERNANCE_REGION_SIGNING_KEY_INVALID");
    const verifier = new ConfiguredGovernanceRegionVerifier(new Map([["region-key", Buffer.alloc(16)]]));
    const evidence = signGovernanceRegionDeploymentEvidence(unsigned(), key);
    await expect(verifier.verify({ workspaceId: "workspace-a", region: evidence.region, evidence, evaluatedAt }))
      .resolves.toEqual({ status: "pending", reason: "UNCONFIGURED_TRUST_ROOT" });
  });
});
