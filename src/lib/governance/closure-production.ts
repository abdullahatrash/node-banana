import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { getDb } from "@/lib/db";
import {
  agentKeys,
  agentPrincipals,
  agentSecurityEvents,
  apiTokens,
  assets,
  credentialProfiles,
  credentialSecurityEvents,
  runtimeDiagnosticTraces,
  runtimeSupportBundleBindIntents,
  runtimeSupportBundles,
  savedPrompts,
  socialAccounts,
  socialPosts,
  usageLedgerReceipts,
} from "@/lib/db/schema";
import type { GovernanceWorkspaceClosureAdapter } from "./closure-worker";
import type { GovernanceRetentionResourceDescriptor } from "./retention-resource";

type Db = ReturnType<typeof getDb>;
type Listed = { cursor: string; descriptor: GovernanceRetentionResourceDescriptor };

const SOURCE_ORDER = [
  "asset",
  "billing",
  "consent",
  "diagnostic",
  "prompt",
  "security_agent",
  "security_credential",
  "social_post",
  "support",
] as const;

function systems(): string[] {
  const configured = (process.env.GOVERNANCE_DELETION_SYSTEMS ?? "primary")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => ["primary", "backup", "logging"].includes(value));
  return [...new Set(["primary", ...configured])].sort();
}

function splitCursor(cursor: string | null): { source: string; id: string } | null {
  if (!cursor) return null;
  const separator = cursor.indexOf(":");
  return separator > 0 ? { source: cursor.slice(0, separator), id: cursor.slice(separator + 1) } : null;
}

function sourcePosition(source: string): number {
  return SOURCE_ORDER.indexOf(source as (typeof SOURCE_ORDER)[number]);
}

function queryFloor(source: string, cursor: { source: string; id: string } | null): { skip: boolean; id: string | null } {
  if (!cursor) return { skip: false, id: null };
  const position = sourcePosition(source);
  const cursorPosition = sourcePosition(cursor.source);
  if (cursorPosition < 0) return { skip: false, id: null };
  if (position < cursorPosition) return { skip: true, id: null };
  return { skip: false, id: position === cursorPosition ? cursor.id : null };
}

function item(source: string, descriptor: GovernanceRetentionResourceDescriptor): Listed {
  return { cursor: `${source}:${descriptor.resourceId}`, descriptor };
}

/** First-party closure effects: revoke every executable credential and enumerate
 * all retention classes through Workspace-scoped canonical stores. */
export class DrizzleGovernanceWorkspaceClosureAdapter implements GovernanceWorkspaceClosureAdapter {
  constructor(private readonly database: () => Db = getDb) {}

  async revokeAccess(input: { workspaceId: string; idempotencyKey: string; evaluatedAt: Date }) {
    const counts = await this.database().transaction(async (tx) => {
      const tokens = await tx.update(apiTokens).set({ revoked: true, revokedAt: input.evaluatedAt, updatedAt: input.evaluatedAt }).where(and(eq(apiTokens.workspaceId, input.workspaceId), eq(apiTokens.revoked, false))).returning({ id: apiTokens.id });
      const principals = await tx.update(agentPrincipals).set({ status: "revoked", revokedAt: input.evaluatedAt, updatedAt: input.evaluatedAt }).where(and(eq(agentPrincipals.workspaceId, input.workspaceId), isNull(agentPrincipals.revokedAt))).returning({ id: agentPrincipals.id });
      const principalIds = tx.select({ id: agentPrincipals.id }).from(agentPrincipals).where(eq(agentPrincipals.workspaceId, input.workspaceId));
      const keys = await tx.update(agentKeys).set({ revokedAt: input.evaluatedAt }).where(and(inArray(agentKeys.principalId, principalIds), isNull(agentKeys.revokedAt))).returning({ id: agentKeys.id });
      const profiles = await tx.update(credentialProfiles).set({ status: "disabled", enabled: false, updatedAt: input.evaluatedAt }).where(and(eq(credentialProfiles.workspaceId, input.workspaceId), eq(credentialProfiles.enabled, true), isNull(credentialProfiles.deletedAt))).returning({ id: credentialProfiles.id });
      const accounts = await tx.update(socialAccounts).set({ disabled: true, requiresReauth: true, accessTokenEncrypted: "revoked:workspace-closure", refreshTokenEncrypted: null, accessTokenSecret: null, additionalSettings: null, updatedAt: input.evaluatedAt }).where(and(eq(socialAccounts.workspaceId, input.workspaceId), eq(socialAccounts.disabled, false))).returning({ id: socialAccounts.id });
      return { apiTokens: tokens.length, agentPrincipals: principals.length, agentKeys: keys.length, credentialProfiles: profiles.length, socialAccounts: accounts.length };
    });
    return {
      schema: "workspace-access-revocation-evidence/v1" as const,
      ...counts,
      evidenceRef: canonicalDigest({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey }),
    };
  }

  async listRetentionResources(input: { workspaceId: string; after: string | null; limit: number }) {
    const db = this.database();
    const limit = Math.min(Math.max(input.limit, 1), 500);
    const cursor = splitCursor(input.after);
    const all: Listed[] = [];
    const add = (rows: Listed[]) => all.push(...rows);

    const assetFloor = queryFloor("asset", cursor);
    if (!assetFloor.skip) add((await db.select({ id: assets.id, createdAt: assets.createdAt }).from(assets).where(and(eq(assets.workspaceId, input.workspaceId), isNull(assets.deletedAt), assetFloor.id ? gt(assets.id, assetFloor.id) : undefined)).orderBy(asc(assets.id)).limit(limit + 1)).map((row) => item("asset", { resourceKind: "media", resourceId: row.id, retentionClass: "workspace_media", createdAt: row.createdAt, authoritativeSystems: systems() })));

    const billingFloor = queryFloor("billing", cursor);
    if (!billingFloor.skip) add((await db.select({ id: usageLedgerReceipts.id, createdAt: usageLedgerReceipts.createdAt }).from(usageLedgerReceipts).where(and(eq(usageLedgerReceipts.workspaceId, input.workspaceId), billingFloor.id ? gt(usageLedgerReceipts.id, billingFloor.id) : undefined)).orderBy(asc(usageLedgerReceipts.id)).limit(limit + 1)).map((row) => item("billing", { resourceKind: "billing_tax_evidence", resourceId: row.id, retentionClass: "billing_tax_evidence", createdAt: row.createdAt, authoritativeSystems: systems() })));

    const consentFloor = queryFloor("consent", cursor);
    if (!consentFloor.skip) add((await db.select({ id: runtimeSupportBundleBindIntents.id, createdAt: runtimeSupportBundleBindIntents.createdAt }).from(runtimeSupportBundleBindIntents).where(and(eq(runtimeSupportBundleBindIntents.workspaceId, input.workspaceId), consentFloor.id ? gt(runtimeSupportBundleBindIntents.id, consentFloor.id) : undefined)).orderBy(asc(runtimeSupportBundleBindIntents.id)).limit(limit + 1)).map((row) => item("consent", { resourceKind: "consent_evidence", resourceId: row.id, retentionClass: "consent_evidence", createdAt: row.createdAt, authoritativeSystems: systems() })));

    const diagnosticFloor = queryFloor("diagnostic", cursor);
    if (!diagnosticFloor.skip) add((await db.select({ id: runtimeDiagnosticTraces.operatorTraceRef, createdAt: runtimeDiagnosticTraces.createdAt }).from(runtimeDiagnosticTraces).where(and(eq(runtimeDiagnosticTraces.workspaceId, input.workspaceId), diagnosticFloor.id ? gt(runtimeDiagnosticTraces.operatorTraceRef, diagnosticFloor.id) : undefined)).orderBy(asc(runtimeDiagnosticTraces.operatorTraceRef)).limit(limit + 1)).map((row) => item("diagnostic", { resourceKind: "provider_diagnostic", resourceId: row.id, retentionClass: "provider_diagnostic", createdAt: row.createdAt, authoritativeSystems: systems() })));

    const promptFloor = queryFloor("prompt", cursor);
    if (!promptFloor.skip) add((await db.select({ id: savedPrompts.id, createdAt: savedPrompts.createdAt }).from(savedPrompts).where(and(eq(savedPrompts.workspaceId, input.workspaceId), isNull(savedPrompts.deletedAt), promptFloor.id ? gt(savedPrompts.id, promptFloor.id) : undefined)).orderBy(asc(savedPrompts.id)).limit(limit + 1)).map((row) => item("prompt", { resourceKind: "prompt", resourceId: row.id, retentionClass: "recoverable_draft", createdAt: row.createdAt, authoritativeSystems: systems() })));

    const agentSecurityFloor = queryFloor("security_agent", cursor);
    if (!agentSecurityFloor.skip) add((await db.select({ id: agentSecurityEvents.id, createdAt: agentSecurityEvents.createdAt }).from(agentSecurityEvents).where(and(eq(agentSecurityEvents.workspaceId, input.workspaceId), agentSecurityFloor.id ? gt(agentSecurityEvents.id, agentSecurityFloor.id) : undefined)).orderBy(asc(agentSecurityEvents.id)).limit(limit + 1)).map((row) => item("security_agent", { resourceKind: "security_evidence", resourceId: row.id, retentionClass: "security_evidence", createdAt: row.createdAt, authoritativeSystems: systems() })));

    const credentialSecurityFloor = queryFloor("security_credential", cursor);
    if (!credentialSecurityFloor.skip) add((await db.select({ id: credentialSecurityEvents.id, createdAt: credentialSecurityEvents.createdAt }).from(credentialSecurityEvents).where(and(eq(credentialSecurityEvents.workspaceId, input.workspaceId), credentialSecurityFloor.id ? gt(credentialSecurityEvents.id, credentialSecurityFloor.id) : undefined)).orderBy(asc(credentialSecurityEvents.id)).limit(limit + 1)).map((row) => item("security_credential", { resourceKind: "security_evidence", resourceId: row.id, retentionClass: "security_evidence", createdAt: row.createdAt, authoritativeSystems: systems() })));

    const postFloor = queryFloor("social_post", cursor);
    if (!postFloor.skip) add((await db.select({ id: socialPosts.id, createdAt: socialPosts.createdAt, publishedAt: socialPosts.publishedAt }).from(socialPosts).where(and(eq(socialPosts.workspaceId, input.workspaceId), postFloor.id ? gt(socialPosts.id, postFloor.id) : undefined)).orderBy(asc(socialPosts.id)).limit(limit + 1)).map((row) => item("social_post", { resourceKind: "social_post", resourceId: row.id, retentionClass: row.publishedAt ? "published_lineage" : "recoverable_draft", createdAt: row.publishedAt ?? row.createdAt, authoritativeSystems: systems() })));

    const supportFloor = queryFloor("support", cursor);
    if (!supportFloor.skip) add((await db.select({ id: runtimeSupportBundles.id, createdAt: runtimeSupportBundles.storedAt }).from(runtimeSupportBundles).where(and(eq(runtimeSupportBundles.workspaceId, input.workspaceId), supportFloor.id ? gt(runtimeSupportBundles.id, supportFloor.id) : undefined)).orderBy(asc(runtimeSupportBundles.id)).limit(limit + 1)).map((row) => item("support", { resourceKind: "support_attachment", resourceId: row.id, retentionClass: "support_attachment", createdAt: row.createdAt, authoritativeSystems: systems() })));

    all.sort((left, right) => left.cursor.localeCompare(right.cursor));
    const page = all.slice(0, limit);
    return { items: page, nextCursor: all.length > limit ? page.at(-1)!.cursor : null };
  }
}
