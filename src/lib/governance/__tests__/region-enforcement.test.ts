import { describe, expect, it } from "vitest";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { InMemoryGovernanceRepository } from "../memory-repository";
import { GOVERNANCE_REGION_ROUTES } from "../region-enforcement";
import { GovernanceRegionAdmissionService } from "../region-policy";

const now = new Date("2026-09-03T12:00:00.000Z");

describe("Workspace Data Region route enforcement", () => {
  it("admits every named production route only from verified, unexpired, exact deployment evidence", async () => {
    const repository = new InMemoryGovernanceRepository();
    const routes = Object.values(GOVERNANCE_REGION_ROUTES).map((route) => ({
      ...route,
      region: "me-central-1",
    }));
    const body = {
      region: "me-central-1",
      verified: true,
      verifiedEvidence: {
        schema: "governance-verified-region-evidence/v1" as const,
        evidenceDigest: canonicalDigest(routes),
        keyId: "deployment-key",
        deploymentId: "deployment-1",
        region: "me-central-1",
        issuedAt: "2026-09-03T11:00:00.000Z",
        expiresAt: "2026-09-04T12:00:00.000Z",
        routes,
        verifiedAt: now.toISOString(),
      },
    };
    await repository.commit({
      receipt: { workspaceId: "workspace-a", capability: "test.seed@1", idempotencyKey: "seed-region", requestDigest: canonicalDigest(body), result: {}, createdAt: now },
      mutations: [{ type: "create", expectedVersion: null, resource: { id: "active", workspaceId: "workspace-a", kind: "data_region_policy", version: 1, status: "active", body, createdByUserId: "owner-a", createdAt: now, updatedAt: now } }],
      audit: { schema: "workspace-audit-event/v1", id: "audit-seed-region", workspaceId: "workspace-a", actor: { kind: "system", id: null }, capability: "test.seed@1", action: "seed", resource: null, outcome: "completed", redactedDetails: {}, occurredAt: now },
    });
    const service = new GovernanceRegionAdmissionService(repository);

    for (const route of Object.values(GOVERNANCE_REGION_ROUTES)) {
      await expect(service.admit({ workspaceId: "workspace-a", ...route, configuredRegion: "me-central-1", evaluatedAt: now }))
        .resolves.toMatchObject({ allowed: true, policyApplied: true });
    }
    await expect(service.admit({ workspaceId: "workspace-a", ...GOVERNANCE_REGION_ROUTES.assetStorage, configuredRegion: "eu-west-1", evaluatedAt: now }))
      .resolves.toEqual({ allowed: false, reason: "REGION_ROUTE_NOT_ALLOWLISTED" });
    await expect(service.admit({ workspaceId: "workspace-a", kind: "processing", routeId: "processing:untrusted-provider", configuredRegion: "me-central-1", evaluatedAt: now }))
      .resolves.toEqual({ allowed: false, reason: "REGION_ROUTE_NOT_ALLOWLISTED" });
  });
});
