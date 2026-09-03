import type { GovernanceRegionRouteKind } from "./region-policy";
import { GovernanceRegionAdmissionService } from "./region-policy";
import { DrizzleGovernanceRepository } from "./postgres-repository";
import { getDb } from "@/lib/db";

const REGION_ADMISSION = new GovernanceRegionAdmissionService(new DrizzleGovernanceRepository(getDb));

export const GOVERNANCE_REGION_ROUTES = {
  assetStorage: { kind: "primary_storage", routeId: "storage:workspace-assets" },
  assetProcessing: { kind: "processing", routeId: "processing:asset-ingestion" },
  publishing: { kind: "processing", routeId: "processing:social-publishing" },
  deletion: { kind: "deletion", routeId: "deletion:workspace-resources" },
  backup: { kind: "backup", routeId: "backup:workspace-primary" },
  logging: { kind: "logging", routeId: "logging:workspace-audit" },
  workspaceImportProcessing: { kind: "processing", routeId: "processing:workspace-import" },
  workspaceImportStorage: { kind: "primary_storage", routeId: "storage:workspace-import" },
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
  const admission = await REGION_ADMISSION.admit({
    workspaceId: input.workspaceId,
    ...input.route,
    configuredRegion: input.configuredRegion?.trim() || "unconfigured",
    evaluatedAt: new Date(),
  });
  if (!admission.allowed) throw new GovernanceRegionRouteDeniedError(admission.reason);
}
