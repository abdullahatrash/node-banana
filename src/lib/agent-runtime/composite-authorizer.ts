import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  agentSecurityEvents,
  workspaceMembers,
  workspaceGovernanceResources,
  workspaces,
} from "@/lib/db/schema";
import type {
  CapabilityAuthorizationAdmission,
  CapabilityAuthorizationRequest,
  CapabilityAuthorizer,
} from "@/types/agentAuthorization";
import {
  BUILT_IN_ROLE_CAPABILITIES,
  governanceCapabilityForApplicationCapability,
  legacyRoleBinding,
} from "@/lib/governance/roles";
import type {
  CustomRoleRevision,
  GovernanceCapability,
  WorkspaceRoleBinding,
} from "@/lib/governance/types";

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
      const governanceCapability = governanceCapabilityForApplicationCapability(
        request.capability.name,
      );
      let governanceAllowed = false;
      if (isHumanAdmission && role && governanceCapability) {
        const [assignment] = await tx
          .select({
            status: workspaceGovernanceResources.status,
            body: workspaceGovernanceResources.body,
          })
          .from(workspaceGovernanceResources)
          .where(
            and(
              eq(workspaceGovernanceResources.workspaceId, context.workspaceId),
              eq(workspaceGovernanceResources.kind, "member_role_assignment"),
              eq(workspaceGovernanceResources.id, context.userId),
            ),
          )
          .limit(1);
        const storedBinding = assignment?.status === "active"
          ? (assignment.body as { binding?: WorkspaceRoleBinding }).binding
          : undefined;
        const binding = storedBinding ?? {
          kind: "built_in" as const,
          role: legacyRoleBinding(role),
        };
        if (binding.kind === "built_in") {
          governanceAllowed = (
            BUILT_IN_ROLE_CAPABILITIES[binding.role] as readonly GovernanceCapability[]
          ).includes(governanceCapability);
        } else if (governanceCapability !== "reviews.decide_publishing") {
          const [customRole] = await tx
            .select({
              status: workspaceGovernanceResources.status,
              body: workspaceGovernanceResources.body,
            })
            .from(workspaceGovernanceResources)
            .where(
              and(
                eq(workspaceGovernanceResources.workspaceId, context.workspaceId),
                eq(workspaceGovernanceResources.kind, "custom_role"),
                eq(workspaceGovernanceResources.id, binding.roleId),
              ),
            )
            .limit(1);
          const revision = customRole?.status === "active"
            ? (customRole.body as { revisions?: CustomRoleRevision[] }).revisions
              ?.find((candidate) => candidate.revision === binding.roleRevision)
            : undefined;
          governanceAllowed = revision?.capabilities.includes(governanceCapability) ?? false;
        }
      }
      const allowed =
        isHumanAdmission &&
        role === context.role &&
        (governanceCapability
          ? governanceAllowed
          : request.audience === "shared"
            ? role === "owner" || role === "admin" || role === "member"
            : role === "owner" || role === "admin");
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

const CLOSURE_CONTINUATION_CAPABILITIES = new Set([
  "governance.view",
  "workspace.close",
  "workspace.transfer_ownership",
  "exports.manage",
  "audit.export",
  "retention.manage",
  "publishing_deliveries.cancel",
  "spend_controls.suspend",
]);

export function closureAllowsCapability(request: CapabilityAuthorizationRequest): boolean {
  return request.effect?.mutation === "none" || CLOSURE_CONTINUATION_CAPABILITIES.has(request.capability.name);
}

/** Blocks every new human or Agent effect while a Workspace closure cools off. */
export class WorkspaceClosureAwareAuthorizer implements CapabilityAuthorizer {
  constructor(private readonly delegate: CapabilityAuthorizer, private readonly database: () => Db) {}

  async authorize(request: CapabilityAuthorizationRequest): Promise<CapabilityAuthorizationAdmission> {
    if (closureAllowsCapability(request)) return this.delegate.authorize(request);
    const [closure] = await this.database().select({ id: workspaceGovernanceResources.id }).from(workspaceGovernanceResources).where(and(eq(workspaceGovernanceResources.workspaceId, request.securityContext.workspaceId), eq(workspaceGovernanceResources.kind, "workspace_closure"), eq(workspaceGovernanceResources.status, "cooling_off"))).limit(1);
    if (!closure) return this.delegate.authorize(request);
    const trace = `otr_${randomUUID().replaceAll("-", "")}`;
    const context = request.securityContext;
    await this.database().insert(agentSecurityEvents).values({
      id: randomUUID(),
      workspaceId: context.workspaceId,
      principalId: context.kind === "agent" ? context.principalId : null,
      keyId: context.kind === "agent" ? context.keyId : null,
      actorUserId: context.kind === "human" ? context.userId : null,
      eventType: "authorization.denied",
      capabilityName: request.capability.name,
      capabilityVersion: request.capability.version,
      reason: "workspace_closure_effects_blocked",
      resourceKinds: [...new Set(request.resources.map((resource) => resource.kind))],
      changeRef: trace,
      revision: null,
      principalStatus: null,
      createdAt: new Date(),
    });
    return { allowed: false, code: "CAPABILITY_NOT_AUTHORIZED", message: "Workspace Closure blocks new effects during the cooling-off period.", operatorTraceRef: trace };
  }
}
