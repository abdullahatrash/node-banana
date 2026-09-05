export const IDENTITY_ERASURE_CONFIRMATION = "ERASE" as const;
export const IDENTITY_ERASURE_FRESH_SESSION_MS = 15 * 60_000;

export interface IdentityErasureOwnedWorkspace {
  id: string;
  name: string;
  lifecycle: "active" | "closed";
}

export interface IdentityErasurePreflight {
  schema: "identity-erasure-preflight/v1";
  canErase: boolean;
  hasCredential: boolean;
  requiresFreshSession: boolean;
  membershipCount: number;
  ownedWorkspaces: IdentityErasureOwnedWorkspace[];
  blockers: Array<{
    code: "ACTIVE_OWNED_WORKSPACE";
    workspaceId: string;
    workspaceName: string;
  }>;
}

export function projectIdentityErasurePreflight(input: {
  accountProviders: readonly string[];
  membershipCount: number;
  ownedWorkspaces: readonly IdentityErasureOwnedWorkspace[];
}): IdentityErasurePreflight {
  const ownedWorkspaces = [...input.ownedWorkspaces];
  const blockers = ownedWorkspaces
    .filter((workspace) => workspace.lifecycle === "active")
    .map((workspace) => ({
      code: "ACTIVE_OWNED_WORKSPACE" as const,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    }));
  const hasCredential = input.accountProviders.includes("credential");

  return {
    schema: "identity-erasure-preflight/v1",
    canErase: blockers.length === 0,
    hasCredential,
    requiresFreshSession: !hasCredential,
    membershipCount: Math.max(0, Math.trunc(input.membershipCount)),
    ownedWorkspaces,
    blockers,
  };
}

export function isFreshIdentityErasureSession(
  createdAt: Date | string,
  now = new Date(),
): boolean {
  const created = new Date(createdAt);
  const age = now.getTime() - created.getTime();
  return Number.isFinite(age) && age >= 0 && age <= IDENTITY_ERASURE_FRESH_SESSION_MS;
}
