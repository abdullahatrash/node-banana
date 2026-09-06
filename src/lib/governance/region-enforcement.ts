import { GovernanceRegionAdmissionService } from "./region-policy";
import { DrizzleGovernanceRepository } from "./postgres-repository";
import { getDb } from "@/lib/db";
import { GOVERNANCE_REGION_ROUTES } from "./region-route-catalog";

export { GOVERNANCE_REGION_ROUTES } from "./region-route-catalog";

const REGION_ADMISSION = new GovernanceRegionAdmissionService(new DrizzleGovernanceRepository(getDb));

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
