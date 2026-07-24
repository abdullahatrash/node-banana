import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  agentAuthorizationDecisions,
  agentAuthorityProvisioningReceipts,
  agentGrantRevisions,
  agentGrantSets,
  agentKeys,
  agentPrincipals,
  agentSecurityEvents,
  credentialProfiles,
  projects,
  socialAccounts,
  socialAutomationRules,
  workspaceAgentPolicies,
  workspaceAgentPolicyRevisions,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import type {
  AgentAuthorizationDecisionRecord,
  AgentAuthorizationRepository,
  AgentGrantRevisionRecord,
  AgentGrantSetRecord,
  AgentResourceKind,
  AgentResourceRef,
  AgentSecurityEventRecord,
  WorkspaceAgentPolicyRecord,
} from "./types";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function constraintKey(kind: AgentResourceKind) {
  return kind === "channel"
    ? "channelIds"
    : kind === "credential_profile"
      ? "credentialProfileIds"
      : kind === "workflow"
        ? "workflowIds"
        : "automationIds";
}

function covers(
  constraints: import("@/types").AgentResourceConstraints,
  resources: AgentResourceRef[],
) {
  return resources.every((resource) =>
    constraints[constraintKey(resource.kind)].includes(resource.id),
  );
}

function principalFromRow(
  row: typeof agentPrincipals.$inferSelect,
): import("@/types").AgentPrincipalRecord {
  return { ...row, requestedAccess: row.requestedAccess ?? [] };
}

function keyFromRow(
  row: typeof agentKeys.$inferSelect,
): import("@/types").AgentKeyRecord {
  return { ...row, authorizationScopes: row.authorizationScopes ?? [] };
}

function revisionFromRow(
  row: typeof agentGrantRevisions.$inferSelect,
): AgentGrantRevisionRecord {
  return { ...row, grants: row.grants ?? [] };
}

function policyFromRow(
  row: typeof workspaceAgentPolicies.$inferSelect,
): WorkspaceAgentPolicyRecord {
  return { ...row, grants: row.grants ?? [] };
}

function refs(kind: AgentResourceKind, ids: string[]): AgentResourceRef[] {
  return ids.map((id) => ({ kind, id }));
}

function constraintRefs(
  resources: import("@/types").AgentResourceConstraints,
): AgentResourceRef[] {
  return [
    ...refs("channel", resources.channelIds),
    ...refs("credential_profile", resources.credentialProfileIds),
    ...refs("workflow", resources.workflowIds),
    ...refs("automation", resources.automationIds),
  ];
}

function grantsCoverScope(
  grants: import("@/types").AgentCapabilityGrant[],
  scope: import("@/types").AgentKeyAuthorizationScope,
): boolean {
  const requested = constraintRefs(scope.resources);
  return grants.some(
    (grant) =>
      grant.capability === scope.capability &&
      grant.authorizationContractDigest === scope.authorizationContractDigest &&
      covers(grant.resources, requested),
  );
}

export class DrizzleAgentAuthorizationRepository
  implements AgentAuthorizationRepository
{
  constructor(private readonly getDatabase: () => Db) {}

  async admit(input: Parameters<AgentAuthorizationRepository["admit"]>[0]) {
    return this.getDatabase().transaction(async (tx) => {
      const { request, resources, now } = input;
      const capability = `${request.capability.name}@${request.capability.version}`;
      const principalRows = await tx
        .select()
        .from(agentPrincipals)
        .where(eq(agentPrincipals.id, request.securityContext.principalId))
        .limit(1)
        .for("update");
      const keyRows = await tx
        .select()
        .from(agentKeys)
        .where(eq(agentKeys.id, request.securityContext.keyId))
        .limit(1)
        .for("update");
      const policyRows = await tx
        .select({
          policy: workspaceAgentPolicies,
          revision: workspaceAgentPolicyRevisions,
        })
        .from(workspaceAgentPolicies)
        .innerJoin(
          workspaceAgentPolicyRevisions,
          and(
            eq(
              workspaceAgentPolicyRevisions.id,
              workspaceAgentPolicies.activeRevisionId,
            ),
            eq(
              workspaceAgentPolicyRevisions.workspaceId,
              workspaceAgentPolicies.workspaceId,
            ),
          ),
        )
        .where(
          eq(
            workspaceAgentPolicies.workspaceId,
            request.securityContext.workspaceId,
          ),
        )
        .limit(1)
        .for("update");
      const grantRows = await tx
        .select({
          set: agentGrantSets,
          revision: agentGrantRevisions,
        })
        .from(agentGrantSets)
        .innerJoin(
          agentGrantRevisions,
          and(
            eq(agentGrantRevisions.grantSetId, agentGrantSets.id),
            eq(agentGrantRevisions.revision, agentGrantSets.activeRevision),
          ),
        )
        .where(
          and(
            eq(
              agentGrantSets.workspaceId,
              request.securityContext.workspaceId,
            ),
            eq(
              agentGrantSets.principalId,
              request.securityContext.principalId,
            ),
            isNull(agentGrantSets.disabledAt),
          ),
        )
        .for("update");
      const principal = principalRows[0]
        ? principalFromRow(principalRows[0])
        : null;
      const key = keyRows[0] ? keyFromRow(keyRows[0]) : null;
      const policy = policyRows[0]
        ? {
            ...policyFromRow(policyRows[0].policy),
            enabled: policyRows[0].revision.enabled,
            grants: policyRows[0].revision.grants ?? [],
          }
        : null;
      const revision =
        grantRows.length === 1
          ? revisionFromRow(grantRows[0].revision)
          : null;
      const matching = (
        grants: import("@/types").AgentCapabilityGrant[],
      ) =>
        grants.some(
          (grant) =>
            grant.capability === capability &&
            grant.authorizationContractDigest ===
              request.authorizationContractDigest &&
            covers(grant.resources, resources),
        );
      let reason: import("@/types").AuthorizationDecisionReason =
        input.forceResourceUnavailable ? "resource_unavailable" : "allowed";
      if (
        reason === "allowed" &&
        (!principal ||
          principal.workspaceId !== request.securityContext.workspaceId ||
          principal.status !== "active" ||
          principal.revokedAt)
      ) {
        reason = "principal_inactive";
      } else if (
        reason === "allowed" &&
        (!key ||
          key.principalId !== principal!.id ||
          key.revokedAt ||
          (key.expiresAt && key.expiresAt <= now))
      ) {
        reason = "key_inactive";
      } else if (
        reason === "allowed" &&
        !key!.authorizationScopes.some(
          (scope) =>
            scope.capability === capability &&
            scope.authorizationContractDigest ===
              request.authorizationContractDigest &&
            covers(scope.resources, resources),
        )
      ) {
        reason = "capability_not_granted";
      } else if (
        reason === "allowed" &&
        (!policy || !policy.enabled || !matching(policy.grants))
      ) {
        reason = "workspace_policy_denied";
      } else if (
        reason === "allowed" &&
        (!revision || !matching(revision.grants))
      ) {
        reason =
          resources.length > 0
            ? "resource_not_granted"
            : "capability_not_granted";
      } else if (
        reason === "allowed" &&
        resources.length > 0 &&
        !(await this.resourcesAreActive(
          tx,
          request.securityContext.workspaceId,
          resources,
        ))
      ) {
        reason = "resource_unavailable";
      }
      const allowed = reason === "allowed";
      const decision = {
        id: input.decisionId,
        workspaceId: request.securityContext.workspaceId,
        principalId: request.securityContext.principalId,
        keyId: request.securityContext.keyId,
        capabilityName: request.capability.name,
        capabilityVersion: request.capability.version,
        authorizationContractDigest: request.authorizationContractDigest,
        outcome: allowed ? ("allowed" as const) : ("denied" as const),
        reason,
        operatorTraceRef: input.operatorTraceRef,
        grantRevisionId: revision?.id ?? null,
        policyRevisionId: policy?.activeRevisionId ?? null,
        resources: allowed ? resources : [],
        createdAt: now,
      };
      await tx.insert(agentAuthorizationDecisions).values(decision);
      await tx.insert(agentSecurityEvents).values({
        id: input.securityEventId,
        workspaceId: decision.workspaceId,
        principalId: decision.principalId,
        keyId: decision.keyId,
        actorUserId: null,
        eventType: allowed
          ? "authorization.allowed"
          : "authorization.denied",
        capabilityName: decision.capabilityName,
        capabilityVersion: decision.capabilityVersion,
        reason,
        resourceKinds: allowed
          ? [...new Set(resources.map((resource) => resource.kind))]
          : [],
        changeRef: null,
        revision: null,
        principalStatus: null,
        createdAt: now,
      });
      return {
        allowed,
        reason,
        grantRevisionId: decision.grantRevisionId,
        policyRevisionId: decision.policyRevisionId,
      };
    });
  }

  private async resourcesAreActive(
    database: Tx,
    workspaceId: string,
    resources: AgentResourceRef[],
  ): Promise<boolean> {
    const found = await this.findActiveResourcesWith(database, workspaceId, resources);
    const active = new Set(found.map((resource) => `${resource.kind}:${resource.id}`));
    return resources.every((resource) =>
      active.has(`${resource.kind}:${resource.id}`),
    );
  }

  private async findActiveResourcesWith(
    database: Db | Tx,
    workspaceId: string,
    resources: AgentResourceRef[],
  ): Promise<AgentResourceRef[]> {
    const idsFor = (kind: AgentResourceKind) =>
      resources
        .filter((resource) => resource.kind === kind)
        .map((resource) => resource.id);
    const channelIds = idsFor("channel");
    const credentialProfileIds = idsFor("credential_profile");
    const workflowIds = idsFor("workflow");
    const automationIds = idsFor("automation");

    const channels = channelIds.length === 0
      ? []
      : await database
            .select({ id: socialAccounts.id })
            .from(socialAccounts)
            .where(
              and(
                eq(socialAccounts.workspaceId, workspaceId),
                inArray(socialAccounts.id, channelIds),
                eq(socialAccounts.disabled, false),
                eq(socialAccounts.requiresReauth, false),
              ),
            )
            .for("share");
    const credentials = credentialProfileIds.length === 0
      ? []
      : await database
            .select({ id: credentialProfiles.id })
            .from(credentialProfiles)
            .where(
              and(
                eq(credentialProfiles.workspaceId, workspaceId),
                inArray(credentialProfiles.id, credentialProfileIds),
                eq(credentialProfiles.enabled, true),
                isNull(credentialProfiles.deletedAt),
              ),
            )
            .for("share");
    const selectedWorkflows = workflowIds.length === 0
      ? []
      : await database
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.workspaceId, workspaceId),
                inArray(projects.id, workflowIds),
                eq(projects.status, "active"),
                isNotNull(projects.workflowJson),
                isNull(projects.deletedAt),
              ),
            )
            .for("share");
    const automations = automationIds.length === 0
      ? []
      : await database
            .select({ id: socialAutomationRules.id })
            .from(socialAutomationRules)
            .where(
              and(
                eq(socialAutomationRules.workspaceId, workspaceId),
                inArray(socialAutomationRules.id, automationIds),
                eq(socialAutomationRules.enabled, true),
              ),
            )
            .for("share");
    return [
      ...refs("channel", channels.map((row) => row.id)),
      ...refs("credential_profile", credentials.map((row) => row.id)),
      ...refs("workflow", selectedWorkflows.map((row) => row.id)),
      ...refs("automation", automations.map((row) => row.id)),
    ];
  }

  async issueAttenuatedKey(
    input: Parameters<AgentAuthorizationRepository["issueAttenuatedKey"]>[0],
  ): Promise<boolean> {
    return this.getDatabase().transaction(async (tx) => {
      const membership = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.actorUserId),
          ),
        )
        .limit(1)
        .for("update");
      if (
        !membership[0] ||
        !["owner", "admin"].includes(membership[0].role)
      ) {
        return false;
      }
      const principals = await tx
        .select()
        .from(agentPrincipals)
        .where(
          and(
            eq(agentPrincipals.id, input.principalId),
            eq(agentPrincipals.workspaceId, input.workspaceId),
            eq(agentPrincipals.status, "active"),
            isNull(agentPrincipals.revokedAt),
          ),
        )
        .limit(1)
        .for("update");
      const policies = await tx
        .select({
          policy: workspaceAgentPolicies,
          revision: workspaceAgentPolicyRevisions,
        })
        .from(workspaceAgentPolicies)
        .innerJoin(
          workspaceAgentPolicyRevisions,
          and(
            eq(
              workspaceAgentPolicyRevisions.id,
              workspaceAgentPolicies.activeRevisionId,
            ),
            eq(
              workspaceAgentPolicyRevisions.workspaceId,
              workspaceAgentPolicies.workspaceId,
            ),
          ),
        )
        .where(
          and(
            eq(workspaceAgentPolicies.workspaceId, input.workspaceId),
            eq(workspaceAgentPolicies.enabled, true),
          ),
        )
        .limit(1)
        .for("update");
      const revisions = await tx
        .select({ revision: agentGrantRevisions })
        .from(agentGrantSets)
        .innerJoin(
          agentGrantRevisions,
          and(
            eq(agentGrantRevisions.grantSetId, agentGrantSets.id),
            eq(agentGrantRevisions.revision, agentGrantSets.activeRevision),
          ),
        )
        .where(
          and(
            eq(agentGrantSets.workspaceId, input.workspaceId),
            eq(agentGrantSets.principalId, input.principalId),
            isNull(agentGrantSets.disabledAt),
          ),
        )
        .for("update");
      if (
        !principals[0] ||
        (input.key.authorizationScopes.length > 0 &&
          (!policies[0] || revisions.length !== 1))
      ) {
        return false;
      }
      const resourceRefs = (
        resources: import("@/types").AgentResourceConstraints,
      ): AgentResourceRef[] => [
        ...resources.channelIds.map((id) => ({ kind: "channel" as const, id })),
        ...resources.credentialProfileIds.map((id) => ({
          kind: "credential_profile" as const,
          id,
        })),
        ...resources.workflowIds.map((id) => ({
          kind: "workflow" as const,
          id,
        })),
        ...resources.automationIds.map((id) => ({
          kind: "automation" as const,
          id,
        })),
      ];
      const revision = revisions[0]
        ? revisionFromRow(revisions[0].revision)
        : null;
      const policy = policies[0]
        ? {
            ...policyFromRow(policies[0].policy),
            enabled: policies[0].revision.enabled,
            grants: policies[0].revision.grants ?? [],
          }
        : null;
      for (const scope of input.key.authorizationScopes) {
        const refs = resourceRefs(scope.resources);
        const matches = (
          grants: import("@/types").AgentCapabilityGrant[],
        ) =>
          grants.some(
            (grant) =>
              grant.capability === scope.capability &&
              grant.authorizationContractDigest ===
                scope.authorizationContractDigest &&
              refs.every((resource) =>
                resourceRefs(grant.resources).some(
                  (candidate) =>
                    candidate.kind === resource.kind &&
                    candidate.id === resource.id,
                ),
              ),
          );
        if (
          !matches(policy!.grants) ||
          !matches(revision!.grants) ||
          !(await this.resourcesAreActive(tx, input.workspaceId, refs))
        ) {
          return false;
        }
      }
      await tx.insert(agentKeys).values(input.key);
      await tx.insert(agentSecurityEvents).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        principalId: input.principalId,
        keyId: input.key.id,
        actorUserId: input.actorUserId,
        eventType: "key.issued",
        capabilityName: "agents.authority.provision",
        capabilityVersion: 1,
        reason: "allowed",
        resourceKinds: [],
        changeRef: input.key.id,
        revision: null,
        principalStatus: null,
        createdAt: input.now,
      });
      return true;
    });
  }

  async provisionAuthority(
    input: Parameters<AgentAuthorizationRepository["provisionAuthority"]>[0],
  ): ReturnType<AgentAuthorizationRepository["provisionAuthority"]> {
    return this.getDatabase().transaction(async (tx) => {
      const membership = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.actorUserId),
          ),
        )
        .limit(1)
        .for("update");
      if (!membership[0] || !["owner", "admin"].includes(membership[0].role)) {
        return { type: "forbidden" as const };
      }
      const workspace = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            isNull(workspaces.deletedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (!workspace[0]) return { type: "invalid_authority" as const };

      const receipts = await tx
        .select({
          receipt: agentAuthorityProvisioningReceipts,
          key: agentKeys,
        })
        .from(agentAuthorityProvisioningReceipts)
        .innerJoin(
          agentKeys,
          eq(agentKeys.id, agentAuthorityProvisioningReceipts.keyId),
        )
        .where(
          and(
            eq(
              agentAuthorityProvisioningReceipts.workspaceId,
              input.workspaceId,
            ),
            eq(
              agentAuthorityProvisioningReceipts.actorUserId,
              input.actorUserId,
            ),
            eq(agentAuthorityProvisioningReceipts.requestId, input.requestId),
          ),
        )
        .limit(1)
        .for("update");
      if (receipts[0]) {
        if (
          receipts[0].receipt.requestFingerprint !== input.requestFingerprint
        ) {
          return { type: "conflict" as const };
        }
        return {
          type: "replayed" as const,
          key: keyFromRow(receipts[0].key),
          grantSetId: receipts[0].receipt.grantSetId,
          grantRevisionId: receipts[0].receipt.grantRevisionId,
          grantRevision: receipts[0].receipt.grantRevision,
          policyRevisionId: receipts[0].receipt.policyRevisionId,
          policyRevision: receipts[0].receipt.policyRevision,
        };
      }
      const principal = await tx
        .select({ id: agentPrincipals.id })
        .from(agentPrincipals)
        .where(
          and(
            eq(agentPrincipals.id, input.principalId),
            eq(agentPrincipals.workspaceId, input.workspaceId),
            eq(agentPrincipals.status, "active"),
            isNull(agentPrincipals.revokedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (!principal[0]) return { type: "invalid_authority" as const };

      const sets = await tx
        .select()
        .from(agentGrantSets)
        .where(
          and(
            eq(agentGrantSets.workspaceId, input.workspaceId),
            eq(agentGrantSets.principalId, input.principalId),
            isNull(agentGrantSets.disabledAt),
          ),
        )
        .for("update");
      if (sets.length > 1) return { type: "invalid_authority" as const };
      const existingSet = sets[0];
      if (
        (input.grantSetId && existingSet?.id !== input.grantSetId) ||
        (!input.grantSetId && existingSet)
      ) {
        return { type: "conflict" as const };
      }
      if (
        input.grantSetId &&
        (input.expectedGrantRevision === undefined ||
          existingSet?.activeRevision !== input.expectedGrantRevision)
      ) {
        return { type: "conflict" as const };
      }

      const currentPolicies = await tx
        .select({ revision: workspaceAgentPolicies.revision })
        .from(workspaceAgentPolicies)
        .where(eq(workspaceAgentPolicies.workspaceId, input.workspaceId))
        .limit(1)
        .for("update");
      if (
        (currentPolicies[0]?.revision ?? 0) !== input.expectedPolicyRevision
      ) {
        return { type: "conflict" as const };
      }
      if (
        input.key.authorizationScopes.some(
          (scope) =>
            !grantsCoverScope(input.grants, scope) ||
            !grantsCoverScope(input.policyGrants, scope),
        )
      ) {
        return { type: "invalid_authority" as const };
      }
      const allResources = [
        ...input.grants.flatMap((grant) => constraintRefs(grant.resources)),
        ...input.policyGrants.flatMap((grant) =>
          constraintRefs(grant.resources),
        ),
        ...input.key.authorizationScopes.flatMap((scope) =>
          constraintRefs(scope.resources),
        ),
      ];
      if (
        !(await this.resourcesAreActive(
          tx,
          input.workspaceId,
          allResources,
        ))
      ) {
        return { type: "invalid_authority" as const };
      }

      const grantSetId =
        existingSet?.id ?? input.grantSetId ?? crypto.randomUUID();
      const grantRevision = (existingSet?.activeRevision ?? 0) + 1;
      const grantRevisionId = crypto.randomUUID();
      const policyRevision = input.expectedPolicyRevision + 1;
      const policyRevisionId = crypto.randomUUID();
      if (existingSet) {
        await tx
          .update(agentGrantSets)
          .set({
            name: input.grantSetName,
            activeRevision: grantRevision,
            updatedAt: input.now,
          })
          .where(eq(agentGrantSets.id, existingSet.id));
      } else {
        await tx.insert(agentGrantSets).values({
          id: grantSetId,
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          name: input.grantSetName,
          activeRevision: grantRevision,
          disabledAt: null,
          createdByUserId: input.actorUserId,
          createdAt: input.now,
          updatedAt: input.now,
        });
      }
      await tx.insert(agentGrantRevisions).values({
        id: grantRevisionId,
        grantSetId,
        revision: grantRevision,
        grants: input.grants,
        createdByUserId: input.actorUserId,
        createdAt: input.now,
      });
      await tx.insert(workspaceAgentPolicyRevisions).values({
        id: policyRevisionId,
        workspaceId: input.workspaceId,
        revision: policyRevision,
        enabled: true,
        grants: input.policyGrants,
        createdByUserId: input.actorUserId,
        createdAt: input.now,
      });
      await tx
        .insert(workspaceAgentPolicies)
        .values({
          workspaceId: input.workspaceId,
          activeRevisionId: policyRevisionId,
          revision: policyRevision,
          enabled: true,
          grants: input.policyGrants,
          updatedByUserId: input.actorUserId,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: workspaceAgentPolicies.workspaceId,
          set: {
            activeRevisionId: policyRevisionId,
            revision: policyRevision,
            enabled: true,
            grants: input.policyGrants,
            updatedByUserId: input.actorUserId,
            updatedAt: input.now,
          },
        });
      await tx.insert(agentKeys).values(input.key);
      await tx.insert(agentSecurityEvents).values([
        {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          keyId: null,
          actorUserId: input.actorUserId,
          eventType: "grant.revised",
          capabilityName: "agents.authority.provision",
          capabilityVersion: 1,
          reason: "allowed",
          resourceKinds: [],
          changeRef: grantRevisionId,
          revision: grantRevision,
          principalStatus: null,
          createdAt: input.now,
        },
        {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          principalId: null,
          keyId: null,
          actorUserId: input.actorUserId,
          eventType: "policy.revised",
          capabilityName: "agents.authority.provision",
          capabilityVersion: 1,
          reason: "allowed",
          resourceKinds: [],
          changeRef: policyRevisionId,
          revision: policyRevision,
          principalStatus: null,
          createdAt: input.now,
        },
        {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          keyId: input.key.id,
          actorUserId: input.actorUserId,
          eventType: "key.issued",
          capabilityName: "agents.authority.provision",
          capabilityVersion: 1,
          reason: "allowed",
          resourceKinds: [],
          changeRef: input.key.id,
          revision: null,
          principalStatus: null,
          createdAt: input.now,
        },
      ]);
      await tx.insert(agentAuthorityProvisioningReceipts).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        requestFingerprint: input.requestFingerprint,
        keyId: input.key.id,
        grantSetId,
        grantRevisionId,
        grantRevision,
        policyRevisionId,
        policyRevision,
        createdAt: input.now,
      });
      return {
        type: "created" as const,
        key: input.key,
        grantSetId,
        grantRevisionId,
        grantRevision,
        policyRevisionId,
        policyRevision,
      };
    });
  }

  async listDecisionsForActor(
    input: Parameters<
      AgentAuthorizationRepository["listDecisionsForActor"]
    >[0],
  ): Promise<AgentAuthorizationDecisionRecord[] | null> {
    const membership = await this.getDatabase()
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.actorUserId),
        ),
      )
      .limit(1);
    if (
      !membership[0] ||
      !["owner", "admin"].includes(membership[0].role)
    ) {
      return null;
    }
    const rows = await this.getDatabase()
      .select()
      .from(agentAuthorizationDecisions)
      .where(
        input.principalId
          ? and(
              eq(agentAuthorizationDecisions.workspaceId, input.workspaceId),
              eq(agentAuthorizationDecisions.principalId, input.principalId),
            )
          : eq(agentAuthorizationDecisions.workspaceId, input.workspaceId),
      )
      .orderBy(desc(agentAuthorizationDecisions.createdAt))
      .limit(input.limit);
    return rows.map((row) => ({
      ...row,
      reason: row.reason as AgentAuthorizationDecisionRecord["reason"],
      outcome: row.outcome as AgentAuthorizationDecisionRecord["outcome"],
      resources: (row.resources ?? []) as AgentResourceRef[],
    }));
  }

  async createGrantSetWithRevision(input: {
    grantSet: AgentGrantSetRecord;
    revision: AgentGrantRevisionRecord;
  }): Promise<void> {
    await this.getDatabase().transaction(async (tx) => {
      const allowed = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.grantSet.workspaceId),
            eq(
              workspaceMembers.userId,
              input.grantSet.createdByUserId,
            ),
          ),
        )
        .limit(1)
        .for("update");
      if (!allowed[0] || !["owner", "admin"].includes(allowed[0].role)) {
        throw new Error("Workspace owner or admin authority is required.");
      }
      const principal = await tx
        .select({ id: agentPrincipals.id })
        .from(agentPrincipals)
        .where(
          and(
            eq(agentPrincipals.id, input.grantSet.principalId),
            eq(agentPrincipals.workspaceId, input.grantSet.workspaceId),
          ),
        )
        .limit(1)
        .for("update");
      if (!principal[0]) {
        throw new Error("Principal is unavailable in this Workspace.");
      }
      await tx.insert(agentGrantSets).values(input.grantSet);
      await tx.insert(agentGrantRevisions).values(input.revision);
      await tx.insert(agentSecurityEvents).values({
        id: crypto.randomUUID(),
        workspaceId: input.grantSet.workspaceId,
        principalId: input.grantSet.principalId,
        keyId: null,
        actorUserId: input.grantSet.createdByUserId,
        eventType: "grant.revised",
        capabilityName: "agents.authority.provision",
        capabilityVersion: 1,
        reason: "allowed",
        resourceKinds: [],
        changeRef: input.revision.id,
        revision: input.revision.revision,
        principalStatus: null,
        createdAt: input.revision.createdAt,
      });
    });
  }

  async appendGrantRevisionAndActivate(input: {
    grantSetId: string;
    workspaceId: string;
    expectedActiveRevision: number;
    revision: AgentGrantRevisionRecord;
    activatedAt: Date;
  }): Promise<boolean> {
    return this.getDatabase().transaction(async (tx) => {
      const allowed = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.revision.createdByUserId),
          ),
        )
        .limit(1)
        .for("update");
      if (!allowed[0] || !["owner", "admin"].includes(allowed[0].role)) {
        throw new Error("Workspace owner or admin authority is required.");
      }
      const updated = await tx
        .update(agentGrantSets)
        .set({
          activeRevision: input.revision.revision,
          updatedAt: input.activatedAt,
        })
        .where(
          and(
            eq(agentGrantSets.id, input.grantSetId),
            eq(agentGrantSets.workspaceId, input.workspaceId),
            eq(
              agentGrantSets.activeRevision,
              input.expectedActiveRevision,
            ),
            isNull(agentGrantSets.disabledAt),
          ),
        )
        .returning({
          id: agentGrantSets.id,
          principalId: agentGrantSets.principalId,
        });
      if (!updated[0]) return false;
      await tx.insert(agentGrantRevisions).values(input.revision);
      await tx.insert(agentSecurityEvents).values({
        id: crypto.randomUUID(),
        workspaceId: input.workspaceId,
        principalId: updated[0].principalId,
        keyId: null,
        actorUserId: input.revision.createdByUserId,
        eventType: "grant.revised",
        capabilityName: "agents.authority.provision",
        capabilityVersion: 1,
        reason: "allowed",
        resourceKinds: [],
        changeRef: input.revision.id,
        revision: input.revision.revision,
        principalStatus: null,
        createdAt: input.activatedAt,
      });
      return true;
    });
  }

  async putWorkspacePolicy(
    policy: WorkspaceAgentPolicyRecord,
  ): Promise<WorkspaceAgentPolicyRecord> {
    return this.getDatabase().transaction(async (tx) => {
      const allowed = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, policy.workspaceId),
            eq(workspaceMembers.userId, policy.updatedByUserId),
          ),
        )
        .limit(1)
        .for("update");
      if (!allowed[0] || !["owner", "admin"].includes(allowed[0].role)) {
        throw new Error("Workspace owner or admin authority is required.");
      }
      const current = await tx
        .select()
        .from(workspaceAgentPolicies)
        .where(eq(workspaceAgentPolicies.workspaceId, policy.workspaceId))
        .limit(1)
        .for("update");
      const stored = {
        ...policy,
        revision: (current[0]?.revision ?? 0) + 1,
      };
      await tx.insert(workspaceAgentPolicyRevisions).values({
        id: stored.activeRevisionId,
        workspaceId: stored.workspaceId,
        revision: stored.revision,
        enabled: stored.enabled,
        grants: stored.grants,
        createdByUserId: stored.updatedByUserId,
        createdAt: stored.updatedAt,
      });
      await tx
        .insert(workspaceAgentPolicies)
        .values(stored)
        .onConflictDoUpdate({
          target: workspaceAgentPolicies.workspaceId,
          set: {
            activeRevisionId: stored.activeRevisionId,
            revision: stored.revision,
            enabled: stored.enabled,
            grants: stored.grants,
            updatedByUserId: stored.updatedByUserId,
            updatedAt: stored.updatedAt,
          },
        });
      await tx.insert(agentSecurityEvents).values({
        id: crypto.randomUUID(),
        workspaceId: stored.workspaceId,
        principalId: null,
        keyId: null,
        actorUserId: stored.updatedByUserId,
        eventType: "policy.revised",
        capabilityName: "agents.authority.provision",
        capabilityVersion: 1,
        reason: "allowed",
        resourceKinds: [],
        changeRef: stored.activeRevisionId,
        revision: stored.revision,
        principalStatus: null,
        createdAt: stored.updatedAt,
      });
      return stored;
    });
  }
}
