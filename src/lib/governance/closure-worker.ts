import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { TRUSTED_RETENTION_LEGAL_FLOORS } from "./retention-policy";
import type { GovernanceRetentionResourceDescriptor } from "./retention-resource";
import type {
  GovernanceAuditEvent,
  GovernanceCanonicalEffect,
  GovernanceMutation,
  GovernanceRepository,
  GovernanceResource,
  RetentionRule,
} from "./types";

const LEASE_MS = 5 * 60_000;
const TERMINAL_DELETION_STATUSES = new Set(["completed", "completed_hold"]);
const PROVEN_ERASURE_STATES = new Set(["deleted", "not_found"]);

export interface WorkspaceClosureEffectOutcome {
  kind: "social_disconnect" | "provider_credential_revoke" | "workspace_hard_erasure";
  targetId: string;
  idempotencyKey: string;
  attempts: number;
  attemptedAt: string;
  state: "deleted" | "not_found" | "retained" | "failed_known" | "outcome_unknown";
  evidenceRef?: string;
  reason?: string;
  legalHoldEvidence?: {
    holdIds: string[];
    policyRevision: number;
    evidenceRef: string;
  };
}

export interface WorkspaceHardErasureEvidence {
  schema: "workspace-hard-erasure-evidence/v1";
  effects: WorkspaceClosureEffectOutcome[];
  surfaces: string[];
  omissions: string[];
  retainedResources: Array<{ resourceKind: string; resourceId: string; holdIds: string[] }>;
  evidenceRef: string;
}

function hasErasureProof(effect: WorkspaceClosureEffectOutcome): boolean {
  return PROVEN_ERASURE_STATES.has(effect.state) && Boolean(effect.evidenceRef?.trim());
}

function hasLegalRetentionProof(
  effect: WorkspaceClosureEffectOutcome,
  retainedResources: Array<{ holdIds: string[] }>,
  activePolicyRevision: number,
): boolean {
  if (effect.state !== "retained" || !effect.evidenceRef?.trim()) return false;
  const evidence = effect.legalHoldEvidence;
  if (!evidence || evidence.policyRevision !== activePolicyRevision || !evidence.evidenceRef.trim() || evidence.holdIds.length === 0) return false;
  const activeHoldIds = new Set(retainedResources.flatMap((resource) => resource.holdIds));
  return evidence.holdIds.every((holdId) => activeHoldIds.has(holdId));
}

interface ClosureBody {
  requestedByUserId: string;
  executeAfter: string;
  executedAt: string;
  exportId: string;
  erasureCursor: string | null;
  erasureScheduled: boolean;
  accessRevocationEvidence: WorkspaceAccessRevocationEvidence | null;
  hardErasureEvidence?: WorkspaceHardErasureEvidence | null;
  completionEvidence: Record<string, unknown> | null;
  lease: ClosureLease | null;
  leaseFence?: number;
  [key: string]: unknown;
}

interface ClosureLease {
  id: string;
  fence: number;
  expiresAt: string;
}

export interface WorkspaceAccessRevocationEvidence {
  schema: "workspace-access-revocation-evidence/v1";
  apiTokens: number;
  agentPrincipals: number;
  agentKeys: number;
  credentialProfiles: number;
  socialAccounts: number;
  externalEffects: WorkspaceClosureEffectOutcome[];
  evidenceRef: string;
}

export interface GovernanceWorkspaceClosureAdapter {
  revokeAccess(input: {
    workspaceId: string;
    idempotencyKey: string;
    evaluatedAt: Date;
  }): Promise<WorkspaceAccessRevocationEvidence>;
  listRetentionResources(input: {
    workspaceId: string;
    after: string | null;
    limit: number;
  }): Promise<{ items: Array<{ cursor: string; descriptor: GovernanceRetentionResourceDescriptor }>; nextCursor: string | null }>;
  hardEraseWorkspace(input: {
    workspaceId: string;
    closureId: string;
    closureLease: ClosureLease;
    idempotencyKey: string;
    evaluatedAt: Date;
    retainedResources: Array<{ resourceKind: string; resourceId: string; holdIds: string[] }>;
  }): Promise<WorkspaceHardErasureEvidence>;
}

function audit(job: GovernanceResource, action: string, outcome: GovernanceAuditEvent["outcome"], now: Date): GovernanceAuditEvent {
  return {
    schema: "workspace-audit-event/v1",
    id: `audit_${randomUUID().replaceAll("-", "")}`,
    workspaceId: job.workspaceId,
    actor: { kind: "system", id: null },
    capability: "workspace_closures.process@1",
    action,
    resource: { kind: "workspace_closure", id: job.id },
    outcome,
    redactedDetails: {},
    occurredAt: now,
  };
}

function updated<T extends Record<string, unknown>>(resource: GovernanceResource<T>, status: string, body: T, now: Date): GovernanceResource<T> {
  return { ...resource, version: resource.version + 1, status, body, updatedAt: now };
}

/**
 * Durable, fenced Workspace closure orchestration. The Workspace remains
 * present and write-blocked until export evidence exists and every canonical
 * resource has either been authoritatively deleted or retained by policy/hold.
 */
export class GovernanceWorkspaceClosureWorker {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly adapter: GovernanceWorkspaceClosureAdapter,
    private readonly clock: { now(): Date } = { now: () => new Date() },
  ) {}

  async process(input: { workspaceId: string; closureId: string }): Promise<void> {
    const found = await this.repository.getResource<ClosureBody>({ workspaceId: input.workspaceId, kind: "workspace_closure", id: input.closureId });
    if (!found || ["closed", "closed_retained", "cancelled", "failed_known"].includes(found.status)) return;
    const job = await this.claim(found);
    if (!job) return;
    const now = this.clock.now();
    const revocationAttempt = await this.adapter.revokeAccess({
      workspaceId: input.workspaceId,
      idempotencyKey: `workspace-closure:${job.id}:access`,
      evaluatedAt: now,
    });
    const previousEffects = new Map((job.body.accessRevocationEvidence?.externalEffects ?? []).map((effect) => [`${effect.kind}:${effect.targetId}`, effect]));
    const revocation = {
      ...revocationAttempt,
      externalEffects: revocationAttempt.externalEffects.map((effect) => ({
        ...effect,
        attempts: (previousEffects.get(`${effect.kind}:${effect.targetId}`)?.attempts ?? 0) + 1,
      })),
    };
    revocation.evidenceRef = canonicalDigest({ ...revocation, evidenceRef: undefined });
    // Access-bearing effects have no lawful "retained" success state: provider
    // credentials and social grants must be proven unusable.
    if (revocation.externalEffects.some((effect) => !hasErasureProof(effect))) {
      await this.release(job, "waiting_erasure", { ...job.body, accessRevocationEvidence: revocation }, now, "closure_waiting_external_revocation");
      return;
    }
    const scheduled = await this.scheduleRetention(job, revocation, now);
    if (scheduled) return;
    await this.tryComplete(job, revocation, now);
  }

  private async scheduleRetention(job: GovernanceResource<ClosureBody>, revocation: WorkspaceAccessRevocationEvidence, now: Date): Promise<boolean> {
    if (job.body.erasureScheduled) return false;
    const policy = await this.repository.getResource<{ revisions: Array<{ revision: number; rules: RetentionRule[] }>; activeRevision: number }>({ workspaceId: job.workspaceId, kind: "retention_policy", id: "active" });
    const revision = policy?.body.revisions.find((candidate) => candidate.revision === policy.body.activeRevision);
    if (
      !policy ||
      policy.status !== "active" ||
      !revision ||
      revision.rules.length !== Object.keys(TRUSTED_RETENTION_LEGAL_FLOORS).length ||
      Object.entries(TRUSTED_RETENTION_LEGAL_FLOORS).some(([retentionClass, legalFloorDays]) => {
        const rules = revision.rules.filter((rule) => rule.retentionClass === retentionClass);
        return rules.length !== 1 || rules[0]!.legalFloorDays !== legalFloorDays;
      })
    ) {
      await this.release(job, "waiting_retention_policy", { ...job.body, accessRevocationEvidence: revocation }, now, "closure_waiting_retention_policy");
      return true;
    }
    const page = await this.adapter.listRetentionResources({ workspaceId: job.workspaceId, after: job.body.erasureCursor, limit: 100 });
    const holds = await this.repository.listResources<{ retentionClasses: string[]; expiresAt: string | null }>({ workspaceId: job.workspaceId, kinds: ["retention_hold"], status: "active" });
    const existing = await this.repository.listResources<{ resourceKind: string; resourceId: string }>({ workspaceId: job.workspaceId, kinds: ["deletion_receipt"] });
    const existingKeys = new Set(existing.map((receipt) => `${receipt.body.resourceKind}:${receipt.body.resourceId}`));
    const mutations: GovernanceMutation[] = [];
    for (const { descriptor } of page.items) {
      const resourceKey = `${descriptor.resourceKind}:${descriptor.resourceId}`;
      if (existingKeys.has(resourceKey)) continue;
      const rule = revision.rules.find((candidate) => candidate.retentionClass === descriptor.retentionClass);
      if (!rule) throw new Error(`Retention rule unavailable for ${descriptor.retentionClass}.`);
      const eligibleAt = new Date(descriptor.createdAt.getTime() + Math.max(rule.durationDays, rule.legalFloorDays, rule.recoverableDays) * 86_400_000);
      const applicableHolds = holds.filter((hold) => hold.body.retentionClasses.includes(descriptor.retentionClass) && (!hold.body.expiresAt || new Date(hold.body.expiresAt) > now));
      const systems = [...new Set(descriptor.authoritativeSystems)].sort();
      if (!systems.length) throw new Error(`Deletion systems unavailable for ${resourceKey}.`);
      const delayed = !applicableHolds.length && eligibleAt > now;
      const outcomes = applicableHolds.length
        ? Object.fromEntries(systems.map((system) => [system, { state: "retained", evidenceRef: applicableHolds.map((hold) => hold.id).join(","), reason: "ACTIVE_RETENTION_HOLD" }]))
        : delayed
          ? Object.fromEntries(systems.map((system) => [system, { state: "delayed", retryAt: eligibleAt.toISOString(), reason: "RETENTION_PERIOD_ACTIVE" }]))
          : {};
      const id = `closure_deletion_${canonicalDigest({ closureId: job.id, resourceKey }).slice(7, 31)}`;
      const status = applicableHolds.length ? "completed_hold" : delayed ? "delayed" : "queued";
      mutations.push({
        type: "create",
        expectedVersion: null,
        resource: {
          id,
          workspaceId: job.workspaceId,
          kind: "deletion_receipt",
          version: 1,
          status,
          body: {
            schema: "deletion-receipt/v2",
            closureId: job.id,
            retentionClass: descriptor.retentionClass,
            resourceKind: descriptor.resourceKind,
            resourceId: descriptor.resourceId,
            systems,
            outcomes,
            holdIds: applicableHolds.map((hold) => hold.id),
            policyRevision: revision.revision,
            policyRuleDigest: canonicalDigest(rule),
            resourceCreatedAt: descriptor.createdAt.toISOString(),
            eligibleAt: eligibleAt.toISOString(),
            requestedAt: now.toISOString(),
          },
          createdByUserId: job.body.requestedByUserId,
          createdAt: now,
          updatedAt: now,
        },
      });
      if (applicableHolds.length) {
        mutations.push({
          type: "create",
          expectedVersion: null,
          resource: {
            id: resourceKey,
            workspaceId: job.workspaceId,
            kind: "tombstone",
            version: 1,
            status: "active",
            body: { resourceKind: descriptor.resourceKind, resourceId: descriptor.resourceId, deletionReceiptId: id, systemOutcomes: outcomes, retainedEvidenceOnly: true },
            createdByUserId: job.body.requestedByUserId,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      existingKeys.add(resourceKey);
    }
    const erasureScheduled = page.nextCursor === null;
    const next = updated(job, erasureScheduled ? "waiting_erasure" : "erasure_queued", {
      ...job.body,
      erasureCursor: page.nextCursor,
      erasureScheduled,
      accessRevocationEvidence: revocation,
      lease: null,
    }, now);
    mutations.push({ type: "update", expectedVersion: job.version, resource: next });
    const outcome = await this.repository.commit({
      receipt: {
        workspaceId: job.workspaceId,
        capability: "workspace_closures.process@1",
        idempotencyKey: `closure-schedule-${job.id}-${job.version}`,
        requestDigest: canonicalDigest({ closureId: job.id, version: job.version, cursor: job.body.erasureCursor, nextCursor: page.nextCursor, resources: page.items.map((item) => [item.cursor, item.descriptor.resourceKind, item.descriptor.resourceId]) }),
        result: { closureId: job.id, status: next.status, scheduled: page.items.length },
        createdAt: now,
      },
      mutations,
      audit: audit(job, "schedule_workspace_erasure", "accepted", now),
    });
    if (outcome.type === "conflict") throw new Error("Workspace closure changed while scheduling erasure.");
    return true;
  }

  private async tryComplete(job: GovernanceResource<ClosureBody>, revocation: WorkspaceAccessRevocationEvidence, now: Date): Promise<void> {
    const exportJob = await this.repository.getResource({ workspaceId: job.workspaceId, kind: "workspace_export", id: job.body.exportId });
    const deletions = (await this.repository.listResources<{ closureId?: string }>({ workspaceId: job.workspaceId, kinds: ["deletion_receipt"] }))
      .filter((receipt) => receipt.body.closureId === job.id);
    if (exportJob?.status !== "succeeded" || deletions.some((receipt) => !TERMINAL_DELETION_STATUSES.has(receipt.status))) {
      await this.release(job, exportJob?.status === "failed_known" ? "waiting_export" : "waiting_erasure", { ...job.body, accessRevocationEvidence: revocation }, now, "closure_waiting_dependencies");
      return;
    }
    const retainedResources = deletions.flatMap((receipt) => {
      const body = receipt.body as { resourceKind?: string; resourceId?: string; holdIds?: string[] };
      return receipt.status === "completed_hold" && body.resourceKind && body.resourceId
        ? [{ resourceKind: body.resourceKind, resourceId: body.resourceId, holdIds: [...(body.holdIds ?? [])].sort() }]
        : [];
    });
    const policy = await this.repository.getResource<{ activeRevision: number }>({ workspaceId: job.workspaceId, kind: "retention_policy", id: "active" });
    const activeRevision = Number.isInteger(policy?.body.activeRevision) ? policy!.body.activeRevision : 0;
    const activeHolds = await this.repository.listResources<{ retentionClasses?: string[]; scopeReview?: { schema?: string; reviewedAgainstPolicyRevision?: number; generationRightsEvidence?: string } | null; expiresAt?: string | null }>({ workspaceId: job.workspaceId, kinds: ["retention_hold"], status: "active" });
    const rightsHoldIds = activeHolds.filter((hold) => {
      const expiry = hold.body.expiresAt;
      if (expiry) {
        const parsed = new Date(expiry);
        if (!Number.isNaN(parsed.getTime()) && parsed <= now) return false;
      }
      const classes = Array.isArray(hold.body.retentionClasses) ? hold.body.retentionClasses : [];
      if (classes.includes("generation_rights_evidence")) return true;
      const review = hold.body.scopeReview;
      return review?.schema !== "retention-hold-scope-review/v2"
        || review.reviewedAgainstPolicyRevision !== activeRevision
        || review.generationRightsEvidence !== "not_applicable";
    }).map((hold) => hold.id).sort();
    if (rightsHoldIds.length) retainedResources.push({
      resourceKind: "generation_rights_evidence",
      resourceId: `workspace:${job.workspaceId}`,
      holdIds: rightsHoldIds,
    });
    if (!job.body.lease) throw new Error("Workspace closure lease unavailable during hard erasure.");
    const hardErasureAttempt = await this.adapter.hardEraseWorkspace({
      workspaceId: job.workspaceId,
      closureId: job.id,
      closureLease: job.body.lease,
      idempotencyKey: `workspace-closure:${job.id}:hard-erasure`,
      evaluatedAt: now,
      retainedResources,
    });
    const previousHardEffects = new Map((job.body.hardErasureEvidence?.effects ?? []).map((effect) => [effect.targetId, effect]));
    const hardErasure = {
      ...hardErasureAttempt,
      effects: hardErasureAttempt.effects.map((effect) => ({ ...effect, attempts: (previousHardEffects.get(effect.targetId)?.attempts ?? 0) + 1 })),
    };
    hardErasure.evidenceRef = canonicalDigest({ ...hardErasure, evidenceRef: undefined });
    if (
      hardErasure.surfaces.length === 0 ||
      hardErasure.effects.length !== hardErasure.surfaces.length ||
      new Set(hardErasure.effects.map((effect) => effect.targetId)).size !== hardErasure.surfaces.length ||
      hardErasure.effects.some((effect) => effect.kind !== "workspace_hard_erasure" || !hardErasure.surfaces.includes(effect.targetId)) ||
      hardErasure.effects.some((effect) => !hasErasureProof(effect) && !hasLegalRetentionProof(effect, retainedResources, activeRevision))
    ) {
      await this.release(job, "waiting_erasure", { ...job.body, accessRevocationEvidence: revocation, hardErasureEvidence: hardErasure }, now, "closure_waiting_hard_erasure");
      return;
    }
    const tombstoneId = `workspace:${job.workspaceId}`;
    const existingTombstone = await this.repository.getResource({ workspaceId: job.workspaceId, kind: "tombstone", id: tombstoneId });
    const legallyRetainedEffects = hardErasure.effects.filter((effect) => effect.state === "retained");
    const fullyErased = retainedResources.length === 0 && legallyRetainedEffects.length === 0;
    const finalStatus = fullyErased ? "closed" : "closed_retained";
    const completionEvidence = {
      schema: "workspace-closure-completion-evidence/v2",
      fullyErased,
      exportId: exportJob.id,
      exportManifestDigest: canonicalDigest((exportJob.body as { manifest?: unknown }).manifest ?? null),
      accessRevocationEvidence: revocation,
      hardErasureEvidence: hardErasure,
      deletionReceipts: deletions.map((receipt) => ({
        id: receipt.id,
        status: receipt.status,
        holdIds: (receipt.body as { holdIds?: string[] }).holdIds ?? [],
        outcomes: (receipt.body as { outcomes?: Record<string, unknown> }).outcomes ?? {},
      })).sort((left, right) => left.id.localeCompare(right.id)),
      holds: [...new Set(retainedResources.flatMap((resource) => resource.holdIds))].sort(),
      legalHoldEvidence: legallyRetainedEffects.map((effect) => ({
        surface: effect.targetId,
        holdIds: [...(effect.legalHoldEvidence?.holdIds ?? [])].sort(),
        policyRevision: effect.legalHoldEvidence?.policyRevision,
        evidenceRef: effect.legalHoldEvidence?.evidenceRef,
      })),
      omissions: [
        ...(((exportJob.body as { manifest?: { omissions?: string[] } }).manifest?.omissions) ?? []),
        ...hardErasure.omissions,
      ].sort(),
      unknowns: [],
      completedAt: now.toISOString(),
    };
    const next = updated(job, finalStatus, { ...job.body, lease: null, completionEvidence, closedAt: now.toISOString() }, now);
    const mutations: GovernanceMutation[] = [{ type: "update", expectedVersion: job.version, resource: next }];
    if (!existingTombstone) mutations.push({
      type: "create",
      expectedVersion: null,
      resource: { id: tombstoneId, workspaceId: job.workspaceId, kind: "tombstone", version: 1, status: "active", body: { resourceKind: "workspace", resourceId: job.workspaceId, closureId: job.id, completionEvidence }, createdByUserId: job.body.requestedByUserId, createdAt: now, updatedAt: now },
    });
    const effects: GovernanceCanonicalEffect[] = [{ type: "workspace_close", workspaceId: job.workspaceId, currentOwnerUserId: job.body.requestedByUserId, occurredAt: now }];
    const outcome = await this.repository.commit({
      receipt: { workspaceId: job.workspaceId, capability: "workspace_closures.process@1", idempotencyKey: `closure-complete-${job.id}`, requestDigest: canonicalDigest(completionEvidence), result: { closureId: job.id, status: finalStatus, fullyErased, tombstoneId }, createdAt: now },
      mutations,
      canonicalEffects: effects,
      audit: audit(job, "complete_workspace_closure", "completed", now),
    });
    if (outcome.type === "conflict") throw new Error("Workspace closure changed while completing.");
  }

  private async claim(job: GovernanceResource<ClosureBody>): Promise<GovernanceResource<ClosureBody> | null> {
    const now = this.clock.now();
    if (job.body.lease && new Date(job.body.lease.expiresAt) > now) return null;
    if (!["erasure_queued", "erasure_running", "waiting_retention_policy", "waiting_erasure", "waiting_export"].includes(job.status)) return null;
    const recordedFence = Number.isSafeInteger(job.body.leaseFence) && job.body.leaseFence! >= 0 ? job.body.leaseFence! : 0;
    const legacyLeaseFence = Number.isSafeInteger(job.body.lease?.fence) && job.body.lease!.fence >= 0 ? job.body.lease!.fence : 0;
    const lease: ClosureLease = { id: `lease_${randomUUID().replaceAll("-", "")}`, fence: Math.max(recordedFence, legacyLeaseFence) + 1, expiresAt: new Date(now.getTime() + LEASE_MS).toISOString() };
    const next = updated(job, "erasure_running", { ...job.body, lease, leaseFence: lease.fence }, now);
    const outcome = await this.repository.commit({
      receipt: { workspaceId: job.workspaceId, capability: "workspace_closures.claim@1", idempotencyKey: `closure-claim-${job.id}-${job.version}-${lease.id}`, requestDigest: canonicalDigest({ closureId: job.id, version: job.version, lease }), result: { closureId: job.id, lease }, createdAt: now },
      mutations: [{ type: "update", expectedVersion: job.version, resource: next }],
      audit: audit(job, "claim_workspace_closure", "accepted", now),
    });
    return outcome.type === "committed" ? next : null;
  }

  private async release(job: GovernanceResource<ClosureBody>, status: string, body: ClosureBody, now: Date, action: string): Promise<void> {
    const next = updated(job, status, { ...body, lease: null }, now);
    const outcome = await this.repository.commit({
      receipt: { workspaceId: job.workspaceId, capability: "workspace_closures.process@1", idempotencyKey: `${action}-${job.id}-${job.version}`, requestDigest: canonicalDigest({ closureId: job.id, version: job.version, status }), result: { closureId: job.id, status }, createdAt: now },
      mutations: [{ type: "update", expectedVersion: job.version, resource: next }],
      audit: audit(job, action, "accepted", now),
    });
    if (outcome.type === "conflict") throw new Error("Workspace closure changed while releasing its lease.");
  }
}
