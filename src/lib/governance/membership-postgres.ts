import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { member, workspaceMembers, workspaceSettings, workspaces } from "@/lib/db/schema";
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
    await this.database().transaction(async (tx) => {
      const role = legacyRole(input.binding);
      const [existing] = await tx.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId))).limit(1);
      if (!existing) {
        await tx.insert(workspaceMembers).values({ workspaceId: input.workspaceId, userId: input.userId, role });
      } else if (existing.role !== "owner") {
        await tx.update(workspaceMembers).set({ role, updatedAt: new Date() }).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId)));
      }
      const [settings] = await tx.select({ organizationId: workspaceSettings.organizationId }).from(workspaceSettings).where(eq(workspaceSettings.workspaceId, input.workspaceId)).limit(1);
      if (!settings) return;
      const [organizationMember] = await tx.select({ id: member.id, role: member.role }).from(member).where(and(eq(member.organizationId, settings.organizationId), eq(member.userId, input.userId))).limit(1);
      const organizationRole = role === "owner" || role === "admin" ? role : "member";
      if (!organizationMember) {
        await tx.insert(member).values({ id: `gov_${randomUUID().replaceAll("-", "")}`, organizationId: settings.organizationId, userId: input.userId, role: organizationRole });
      } else if (organizationMember.role !== "owner") {
        await tx.update(member).set({ role: organizationRole }).where(eq(member.id, organizationMember.id));
      }
    });
  }

  async removeMembership(input: { workspaceId: string; userId: string }) {
    return this.database().transaction(async (tx) => {
      const [workspace] = await tx.select({ ownerUserId: workspaces.ownerUserId }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
      if (!workspace) return "not_found" as const;
      if (workspace.ownerUserId === input.userId) return "owner_forbidden" as const;
      const removed = await tx.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId))).returning({ userId: workspaceMembers.userId });
      if (!removed.length) return "not_found" as const;
      const [settings] = await tx.select({ organizationId: workspaceSettings.organizationId }).from(workspaceSettings).where(eq(workspaceSettings.workspaceId, input.workspaceId)).limit(1);
      if (settings) await tx.delete(member).where(and(eq(member.organizationId, settings.organizationId), eq(member.userId, input.userId)));
      return "removed" as const;
    });
  }

  async transferOwnership(input: { workspaceId: string; currentOwnerUserId: string; newOwnerUserId: string }) {
    return this.database().transaction(async (tx) => {
      const [workspace] = await tx.select({ ownerUserId: workspaces.ownerUserId }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
      if (!workspace || workspace.ownerUserId !== input.currentOwnerUserId) return "not_current_owner" as const;
      const [target] = await tx.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.newOwnerUserId))).limit(1);
      if (!target) return "target_not_member" as const;
      await tx.update(workspaces).set({ ownerUserId: input.newOwnerUserId, updatedAt: new Date() }).where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.ownerUserId, input.currentOwnerUserId)));
      await tx.update(workspaceMembers).set({ role: "admin", updatedAt: new Date() }).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.currentOwnerUserId)));
      await tx.update(workspaceMembers).set({ role: "owner", updatedAt: new Date() }).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.newOwnerUserId)));
      const [settings] = await tx.select({ organizationId: workspaceSettings.organizationId }).from(workspaceSettings).where(eq(workspaceSettings.workspaceId, input.workspaceId)).limit(1);
      if (settings) {
        await tx.update(member).set({ role: "admin" }).where(and(eq(member.organizationId, settings.organizationId), eq(member.userId, input.currentOwnerUserId)));
        await tx.update(member).set({ role: "owner" }).where(and(eq(member.organizationId, settings.organizationId), eq(member.userId, input.newOwnerUserId)));
      }
      return "transferred" as const;
    });
  }

  async closeWorkspace(input: { workspaceId: string; currentOwnerUserId: string; closedAt: Date }) {
    return this.database().transaction(async (tx) => {
      const closed = await tx.update(workspaces).set({ deletedAt: input.closedAt, updatedAt: input.closedAt }).where(and(eq(workspaces.id, input.workspaceId), eq(workspaces.ownerUserId, input.currentOwnerUserId))).returning({ id: workspaces.id });
      return closed.length ? "closed" as const : "not_current_owner" as const;
    });
  }
}
