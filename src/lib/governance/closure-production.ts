import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
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
import type { WorkspaceClosureEffectOutcome, WorkspaceHardErasureEvidence } from "./closure-worker";
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

/** Every canonical Workspace-owned surface handed to the closure-specific
 * hard-erasure integration. Row-level retention receipts run first; this is
 * the final authoritative purge rather than a collection of ordinary delete
 * endpoints with incompatible state machines. */
export const CLOSURE_CANONICAL_SURFACES = [
  "content_workflows_revisions_and_runs",
  "model_routes_intents_predictions_effects_and_ingestion_receipts",
  "inspiration_rights_evidence_and_snapshots",
  "brand_profiles_sources_and_saved_prompts",
  "calendar_posts_captions_and_platform_observations",
  "social_accounts_tokens_automation_and_publish_receipts",
  "credential_profiles_versions_tokens_agents_and_keys",
  "budgets_quotas_reservations_usage_and_settlements",
  "diagnostics_support_bundles_telemetry_and_experiments",
  "release_attestations_manifests_flags_and_audit_lineage",
  "projects_assets_and_generated_artifacts",
  "portfolios_and_cross_workspace_assignments",
  "review_guests_and_approval_records",
  "region_retention_safety_and_bulk_records",
  "memberships_invitations_and_role_assignments",
  "audit_exports_imports_and_governance_receipts",
  "workspace_identity",
] as const;

const GENERATION_RIGHTS_SURFACE = "inspiration_rights_evidence_and_snapshots" as const;
const DIRECT_RIGHTS_DEPENDENCIES = [
  "content_workflows_revisions_and_runs",
  "model_routes_intents_predictions_effects_and_ingestion_receipts",
] as const;
const RIGHTS_ASSET_DEPENDENCIES = ["projects_assets_and_generated_artifacts"] as const;
const GOVERNANCE_FINALIZATION_SURFACES = [
  "memberships_invitations_and_role_assignments",
  "audit_exports_imports_and_governance_receipts",
] as const;
const WORKSPACE_IDENTITY_SURFACE = "workspace_identity" as const;
const PRESERVED_RIGHTS_ERASURE_RECORDS = [
  "generation_rights_erasure_tombstones",
  "generation_rights_erasure_attempts",
  "workspace_closures.erase_generation_rights@1 receipts",
  "workspace_closures.erase_generation_rights@1 audit events",
  "active workspace_closure resource",
  "workspace closure completion tombstone",
  "workspace_closures.process@1 completion receipt",
  "complete_workspace_closure audit event",
  "active retention_hold resources",
  "completed_hold deletion receipts",
  "retained resource tombstones",
  "closed_retained completion legal-hold proof",
] as const;

function isTerminalClosureEffect(effect: WorkspaceClosureEffectOutcome): boolean {
  if (!effect.evidenceRef?.trim()) return false;
  if (effect.state === "deleted" || effect.state === "not_found") return true;
  return effect.state === "retained" && Boolean(effect.legalHoldEvidence);
}

function isErasedClosureEffect(effect: WorkspaceClosureEffectOutcome): boolean {
  return (effect.state === "deleted" || effect.state === "not_found") && Boolean(effect.evidenceRef?.trim());
}

const externalEffectOutcome = z.object({
  state: z.enum(["deleted", "not_found", "retained", "failed_known", "outcome_unknown"]),
  evidenceRef: z.string().min(1).max(500).optional(),
  reason: z.string().min(1).max(500).optional(),
  legalHoldEvidence: z.object({
    holdIds: z.array(z.string().min(1).max(200)).min(1).max(1_000),
    policyRevision: z.number().int().positive(),
    evidenceRef: z.string().min(1).max(500),
  }).strict().optional(),
  preservedRecords: z.array(z.string()).optional(),
  deletionMode: z.enum(["hard_delete", "canonical_close_redaction"]).optional(),
}).strict();

async function runClosureEffect(input: {
  path: string;
  body: Record<string, unknown>;
}): Promise<z.infer<typeof externalEffectOutcome>> {
  const base = process.env.GOVERNANCE_CLOSURE_EFFECT_URL?.trim();
  const secret = process.env.GOVERNANCE_CLOSURE_EFFECT_SECRET?.trim();
  if (!base || !secret) return { state: "outcome_unknown", reason: "CLOSURE_EFFECT_ADAPTER_NOT_CONFIGURED" };
  try {
    const response = await fetch(new URL(input.path, base), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { state: "outcome_unknown", reason: `CLOSURE_EFFECT_HTTP_${response.status}` };
    const parsed = externalEffectOutcome.safeParse(await response.json());
    return parsed.success ? parsed.data : { state: "outcome_unknown", reason: "CLOSURE_EFFECT_RESPONSE_INVALID" };
  } catch (error) {
    return { state: "outcome_unknown", reason: error instanceof Error ? error.name : "CLOSURE_EFFECT_REQUEST_FAILED" };
  }
}

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
    const db = this.database();
    const [socialTargets, credentialTargets] = await Promise.all([
      db.select({ id: socialAccounts.id, provider: socialAccounts.platform }).from(socialAccounts).where(eq(socialAccounts.workspaceId, input.workspaceId)),
      db.select({ id: credentialProfiles.id, provider: credentialProfiles.provider }).from(credentialProfiles).where(and(eq(credentialProfiles.workspaceId, input.workspaceId), isNull(credentialProfiles.deletedAt))),
    ]);
    const counts = await db.transaction(async (tx) => {
      const tokens = await tx.update(apiTokens).set({ revoked: true, revokedAt: input.evaluatedAt, updatedAt: input.evaluatedAt }).where(and(eq(apiTokens.workspaceId, input.workspaceId), eq(apiTokens.revoked, false))).returning({ id: apiTokens.id });
      const principals = await tx.update(agentPrincipals).set({ status: "revoked", revokedAt: input.evaluatedAt, updatedAt: input.evaluatedAt }).where(and(eq(agentPrincipals.workspaceId, input.workspaceId), isNull(agentPrincipals.revokedAt))).returning({ id: agentPrincipals.id });
      const principalIds = tx.select({ id: agentPrincipals.id }).from(agentPrincipals).where(eq(agentPrincipals.workspaceId, input.workspaceId));
      const keys = await tx.update(agentKeys).set({ revokedAt: input.evaluatedAt }).where(and(inArray(agentKeys.principalId, principalIds), isNull(agentKeys.revokedAt))).returning({ id: agentKeys.id });
      const profiles = await tx.update(credentialProfiles).set({ status: "disabled", enabled: false, updatedAt: input.evaluatedAt }).where(and(eq(credentialProfiles.workspaceId, input.workspaceId), eq(credentialProfiles.enabled, true), isNull(credentialProfiles.deletedAt))).returning({ id: credentialProfiles.id });
      const accounts = await tx.update(socialAccounts).set({ disabled: true, requiresReauth: true, accessTokenEncrypted: "revoked:workspace-closure", refreshTokenEncrypted: null, accessTokenSecret: null, additionalSettings: null, updatedAt: input.evaluatedAt }).where(and(eq(socialAccounts.workspaceId, input.workspaceId), eq(socialAccounts.disabled, false))).returning({ id: socialAccounts.id });
      return { apiTokens: tokens.length, agentPrincipals: principals.length, agentKeys: keys.length, credentialProfiles: profiles.length, socialAccounts: accounts.length };
    });
    const externalEffects: WorkspaceClosureEffectOutcome[] = await Promise.all([
      ...socialTargets.map(async (target) => ({
        kind: "social_disconnect" as const,
        targetId: target.id,
        idempotencyKey: `${input.idempotencyKey}:social:${target.id}`,
        attempts: 1,
        attemptedAt: input.evaluatedAt.toISOString(),
        ...await runClosureEffect({ path: "/v1/social/disconnect", body: { schema: "workspace-closure-effect/v1", workspaceId: input.workspaceId, targetId: target.id, provider: target.provider, idempotencyKey: `${input.idempotencyKey}:social:${target.id}`, evaluatedAt: input.evaluatedAt.toISOString() } }),
      })),
      ...credentialTargets.map(async (target) => ({
        kind: "provider_credential_revoke" as const,
        targetId: target.id,
        idempotencyKey: `${input.idempotencyKey}:credential:${target.id}`,
        attempts: 1,
        attemptedAt: input.evaluatedAt.toISOString(),
        ...await runClosureEffect({ path: "/v1/providers/revoke", body: { schema: "workspace-closure-effect/v1", workspaceId: input.workspaceId, targetId: target.id, provider: target.provider, idempotencyKey: `${input.idempotencyKey}:credential:${target.id}`, evaluatedAt: input.evaluatedAt.toISOString() } }),
      })),
    ]);
    return {
      schema: "workspace-access-revocation-evidence/v1" as const,
      ...counts,
      externalEffects,
      evidenceRef: canonicalDigest({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey }),
    };
  }

  async hardEraseWorkspace(input: { workspaceId: string; closureId: string; closureLease: { id: string; fence: number; expiresAt: string }; idempotencyKey: string; evaluatedAt: Date; retainedResources: Array<{ resourceKind: string; resourceId: string; holdIds: string[] }> }): Promise<WorkspaceHardErasureEvidence> {
    const blocked = (surface: (typeof CLOSURE_CANONICAL_SURFACES)[number], reason: string): WorkspaceClosureEffectOutcome => ({
      kind: "workspace_hard_erasure",
      targetId: surface,
      idempotencyKey: `${input.idempotencyKey}:${surface}`,
      attempts: 1,
      attemptedAt: input.evaluatedAt.toISOString(),
      state: "failed_known",
      reason,
    });
    const propagateRetention = (surface: (typeof CLOSURE_CANONICAL_SURFACES)[number], dependencies: WorkspaceClosureEffectOutcome[]): WorkspaceClosureEffectOutcome | null => {
      if (!dependencies.every(isTerminalClosureEffect)) return null;
      const retained = dependencies.filter((effect) => effect.state === "retained" && effect.legalHoldEvidence);
      if (!retained.length) return null;
      const policyRevisions = new Set(retained.map((effect) => effect.legalHoldEvidence!.policyRevision));
      if (policyRevisions.size !== 1) return null;
      const proof = canonicalDigest({
        schema: "workspace-closure-propagated-retention/v1",
        workspaceId: input.workspaceId,
        closureId: input.closureId,
        surface,
        dependencies: retained.map((effect) => ({ targetId: effect.targetId, evidenceRef: effect.evidenceRef, legalHoldEvidence: effect.legalHoldEvidence })),
      });
      return {
        kind: "workspace_hard_erasure",
        targetId: surface,
        idempotencyKey: `${input.idempotencyKey}:${surface}`,
        attempts: 1,
        attemptedAt: input.evaluatedAt.toISOString(),
        state: "retained",
        reason: "DEPENDENCY_LEGALLY_RETAINED",
        evidenceRef: proof,
        legalHoldEvidence: {
          holdIds: [...new Set(retained.flatMap((effect) => effect.legalHoldEvidence!.holdIds))].sort(),
          policyRevision: retained[0]!.legalHoldEvidence!.policyRevision,
          evidenceRef: proof,
        },
      };
    };
    const erase = async (surface: (typeof CLOSURE_CANONICAL_SURFACES)[number]): Promise<WorkspaceClosureEffectOutcome> => {
      const outcome = await runClosureEffect({
        path: "/v1/workspaces/hard-erase",
        body: { schema: "workspace-closure-hard-erasure/v2", workspaceId: input.workspaceId, closureId: input.closureId, closureLease: input.closureLease, surface, retainedResources: input.retainedResources, preserveRecords: PRESERVED_RIGHTS_ERASURE_RECORDS, idempotencyKey: `${input.idempotencyKey}:${surface}`, evaluatedAt: input.evaluatedAt.toISOString() },
      });
      const preserved = new Set(outcome.preservedRecords ?? []);
      const preservationProven = PRESERVED_RIGHTS_ERASURE_RECORDS.every((record) => preserved.has(record));
      const requiresPreservationProof = GOVERNANCE_FINALIZATION_SURFACES.includes(surface as (typeof GOVERNANCE_FINALIZATION_SURFACES)[number]) || surface === WORKSPACE_IDENTITY_SURFACE;
      const contractFailure = requiresPreservationProof && !preservationProven
        ? "CLOSURE_PROOF_PRESERVATION_NOT_PROVEN"
        : surface === WORKSPACE_IDENTITY_SURFACE && outcome.deletionMode !== "canonical_close_redaction"
          ? "WORKSPACE_IDENTITY_MUST_USE_CANONICAL_CLOSE_REDACTION"
          : null;
      return {
        kind: "workspace_hard_erasure" as const,
        targetId: surface,
        idempotencyKey: `${input.idempotencyKey}:${surface}`,
        attempts: 1,
        attemptedAt: input.evaluatedAt.toISOString(),
        ...(contractFailure ? { state: "failed_known" as const, reason: contractFailure } : outcome),
      };
    };
    const prerequisiteEffects: WorkspaceClosureEffectOutcome[] = [];
    for (const surface of DIRECT_RIGHTS_DEPENDENCIES) {
      prerequisiteEffects.push(prerequisiteEffects.every(isErasedClosureEffect)
        ? await erase(surface)
        : propagateRetention(surface, prerequisiteEffects) ?? blocked(surface, "PRIOR_RIGHTS_DEPENDENCY_NOT_ERASED"));
    }
    const prerequisitesErased = prerequisiteEffects.every((effect) =>
      (effect.state === "deleted" || effect.state === "not_found") && Boolean(effect.evidenceRef?.trim()),
    );
    const rightsEffect = prerequisitesErased
      ? await erase(GENERATION_RIGHTS_SURFACE)
      : propagateRetention(GENERATION_RIGHTS_SURFACE, prerequisiteEffects) ?? blocked(GENERATION_RIGHTS_SURFACE, "DEPENDENCY_SURFACES_NOT_ERASED");
    const completed = new Set<string>([
      ...DIRECT_RIGHTS_DEPENDENCIES,
      GENERATION_RIGHTS_SURFACE,
      ...RIGHTS_ASSET_DEPENDENCIES,
      ...GOVERNANCE_FINALIZATION_SURFACES,
      WORKSPACE_IDENTITY_SURFACE,
    ]);
    const remainingSurfaces = CLOSURE_CANONICAL_SURFACES.filter((surface) => !completed.has(surface));
    const remainingEffects = await Promise.all(remainingSurfaces.map(erase));
    const preAssetEffects = [...prerequisiteEffects, rightsEffect, ...remainingEffects];
    const assetEffects = preAssetEffects.every(isErasedClosureEffect)
      ? await Promise.all(RIGHTS_ASSET_DEPENDENCIES.map(erase))
      : RIGHTS_ASSET_DEPENDENCIES.map((surface) => propagateRetention(surface, preAssetEffects) ?? blocked(surface, "ASSET_REFERENCING_SURFACES_NOT_TERMINAL"));
    const preGovernanceEffects = [...preAssetEffects, ...assetEffects];
    const governanceEffects = preGovernanceEffects.every(isTerminalClosureEffect)
      ? await Promise.all(GOVERNANCE_FINALIZATION_SURFACES.map(erase))
      : GOVERNANCE_FINALIZATION_SURFACES.map((surface) => blocked(surface, "PRIOR_ERASURE_PHASE_NOT_TERMINAL"));
    const identityEffect = governanceEffects.every(isTerminalClosureEffect)
      ? await erase(WORKSPACE_IDENTITY_SURFACE)
      : blocked(WORKSPACE_IDENTITY_SURFACE, "GOVERNANCE_ERASURE_NOT_TERMINAL");
    const effects = [...prerequisiteEffects, rightsEffect, ...remainingEffects, ...assetEffects, ...governanceEffects, identityEffect];
    return {
      schema: "workspace-hard-erasure-evidence/v1",
      effects,
      surfaces: [...CLOSURE_CANONICAL_SURFACES],
      omissions: [],
      retainedResources: input.retainedResources,
      evidenceRef: canonicalDigest({ workspaceId: input.workspaceId, closureId: input.closureId, surfaces: CLOSURE_CANONICAL_SURFACES, retainedResources: input.retainedResources, effects }),
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
