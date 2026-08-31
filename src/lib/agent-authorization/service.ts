import { randomUUID } from "node:crypto";
import type {
  AgentAuthorizationDecisionRecord,
  AgentAuthorizationRepository,
  AgentCapabilityGrant,
  AgentGrantRevisionRecord,
  AgentGrantSetRecord,
  AgentResourceConstraints,
  AgentResourceRef,
  AgentSecurityEventRecord,
  AuthorizationDecisionReason,
  CapabilityAuthorizationAdmission,
  CapabilityAuthorizationRequest,
  CapabilityAuthorizer,
  WorkspaceAgentPolicyRecord,
} from "./types";
import {
  AGENT_RESOURCE_KINDS,
  AGENT_RESOURCE_DESCRIPTORS,
  emptyResourceConstraints,
  resourceConstraintKey,
} from "./resource-constraints";

const EXACT_CAPABILITY =
  /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+@[1-9][0-9]*$/;
export const EMPTY_RESOURCE_CONSTRAINTS: AgentResourceConstraints =
  emptyResourceConstraints();

interface AuthorizationClock {
  now(): Date;
}

const systemClock: AuthorizationClock = { now: () => new Date() };

function exactCapability(name: string, version: number): string {
  return `${name}@${version}`;
}

function uniqueStrings(values: string[], label: string): string[] {
  const normalized = [...new Set(values.map((value) => value.trim()))];
  if (
    normalized.length > 256 ||
    normalized.some((value) => !value || value.length > 200)
  ) {
    throw new TypeError(`${label} contains an invalid value.`);
  }
  return normalized.sort();
}

export function normalizeCapabilityScopes(scopes: string[]): string[] {
  const normalized = uniqueStrings(scopes, "Capability scopes");
  if (normalized.some((scope) => !EXACT_CAPABILITY.test(scope))) {
    throw new TypeError(
      "Capability scopes must use exact identities such as capabilities.list@1.",
    );
  }
  return normalized;
}

export function normalizeCapabilityGrants(
  grants: AgentCapabilityGrant[],
): AgentCapabilityGrant[] {
  const normalized = grants.map((grant) => {
    const capability = grant.capability.trim();
    const authorizationContractDigest =
      grant.authorizationContractDigest.trim();
    if (
      !EXACT_CAPABILITY.test(capability) ||
      !/^sha256:[a-f0-9]{64}$/.test(authorizationContractDigest)
    ) {
      throw new TypeError(
        "Capability grants require an exact identity and canonical contract digest.",
      );
    }
    return {
      capability,
      authorizationContractDigest,
      resources: normalizeResourceConstraints(grant.resources),
    };
  });
  const seen = new Set<string>();
  for (const grant of normalized) {
    const key = `${grant.capability}:${grant.authorizationContractDigest}`;
    if (seen.has(key)) {
      throw new TypeError("Capability grants must be unique.");
    }
    seen.add(key);
  }
  return normalized.sort((left, right) =>
    left.capability.localeCompare(right.capability),
  );
}

export function normalizeResourceConstraints(
  resources: AgentResourceConstraints,
): AgentResourceConstraints {
  return Object.fromEntries(
    AGENT_RESOURCE_DESCRIPTORS.map(({ constraintKey, label }) => [
      constraintKey,
      uniqueStrings(resources[constraintKey] ?? [], label),
    ]),
  ) as unknown as AgentResourceConstraints;
}

function normalizeResourceRefs(resources: AgentResourceRef[]): AgentResourceRef[] {
  const unique = new Map<string, AgentResourceRef>();
  for (const resource of resources) {
    const id = resource.id.trim();
    if (
      !AGENT_RESOURCE_KINDS.includes(resource.kind) ||
      !id ||
      id.length > 200
    ) {
      throw new TypeError("Capability resource references are invalid.");
    }
    unique.set(`${resource.kind}:${id}`, { kind: resource.kind, id });
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  );
}

function constraintsCover(
  constraints: AgentResourceConstraints,
  resources: AgentResourceRef[],
): boolean {
  return resources.every((resource) =>
    (constraints[resourceConstraintKey(resource.kind)] ?? []).includes(
      resource.id,
    ),
  );
}

function sameResources(
  left: AgentResourceRef[],
  right: AgentResourceRef[],
): boolean {
  if (left.length !== right.length) return false;
  const found = new Set(left.map((resource) => `${resource.kind}:${resource.id}`));
  return right.every((resource) =>
    found.has(`${resource.kind}:${resource.id}`),
  );
}

function deniedAdmission(
  operatorTraceRef: string,
  capability: string,
): CapabilityAuthorizationAdmission {
  return {
    allowed: false,
    code: "CAPABILITY_NOT_AUTHORIZED",
    message: `Capability ${capability} is not authorized. Ask a Workspace owner or admin to grant that exact capability and its required resources.`,
    operatorTraceRef,
  };
}

export class AgentAuthorizationService implements CapabilityAuthorizer {
  constructor(
    readonly repository: AgentAuthorizationRepository,
    private readonly clock: AuthorizationClock = systemClock,
  ) {}

  async authorize(
    request: CapabilityAuthorizationRequest,
  ): Promise<CapabilityAuthorizationAdmission> {
    if (
      (request.audience !== "agent" && request.audience !== "shared") ||
      request.securityContext.kind !== "agent"
    ) {
      return deniedAdmission(
        `otr_${randomUUID().replaceAll("-", "")}`,
        exactCapability(request.capability.name, request.capability.version),
      );
    }
    let resources: AgentResourceRef[];
    let forceResourceUnavailable = request.resourceExtractionValid === false;
    try {
      resources = normalizeResourceRefs(request.resources);
    } catch {
      resources = [];
      forceResourceUnavailable = true;
    }
    const now = this.clock.now();
    const operatorTraceRef = `otr_${randomUUID().replaceAll("-", "")}`;
    const result = await this.repository.admit({
      request,
      resources,
      decisionId: randomUUID(),
      securityEventId: randomUUID(),
      operatorTraceRef,
      now,
      forceResourceUnavailable,
    });
    return result.allowed
      ? {
          allowed: true,
          operatorTraceRef,
          effectiveResources: result.effectiveResources,
        }
      : deniedAdmission(
          operatorTraceRef,
          exactCapability(
            request.capability.name,
            request.capability.version,
          ),
        );
  }

  async createGrantSet(input: {
    workspaceId: string;
    principalId: string;
    name: string;
    grants: AgentCapabilityGrant[];
    actorUserId: string;
  }): Promise<{
    grantSet: AgentGrantSetRecord;
    revision: AgentGrantRevisionRecord;
  }> {
    const now = this.clock.now();
    const grantSetId = randomUUID();
    const grantSet: AgentGrantSetRecord = {
      id: grantSetId,
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      name: input.name.trim(),
      activeRevision: 1,
      disabledAt: null,
      createdByUserId: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    if (!grantSet.name || grantSet.name.length > 120) {
      throw new TypeError("Grant Set name must be between 1 and 120 characters.");
    }
    const revision: AgentGrantRevisionRecord = {
      id: randomUUID(),
      grantSetId,
      revision: 1,
      grants: normalizeCapabilityGrants(input.grants),
      createdByUserId: input.actorUserId,
      createdAt: now,
    };
    await this.repository.createGrantSetWithRevision({ grantSet, revision });
    return { grantSet, revision };
  }

  async reviseGrantSet(input: {
    grantSetId: string;
    workspaceId: string;
    expectedActiveRevision: number;
    grants: AgentCapabilityGrant[];
    actorUserId: string;
  }): Promise<AgentGrantRevisionRecord> {
    const now = this.clock.now();
    const revision: AgentGrantRevisionRecord = {
      id: randomUUID(),
      grantSetId: input.grantSetId,
      revision: input.expectedActiveRevision + 1,
      grants: normalizeCapabilityGrants(input.grants),
      createdByUserId: input.actorUserId,
      createdAt: now,
    };
    const activated = await this.repository.appendGrantRevisionAndActivate({
      grantSetId: input.grantSetId,
      workspaceId: input.workspaceId,
      expectedActiveRevision: input.expectedActiveRevision,
      revision,
      activatedAt: now,
    });
    if (!activated) {
      throw new Error("Grant Set revision changed; reload and retry.");
    }
    return revision;
  }

  async putWorkspacePolicy(input: {
    workspaceId: string;
    enabled: boolean;
    grants: AgentCapabilityGrant[];
    actorUserId: string;
  }): Promise<WorkspaceAgentPolicyRecord> {
    const policy: WorkspaceAgentPolicyRecord = {
      workspaceId: input.workspaceId,
      activeRevisionId: randomUUID(),
      revision: 1,
      enabled: input.enabled,
      grants: normalizeCapabilityGrants(input.grants),
      updatedByUserId: input.actorUserId,
      updatedAt: this.clock.now(),
    };
    return this.repository.putWorkspacePolicy(policy);
  }

}
