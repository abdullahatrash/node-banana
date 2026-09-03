import { and, eq, isNull } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  agentSecurityEvents,
  assets,
  credentialSecurityEvents,
  runtimeDiagnosticTraces,
  runtimeSupportBundleBindIntents,
  runtimeSupportBundles,
  savedPrompts,
  socialPosts,
  usageLedgerReceipts,
} from "@/lib/db/schema";
import type { RetentionClass } from "./types";

export interface GovernanceRetentionResourceDescriptor {
  resourceKind: string;
  resourceId: string;
  retentionClass: RetentionClass;
  createdAt: Date;
  authoritativeSystems: string[];
}

export interface GovernanceRetentionResourcePort {
  resolve(input: { workspaceId: string; resourceKind: string; resourceId: string }): Promise<GovernanceRetentionResourceDescriptor | null>;
}

export const UNCONFIGURED_GOVERNANCE_RETENTION_RESOURCE_PORT: GovernanceRetentionResourcePort = {
  resolve: async () => null,
};

function authoritativeSystems(): string[] {
  const configured = (process.env.GOVERNANCE_DELETION_SYSTEMS ?? "primary")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => ["primary", "backup", "logging"].includes(value));
  return [...new Set(["primary", ...configured])].sort();
}

/** Resolves retention identity only from exact Workspace-owned canonical rows. */
export class DrizzleGovernanceRetentionResourcePort implements GovernanceRetentionResourcePort {
  constructor(private readonly database: () => ReturnType<typeof getDb>) {}

  async resolve(input: { workspaceId: string; resourceKind: string; resourceId: string }): Promise<GovernanceRetentionResourceDescriptor | null> {
    const db = this.database();
    if (input.resourceKind === "media" || input.resourceKind === "asset") {
      const [row] = await db.select({ id: assets.id, createdAt: assets.createdAt }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), eq(assets.id, input.resourceId), isNull(assets.deletedAt))).limit(1);
      return row ? { resourceKind: "media", resourceId: row.id, retentionClass: "workspace_media", createdAt: row.createdAt, authoritativeSystems: authoritativeSystems() } : null;
    }
    if (input.resourceKind === "prompt") {
      const [row] = await db.select({ id: savedPrompts.id, createdAt: savedPrompts.createdAt }).from(savedPrompts).where(and(eq(savedPrompts.workspaceId, input.workspaceId), eq(savedPrompts.id, input.resourceId), isNull(savedPrompts.deletedAt))).limit(1);
      return row ? { resourceKind: "prompt", resourceId: row.id, retentionClass: "recoverable_draft", createdAt: row.createdAt, authoritativeSystems: authoritativeSystems() } : null;
    }
    if (input.resourceKind === "social_post" || input.resourceKind === "calendar_plan") {
      const [row] = await db.select({ id: socialPosts.id, createdAt: socialPosts.createdAt, publishedAt: socialPosts.publishedAt }).from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), eq(socialPosts.id, input.resourceId))).limit(1);
      return row ? socialPostDescriptor(row) : null;
    }
    if (input.resourceKind === "consent_evidence") {
      const [row] = await db.select({ id: runtimeSupportBundleBindIntents.id, createdAt: runtimeSupportBundleBindIntents.createdAt }).from(runtimeSupportBundleBindIntents).where(and(eq(runtimeSupportBundleBindIntents.workspaceId, input.workspaceId), eq(runtimeSupportBundleBindIntents.id, input.resourceId))).limit(1);
      return row ? descriptor("consent_evidence", row.id, "consent_evidence", row.createdAt) : null;
    }
    if (input.resourceKind === "security_evidence") {
      const [agent] = await db.select({ id: agentSecurityEvents.id, createdAt: agentSecurityEvents.createdAt }).from(agentSecurityEvents).where(and(eq(agentSecurityEvents.workspaceId, input.workspaceId), eq(agentSecurityEvents.id, input.resourceId))).limit(1);
      if (agent) return descriptor("security_evidence", agent.id, "security_evidence", agent.createdAt);
      const [credential] = await db.select({ id: credentialSecurityEvents.id, createdAt: credentialSecurityEvents.createdAt }).from(credentialSecurityEvents).where(and(eq(credentialSecurityEvents.workspaceId, input.workspaceId), eq(credentialSecurityEvents.id, input.resourceId))).limit(1);
      return credential ? descriptor("security_evidence", credential.id, "security_evidence", credential.createdAt) : null;
    }
    if (input.resourceKind === "billing_tax_evidence") {
      const [row] = await db.select({ id: usageLedgerReceipts.id, createdAt: usageLedgerReceipts.createdAt }).from(usageLedgerReceipts).where(and(eq(usageLedgerReceipts.workspaceId, input.workspaceId), eq(usageLedgerReceipts.id, input.resourceId))).limit(1);
      return row ? descriptor("billing_tax_evidence", row.id, "billing_tax_evidence", row.createdAt) : null;
    }
    if (input.resourceKind === "provider_diagnostic") {
      const [row] = await db.select({ id: runtimeDiagnosticTraces.operatorTraceRef, createdAt: runtimeDiagnosticTraces.createdAt }).from(runtimeDiagnosticTraces).where(and(eq(runtimeDiagnosticTraces.workspaceId, input.workspaceId), eq(runtimeDiagnosticTraces.operatorTraceRef, input.resourceId))).limit(1);
      return row ? descriptor("provider_diagnostic", row.id, "provider_diagnostic", row.createdAt) : null;
    }
    if (input.resourceKind === "support_attachment") {
      const [row] = await db.select({ id: runtimeSupportBundles.id, storedAt: runtimeSupportBundles.storedAt }).from(runtimeSupportBundles).where(and(eq(runtimeSupportBundles.workspaceId, input.workspaceId), eq(runtimeSupportBundles.id, input.resourceId))).limit(1);
      return row ? descriptor("support_attachment", row.id, "support_attachment", row.storedAt) : null;
    }
    return null;
  }
}

function descriptor(resourceKind: string, resourceId: string, retentionClass: RetentionClass, createdAt: Date): GovernanceRetentionResourceDescriptor {
  return { resourceKind, resourceId, retentionClass, createdAt, authoritativeSystems: authoritativeSystems() };
}

export function socialPostDescriptor(row: { id: string; createdAt: Date; publishedAt: Date | null }): GovernanceRetentionResourceDescriptor {
  return descriptor(
    "social_post",
    row.id,
    row.publishedAt ? "published_lineage" : "recoverable_draft",
    row.publishedAt ?? row.createdAt,
  );
}
