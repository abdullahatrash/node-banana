import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import {
  agentGrantRevisions,
  agentGrantSets,
  agentKeys,
  agentPrincipals,
  agentSecurityEvents,
  artifacts,
  assets,
  builtInAgentAuthorityProvisioningReceipts,
  contentWorkflows,
  socialAccounts,
  workspaceAgentPolicies,
  workspaceMembers,
  workspaceAgentPolicyRevisions,
  workspaces,
} from "@/lib/db/schema";
import type {
  AgentCapabilityGrant,
  AgentKeyAuthorizationScope,
  AgentResourceConstraints,
} from "@/types/agentAuthorization";
import { deriveOpaqueCredential, hashCredentialSecret } from "./crypto";
import { loadAgentKeyPepperConfig } from "./service";

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
  workspacePolicyEnabled: boolean;
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
    initiatingUserId: string;
    now: Date;
  }): Promise<void>;
}

const PURPOSE = {
  content_workflow: {
    marker: "service:content-workflow",
    capability: "workflow_runs.start@3",
  },
  calendar_reschedule: {
    marker: "service:calendar-reschedule",
    capability: "publishing_plan_revisions.create@1",
  },
} as const satisfies Record<
  WorkspaceServiceAgentPurpose,
  { marker: string; capability: string }
>;

export const BUILT_IN_SERVICE_AUTHORITY_ACTOR_ID = "tasmeemai:builtin-service-authority@1";

export function builtInServiceAuthorityAuditActor(initiatingUserId: string) {
  if (!initiatingUserId.trim() || initiatingUserId.length > 200) {
    throw new WorkspaceServiceAgentUnavailableError("content_workflow");
  }
  return {
    actorKind: "built_in_system" as const,
    systemActorId: BUILT_IN_SERVICE_AUTHORITY_ACTOR_ID,
    initiatingUserId,
  };
}

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
  "studioAssetIds",
  "artifactIds",
] as const satisfies readonly (keyof AgentResourceConstraints)[];

function normalizedResources(resources: AgentResourceConstraints): AgentResourceConstraints {
  return Object.fromEntries(
    RESOURCE_KEYS.map((key) => [key, [...new Set(resources[key] ?? [])].sort()]),
  ) as unknown as AgentResourceConstraints;
}

export function validateWorkspaceServiceAgentAuthority(
  purpose: WorkspaceServiceAgentPurpose,
  authority: WorkspaceServiceAgentAuthority,
): WorkspaceServiceAgentAuthority {
  const profile = workspaceServiceAgentProvisioningProfile(purpose);
  const resources = normalizedResources(authority.resources);
  const forbidden = purpose === "content_workflow"
    ? [...resources.channelIds, ...resources.credentialProfileIds, ...resources.automationIds]
    : [...resources.credentialProfileIds, ...resources.workflowIds, ...resources.automationIds, ...(resources.studioAssetIds ?? [])];
  if (
    authority.capability !== profile.capabilities[0] ||
    !/^sha256:[a-f0-9]{64}$/.test(authority.authorizationContractDigest) ||
    forbidden.length > 0
  ) {
    throw new WorkspaceServiceAgentUnavailableError(purpose);
  }
  return { ...authority, resources };
}

export function workspaceServiceAgentPrincipalId(
  workspaceId: string,
  purpose: WorkspaceServiceAgentPurpose,
): string {
  return `service_${canonicalDigest({ schema: "workspace-service-agent-principal/v1", workspaceId, purpose }).slice(7, 39)}`;
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
    provisioningActorUserId: string;
  }): Promise<WorkspaceServiceAgentActor> {
    const cacheKey = `${input.workspaceId}:${input.purpose}:${input.provisioningActorUserId}:${canonicalDigest(input.authority)}`;
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
    provisioningActorUserId: string;
  }): Promise<WorkspaceServiceAgentActor> {
    const profile = workspaceServiceAgentProvisioningProfile(input.purpose);
    const authority = validateWorkspaceServiceAgentAuthority(input.purpose, input.authority);
    const now = this.now();
    let candidates = await this.repository.listCandidates({ ...input, now });
    let eligible = this.eligible(candidates, { ...input, authority }, now);
    if (!eligible[0]) {
      const marked = candidates.filter((candidate) =>
        candidate.workspaceId === input.workspaceId &&
        canonicalDigest(candidate.requestedAccess) === canonicalDigest([...profile.requestedAccess]),
      );
      const bootstrapEligibleActor = marked.some((candidate) =>
        candidate.principalStatus === "active" &&
        !candidate.principalRevokedAt &&
        !candidate.keyRevokedAt &&
        (!candidate.keyExpiresAt || candidate.keyExpiresAt > now) &&
        candidate.workspacePolicyEnabled,
      );
      if (marked.length > 0 && !bootstrapEligibleActor) {
        throw new WorkspaceServiceAgentUnavailableError(input.purpose);
      }
      await this.repository.provision({
        workspaceId: input.workspaceId,
        purpose: input.purpose,
        authority,
        initiatingUserId: input.provisioningActorUserId,
        now,
      });
      const refreshedAt = this.now();
      candidates = await this.repository.listCandidates({ ...input, now: refreshedAt });
      eligible = this.eligible(candidates, { ...input, authority }, refreshedAt);
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
      candidate.principalId === workspaceServiceAgentPrincipalId(input.workspaceId, input.purpose) &&
      candidate.principalStatus === "active" &&
      !candidate.principalRevokedAt &&
      !candidate.keyRevokedAt &&
      (!candidate.keyExpiresAt || candidate.keyExpiresAt > now) &&
      candidate.workspacePolicyEnabled &&
      canonicalDigest(candidate.requestedAccess) === canonicalDigest([...profile.requestedAccess]) &&
      candidate.authorizationScopes.some((scope) => scopeCovers(scope, input.authority)),
    );
  }
}

class DrizzleWorkspaceServiceAgentRepository implements WorkspaceServiceAgentRepository {
  async listCandidates(input: { workspaceId: string; purpose: WorkspaceServiceAgentPurpose; now: Date }): Promise<WorkspaceServiceAgentCandidate[]> {
    const [rows, policies] = await Promise.all([
      getDb().select({ principal: agentPrincipals, key: agentKeys })
        .from(agentPrincipals)
        .innerJoin(agentKeys, eq(agentKeys.principalId, agentPrincipals.id))
        .where(eq(agentPrincipals.workspaceId, input.workspaceId))
        .orderBy(desc(agentKeys.createdAt), desc(agentKeys.id)),
      getDb().select({ enabled: workspaceAgentPolicies.enabled })
        .from(workspaceAgentPolicies)
        .where(eq(workspaceAgentPolicies.workspaceId, input.workspaceId))
        .limit(1),
    ]);
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
        resources: {
          ...scope.resources,
          studioAssetIds: scope.resources.studioAssetIds ?? [],
          artifactIds: scope.resources.artifactIds ?? [],
        },
      })),
      workspacePolicyEnabled: policies[0]?.enabled === true,
    }));
  }

  async provision(input: { workspaceId: string; purpose: WorkspaceServiceAgentPurpose; authority: WorkspaceServiceAgentAuthority; initiatingUserId: string; now: Date }): Promise<void> {
    const profile = workspaceServiceAgentProvisioningProfile(input.purpose);
    const authority = validateWorkspaceServiceAgentAuthority(input.purpose, input.authority);
    const auditActor = builtInServiceAuthorityAuditActor(input.initiatingUserId);
    const principalId = workspaceServiceAgentPrincipalId(input.workspaceId, input.purpose);
    const requestFingerprint = canonicalDigest({
      schema: "built-in-agent-authority-provisioning/v1",
      systemActorId: auditActor.systemActorId,
      workspaceId: input.workspaceId,
      purpose: input.purpose,
      principalId,
      authority,
    });
    const requestId = `built-in:${input.purpose}:${requestFingerprint.slice(7)}`;
    const pepper = loadAgentKeyPepperConfig();
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`workspace-service-agent:${input.workspaceId}:${input.purpose}`}, 0))`);
      const [workspace] = await tx.select({ id: workspaces.id, ownerUserId: workspaces.ownerUserId })
        .from(workspaces)
        .where(and(eq(workspaces.id, input.workspaceId), isNull(workspaces.deletedAt)))
        .limit(1)
        .for("update");
      const [initiator] = await tx.select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.initiatingUserId),
        ))
        .limit(1);
      if (!workspace || !initiator) throw new WorkspaceServiceAgentUnavailableError(input.purpose);

      const [receipt] = await tx.select().from(builtInAgentAuthorityProvisioningReceipts)
        .where(and(
          eq(builtInAgentAuthorityProvisioningReceipts.workspaceId, input.workspaceId),
          eq(builtInAgentAuthorityProvisioningReceipts.purpose, input.purpose),
          eq(builtInAgentAuthorityProvisioningReceipts.requestId, requestId),
        )).limit(1).for("update");
      if (receipt) {
        const [live] = await tx.select({ principal: agentPrincipals, key: agentKeys, set: agentGrantSets, policy: workspaceAgentPolicies })
          .from(agentPrincipals)
          .innerJoin(agentKeys, eq(agentKeys.id, receipt.keyId))
          .innerJoin(agentGrantSets, eq(agentGrantSets.id, receipt.grantSetId))
          .innerJoin(workspaceAgentPolicies, eq(workspaceAgentPolicies.workspaceId, receipt.workspaceId))
          .where(and(eq(agentPrincipals.id, receipt.principalId), eq(agentPrincipals.workspaceId, input.workspaceId)))
          .limit(1);
        if (
          receipt.requestFingerprint !== requestFingerprint ||
          receipt.systemActorId !== auditActor.systemActorId ||
          !live || live.principal.status !== "active" || live.principal.revokedAt ||
          live.key.revokedAt || (live.key.expiresAt && live.key.expiresAt <= input.now) ||
          live.set.disabledAt || !live.policy.enabled
        ) throw new WorkspaceServiceAgentUnavailableError(input.purpose);
        return;
      }

      const [stored] = await tx.select().from(agentPrincipals)
        .where(eq(agentPrincipals.id, principalId)).limit(1).for("update");
      let sponsorUserId: string;
      if (stored) {
        const [sponsor] = stored.sponsorUserId ? await tx.select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, stored.sponsorUserId)))
          .limit(1) : [];
        if (
          stored.workspaceId !== input.workspaceId || stored.status !== "active" || stored.revokedAt ||
          canonicalDigest(stored.requestedAccess ?? []) !== canonicalDigest([...profile.requestedAccess]) ||
          !sponsor || !["owner", "admin"].includes(sponsor.role)
        ) throw new WorkspaceServiceAgentUnavailableError(input.purpose);
        sponsorUserId = stored.sponsorUserId!;
      } else {
        const [owner] = await tx.select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, workspace.ownerUserId), eq(workspaceMembers.role, "owner")))
          .limit(1);
        if (!owner) throw new WorkspaceServiceAgentUnavailableError(input.purpose);
        sponsorUserId = owner.userId;
        await tx.insert(agentPrincipals).values({
          id: principalId,
          workspaceId: input.workspaceId,
          sponsorUserId,
          name: input.purpose === "content_workflow" ? "Content Workflow service" : "Calendar Reschedule service",
          requestedAccess: [...profile.requestedAccess],
          status: "active",
          suspendedAt: null,
          revokedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        });
      }

      const [policyRow] = await tx.select().from(workspaceAgentPolicies)
        .where(eq(workspaceAgentPolicies.workspaceId, input.workspaceId)).limit(1).for("update");
      if (policyRow && !policyRow.enabled) throw new WorkspaceServiceAgentUnavailableError(input.purpose);
      const [setRow] = await tx.select().from(agentGrantSets)
        .where(and(eq(agentGrantSets.workspaceId, input.workspaceId), eq(agentGrantSets.principalId, principalId)))
        .limit(1).for("update");
      if (setRow?.disabledAt) throw new WorkspaceServiceAgentUnavailableError(input.purpose);

      const activeResourceIds = async () => {
        const [channels, workflows, selectedStudioAssets, selectedArtifacts] = await Promise.all([
          authority.resources.channelIds.length ? tx.select({ id: socialAccounts.id }).from(socialAccounts).where(and(eq(socialAccounts.workspaceId, input.workspaceId), inArray(socialAccounts.id, authority.resources.channelIds), eq(socialAccounts.disabled, false), eq(socialAccounts.requiresReauth, false))).for("share") : [],
          authority.resources.workflowIds.length ? tx.select({ id: contentWorkflows.id }).from(contentWorkflows).where(and(eq(contentWorkflows.workspaceId, input.workspaceId), inArray(contentWorkflows.id, authority.resources.workflowIds))).for("share") : [],
          (authority.resources.studioAssetIds ?? []).length ? tx.select({ id: assets.id }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), inArray(assets.id, authority.resources.studioAssetIds ?? []), isNull(assets.deletedAt))).for("share") : [],
          (authority.resources.artifactIds ?? []).length ? tx.select({ id: artifacts.id }).from(artifacts).where(and(eq(artifacts.workspaceId, input.workspaceId), inArray(artifacts.id, authority.resources.artifactIds ?? []), isNull(artifacts.deletedAt))).for("share") : [],
        ]);
        return {
          channelIds: channels.map(({ id }) => id),
          workflowIds: workflows.map(({ id }) => id),
          studioAssetIds: selectedStudioAssets.map(({ id }) => id),
          artifactIds: selectedArtifacts.map(({ id }) => id),
        };
      };
      const active = await activeResourceIds();
      if (
        authority.resources.channelIds.some((id) => !active.channelIds.includes(id)) ||
        authority.resources.workflowIds.some((id) => !active.workflowIds.includes(id)) ||
        (authority.resources.studioAssetIds ?? []).some((id) => !active.studioAssetIds.includes(id)) ||
        (authority.resources.artifactIds ?? []).some((id) => !active.artifactIds.includes(id))
      ) {
        throw new WorkspaceServiceAgentUnavailableError(input.purpose);
      }

      const [activeGrantRevision] = setRow?.activeRevision ? await tx.select().from(agentGrantRevisions)
        .where(and(eq(agentGrantRevisions.grantSetId, setRow.id), eq(agentGrantRevisions.revision, setRow.activeRevision)))
        .limit(1).for("share") : [];
      if (setRow?.activeRevision && !activeGrantRevision) throw new WorkspaceServiceAgentUnavailableError(input.purpose);
      const grants = mergeGrant((activeGrantRevision?.grants ?? []) as AgentCapabilityGrant[], authority);
      const policyGrants = mergeGrant((policyRow?.grants ?? []) as AgentCapabilityGrant[], authority);
      const scope = grants.find((candidate) => candidate.capability === authority.capability && candidate.authorizationContractDigest === authority.authorizationContractDigest)!;
      const grantSetId = setRow?.id ?? `service_grants_${canonicalDigest({ workspaceId: input.workspaceId, purpose: input.purpose }).slice(7, 39)}`;
      const grantRevision = (setRow?.activeRevision ?? 0) + 1;
      const grantRevisionId = `service_grant_revision_${canonicalDigest({ grantSetId, grantRevision, grants }).slice(7, 39)}`;
      const policyRevision = (policyRow?.revision ?? 0) + 1;
      const policyRevisionId = `service_policy_revision_${canonicalDigest({ workspaceId: input.workspaceId, policyRevision, policyGrants }).slice(7, 39)}`;
      const keyId = `service_key_${requestFingerprint.slice(7, 39)}`;
      const credential = deriveOpaqueCredential("key", `${BUILT_IN_SERVICE_AUTHORITY_ACTOR_ID}:${input.workspaceId}:${input.purpose}:${requestFingerprint}`, pepper.peppers[pepper.activeVersion]!);

      if (setRow) {
        await tx.update(agentGrantSets).set({ name: `Built-in ${input.purpose} authority`, activeRevision: grantRevision, updatedAt: input.now }).where(eq(agentGrantSets.id, setRow.id));
      } else {
        await tx.insert(agentGrantSets).values({ id: grantSetId, workspaceId: input.workspaceId, principalId, name: `Built-in ${input.purpose} authority`, activeRevision: grantRevision, disabledAt: null, createdByUserId: null, createdBySystemActorId: auditActor.systemActorId, initiatingUserId: auditActor.initiatingUserId, createdAt: input.now, updatedAt: input.now });
      }
      await tx.insert(agentGrantRevisions).values({ id: grantRevisionId, grantSetId, revision: grantRevision, grants, createdByUserId: null, createdBySystemActorId: auditActor.systemActorId, initiatingUserId: auditActor.initiatingUserId, createdAt: input.now });
      await tx.insert(workspaceAgentPolicyRevisions).values({ id: policyRevisionId, workspaceId: input.workspaceId, revision: policyRevision, enabled: true, grants: policyGrants, createdByUserId: null, createdBySystemActorId: auditActor.systemActorId, initiatingUserId: auditActor.initiatingUserId, createdAt: input.now });
      await tx.insert(workspaceAgentPolicies).values({ workspaceId: input.workspaceId, activeRevisionId: policyRevisionId, revision: policyRevision, enabled: true, grants: policyGrants, updatedByUserId: null, updatedBySystemActorId: auditActor.systemActorId, initiatingUserId: auditActor.initiatingUserId, updatedAt: input.now }).onConflictDoUpdate({ target: workspaceAgentPolicies.workspaceId, set: { activeRevisionId: policyRevisionId, revision: policyRevision, enabled: true, grants: policyGrants, updatedByUserId: null, updatedBySystemActorId: auditActor.systemActorId, initiatingUserId: auditActor.initiatingUserId, updatedAt: input.now } });
      await tx.insert(agentKeys).values({ id: keyId, principalId, name: `Built-in ${input.purpose} key`, lookupPrefix: credential.lookupPrefix, secretHash: hashCredentialSecret(credential.secret, pepper.peppers[pepper.activeVersion]!), pepperVersion: pepper.activeVersion, authorizationScopes: [scope], expiresAt: null, revokedAt: null, lastUsedAt: null, createdAt: input.now });
      const securityEvents: Array<typeof agentSecurityEvents.$inferInsert> = [
        { id: crypto.randomUUID(), workspaceId: input.workspaceId, principalId, keyId: null, actorUserId: null, systemActorId: auditActor.systemActorId, initiatingUserId: auditActor.initiatingUserId, eventType: "grant.revised", capabilityName: "agents.authority.provision", capabilityVersion: 1, reason: "allowed", resourceKinds: [], changeRef: grantRevisionId, revision: grantRevision, principalStatus: null, createdAt: input.now },
        { id: crypto.randomUUID(), workspaceId: input.workspaceId, principalId: null, keyId: null, actorUserId: null, systemActorId: auditActor.systemActorId, initiatingUserId: auditActor.initiatingUserId, eventType: "policy.revised", capabilityName: "agents.authority.provision", capabilityVersion: 1, reason: "allowed", resourceKinds: [], changeRef: policyRevisionId, revision: policyRevision, principalStatus: null, createdAt: input.now },
        { id: crypto.randomUUID(), workspaceId: input.workspaceId, principalId, keyId, actorUserId: null, systemActorId: auditActor.systemActorId, initiatingUserId: auditActor.initiatingUserId, eventType: "key.issued", capabilityName: "agents.authority.provision", capabilityVersion: 1, reason: "allowed", resourceKinds: [], changeRef: keyId, revision: null, principalStatus: null, createdAt: input.now },
      ];
      await tx.insert(agentSecurityEvents).values(securityEvents);
      await tx.insert(builtInAgentAuthorityProvisioningReceipts).values({ id: `service_authority_${canonicalDigest({ workspaceId: input.workspaceId, purpose: input.purpose, requestId }).slice(7, 39)}`, workspaceId: input.workspaceId, purpose: input.purpose, systemActorId: auditActor.systemActorId, initiatingUserId: auditActor.initiatingUserId, sponsorUserId, principalId, keyId, grantSetId, grantRevisionId, grantRevision, policyRevisionId, policyRevision, capability: authority.capability, authorizationContractDigest: authority.authorizationContractDigest, resources: authority.resources, requestId, requestFingerprint, createdAt: input.now });
    });
  }
}

export const WORKSPACE_SERVICE_AGENT_RESOLVER = new WorkspaceServiceAgentResolver(
  new DrizzleWorkspaceServiceAgentRepository(),
);
