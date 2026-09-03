import { NextRequest, after } from "next/server";
import { z } from "zod";
import { noStoreJson, requireAgentMutationRequest, requireExplicitAgentWorkspace } from "@/lib/agent-auth/http-request";
import { PRODUCTION_CAPABILITY_REGISTRY, dispatchCapability } from "@/lib/agent-runtime/server-dispatcher";
import { credentialHumanContext } from "@/lib/credential-vault/http";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";
import { getProductionGovernanceBulkWorker, getProductionGovernanceExportWorker, getProductionGovernanceImportWorker } from "@/lib/governance/production";

const bodySchema = z.object({
  capability: z.string().regex(/^(?:governance\.snapshot\.get|governance\.view|members\.(?:invite|manage)|roles\.manage|portfolios\.manage|reviews\.(?:create|decide_content|decide_publishing)|approval_policies\.manage|audit\.(?:view|export)|regions\.manage|retention\.manage|safety\.(?:decide|appeal)|bulk\.(?:preview|execute)|imports\.manage|exports\.manage|workspace\.(?:transfer_ownership|close))@1$/),
  input: z.record(z.string(), z.unknown()).default({}),
}).strict();

function status(category: string): number {
  if (category === "authorization") return 403;
  if (category === "not_found") return 404;
  if (category === "conflict") return 409;
  if (category === "internal") return 500;
  return 400;
}

export const POST = withStudioAuth<undefined>(
  { route: "/api/studio/governance/capabilities", action: "read" },
  async (request: NextRequest, authz) => {
    let body: unknown;
    try { body = await request.json(); } catch { return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 }); }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
    const mutation = parsed.data.capability !== "governance.snapshot.get@1";
    const boundaryError = mutation
      ? requireAgentMutationRequest(request, authz.workspaceId)
      : requireExplicitAgentWorkspace(request, authz.workspaceId);
    if (boundaryError) return boundaryError;
    const context = credentialHumanContext(request, authz);
    if (!context) return noStoreJson({ success: false, code: "WORKSPACE_REQUIRED" }, { status: 400 });
    const definition = PRODUCTION_CAPABILITY_REGISTRY.getDefinition({ name: parsed.data.capability.slice(0, -2), version: 1 });
    if (!definition) return noStoreJson({ success: false, code: "CAPABILITY_NOT_FOUND" }, { status: 404 });
    const response = await dispatchCapability(parsed.data, { securityContext: context });
    if (response.type === "capability_error") return noStoreJson({ success: false, code: response.code, operatorTraceRef: response.operatorTraceRef }, { status: status(response.category) });
    const output = response.output as { exportId?: string; operationId?: string; importId?: string; status?: string };
    if (output?.exportId && (parsed.data.capability === "audit.export@1" || parsed.data.capability === "exports.manage@1")) {
      const kind = parsed.data.capability === "audit.export@1" ? "audit_export" as const : "workspace_export" as const;
      after(async () => {
        try { await getProductionGovernanceExportWorker().process({ workspaceId: authz.workspaceId, kind, exportId: output.exportId! }); }
        catch { /* The durable job records a safe failed-known state. */ }
      });
    }
    if (output?.operationId && output.status === "queued" && parsed.data.capability === "bulk.execute@1") {
      after(async () => {
        try { await getProductionGovernanceBulkWorker().process({ workspaceId: authz.workspaceId, operationId: output.operationId! }); }
        catch { /* The durable per-item states make interruption explicit and retry-safe. */ }
      });
    }
    if (output?.importId && output.status === "queued" && parsed.data.capability === "imports.manage@1") {
      after(async () => {
        try { await getProductionGovernanceImportWorker().process({ workspaceId: authz.workspaceId, importId: output.importId! }); }
        catch { /* Import item evidence remains durable and idempotent for recovery. */ }
      });
    }
    return noStoreJson({ success: true, capability: `${response.capability.name}@${response.capability.version}`, result: response.output });
  },
);
