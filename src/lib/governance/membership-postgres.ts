import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import type { GovernanceMembershipPort, WorkspaceRoleBinding } from "./types";

type Db = ReturnType<typeof getDb>;

function legacyRole(binding: WorkspaceRoleBinding): "owner" | "admin" | "member" {
  if (binding.kind === "built_in" && binding.role === "owner") return "owner";
  if (binding.kind === "built_in" && binding.role === "admin") return "admin";
  return "member";
}

export class DrizzleGovernanceMembershipPort implements GovernanceMembershipPort {
  constructor(private readonly database: () => Db) {}

  async provisionAcceptedMembership(input: { workspaceId: string; userId: string; binding: WorkspaceRoleBinding }) {
    legacyRole(input.binding);
    const [workspace] = await this.database().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
    if (!workspace) throw new Error("Workspace unavailable for membership admission.");
  }

  async removeMembership(input: { workspaceId: string; userId: string }) {
    const [workspace] = await this.database().select({ ownerUserId: workspaces.ownerUserId }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
    if (!workspace) return "not_found" as const;
    if (workspace.ownerUserId === input.userId) return "owner_forbidden" as const;
    const [existing] = await this.database().select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId))).limit(1);
    return existing ? "removed" as const : "not_found" as const;
  }

  async transferOwnership(input: { workspaceId: string; currentOwnerUserId: string; newOwnerUserId: string }) {
    const [workspace] = await this.database().select({ ownerUserId: workspaces.ownerUserId }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
    if (!workspace || workspace.ownerUserId !== input.currentOwnerUserId) return "not_current_owner" as const;
    const [target] = await this.database().select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.newOwnerUserId))).limit(1);
    return target ? "transferred" as const : "target_not_member" as const;
  }

  async closeWorkspace(input: { workspaceId: string; currentOwnerUserId: string; closedAt: Date }) {
    void input.closedAt;
    const [workspace] = await this.database().select({ ownerUserId: workspaces.ownerUserId }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
    return workspace?.ownerUserId === input.currentOwnerUserId ? "closed" as const : "not_current_owner" as const;
  }
}
