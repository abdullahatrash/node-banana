import { getDb } from "@/lib/db";
import { DrizzleAgentAuthorizationRepository } from "@/lib/agent-authorization";
import { requireAgentManagerRole } from "@/lib/agent-auth/http";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const repository = new DrizzleAgentAuthorizationRepository(getDb);

export const GET = withStudioAuth<undefined>(
  { route: "/api/agents/authorization-decisions", action: "read", permission: "workspaces:read" },
  async (request, authz) => {
    const denied = requireAgentManagerRole(authz.role);
    if (denied) {
      denied.headers.set("Cache-Control", "no-store");
      denied.headers.set("Pragma", "no-cache");
      return denied;
    }
    const url = new URL(request.url);
    const principalId = url.searchParams.get("principalId")?.trim() || undefined;
    const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(200, Math.max(1, requestedLimit))
      : 100;
    const decisions = await repository.listDecisionsForActor({
      workspaceId: authz.workspaceId,
      actorUserId: authz.userId,
      principalId,
      limit,
    });
    if (!decisions) {
      return noStoreJson(
        { success: false, error: "Authorization decisions are unavailable." },
        { status: 403 },
      );
    }
    return noStoreJson({
      success: true,
      decisions: decisions.map((decision) => ({
        id: decision.id,
        principalId: decision.principalId,
        keyId: decision.keyId,
        capability: `${decision.capabilityName}@${decision.capabilityVersion}`,
        outcome: decision.outcome,
        reason: decision.reason,
        operatorTraceRef: decision.operatorTraceRef,
        grantRevisionId: decision.grantRevisionId,
        policyRevisionId: decision.policyRevisionId,
        createdAt: decision.createdAt.toISOString(),
      })),
    });
  },
);
