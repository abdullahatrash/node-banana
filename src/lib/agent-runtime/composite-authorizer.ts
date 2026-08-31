import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  agentSecurityEvents,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import type {
  CapabilityAuthorizationAdmission,
  CapabilityAuthorizationRequest,
  CapabilityAuthorizer,
} from "@/types/agentAuthorization";

type Db = ReturnType<typeof getDb>;

export class HumanCapabilityAuthorizer implements CapabilityAuthorizer {
  constructor(private readonly database: () => Db) {}

  async authorize(
    request: CapabilityAuthorizationRequest,
  ): Promise<CapabilityAuthorizationAdmission> {
    const trace = `otr_${randomUUID().replaceAll("-", "")}`;
    const context = request.securityContext;
    return this.database().transaction(async (tx) => {
      const isHumanAdmission =
        (request.audience === "human" || request.audience === "shared") &&
        context.kind === "human";
      const rows = isHumanAdmission
        ? await tx
            .select({ role: workspaceMembers.role })
            .from(workspaceMembers)
            .innerJoin(
              workspaces,
              and(
                eq(workspaces.id, workspaceMembers.workspaceId),
                isNull(workspaces.deletedAt),
              ),
            )
            .where(
              and(
                eq(workspaceMembers.workspaceId, context.workspaceId),
                eq(workspaceMembers.userId, context.userId),
              ),
            )
            .limit(1)
        : [];
      const role = rows[0]?.role;
      const allowed =
        isHumanAdmission &&
        (
          request.audience === "shared"
            ? role === "owner" || role === "admin" || role === "member"
            : role === "owner" || role === "admin"
        ) &&
        role === context.role;
      const reason = !isHumanAdmission
        ? "security_context_mismatch"
        : allowed
          ? "allowed"
          : "workspace_policy_denied";
      await tx.insert(agentSecurityEvents).values({
        id: randomUUID(),
        workspaceId: context.workspaceId,
        principalId: context.kind === "agent" ? context.principalId : null,
        keyId: context.kind === "agent" ? context.keyId : null,
        actorUserId: context.kind === "human" ? context.userId : null,
        eventType: allowed ? "authorization.allowed" : "authorization.denied",
        capabilityName: request.capability.name,
        capabilityVersion: request.capability.version,
        reason,
        resourceKinds: [
          ...new Set(request.resources.map((resource) => resource.kind)),
        ],
        changeRef: trace,
        revision: null,
        principalStatus: null,
        createdAt: new Date(),
      });
      return allowed
        ? { allowed: true, operatorTraceRef: trace }
        : {
            allowed: false,
            code: "CAPABILITY_NOT_AUTHORIZED" as const,
            message:
              request.audience === "shared"
                ? "This Workspace read requires an active membership."
                : "Workspace administration requires an active owner or admin membership.",
            operatorTraceRef: trace,
          };
    });
  }
}

export class CompositeCapabilityAuthorizer implements CapabilityAuthorizer {
  constructor(
    private readonly agent: CapabilityAuthorizer,
    private readonly human: CapabilityAuthorizer,
  ) {}

  authorize(
    request: CapabilityAuthorizationRequest,
  ): Promise<CapabilityAuthorizationAdmission> {
    return request.securityContext.kind === "agent" &&
      (request.audience === "agent" || request.audience === "shared")
      ? this.agent.authorize(request)
      : this.human.authorize(request);
  }
}
