import type { GovernanceRegionRouteKind } from "./region-policy";

/** Every authoritative route that a Workspace Data Region Policy can govern. */
export const GOVERNANCE_REGION_ROUTES = {
  assetStorage: { kind: "primary_storage", routeId: "storage:workspace-assets" },
  workspaceImportStorage: { kind: "primary_storage", routeId: "storage:workspace-import" },
  governanceExportStorage: { kind: "primary_storage", routeId: "storage:governance-export" },
  assetProcessing: { kind: "processing", routeId: "processing:asset-ingestion" },
  publishing: { kind: "processing", routeId: "processing:social-publishing" },
  workspaceImportProcessing: { kind: "processing", routeId: "processing:workspace-import" },
  replicateProcessing: { kind: "processing", routeId: "provider:replicate" },
  backup: { kind: "backup", routeId: "backup:workspace-primary" },
  logging: { kind: "logging", routeId: "logging:workspace-audit" },
  deletion: { kind: "deletion", routeId: "deletion:workspace-resources" },
} as const satisfies Record<string, { kind: GovernanceRegionRouteKind; routeId: string }>;

export const GOVERNANCE_REGION_ROUTE_CATALOG = Object.entries(GOVERNANCE_REGION_ROUTES).map(([key, route]) => ({
  key: key as keyof typeof GOVERNANCE_REGION_ROUTES,
  ...route,
}));
