import type { GovernanceRegionRouteKind } from "./region-policy";
import { admitProductionGovernanceRegionRoute } from "./production";

export const GOVERNANCE_REGION_ROUTES = {
  assetStorage: { kind: "primary_storage", routeId: "storage:workspace-assets" },
  assetProcessing: { kind: "processing", routeId: "processing:asset-ingestion" },
  publishing: { kind: "processing", routeId: "processing:social-publishing" },
  deletion: { kind: "deletion", routeId: "deletion:workspace-resources" },
  backup: { kind: "backup", routeId: "backup:workspace-primary" },
  logging: { kind: "logging", routeId: "logging:workspace-audit" },
} as const satisfies Record<string, { kind: GovernanceRegionRouteKind; routeId: string }>;

export class GovernanceRegionRouteDeniedError extends Error {
  constructor(readonly reason: string) {
    super(`Workspace Data Region Policy denied this route: ${reason}`);
    this.name = "GovernanceRegionRouteDeniedError";
  }
}

export async function requireGovernanceRegionRoute(input: {
  workspaceId: string;
  route: (typeof GOVERNANCE_REGION_ROUTES)[keyof typeof GOVERNANCE_REGION_ROUTES];
  configuredRegion: string | undefined;
}): Promise<void> {
  const admission = await admitProductionGovernanceRegionRoute({
    workspaceId: input.workspaceId,
    ...input.route,
    configuredRegion: input.configuredRegion?.trim() || "unconfigured",
  });
  if (!admission.allowed) throw new GovernanceRegionRouteDeniedError(admission.reason);
}
