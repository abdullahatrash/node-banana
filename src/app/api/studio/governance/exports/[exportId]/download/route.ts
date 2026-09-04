import { NextRequest } from "next/server";
import { noStoreJson, requireExplicitAgentWorkspace } from "@/lib/agent-auth/http-request";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { GovernanceError } from "@/lib/governance/service";
import { admitProductionGovernanceRegionRoute, PRODUCTION_GOVERNANCE_SERVICE } from "@/lib/governance/production";
import { GOVERNANCE_REGION_ROUTES } from "@/lib/governance/region-route-catalog";
import { createPresignedDownload } from "@/lib/storage";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

function errorStatus(error: GovernanceError): number {
  if (error.code === "FORBIDDEN") return 403;
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "CONFLICT" || error.code === "EXPIRED") return 409;
  return 400;
}

export const GET = withStudioAuth<{ params: Promise<Record<string, string>> }>(
  { route: "/api/studio/governance/exports/[exportId]/download", action: "read", permission: "workspaces:read" },
  async (request: NextRequest, authz, context) => {
    const boundaryError = requireExplicitAgentWorkspace(request, authz.workspaceId);
    if (boundaryError) return boundaryError;
    const actor = credentialHumanContext(request, authz);
    if (!actor) return noStoreJson({ success: false, code: "WORKSPACE_REQUIRED" }, { status: 400 });
    try {
      const { exportId } = await context.params;
      const artifact = await PRODUCTION_GOVERNANCE_SERVICE.authorizeExportDownload({ workspaceId: actor.workspaceId, userId: actor.userId, legacyRole: actor.role, authContextId: actor.authContextId ?? authz.authContextId }, exportId ?? "");
      const admission = await admitProductionGovernanceRegionRoute({ workspaceId: authz.workspaceId, ...GOVERNANCE_REGION_ROUTES.governanceExportStorage, configuredRegion: process.env.GOVERNANCE_EXPORT_STORAGE_REGION ?? "unconfigured" });
      if (!admission.allowed) return noStoreJson({ success: false, code: "REGION_ROUTE_NOT_ALLOWLISTED" }, { status: 409 });
      const signed = await createPresignedDownload({ key: artifact.artifactRef, expiresInSeconds: 300 });
      return noStoreJson({ success: true, exportId: artifact.exportId, kind: artifact.kind, expiresAt: artifact.expiresAt, manifest: artifact.manifest, downloadUrl: signed.downloadUrl, downloadExpiresInSeconds: signed.expiresInSeconds });
    } catch (error) {
      if (error instanceof GovernanceError) return noStoreJson({ success: false, code: `GOVERNANCE_${error.code}` }, { status: errorStatus(error) });
      return noStoreJson({ success: false, code: "UNAVAILABLE" }, { status: 503 });
    }
  },
);
