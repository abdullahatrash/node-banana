import { describe, expect, it } from "vitest";
import { GovernanceGenerationRegionAuthority, type GenerationRegionRepository } from "../generation-region";
import { testRef } from "./fixtures";

const at = new Date("2026-09-04T00:00:00.000Z");
const digest = `sha256:${"ab".repeat(32)}`;
function repository(overrides: Record<string, unknown> = {}): GenerationRegionRepository {
  return { getResource: async () => ({ id: "active", workspaceId: "ws", kind: "data_region_policy", version: 4, status: "active", body: { region: "replicate-us", verified: true, verifiedEvidence: { schema: "governance-verified-region-evidence/v1", evidenceDigest: digest, keyId: "key", deploymentId: "deployment", region: "replicate-us", issuedAt: "2026-09-03T00:00:00.000Z", expiresAt: "2026-09-05T00:00:00.000Z", routes: [{ kind: "processing", routeId: "provider:replicate", region: "replicate-us" }], verifiedAt: "2026-09-03T00:00:00.000Z" }, ...overrides }, createdByUserId: "u", createdAt: at, updatedAt: at }) as never };
}

describe("generation processing region authority", () => {
  it("pins exact verified, unexpired governance evidence and its policy revision", async () => {
    const authority = new GovernanceGenerationRegionAuthority(repository(), () => "replicate-us");
    const admitted = await authority.admit({ workspaceId: "ws", model: testRef(5), at });
    expect(admitted).toMatchObject({ kind: "admitted", evidence: { policyId: "active", policyVersion: 4, evidenceDigest: digest, routeId: "provider:replicate" } });
    if (admitted.kind === "admitted") await expect(authority.revalidate({ workspaceId: "ws", model: testRef(5), evidence: admitted.evidence, at })).resolves.toEqual({ kind: "admitted" });
  });

  it("fails closed without policy evidence and when the pinned revision changes", async () => {
    const absent = new GovernanceGenerationRegionAuthority({ getResource: async () => null }, () => "replicate-us");
    await expect(absent.admit({ workspaceId: "ws", model: testRef(5), at })).resolves.toMatchObject({ kind: "denied" });
    const original = new GovernanceGenerationRegionAuthority(repository(), () => "replicate-us"); const admitted = await original.admit({ workspaceId: "ws", model: testRef(5), at });
    const changed = new GovernanceGenerationRegionAuthority(repository({}), () => "replicate-us");
    if (admitted.kind === "admitted") await expect(changed.revalidate({ workspaceId: "ws", model: testRef(5), evidence: { ...admitted.evidence, policyVersion: 3 }, at })).resolves.toMatchObject({ kind: "denied", code: "PROCESSING_REGION_EVIDENCE_CHANGED" });
  });
});
