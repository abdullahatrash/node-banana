import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import {
  agentGrantRevisions,
  agentGrantSets,
  agentKeys,
  agentPrincipals,
  workspaceAgentPolicies,
  workspaceMembers,
} from "@/lib/db/schema";
import type {
  AgentCapabilityGrant,
  AgentKeyAuthorizationScope,
  AgentResourceConstraints,
} from "@/types/agentAuthorization";
import { AGENT_AUTH_SERVICE, AgentAuthError } from "./service";

export type WorkspaceServiceAgentPurpose =
  | "content_workflow"
  | "calendar_reschedule";

export interface WorkspaceServiceAgentActor {
  workspaceId: string;
  principalId: string;
  keyId: string;
}

export interface WorkspaceServiceAgentAuthority {
  capability: string;
  authorizationContractDigest: string;
  resources: AgentResourceConstraints;
}

export interface WorkspaceServiceAgentCandidate extends WorkspaceServiceAgentActor {
  principalStatus: "active" | "suspended" | "revoked";
  principalRevokedAt: Date | null;
  keyRevokedAt: Date | null;
  keyExpiresAt: Date | null;
  keyCreatedAt: Date;
  requestedAccess: string[];
  authorizationScopes: AgentKeyAuthorizationScope[];
}

export interface WorkspaceServiceAgentRepository {
  listCandidates(input: {
    workspaceId: string;
    purpose: WorkspaceServiceAgentPurpose;
    now: Date;
  }): Promise<WorkspaceServiceAgentCandidate[]>;
  provision(input: {
    workspaceId: string;
    purpose: WorkspaceServiceAgentPurpose;
    authority: WorkspaceServiceAgentAuthority;
    now: Date;
  }): Promise<void>;
}

const PURPOSE = {
  content_workflow: {
    marker: "service:content-workflow",
    capability: "workflow_runs.start@2",
  },
  calendar_reschedule: {
    marker: "service:calendar-reschedule",
    capability: "publishing_plan_revisions.create@1",
  },
} as const satisfies Record<
  WorkspaceServiceAgentPurpose,
  { marker: string; capability: string }
>;

export function workspaceServiceAgentProvisioningProfile(
  purpose: WorkspaceServiceAgentPurpose,
) {
  return {
    requestedAccess: [PURPOSE[purpose].marker],
    capabilities: [PURPOSE[purpose].capability],
  } as const;
}

const RESOURCE_KEYS = [
  "channelIds",
  "credentialProfileIds",
  "workflowIds",
  "automationIds",
  "artifactIds",
] as const satisfies readonly (keyof AgentResourceConstraints)[];

function normalizedResources(resources: AgentResourceConstraints): AgentResourceConstraints {
  return Object.fromEntries(
    RESOURCE_KEYS.map((key) => [key, [...new Set(resources[key] ?? [])].sort()]),
  ) as unknown as AgentResourceConstraints;
}

function resourcesCover(available: AgentResourceConstraints, required: AgentResourceConstraints): boolean {
  return RESOURCE_KEYS.every((key) =>
    (required[key] ?? []).every((id) => (available[key] ?? []).includes(id)),
  );
}

function scopeCovers(scope: AgentKeyAuthorizationScope, authority: WorkspaceServiceAgentAuthority): boolean {
  return scope.capability === authority.capability &&
    scope.authorizationContractDigest === authority.authorizationContractDigest &&
    resourcesCover(scope.resources, authority.resources);
}

function mergeGrant(grants: AgentCapabilityGrant[], authority: WorkspaceServiceAgentAuthority): AgentCapabilityGrant[] {
  const matching = grants.find((grant) =>
    grant.capability === authority.capability &&
    grant.authorizationContractDigest === authority.authorizationContractDigest,
  );
  const retained = grants.filter((grant) => grant !== matching);
  const resources = normalizedResources(Object.fromEntries(
    RESOURCE_KEYS.map((key) => [
      key,
      [...(matching?.resources[key] ?? []), ...(authority.resources[key] ?? [])],
    ]),
  ) as unknown as AgentResourceConstraints);
  return [...retained, {
    capability: authority.capability,
    authorizationContractDigest: authority.authorizationContractDigest,
    resources,
  }].sort((left, right) =>
    `${left.capability}:${left.authorizationContractDigest}`.localeCompare(
      `${right.capability}:${right.authorizationContractDigest}`,
    ),
  );
}

export class WorkspaceServiceAgentUnavailableError extends Error {
  readonly code = "WORKSPACE_SERVICE_AGENT_UNAVAILABLE";

  constructor(readonly purpose: WorkspaceServiceAgentPurpose) {
    super(`No active ${purpose} service Agent is provisioned for this Workspace.`);
    this.name = "WorkspaceServiceAgentUnavailableError";
  }
}

/** Concurrent calls for the same tenant/purpose share bootstrap work. The entry
 * is removed immediately afterward, so rotation and revocation are observed by
 * the next request without a process-local TTL. */
export class WorkspaceServiceAgentResolver {
  private readonly inFlight = new Map<string, Promise<WorkspaceServiceAgentActor>>();

  constructor(
    private readonly repository: WorkspaceServiceAgentRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  resolve(input: {
    workspaceId: string;
    purpose: WorkspaceServiceAgentPurpose;
    authority: WorkspaceServiceAgentAuthority;
  }): Promise<WorkspaceServiceAgentActor> {
    const cacheKey = `${input.workspaceId}:${input.purpose}:${canonicalDigest(input.authority)}`;
    const pending = this.inFlight.get(cacheKey);
    if (pending) return pending;
    const resolution = this.resolveFresh(input).finally(() => {
      if (this.inFlight.get(cacheKey) === resolution) this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, resolution);
    return resolution;
  }

  private async resolveFresh(input: {
    workspaceId: string;
    purpose: WorkspaceServiceAgentPurpose;
    authority: WorkspaceServiceAgentAuthority;
  }): Promise<WorkspaceServiceAgentActor> {
    const profile = workspaceServiceAgentProvisioningProfile(input.purpose);
    if (input.authority.capability !== profile.capabilities[0]) {
      throw new WorkspaceServiceAgentUnavailableError(input.purpose);
    }
    const now = this.now();
    let candidates = await this.repository.listCandidates({ ...input, now });
    let eligible = this.eligible(candidates, input, now);
    if (!eligible[0]) {
      const marked = candidates.filter((candidate) =>
        candidate.workspaceId === input.workspaceId &&
        profile.requestedAccess.every((marker) => candidate.requestedAccess.includes(marker)),
      );
      const activePrincipal = marked.some((candidate) =>
        candidate.principalStatus === "active" && !candidate.principalRevokedAt,
      );
      const usableKey = marked.some((candidate) =>
        !candidate.keyRevokedAt && (!candidate.keyExpiresAt || candidate.keyExpiresAt > now),
      );
      if (marked.length > 0 && (!activePrincipal || !usableKey)) {
        throw new WorkspaceServiceAgentUnavailableError(input.purpose);
      }
      await this.repository.provision({ ...input, now });
      const refreshedAt = this.now();
      candidates = await this.repository.listCandidates({ ...input, now: refreshedAt });
      eligible = this.eligible(candidates, input, refreshedAt);
    }
    if (!eligible[0]) throw new WorkspaceServiceAgentUnavailableError(input.purpose);
    eligible.sort((left, right) =>
      right.keyCreatedAt.getTime() - left.keyCreatedAt.getTime() || right.keyId.localeCompare(left.keyId),
    );
    const selected = eligible[0];
    return { workspaceId: selected.workspaceId, principalId: selected.principalId, keyId: selected.keyId };
  }

  private eligible(
    candidates: WorkspaceServiceAgentCandidate[],
    input: { workspaceId: string; purpose: WorkspaceServiceAgentPurpose; authority: WorkspaceServiceAgentAuthority },
    now: Date,
  ): WorkspaceServiceAgentCandidate[] {
    const profile = workspaceServiceAgentProvisioningProfile(input.purpose);
    return candidates.filter((candidate) =>
      candidate.workspaceId === input.workspaceId &&
      candidate.principalStatus === "active" &&
      !candidate.principalRevokedAt &&
      !candidate.keyRevokedAt &&
      (!candidate.keyExpiresAt || candidate.keyExpiresAt > now) &&
      profile.requestedAccess.every((marker) => candidate.requestedAccess.includes(marker)) &&
      candidate.authorizationScopes.some((scope) => scopeCovers(scope, input.authority)),
    );
  }
}

class DrizzleWorkspaceServiceAgentRepository implements WorkspaceServiceAgentRepository {
  async listCandidates(input: { workspaceId: string; purpose: WorkspaceServiceAgentPurpose; now: Date }): Promise<WorkspaceServiceAgentCandidate[]> {
    const rows = await getDb().select({ principal: agentPrincipals, key: agentKeys })
      .from(agentPrincipals)
      .innerJoin(agentKeys, eq(agentKeys.principalId, agentPrincipals.id))
      .where(eq(agentPrincipals.workspaceId, input.workspaceId))
      .orderBy(desc(agentKeys.createdAt), desc(agentKeys.id));
    return rows.map(({ principal, key }) => ({
      workspaceId: principal.workspaceId,
      principalId: principal.id,
      keyId: key.id,
      principalStatus: principal.status,
      principalRevokedAt: principal.revokedAt,
      keyRevokedAt: key.revokedAt,
      keyExpiresAt: key.expiresAt,
      keyCreatedAt: key.createdAt,
      requestedAccess: principal.requestedAccess ?? [],
      authorizationScopes: (key.authorizationScopes ?? []).map((scope) => ({
        ...scope,
        resources: { ...scope.resources, artifactIds: scope.resources.artifactIds ?? [] },
      })),
    }));
  }

  async provision(input: { workspaceId: string; purpose: WorkspaceServiceAgentPurpose; authority: WorkspaceServiceAgentAuthority; now: Date }): Promise<void> {
    const profile = workspaceServiceAgentProvisioningProfile(input.purpose);
    const principalId = `service_${canonicalDigest({ schema: "workspace-service-agent-principal/v1", workspaceId: input.workspaceId, purpose: input.purpose }).slice(7, 39)}`;
    const principal = await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`workspace-service-agent:${input.workspaceId}:${input.purpose}`}, 0))`);
      const [administrator] = await tx.select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), inArray(workspaceMembers.role, ["owner", "admin"])))
        .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.userId)).limit(1);
      if (!administrator) throw new WorkspaceServiceAgentUnavailableError(input.purpose);
      await tx.insert(agentPrincipals).values({
        id: principalId,
        workspaceId: input.workspaceId,
        sponsorUserId: administrator.userId,
        name: input.purpose === "content_workflow" ? "Content Workflow service" : "Calendar Reschedule service",
        requestedAccess: [...profile.requestedAccess],
        status: "active",
        suspendedAt: null,
        revokedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      }).onConflictDoNothing();
      const [stored] = await tx.select().from(agentPrincipals)
        .where(and(eq(agentPrincipals.id, principalId), eq(agentPrincipals.workspaceId, input.workspaceId))).limit(1);
      if (!stored || stored.status !== "active" || stored.revokedAt ||
        !profile.requestedAccess.every((marker) => (stored.requestedAccess ?? []).includes(marker))) {
        throw new WorkspaceServiceAgentUnavailableError(input.purpose);
      }
      return { principalId: stored.id, actorUserId: administrator.userId };
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [policyRows, grantRows] = await Promise.all([
        getDb().select().from(workspaceAgentPolicies)
          .where(eq(workspaceAgentPolicies.workspaceId, input.workspaceId)).limit(1),
        getDb().select({ set: agentGrantSets, revision: agentGrantRevisions })
          .from(agentGrantSets)
          .leftJoin(agentGrantRevisions, and(
            eq(agentGrantRevisions.grantSetId, agentGrantSets.id),
            eq(agentGrantRevisions.revision, agentGrantSets.activeRevision),
          ))
          .where(and(
            eq(agentGrantSets.workspaceId, input.workspaceId),
            eq(agentGrantSets.principalId, principal.principalId),
            isNull(agentGrantSets.disabledAt),
          )).limit(1),
      ]);
      if (policyRows[0] && !policyRows[0].enabled) {
        throw new WorkspaceServiceAgentUnavailableError(input.purpose);
      }
      const grants = mergeGrant((grantRows[0]?.revision?.grants ?? []) as AgentCapabilityGrant[], input.authority);
      const policyGrants = mergeGrant((policyRows[0]?.grants ?? []) as AgentCapabilityGrant[], input.authority);
      const scope = grants.find((candidate) =>
        candidate.capability === input.authority.capability &&
        candidate.authorizationContractDigest === input.authority.authorizationContractDigest,
      )!;
      try {
        await AGENT_AUTH_SERVICE.provisionAuthority({
          workspaceId: input.workspaceId,
          principalId: principal.principalId,
          actorUserId: principal.actorUserId,
          requestId: `service-authority:${input.purpose}:${canonicalDigest(scope).slice(7)}`,
          grantSetId: grantRows[0]?.set.id,
          grantSetName: `Built-in ${input.purpose} authority`,
          expectedGrantRevision: grantRows[0]?.set.activeRevision ?? undefined,
          expectedPolicyRevision: policyRows[0]?.revision ?? 0,
          grants,
          policyGrants,
          key: { name: `Built-in ${input.purpose} key`, authorizationScopes: [scope] },
        });
        return;
      } catch (error) {
        if (!(error instanceof AgentAuthError) || error.code !== "AGENT_AUTHORITY_CONFLICT" || attempt === 2) throw error;
      }
    }
  }
}

export const WORKSPACE_SERVICE_AGENT_RESOLVER = new WorkspaceServiceAgentResolver(
  new DrizzleWorkspaceServiceAgentRepository(),
);
