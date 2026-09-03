import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { GovernanceAuditEvent, GovernanceRepository, GovernanceResource } from "./types";

export interface GovernanceSafetyRevalidationPort {
  revalidate(input: { workspaceId: string; intentRef: string; originalDecisionId: string; originalPolicyVersion: string; originalEvidenceRef: string; idempotencyKey: string }): Promise<{ outcome: "allowed" | "blocked"; currentPolicyVersion: string; evidenceRef: string; safeExplanation: string }>;
}

export const FAIL_CLOSED_SAFETY_REVALIDATION: GovernanceSafetyRevalidationPort = {
  revalidate: async () => ({ outcome: "blocked", currentPolicyVersion: "unconfigured", evidenceRef: "revalidation-unavailable", safeExplanation: "Current-policy revalidation is unavailable." }),
};

function audit(appeal: GovernanceResource, outcome: GovernanceAuditEvent["outcome"], now: Date): GovernanceAuditEvent {
  return { schema: "workspace-audit-event/v1", id: `audit_${randomUUID().replaceAll("-", "")}`, workspaceId: appeal.workspaceId, actor: { kind: "system", id: null }, capability: "safety.appeals.revalidate@1", action: "revalidate_exact_intent", resource: { kind: appeal.kind, id: appeal.id }, outcome, redactedDetails: {}, occurredAt: now };
}

export class GovernanceSafetyAppealWorker {
  constructor(private readonly repository: GovernanceRepository, private readonly revalidation: GovernanceSafetyRevalidationPort = FAIL_CLOSED_SAFETY_REVALIDATION, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  async process(input: { workspaceId: string; appealId: string }): Promise<void> {
    const found = await this.repository.getResource<{ decisionId: string; intentRef: string; outcome: string; currentRevalidationRequired: boolean; canResume: boolean; lease?: SafetyLease | null; [key: string]: unknown }>({ workspaceId: input.workspaceId, kind: "safety_appeal", id: input.appealId });
    if (!found || !["revalidation_queued", "revalidation_running"].includes(found.status)) return;
    const appeal = await this.claim(found);
    if (!appeal) return;
    const decision = await this.repository.getResource<{ intentRef: string; policyVersion: string; evidenceRef: string; [key: string]: unknown }>({ workspaceId: input.workspaceId, kind: "safety_decision", id: appeal.body.decisionId });
    if (!decision || decision.body.intentRef !== appeal.body.intentRef) throw new Error("Safety appeal lost its exact-intent decision binding.");
    const now = this.clock.now();
    let result;
    try {
      result = await this.revalidation.revalidate({ workspaceId: input.workspaceId, intentRef: appeal.body.intentRef, originalDecisionId: decision.id, originalPolicyVersion: decision.body.policyVersion, originalEvidenceRef: decision.body.evidenceRef, idempotencyKey: `${appeal.id}:${decision.id}` });
    } catch {
      result = { outcome: "blocked" as const, currentPolicyVersion: "unavailable", evidenceRef: "revalidation-transport-failed", safeExplanation: "Current-policy revalidation could not be completed." };
    }
    const allowed = result.outcome === "allowed";
    const nextAppeal: GovernanceResource = { ...appeal, version: appeal.version + 1, status: allowed ? "revalidated_allowed" : "resolved_upheld", body: { ...appeal.body, lease: null, outcome: allowed ? "reevaluated_allowed" : "upheld", currentRevalidationRequired: false, canResume: allowed, revalidation: { ...result, revalidatedAt: now.toISOString(), exactIntentRef: appeal.body.intentRef } }, updatedAt: now };
    const mutations: Parameters<GovernanceRepository["commit"]>[0]["mutations"] = [{ type: "update", expectedVersion: appeal.version, resource: nextAppeal }];
    if (allowed) mutations.push({ type: "update", expectedVersion: decision.version, resource: { ...decision, version: decision.version + 1, status: "superseded_after_revalidation", body: { ...decision.body, resumeAuthorizedByAppealId: appeal.id, currentPolicyVersion: result.currentPolicyVersion, currentPolicyEvidenceRef: result.evidenceRef }, updatedAt: now } });
    const committed = await this.repository.commit({ receipt: { workspaceId: input.workspaceId, capability: "safety.appeals.revalidate@1", idempotencyKey: `appeal-revalidation-${appeal.id}-${appeal.version}`, requestDigest: canonicalDigest({ appealId: appeal.id, version: appeal.version, result }), result: { appealId: appeal.id, status: nextAppeal.status, canResume: allowed }, createdAt: now }, mutations, audit: audit(appeal, allowed ? "completed" : "denied", now) });
    if (committed.type === "conflict") throw new Error("Safety appeal changed during revalidation.");
  }

  async recoverExpired(input: { workspaceId: string }): Promise<number> {
    const now = this.clock.now();
    const appeals = (await this.repository.listResources<{ lease?: SafetyLease | null }>({ workspaceId: input.workspaceId, kinds: ["safety_appeal"] }))
      .filter((item) => item.status === "revalidation_running" && (!item.body.lease || new Date(item.body.lease.expiresAt) <= now));
    for (const appeal of appeals) await this.process({ workspaceId: input.workspaceId, appealId: appeal.id });
    return appeals.length;
  }

  private async claim(appeal: GovernanceResource<{ lease?: SafetyLease | null; [key: string]: unknown }>) {
    const now = this.clock.now();
    if (appeal.status === "revalidation_running" && appeal.body.lease && new Date(appeal.body.lease.expiresAt) > now) return null;
    const lease: SafetyLease = { id: `lease_${randomUUID().replaceAll("-", "")}`, fence: (appeal.body.lease?.fence ?? 0) + 1, expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString() };
    const next = { ...appeal, version: appeal.version + 1, status: "revalidation_running", body: { ...appeal.body, lease }, updatedAt: now };
    const committed = await this.repository.commit({ receipt: { workspaceId: appeal.workspaceId, capability: "safety.appeals.claim@1", idempotencyKey: `appeal-claim-${appeal.id}-${appeal.version}-${lease.id}`, requestDigest: canonicalDigest({ id: appeal.id, version: appeal.version, lease }), result: { appealId: appeal.id, lease }, createdAt: now }, mutations: [{ type: "update", expectedVersion: appeal.version, resource: next }], audit: audit(appeal, "accepted", now) });
    return committed.type === "committed" ? next : null;
  }
}

interface SafetyLease { id: string; fence: number; expiresAt: string }
