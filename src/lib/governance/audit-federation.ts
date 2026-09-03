import { and, desc, eq, sql, type SQLWrapper } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { agentSecurityEvents, credentialEffectAuditEvents, credentialSecurityEvents, runtimeBudgetReservationEvents, runtimePublishingDeliveryEvents, runtimeSupportBundleAccessAudits, runtimeUsageMeteringEvents, socialEvents, workflowRunEvents } from "@/lib/db/schema";
import type { GovernanceAuditEvent } from "./types";

export interface GovernanceAuditFederationPort {
  list(input: {
    workspaceId: string;
    limit: number;
    before?: { occurredAt: Date; id: string };
  }): Promise<GovernanceAuditEvent[]>;
}

export const EMPTY_GOVERNANCE_AUDIT_FEDERATION: GovernanceAuditFederationPort = { list: async () => [] };
type Db = ReturnType<typeof getDb>;

function event(input: { workspaceId: string; source: string; id: string; action: string; capability: string; actorUserId?: string | null; principalId?: string | null; resourceKind: string; resourceId: string; outcome: GovernanceAuditEvent["outcome"]; occurredAt: Date; details?: Record<string, unknown> }): GovernanceAuditEvent {
  return { schema: "workspace-audit-event/v1", id: `federated:${input.source}:${input.id}`, workspaceId: input.workspaceId, actor: input.actorUserId ? { kind: "human", id: input.actorUserId } : { kind: "system", id: input.principalId ?? null }, capability: input.capability, action: input.action, resource: { kind: input.resourceKind, id: input.resourceId }, outcome: input.outcome, redactedDetails: { source: input.source, ...(input.details ?? {}) }, occurredAt: input.occurredAt };
}

function beforeCursor(
  occurredAt: SQLWrapper,
  id: SQLWrapper,
  source: string,
  before: { occurredAt: Date; id: string } | undefined,
) {
  if (!before) return undefined;
  const idPrefix = `federated:${source}:`;
  // PostgreSQL row comparison gives the same strict, stable ordering used by
  // the merged customer audit timeline, including timestamp ties.
  return sql`(${occurredAt}, ${idPrefix} || ${id}) < (${before.occurredAt}, ${before.id})`;
}

/** Read-only federation over authoritative append-only domain ledgers. Only
 * allowlisted non-secret columns are projected into the customer audit view. */
export class DrizzleGovernanceAuditFederation implements GovernanceAuditFederationPort {
  constructor(private readonly database: () => Db) {}

  async list(input: { workspaceId: string; limit: number; before?: { occurredAt: Date; id: string } }) {
    const perSource = Math.min(Math.max(input.limit, 1), 10_000);
    const db = this.database();
    const [agents, credentialSecurity, credentialEffects, budgets, usage, runs, deliveries, social, support] = await Promise.all([
      db.select({ id: agentSecurityEvents.id, actorUserId: agentSecurityEvents.actorUserId, principalId: agentSecurityEvents.principalId, eventType: agentSecurityEvents.eventType, capabilityName: agentSecurityEvents.capabilityName, capabilityVersion: agentSecurityEvents.capabilityVersion, reason: agentSecurityEvents.reason, createdAt: agentSecurityEvents.createdAt }).from(agentSecurityEvents).where(and(eq(agentSecurityEvents.workspaceId, input.workspaceId), beforeCursor(agentSecurityEvents.createdAt, agentSecurityEvents.id, "agent_security", input.before))).orderBy(desc(agentSecurityEvents.createdAt), desc(agentSecurityEvents.id)).limit(perSource),
      db.select({ id: credentialSecurityEvents.id, actorUserId: credentialSecurityEvents.actorUserId, principalId: credentialSecurityEvents.principalId, eventType: credentialSecurityEvents.eventType, profileId: credentialSecurityEvents.profileId, createdAt: credentialSecurityEvents.createdAt }).from(credentialSecurityEvents).where(and(eq(credentialSecurityEvents.workspaceId, input.workspaceId), beforeCursor(credentialSecurityEvents.createdAt, credentialSecurityEvents.id, "credential_security", input.before))).orderBy(desc(credentialSecurityEvents.createdAt), desc(credentialSecurityEvents.id)).limit(perSource),
      db.select({ id: credentialEffectAuditEvents.id, principalId: credentialEffectAuditEvents.principalId, eventType: credentialEffectAuditEvents.eventType, effectRef: credentialEffectAuditEvents.effectRef, failureCode: credentialEffectAuditEvents.failureCode, createdAt: credentialEffectAuditEvents.createdAt }).from(credentialEffectAuditEvents).where(and(eq(credentialEffectAuditEvents.workspaceId, input.workspaceId), beforeCursor(credentialEffectAuditEvents.createdAt, credentialEffectAuditEvents.id, "credential_effect", input.before))).orderBy(desc(credentialEffectAuditEvents.createdAt), desc(credentialEffectAuditEvents.id)).limit(perSource),
      db.select({ id: runtimeBudgetReservationEvents.id, eventType: runtimeBudgetReservationEvents.eventType, reservationId: runtimeBudgetReservationEvents.reservationId, runId: runtimeBudgetReservationEvents.runId, amount: runtimeBudgetReservationEvents.amount, currency: runtimeBudgetReservationEvents.currency, occurredAt: runtimeBudgetReservationEvents.occurredAt }).from(runtimeBudgetReservationEvents).where(and(eq(runtimeBudgetReservationEvents.workspaceId, input.workspaceId), beforeCursor(runtimeBudgetReservationEvents.occurredAt, runtimeBudgetReservationEvents.id, "budget", input.before))).orderBy(desc(runtimeBudgetReservationEvents.occurredAt), desc(runtimeBudgetReservationEvents.id)).limit(perSource),
      db.select({ id: runtimeUsageMeteringEvents.id, principalId: runtimeUsageMeteringEvents.principalId, eventType: runtimeUsageMeteringEvents.eventType, runId: runtimeUsageMeteringEvents.runId, occurredAt: runtimeUsageMeteringEvents.occurredAt }).from(runtimeUsageMeteringEvents).where(and(eq(runtimeUsageMeteringEvents.workspaceId, input.workspaceId), beforeCursor(runtimeUsageMeteringEvents.occurredAt, runtimeUsageMeteringEvents.id, "usage", input.before))).orderBy(desc(runtimeUsageMeteringEvents.occurredAt), desc(runtimeUsageMeteringEvents.id)).limit(perSource),
      db.select({ id: workflowRunEvents.id, runId: workflowRunEvents.runId, type: workflowRunEvents.type, occurredAt: workflowRunEvents.occurredAt }).from(workflowRunEvents).where(and(eq(workflowRunEvents.workspaceId, input.workspaceId), beforeCursor(workflowRunEvents.occurredAt, workflowRunEvents.id, "generation", input.before))).orderBy(desc(workflowRunEvents.occurredAt), desc(workflowRunEvents.id)).limit(perSource),
      db.select({ id: runtimePublishingDeliveryEvents.id, deliveryId: runtimePublishingDeliveryEvents.deliveryId, type: runtimePublishingDeliveryEvents.type, occurredAt: runtimePublishingDeliveryEvents.occurredAt }).from(runtimePublishingDeliveryEvents).where(and(eq(runtimePublishingDeliveryEvents.workspaceId, input.workspaceId), beforeCursor(runtimePublishingDeliveryEvents.occurredAt, runtimePublishingDeliveryEvents.id, "publishing_delivery", input.before))).orderBy(desc(runtimePublishingDeliveryEvents.occurredAt), desc(runtimePublishingDeliveryEvents.id)).limit(perSource),
      db.select({ id: socialEvents.id, eventType: socialEvents.eventType, postId: socialEvents.postId, accountId: socialEvents.accountId, createdByUserId: socialEvents.createdByUserId, createdAt: socialEvents.createdAt }).from(socialEvents).where(and(eq(socialEvents.workspaceId, input.workspaceId), beforeCursor(socialEvents.createdAt, socialEvents.id, "social", input.before))).orderBy(desc(socialEvents.createdAt), desc(socialEvents.id)).limit(perSource),
      db.select({ id: runtimeSupportBundleAccessAudits.id, bundleId: runtimeSupportBundleAccessAudits.bundleId, operatorId: runtimeSupportBundleAccessAudits.operatorId, outcome: runtimeSupportBundleAccessAudits.outcome, occurredAt: runtimeSupportBundleAccessAudits.occurredAt }).from(runtimeSupportBundleAccessAudits).where(and(eq(runtimeSupportBundleAccessAudits.workspaceId, input.workspaceId), beforeCursor(runtimeSupportBundleAccessAudits.occurredAt, runtimeSupportBundleAccessAudits.id, "support_access", input.before))).orderBy(desc(runtimeSupportBundleAccessAudits.occurredAt), desc(runtimeSupportBundleAccessAudits.id)).limit(perSource),
    ]);
    const events: GovernanceAuditEvent[] = [
      ...agents.map((row) => event({ workspaceId: input.workspaceId, source: "agent_security", id: row.id, action: row.eventType, capability: `${row.capabilityName}@${row.capabilityVersion}`, actorUserId: row.actorUserId, principalId: row.principalId, resourceKind: "agent_principal", resourceId: row.principalId ?? row.id, outcome: row.eventType.endsWith("denied") ? "denied" : "completed", occurredAt: row.createdAt, details: { reason: row.reason } })),
      ...credentialSecurity.map((row) => event({ workspaceId: input.workspaceId, source: "credential_security", id: row.id, action: row.eventType, capability: "credential_profiles.audit@1", actorUserId: row.actorUserId, principalId: row.principalId, resourceKind: "credential_profile", resourceId: row.profileId ?? row.id, outcome: "completed", occurredAt: row.createdAt })),
      ...credentialEffects.map((row) => event({ workspaceId: input.workspaceId, source: "credential_effect", id: row.id, action: row.eventType, capability: "provider_effects.audit@1", principalId: row.principalId, resourceKind: "provider_effect", resourceId: row.effectRef, outcome: row.failureCode ? "failed" : "completed", occurredAt: row.createdAt, details: { failureCode: row.failureCode } })),
      ...budgets.map((row) => event({ workspaceId: input.workspaceId, source: "budget", id: row.id, action: row.eventType, capability: "budgets.audit@1", resourceKind: "budget_reservation", resourceId: row.reservationId, outcome: row.eventType === "outcome_unknown" ? "failed" : "completed", occurredAt: row.occurredAt, details: { runId: row.runId, amount: row.amount, currency: row.currency } })),
      ...usage.map((row) => event({ workspaceId: input.workspaceId, source: "usage", id: row.id, action: row.eventType, capability: "usage.audit@1", principalId: row.principalId, resourceKind: "workflow_run", resourceId: row.runId, outcome: "completed", occurredAt: row.occurredAt })),
      ...runs.map((row) => event({ workspaceId: input.workspaceId, source: "generation", id: row.id, action: row.type, capability: "workflow_runs.audit@1", resourceKind: "workflow_run", resourceId: row.runId, outcome: row.type.includes("failed") ? "failed" : "completed", occurredAt: row.occurredAt })),
      ...deliveries.map((row) => event({ workspaceId: input.workspaceId, source: "publishing_delivery", id: row.id, action: row.type, capability: "publishing_deliveries.audit@1", resourceKind: "publishing_delivery", resourceId: row.deliveryId, outcome: row.type.includes("failed") ? "failed" : "completed", occurredAt: row.occurredAt })),
      ...social.map((row) => event({ workspaceId: input.workspaceId, source: "social", id: row.id, action: row.eventType, capability: "social.audit@1", actorUserId: row.createdByUserId, resourceKind: row.postId ? "social_post" : "channel", resourceId: row.postId ?? row.accountId ?? row.id, outcome: row.eventType.includes("failed") ? "failed" : "completed", occurredAt: row.createdAt })),
      ...support.map((row) => event({ workspaceId: input.workspaceId, source: "support_access", id: row.id, action: `support_access.${row.outcome}`, capability: "support_bundles.audit@1", resourceKind: "support_bundle", resourceId: row.bundleId, outcome: row.outcome === "granted" ? "completed" : "denied", occurredAt: row.occurredAt, details: { operatorId: row.operatorId } })),
    ];
    return events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id)).slice(0, input.limit);
  }
}
