import type {
  AgentAuthorizationDecisionRecord,
  AgentAuthorizationRepository,
  AgentGrantRevisionRecord,
  AgentGrantSetRecord,
  AgentResourceRef,
  AgentSecurityEventRecord,
  WorkspaceAgentPolicyRecord,
} from "./types";
import type { AgentKeyRecord, AgentPrincipalRecord } from "@/types/agentAuth";

export class InMemoryAgentAuthorizationRepository
  implements AgentAuthorizationRepository
{
  readonly principals = new Map<string, AgentPrincipalRecord>();
  readonly keys = new Map<string, AgentKeyRecord>();
  readonly grantSets = new Map<string, AgentGrantSetRecord>();
  readonly grantRevisions = new Map<string, AgentGrantRevisionRecord>();
  readonly policies = new Map<string, WorkspaceAgentPolicyRecord>();
  readonly activeResources = new Set<string>();
  readonly administrators = new Set<string>();
  readonly decisions: AgentAuthorizationDecisionRecord[] = [];
  readonly securityEvents: AgentSecurityEventRecord[] = [];
  readonly provisioningReceipts = new Map<
    string,
    {
      requestFingerprint: string;
      keyId: string;
      grantSetId: string;
      grantRevisionId: string;
      grantRevision: number;
      policyRevisionId: string;
      policyRevision: number;
    }
  >();

  async admit(input: Parameters<AgentAuthorizationRepository["admit"]>[0]) {
    const { request, resources, now } = input;
    const capability = `${request.capability.name}@${request.capability.version}`;
    const principal = this.principals.get(request.securityContext.principalId);
    const key = this.keys.get(request.securityContext.keyId);
    const policy = this.policies.get(request.securityContext.workspaceId);
    const sets = [...this.grantSets.values()].filter(
      (set) =>
        set.workspaceId === request.securityContext.workspaceId &&
        set.principalId === request.securityContext.principalId &&
        !set.disabledAt,
    );
    const set = sets.length === 1 ? sets[0] : undefined;
    const revision = set
      ? [...this.grantRevisions.values()].find(
          (candidate) =>
            candidate.grantSetId === set.id &&
            candidate.revision === set.activeRevision,
        )
      : undefined;
    const covers = (
      constraints: import("@/types").AgentResourceConstraints,
    ) =>
      resources.every((resource) => {
        const key =
          resource.kind === "channel"
            ? "channelIds"
            : resource.kind === "credential_profile"
              ? "credentialProfileIds"
              : resource.kind === "workflow"
                ? "workflowIds"
                : "automationIds";
        return constraints[key].includes(resource.id);
      });
    const matching = (grants: import("@/types").AgentCapabilityGrant[]) =>
      grants.some(
        (grant) =>
          grant.capability === capability &&
          grant.authorizationContractDigest ===
            request.authorizationContractDigest &&
          covers(grant.resources),
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
          covers(scope.resources),
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
      resources.some(
        (resource) =>
          !this.activeResources.has(
            `${request.securityContext.workspaceId}:${resource.kind}:${resource.id}`,
          ),
      )
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
      resources: allowed ? structuredClone(resources) : [],
      createdAt: now,
    };
    const event = {
      id: input.securityEventId,
      workspaceId: decision.workspaceId,
      principalId: decision.principalId,
      keyId: decision.keyId,
      actorUserId: null,
      eventType: allowed
        ? ("authorization.allowed" as const)
        : ("authorization.denied" as const),
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
    };
    this.decisions.push(decision);
    this.securityEvents.push(event);
    return {
      allowed,
      reason,
      grantRevisionId: decision.grantRevisionId,
      policyRevisionId: decision.policyRevisionId,
    };
  }

  setResourceActive(workspaceId: string, resource: AgentResourceRef): void {
    this.activeResources.add(
      `${workspaceId}:${resource.kind}:${resource.id}`,
    );
  }

  addAdministrator(workspaceId: string, userId: string): void {
    this.administrators.add(`${workspaceId}:${userId}`);
  }

  async issueAttenuatedKey(
    input: Parameters<AgentAuthorizationRepository["issueAttenuatedKey"]>[0],
  ): Promise<boolean> {
    if (
      !this.administrators.has(
        `${input.workspaceId}:${input.actorUserId}`,
      )
    ) {
      return false;
    }
    const principal = this.principals.get(input.principalId);
    const policy = this.policies.get(input.workspaceId);
    const sets = [...this.grantSets.values()].filter(
      (set) =>
        set.workspaceId === input.workspaceId &&
        set.principalId === input.principalId &&
        !set.disabledAt,
    );
    const revision =
      sets.length === 1
        ? [...this.grantRevisions.values()].find(
            (candidate) =>
              candidate.grantSetId === sets[0].id &&
              candidate.revision === sets[0].activeRevision,
          )
        : undefined;
    if (
      !principal ||
      principal.workspaceId !== input.workspaceId ||
      principal.status !== "active" ||
      principal.revokedAt ||
      (input.key.authorizationScopes.length > 0 &&
        (!policy?.enabled || !revision))
    ) {
      return false;
    }
    const ids = (
      resources: import("@/types").AgentResourceConstraints,
    ): AgentResourceRef[] => [
      ...resources.channelIds.map((id) => ({ kind: "channel" as const, id })),
      ...resources.credentialProfileIds.map((id) => ({
        kind: "credential_profile" as const,
        id,
      })),
      ...resources.workflowIds.map((id) => ({ kind: "workflow" as const, id })),
      ...resources.automationIds.map((id) => ({
        kind: "automation" as const,
        id,
      })),
    ];
    const authorized = input.key.authorizationScopes.every((scope) => {
      const matches = (grants: import("@/types").AgentCapabilityGrant[]) =>
        grants.some(
          (grant) =>
            grant.capability === scope.capability &&
            grant.authorizationContractDigest ===
              scope.authorizationContractDigest &&
            ids(scope.resources).every((resource) =>
              ids(grant.resources).some(
                (candidate) =>
                  candidate.kind === resource.kind &&
                  candidate.id === resource.id,
              ),
            ),
        );
      return (
        matches(policy!.grants) &&
        matches(revision!.grants) &&
        ids(scope.resources).every((resource) =>
          this.activeResources.has(
            `${input.workspaceId}:${resource.kind}:${resource.id}`,
          ),
        )
      );
    });
    if (!authorized) return false;
    this.keys.set(input.key.id, structuredClone(input.key));
    this.securityEvents.push({
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
  }

  async provisionAuthority(
    input: Parameters<AgentAuthorizationRepository["provisionAuthority"]>[0],
  ): ReturnType<AgentAuthorizationRepository["provisionAuthority"]> {
    if (
      !this.administrators.has(`${input.workspaceId}:${input.actorUserId}`)
    ) {
      return { type: "forbidden" };
    }
    const receiptKey = `${input.workspaceId}:${input.actorUserId}:${input.requestId}`;
    const receipt = this.provisioningReceipts.get(receiptKey);
    if (receipt) {
      if (receipt.requestFingerprint !== input.requestFingerprint) {
        return { type: "conflict" };
      }
      const key = this.keys.get(receipt.keyId);
      if (!key) return { type: "invalid_authority" };
      return {
        type: "replayed",
        key: structuredClone(key),
        grantSetId: receipt.grantSetId,
        grantRevisionId: receipt.grantRevisionId,
        grantRevision: receipt.grantRevision,
        policyRevisionId: receipt.policyRevisionId,
        policyRevision: receipt.policyRevision,
      };
    }
    const principal = this.principals.get(input.principalId);
    if (
      !principal ||
      principal.workspaceId !== input.workspaceId ||
      principal.status !== "active" ||
      principal.revokedAt
    ) {
      return { type: "invalid_authority" };
    }
    const existingSets = [...this.grantSets.values()].filter(
      (set) =>
        set.workspaceId === input.workspaceId &&
        set.principalId === input.principalId &&
        !set.disabledAt,
    );
    if (existingSets.length > 1) return { type: "invalid_authority" };
    const existingSet = existingSets[0];
    if (
      (input.grantSetId && existingSet?.id !== input.grantSetId) ||
      (!input.grantSetId && existingSet)
    ) {
      return { type: "conflict" };
    }
    if (
      input.grantSetId &&
      (input.expectedGrantRevision === undefined ||
        existingSet?.activeRevision !== input.expectedGrantRevision)
    ) {
      return { type: "conflict" };
    }
    const currentPolicy = this.policies.get(input.workspaceId);
    if ((currentPolicy?.revision ?? 0) !== input.expectedPolicyRevision) {
      return { type: "conflict" };
    }
    const refsFor = (
      constraints: import("@/types").AgentResourceConstraints,
    ): AgentResourceRef[] => [
      ...constraints.channelIds.map((id) => ({ kind: "channel" as const, id })),
      ...constraints.credentialProfileIds.map((id) => ({
        kind: "credential_profile" as const,
        id,
      })),
      ...constraints.workflowIds.map((id) => ({
        kind: "workflow" as const,
        id,
      })),
      ...constraints.automationIds.map((id) => ({
        kind: "automation" as const,
        id,
      })),
    ];
    const allResources = [
      ...input.grants.flatMap((grant) => refsFor(grant.resources)),
      ...input.policyGrants.flatMap((grant) => refsFor(grant.resources)),
      ...input.key.authorizationScopes.flatMap((scope) =>
        refsFor(scope.resources),
      ),
    ];
    if (
      allResources.some(
        (resource) =>
          !this.activeResources.has(
            `${input.workspaceId}:${resource.kind}:${resource.id}`,
          ),
      )
    ) {
      return { type: "invalid_authority" };
    }
    const grantCovers = (
      grants: import("@/types").AgentCapabilityGrant[],
      scope: import("@/types").AgentKeyAuthorizationScope,
    ) =>
      grants.some(
        (grant) =>
          grant.capability === scope.capability &&
          grant.authorizationContractDigest ===
            scope.authorizationContractDigest &&
          refsFor(scope.resources).every((resource) =>
            refsFor(grant.resources).some(
              (candidate) =>
                candidate.kind === resource.kind &&
                candidate.id === resource.id,
            ),
          ),
      );
    if (
      input.key.authorizationScopes.some(
        (scope) =>
          !grantCovers(input.grants, scope) ||
          !grantCovers(input.policyGrants, scope),
      )
    ) {
      return { type: "invalid_authority" };
    }

    const grantSetId = existingSet?.id ?? input.grantSetId ?? crypto.randomUUID();
    const grantRevision = (existingSet?.activeRevision ?? 0) + 1;
    const grantRevisionId = crypto.randomUUID();
    const policyRevision = input.expectedPolicyRevision + 1;
    const policyRevisionId = crypto.randomUUID();
    const set: AgentGrantSetRecord = existingSet
      ? {
          ...structuredClone(existingSet),
          activeRevision: grantRevision,
          updatedAt: input.now,
        }
      : {
          id: grantSetId,
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          name: input.grantSetName,
          activeRevision: grantRevision,
          disabledAt: null,
          createdByUserId: input.actorUserId,
          createdAt: input.now,
          updatedAt: input.now,
        };
    const revisionRecord: AgentGrantRevisionRecord = {
      id: grantRevisionId,
      grantSetId,
      revision: grantRevision,
      grants: structuredClone(input.grants),
      createdByUserId: input.actorUserId,
      createdAt: input.now,
    };
    const policy: WorkspaceAgentPolicyRecord = {
      workspaceId: input.workspaceId,
      activeRevisionId: policyRevisionId,
      revision: policyRevision,
      enabled: true,
      grants: structuredClone(input.policyGrants),
      updatedByUserId: input.actorUserId,
      updatedAt: input.now,
    };
    this.grantSets.set(grantSetId, set);
    this.grantRevisions.set(grantRevisionId, revisionRecord);
    this.policies.set(input.workspaceId, policy);
    this.keys.set(input.key.id, structuredClone(input.key));
    this.securityEvents.push(
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
    );
    this.provisioningReceipts.set(receiptKey, {
      requestFingerprint: input.requestFingerprint,
      keyId: input.key.id,
      grantSetId,
      grantRevisionId,
      grantRevision,
      policyRevisionId,
      policyRevision,
    });
    return {
      type: "created",
      key: structuredClone(input.key),
      grantSetId,
      grantRevisionId,
      grantRevision,
      policyRevisionId,
      policyRevision,
    };
  }

  async listDecisionsForActor(
    input: Parameters<
      AgentAuthorizationRepository["listDecisionsForActor"]
    >[0],
  ): Promise<AgentAuthorizationDecisionRecord[] | null> {
    if (
      !this.administrators.has(
        `${input.workspaceId}:${input.actorUserId}`,
      )
    ) {
      return null;
    }
    return this.decisions
      .filter(
        (decision) =>
          decision.workspaceId === input.workspaceId &&
          (!input.principalId ||
            decision.principalId === input.principalId),
      )
      .slice(-input.limit)
      .map((decision) => structuredClone(decision));
  }

  async createGrantSetWithRevision(input: {
    grantSet: AgentGrantSetRecord;
    revision: AgentGrantRevisionRecord;
  }): Promise<void> {
    if (
      !this.administrators.has(
        `${input.grantSet.workspaceId}:${input.grantSet.createdByUserId}`,
      )
    ) {
      throw new Error("Workspace owner or admin authority is required.");
    }
    if (
      this.principals.get(input.grantSet.principalId)?.workspaceId !==
      input.grantSet.workspaceId
    ) {
      throw new Error("Principal is unavailable in this Workspace.");
    }
    if (
      [...this.grantSets.values()].some(
        (set) => set.principalId === input.grantSet.principalId,
      )
    ) {
      throw new Error("A Principal may have only one Grant Set.");
    }
    this.grantSets.set(input.grantSet.id, structuredClone(input.grantSet));
    this.grantRevisions.set(
      input.revision.id,
      structuredClone(input.revision),
    );
  }

  async appendGrantRevisionAndActivate(input: {
    grantSetId: string;
    workspaceId: string;
    expectedActiveRevision: number;
    revision: AgentGrantRevisionRecord;
    activatedAt: Date;
  }): Promise<boolean> {
    const grantSet = this.grantSets.get(input.grantSetId);
    if (
      !grantSet ||
      !this.administrators.has(
        `${input.workspaceId}:${input.revision.createdByUserId}`,
      ) ||
      grantSet.workspaceId !== input.workspaceId ||
      grantSet.disabledAt ||
      grantSet.activeRevision !== input.expectedActiveRevision
    ) {
      return false;
    }
    this.grantRevisions.set(
      input.revision.id,
      structuredClone(input.revision),
    );
    grantSet.activeRevision = input.revision.revision;
    grantSet.updatedAt = input.activatedAt;
    return true;
  }

  async putWorkspacePolicy(
    policy: WorkspaceAgentPolicyRecord,
  ): Promise<WorkspaceAgentPolicyRecord> {
    if (
      !this.administrators.has(
        `${policy.workspaceId}:${policy.updatedByUserId}`,
      )
    ) {
      throw new Error("Workspace owner or admin authority is required.");
    }
    const current = this.policies.get(policy.workspaceId);
    const stored = {
      ...structuredClone(policy),
      revision: (current?.revision ?? 0) + 1,
    };
    this.policies.set(policy.workspaceId, stored);
    return structuredClone(stored);
  }
}
