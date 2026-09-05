import "server-only";
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  credentialProfiles,
  credentialSecurityEvents,
  generationCreditBuckets,
  runtimePublishingApprovalDecisions,
  runtimePublishingApprovalRequests,
  runtimePublishingDeliveries,
  runtimePublishingDeliveryEvents,
  socialAccounts,
  socialEvents,
  workspaceNotificationCreditStates,
} from "@/lib/db/schema";
import type { WorkspaceNotificationEventType } from "@/i18n/notifications";
import { WorkspaceNotificationService, type WorkspaceNotificationInput } from "./service";

type Db = ReturnType<typeof getDb>;
type ProjectionSummary = { inspected: number; recorded: number; recipientsCreated: number; failed: number };
type CredentialEventType = "profile.created" | "profile.reprovisioned" | "profile.rotated" | "version.revoked" | "profile.status_changed" | "spend_grant.created" | "spend_grant.revoked";
const CREDENTIAL_EVENT_TYPES: CredentialEventType[] = ["profile.created", "profile.reprovisioned", "profile.rotated", "version.revoked", "profile.status_changed", "spend_grant.created", "spend_grant.revoked"];
const SOCIAL_EVENT_TYPES = ["account.reauth_required", "post.failed", "dispatch.failed"] as const;
const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60_000;
const CREDIT_WARNING_THRESHOLD = 10;

export class WorkspaceNotificationProjector {
  constructor(private readonly database: Db = getDb(), private readonly notifications = new WorkspaceNotificationService(database), private readonly now = () => new Date()) {}

  async project(limit = 50) {
    let remaining = Math.min(Math.max(Number.isInteger(limit) ? limit : 50, 1), 100);
    const summary: ProjectionSummary = { inspected: 0, recorded: 0, recipientsCreated: 0, failed: 0 };
    const projections = [
      () => this.projectCredentialEvents(remaining, summary),
      () => this.projectChannelConsent(remaining, summary),
      () => this.projectSocialEvents(remaining, summary),
      () => this.projectApprovalRequests(remaining, summary),
      () => this.projectApprovalDecisions(remaining, summary),
      () => this.projectDeliveryEvents(remaining, summary),
      () => this.projectCreditStates(remaining, summary),
    ];
    for (const project of projections) {
      if (remaining <= 0) break;
      const inspected = await project();
      remaining -= inspected;
    }
    return summary;
  }

  private async projectCredentialEvents(limit: number, summary: ProjectionSummary) {
    const rows = await this.database.select({ event: credentialSecurityEvents, profileName: credentialProfiles.name, provider: credentialProfiles.provider }).from(credentialSecurityEvents).leftJoin(credentialProfiles, and(eq(credentialProfiles.workspaceId, credentialSecurityEvents.workspaceId), eq(credentialProfiles.id, credentialSecurityEvents.profileId))).where(and(inArray(credentialSecurityEvents.eventType, CREDENTIAL_EVENT_TYPES), sql`not exists (select 1 from workspace_notification_events n where n.workspace_id = ${credentialSecurityEvents.workspaceId} and n.source_ref = 'credential-security:' || ${credentialSecurityEvents.id})`)).orderBy(asc(credentialSecurityEvents.createdAt), asc(credentialSecurityEvents.id)).limit(limit);
    await this.recordRows(rows.map(({ event, profileName, provider }) => {
      const policy = credentialNotificationPolicy(event.eventType as CredentialEventType, stringDetail(event.details, "status"));
      return { workspaceId: event.workspaceId, eventType: policy.eventType, sourceRef: `credential-security:${event.id}`, requiredPermission: "workspaces:write", severity: policy.severity, facts: { resourceName: profileName ?? event.profileId ?? event.spendGrantId ?? "credential", provider: provider ?? stringDetail(event.details, "provider") ?? "provider", change: policy.change, reference: event.id }, actionPath: "/studio/credentials", occurredAt: event.createdAt } satisfies WorkspaceNotificationInput;
    }), summary);
    return rows.length;
  }

  private async projectChannelConsent(limit: number, summary: ProjectionSummary) {
    const at = this.now();
    const rows = await this.database.select().from(socialAccounts).where(and(inArray(socialAccounts.platform, ["facebook", "instagram", "linkedin"]), eq(socialAccounts.disabled, false), eq(socialAccounts.requiresReauth, false), gt(socialAccounts.tokenExpiresAt, at), lte(socialAccounts.tokenExpiresAt, new Date(at.getTime() + EXPIRY_WARNING_MS)), sql`not exists (select 1 from workspace_notification_events n where n.workspace_id = ${socialAccounts.workspaceId} and n.source_ref = 'channel-consent:' || ${socialAccounts.id} || ':' || floor(extract(epoch from ${socialAccounts.tokenExpiresAt}) * 1000)::bigint::text)`)).orderBy(asc(socialAccounts.tokenExpiresAt), asc(socialAccounts.id)).limit(limit);
    await this.recordRows(rows.map((account) => ({ workspaceId: account.workspaceId, eventType: "channel.consent_expiring", sourceRef: `channel-consent:${account.id}:${account.tokenExpiresAt!.getTime()}`, requiredPermission: "social:manage", severity: "warning", facts: { channelName: account.displayName, platform: account.platform, expiresAt: account.tokenExpiresAt!.toISOString() }, actionPath: "/channels", occurredAt: at } satisfies WorkspaceNotificationInput)), summary);
    return rows.length;
  }

  private async projectSocialEvents(limit: number, summary: ProjectionSummary) {
    const rows = await this.database.select({ event: socialEvents, channelName: socialAccounts.displayName, platform: socialAccounts.platform }).from(socialEvents).leftJoin(socialAccounts, and(eq(socialAccounts.workspaceId, socialEvents.workspaceId), eq(socialAccounts.id, socialEvents.accountId))).where(and(eq(socialEvents.userFacing, true), inArray(socialEvents.eventType, [...SOCIAL_EVENT_TYPES]), sql`not exists (select 1 from workspace_notification_events n where n.workspace_id = ${socialEvents.workspaceId} and n.source_ref = 'social-event:' || ${socialEvents.id})`)).orderBy(asc(socialEvents.createdAt), asc(socialEvents.id)).limit(limit);
    await this.recordRows(rows.map(({ event, channelName, platform }): WorkspaceNotificationInput => event.eventType === "account.reauth_required"
      ? { workspaceId: event.workspaceId, eventType: "channel.reconnect_required", sourceRef: `social-event:${event.id}`, requiredPermission: "social:manage", severity: "critical", facts: { channelName: channelName ?? event.accountId ?? "channel", platform: platform ?? event.provider ?? "platform", expiresAt: null }, actionPath: "/channels", occurredAt: event.createdAt }
      : { workspaceId: event.workspaceId, eventType: "publishing.social_failed", sourceRef: `social-event:${event.id}`, requiredPermission: "social:view", severity: event.severity === "error" ? "critical" : "warning", facts: { reference: event.postId ?? event.dispatchKey ?? event.id, channel: platform ?? event.provider ?? "platform", failureCode: event.eventType === "post.failed" ? "POST_FAILED" : "DISPATCH_FAILED" }, actionPath: "/social/events", occurredAt: event.createdAt }), summary);
    return rows.length;
  }

  private async projectApprovalRequests(limit: number, summary: ProjectionSummary) {
    const rows = await this.database.select().from(runtimePublishingApprovalRequests).where(sql`not exists (select 1 from workspace_notification_events n where n.workspace_id = ${runtimePublishingApprovalRequests.workspaceId} and n.source_ref = 'publishing-approval-request:' || ${runtimePublishingApprovalRequests.id})`).orderBy(asc(runtimePublishingApprovalRequests.createdAt), asc(runtimePublishingApprovalRequests.id)).limit(limit);
    await this.recordRows(rows.map((request) => ({ workspaceId: request.workspaceId, eventType: "publishing.approval_requested", sourceRef: `publishing-approval-request:${request.id}`, requiredPermission: "social:manage", severity: "warning", facts: { requestId: request.id, targetCount: request.targetIds.length, channelCount: request.channelIds.length }, actionPath: "/studio/publishing-approvals", occurredAt: request.createdAt } satisfies WorkspaceNotificationInput)), summary);
    return rows.length;
  }

  private async projectApprovalDecisions(limit: number, summary: ProjectionSummary) {
    const rows = await this.database.select({ decision: runtimePublishingApprovalDecisions, request: runtimePublishingApprovalRequests }).from(runtimePublishingApprovalDecisions).innerJoin(runtimePublishingApprovalRequests, and(eq(runtimePublishingApprovalRequests.workspaceId, runtimePublishingApprovalDecisions.workspaceId), eq(runtimePublishingApprovalRequests.id, runtimePublishingApprovalDecisions.requestId))).where(sql`not exists (select 1 from workspace_notification_events n where n.workspace_id = ${runtimePublishingApprovalDecisions.workspaceId} and n.source_ref = 'publishing-approval-decision:' || ${runtimePublishingApprovalDecisions.id})`).orderBy(asc(runtimePublishingApprovalDecisions.decidedAt), asc(runtimePublishingApprovalDecisions.id)).limit(limit);
    await this.recordRows(rows.map(({ decision, request }) => ({ workspaceId: decision.workspaceId, eventType: decision.outcome === "approved" ? "publishing.approval_approved" : "publishing.approval_denied", sourceRef: `publishing-approval-decision:${decision.id}`, requiredPermission: "social:view", severity: decision.outcome === "approved" ? "info" : "warning", facts: { requestId: request.id, targetCount: request.targetIds.length, channelCount: request.channelIds.length }, actionPath: "/studio/publishing-approvals", occurredAt: decision.decidedAt } satisfies WorkspaceNotificationInput)), summary);
    return rows.length;
  }

  private async projectDeliveryEvents(limit: number, summary: ProjectionSummary) {
    const rows = await this.database.select({ event: runtimePublishingDeliveryEvents, delivery: runtimePublishingDeliveries }).from(runtimePublishingDeliveryEvents).innerJoin(runtimePublishingDeliveries, and(eq(runtimePublishingDeliveries.workspaceId, runtimePublishingDeliveryEvents.workspaceId), eq(runtimePublishingDeliveries.id, runtimePublishingDeliveryEvents.deliveryId))).where(and(inArray(runtimePublishingDeliveryEvents.type, ["publication.failed_terminal", "publication.outcome_unknown"]), sql`not exists (select 1 from workspace_notification_events n where n.workspace_id = ${runtimePublishingDeliveryEvents.workspaceId} and n.source_ref = 'publishing-delivery-event:' || ${runtimePublishingDeliveryEvents.id})`)).orderBy(asc(runtimePublishingDeliveryEvents.occurredAt), asc(runtimePublishingDeliveryEvents.id)).limit(limit);
    await this.recordRows(rows.map(({ event, delivery }) => ({ workspaceId: event.workspaceId, eventType: event.type === "publication.outcome_unknown" ? "publishing.delivery_outcome_unknown" : "publishing.delivery_failed", sourceRef: `publishing-delivery-event:${event.id}`, requiredPermission: "social:view", severity: event.type === "publication.outcome_unknown" ? "critical" : "warning", facts: { reference: delivery.id, channel: delivery.channelId, failureCode: delivery.failureCode ?? "UNKNOWN_FAILURE" }, actionPath: `/studio/publishing-deliveries/${delivery.id}`, occurredAt: event.occurredAt } satisfies WorkspaceNotificationInput)), summary);
    return rows.length;
  }

  private async projectCreditStates(limit: number, summary: ProjectionSummary) {
    const at = this.now();
    const available = sql<number>`coalesce(sum(case when ${generationCreditBuckets.expiresAt} is null or ${generationCreditBuckets.expiresAt} > ${at} then ${generationCreditBuckets.availableUnits} else 0 end), 0)`;
    const lastSequence = sql<number>`coalesce((select max(l.sequence) from generation_credit_ledger_entries l where l.workspace_id = ${generationCreditBuckets.workspaceId}), 0)`;
    const rows = await this.database.select({ workspaceId: generationCreditBuckets.workspaceId, availableUnits: available, lastLedgerSequence: lastSequence, storedState: workspaceNotificationCreditStates.balanceState, storedAvailable: workspaceNotificationCreditStates.availableUnits, storedThreshold: workspaceNotificationCreditStates.warningThreshold, storedEpisode: workspaceNotificationCreditStates.episode }).from(generationCreditBuckets).leftJoin(workspaceNotificationCreditStates, eq(workspaceNotificationCreditStates.workspaceId, generationCreditBuckets.workspaceId)).groupBy(generationCreditBuckets.workspaceId, workspaceNotificationCreditStates.workspaceId, workspaceNotificationCreditStates.balanceState, workspaceNotificationCreditStates.availableUnits, workspaceNotificationCreditStates.warningThreshold, workspaceNotificationCreditStates.episode).having(sql`${workspaceNotificationCreditStates.workspaceId} is null or ${workspaceNotificationCreditStates.availableUnits} <> ${available} or ${workspaceNotificationCreditStates.warningThreshold} <> ${CREDIT_WARNING_THRESHOLD} or ${workspaceNotificationCreditStates.lastLedgerSequence} <> ${lastSequence}`).orderBy(asc(generationCreditBuckets.workspaceId)).limit(limit);
    for (const row of rows) {
      summary.inspected += 1;
      try {
        const availableUnits = Number(row.availableUnits);
        const lastLedgerSequence = Number(row.lastLedgerSequence);
        const nextState = classifyCreditBalance(availableUnits, CREDIT_WARNING_THRESHOLD);
        const changed = row.storedState !== nextState;
        const episode = Number(row.storedEpisode ?? 0) + (changed ? 1 : 0);
        if (changed && nextState !== "healthy") {
          const eventType: WorkspaceNotificationEventType = nextState === "exhausted" ? "credits.exhausted" : "credits.low";
          const result = await this.notifications.recordEvent({ workspaceId: row.workspaceId, eventType, sourceRef: `credit-balance:${nextState}:${episode}`, requiredPermission: "product:billing:read", severity: nextState === "exhausted" ? "critical" : "warning", facts: { availableCredits: availableUnits, warningThreshold: CREDIT_WARNING_THRESHOLD }, actionPath: "/billing", occurredAt: at });
          summary.recorded += 1;
          summary.recipientsCreated += result.recipientsCreated;
        }
        await this.database.insert(workspaceNotificationCreditStates).values({ workspaceId: row.workspaceId, balanceState: nextState, availableUnits, warningThreshold: CREDIT_WARNING_THRESHOLD, episode, lastLedgerSequence, updatedAt: at }).onConflictDoUpdate({ target: workspaceNotificationCreditStates.workspaceId, set: { balanceState: nextState, availableUnits, warningThreshold: CREDIT_WARNING_THRESHOLD, episode, lastLedgerSequence, updatedAt: at } });
      } catch { summary.failed += 1; }
    }
    return rows.length;
  }

  private async recordRows(rows: WorkspaceNotificationInput[], summary: ProjectionSummary) {
    for (const row of rows) {
      summary.inspected += 1;
      try {
        const result = await this.notifications.recordEvent(row);
        summary.recorded += 1;
        summary.recipientsCreated += result.recipientsCreated;
      } catch { summary.failed += 1; }
    }
  }
}

export function credentialNotificationPolicy(eventType: CredentialEventType, status: string | null): { eventType: WorkspaceNotificationEventType; severity: "info" | "warning" | "critical"; change: string } {
  if (eventType === "profile.created" || eventType === "profile.reprovisioned") return { eventType: "security.credential_created", severity: eventType === "profile.created" ? "info" : "warning", change: eventType === "profile.created" ? "created" : "reprovisioned" };
  if (eventType === "profile.rotated") return { eventType: "security.credential_rotated", severity: "warning", change: "rotated" };
  if (eventType === "version.revoked") return { eventType: "security.credential_revoked", severity: "critical", change: "revoked" };
  if (eventType === "profile.status_changed") return { eventType: "security.credential_status_changed", severity: status === "disabled" ? "critical" : "info", change: status === "disabled" ? "disabled" : "enabled" };
  return { eventType: "security.spend_authority_changed", severity: eventType === "spend_grant.revoked" ? "critical" : "warning", change: eventType === "spend_grant.revoked" ? "revoked" : "created" };
}

export function classifyCreditBalance(availableUnits: number, threshold = CREDIT_WARNING_THRESHOLD): "healthy" | "low" | "exhausted" {
  if (!Number.isSafeInteger(availableUnits) || availableUnits < 0 || !Number.isSafeInteger(threshold) || threshold < 1) throw new Error("CREDIT_NOTIFICATION_BALANCE_INVALID");
  return availableUnits === 0 ? "exhausted" : availableUnits <= threshold ? "low" : "healthy";
}

function stringDetail(details: Record<string, string | number | boolean | null>, key: string): string | null { return typeof details[key] === "string" ? details[key] as string : null; }
