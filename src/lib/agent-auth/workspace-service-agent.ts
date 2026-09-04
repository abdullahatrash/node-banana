import "server-only";

import { and, desc, eq, isNull, or, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { agentKeys, agentPrincipals } from "@/lib/db/schema";

export type WorkspaceServiceAgentPurpose =
  | "content_workflow"
  | "calendar_reschedule";

export interface WorkspaceServiceAgentActor {
  workspaceId: string;
  principalId: string;
  keyId: string;
}

export interface WorkspaceServiceAgentCandidate extends WorkspaceServiceAgentActor {
  principalStatus: "active" | "suspended" | "revoked";
  principalRevokedAt: Date | null;
  keyRevokedAt: Date | null;
  keyExpiresAt: Date | null;
  keyCreatedAt: Date;
  requestedAccess: string[];
  authorizationCapabilities: string[];
}

export interface WorkspaceServiceAgentRepository {
  listCandidates(input: {
    workspaceId: string;
    purpose: WorkspaceServiceAgentPurpose;
    now: Date;
  }): Promise<WorkspaceServiceAgentCandidate[]>;
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

export class WorkspaceServiceAgentUnavailableError extends Error {
  readonly code = "WORKSPACE_SERVICE_AGENT_UNAVAILABLE";

  constructor(readonly purpose: WorkspaceServiceAgentPurpose) {
    super(`No active ${purpose} service Agent is provisioned for this Workspace.`);
    this.name = "WorkspaceServiceAgentUnavailableError";
  }
}

/**
 * Only coalesces concurrent reads. Results are deliberately not retained after
 * resolution, so key rotation and Principal/key revocation take effect on the
 * next request rather than after a process-local TTL.
 */
export class WorkspaceServiceAgentResolver {
  private readonly inFlight = new Map<string, Promise<WorkspaceServiceAgentActor>>();

  constructor(
    private readonly repository: WorkspaceServiceAgentRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  resolve(input: {
    workspaceId: string;
    purpose: WorkspaceServiceAgentPurpose;
  }): Promise<WorkspaceServiceAgentActor> {
    const cacheKey = `${input.workspaceId}:${input.purpose}`;
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
  }): Promise<WorkspaceServiceAgentActor> {
    const profile = workspaceServiceAgentProvisioningProfile(input.purpose);
    const candidates = await this.repository.listCandidates({
      ...input,
      now: this.now(),
    });
    const eligible = candidates.filter(
      (candidate) =>
        candidate.workspaceId === input.workspaceId &&
        candidate.principalStatus === "active" &&
        !candidate.principalRevokedAt &&
        !candidate.keyRevokedAt &&
        (!candidate.keyExpiresAt || candidate.keyExpiresAt > this.now()) &&
        profile.requestedAccess.every((marker) =>
          candidate.requestedAccess.includes(marker),
        ) &&
        profile.capabilities.every((capability) =>
          candidate.authorizationCapabilities.includes(capability),
        ),
    );
    const principals = new Set(eligible.map((candidate) => candidate.principalId));
    if (principals.size !== 1 || !eligible[0]) {
      throw new WorkspaceServiceAgentUnavailableError(input.purpose);
    }
    eligible.sort((left, right) =>
      right.keyCreatedAt.getTime() - left.keyCreatedAt.getTime() ||
      right.keyId.localeCompare(left.keyId),
    );
    const selected = eligible[0];
    return {
      workspaceId: selected.workspaceId,
      principalId: selected.principalId,
      keyId: selected.keyId,
    };
  }
}

class DrizzleWorkspaceServiceAgentRepository
  implements WorkspaceServiceAgentRepository
{
  async listCandidates(input: {
    workspaceId: string;
    purpose: WorkspaceServiceAgentPurpose;
    now: Date;
  }): Promise<WorkspaceServiceAgentCandidate[]> {
    const rows = await getDb()
      .select({ principal: agentPrincipals, key: agentKeys })
      .from(agentPrincipals)
      .innerJoin(agentKeys, eq(agentKeys.principalId, agentPrincipals.id))
      .where(
        and(
          eq(agentPrincipals.workspaceId, input.workspaceId),
          eq(agentPrincipals.status, "active"),
          isNull(agentPrincipals.revokedAt),
          isNull(agentKeys.revokedAt),
          or(isNull(agentKeys.expiresAt), gt(agentKeys.expiresAt, input.now)),
        ),
      )
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
      authorizationCapabilities: (key.authorizationScopes ?? []).map(
        (scope) => scope.capability,
      ),
    }));
  }
}

export const WORKSPACE_SERVICE_AGENT_RESOLVER =
  new WorkspaceServiceAgentResolver(new DrizzleWorkspaceServiceAgentRepository());
