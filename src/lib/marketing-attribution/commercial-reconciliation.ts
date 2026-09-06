import "server-only";

import { sql } from "drizzle-orm";
import type { XAdsAttributionConfig } from "./config";
import { evaluateXAdsAttributionReadiness } from "./config";
import { getDb } from "@/lib/db";
import type { MarketingAttributionService } from "./service";
import type { MarketingAttributionEventName } from "./types";

const DAY = 86_400_000;

export interface MarketingAttributionCommercialSource {
  workspaceId: string;
  userId: string;
  email: string;
  eventName: Extract<MarketingAttributionEventName, "trial_started" | "purchase">;
  occurredAt: Date;
  value: string | null;
  currency: string | null;
  idempotencyKey: string;
}

export interface MarketingAttributionCommercialSourcePort {
  listEligible(input: { now: Date; oldestAt: Date; noticeVersion: string; regionReviewVersion: string; limit: number }): Promise<MarketingAttributionCommercialSource[]>;
}

type Db = ReturnType<typeof getDb>;

/**
 * Reads only durable commercial facts whose latest consent was already active
 * when the fact occurred. A missing mutation receipt means the immediate
 * best-effort producer did not durably enqueue the conversion.
 */
export class PostgresMarketingAttributionCommercialSourceRepository implements MarketingAttributionCommercialSourcePort {
  constructor(private readonly database: Db = getDb()) {}

  async listEligible(input: { now: Date; oldestAt: Date; noticeVersion: string; regionReviewVersion: string; limit: number }): Promise<MarketingAttributionCommercialSource[]> {
    const result = await this.database.execute<{
      workspaceId: string;
      userId: string;
      email: string;
      eventName: "trial_started" | "purchase";
      occurredAt: Date | string;
      value: string | null;
      currency: string | null;
      idempotencyKey: string;
    }>(sql`
      with latest_consent as (
        select distinct on (workspace_id, user_id)
          workspace_id, user_id, status, notice_version,
          region_review_version, issued_at, expires_at
        from marketing_attribution_consents
        where provider = 'x_ads'
        order by workspace_id, user_id, revision desc
      ), eligible_sources as (
        select
          event.workspace_id as "workspaceId",
          substring(event.actor_ref from 7) as "userId",
          identity.email as "email",
          'trial_started'::text as "eventName",
          event.occurred_at as "occurredAt",
          null::text as "value",
          null::text as "currency",
          'xads:trial:' || event.id as "idempotencyKey"
        from workspace_subscription_events event
        join latest_consent consent
          on consent.workspace_id = event.workspace_id
         and consent.user_id = substring(event.actor_ref from 7)
        join "user" identity on identity.id = substring(event.actor_ref from 7)
        left join marketing_attribution_mutation_receipts receipt
          on receipt.workspace_id = event.workspace_id
         and receipt.idempotency_key = 'xads:trial:' || event.id
        where event.reason_code = 'trial.started'
          and event.actor_ref like 'human:%'
          and event.occurred_at >= ${input.oldestAt}
          and event.occurred_at <= ${input.now}
          and consent.status = 'active'
          and consent.notice_version = ${input.noticeVersion}
          and consent.region_review_version = ${input.regionReviewVersion}
          and consent.expires_at > ${input.now}
          and event.occurred_at >= consent.issued_at
          and receipt.idempotency_key is null

        union all

        select
          checkout.workspace_id as "workspaceId",
          checkout.created_by_user_id as "userId",
          identity.email as "email",
          'purchase'::text as "eventName",
          webhook.provider_occurred_at as "occurredAt",
          to_char(checkout.amount_minor::numeric / 100, 'FM999999990.00') as "value",
          upper(checkout.currency) as "currency",
          'xads:purchase:' || webhook.provider || ':' || webhook.event_id as "idempotencyKey"
        from merchant_webhook_receipts webhook
        join merchant_checkout_sessions checkout on checkout.id = webhook.checkout_id
        join latest_consent consent
          on consent.workspace_id = checkout.workspace_id
         and consent.user_id = checkout.created_by_user_id
        join "user" identity on identity.id = checkout.created_by_user_id
        left join marketing_attribution_mutation_receipts receipt
          on receipt.workspace_id = checkout.workspace_id
         and receipt.idempotency_key = 'xads:purchase:' || webhook.provider || ':' || webhook.event_id
        where webhook.event_type = 'checkout.completed'
          and webhook.state = 'applied'
          and checkout.state = 'completed'
          and webhook.provider_occurred_at >= ${input.oldestAt}
          and webhook.provider_occurred_at <= ${input.now}
          and consent.status = 'active'
          and consent.notice_version = ${input.noticeVersion}
          and consent.region_review_version = ${input.regionReviewVersion}
          and consent.expires_at > ${input.now}
          and webhook.provider_occurred_at >= consent.issued_at
          and receipt.idempotency_key is null
      )
      select * from eligible_sources
      order by "occurredAt", "idempotencyKey"
      limit ${input.limit}
    `);
    return result.rows.map((row) => ({ ...row, occurredAt: new Date(row.occurredAt) }));
  }
}

export class MarketingAttributionCommercialReconciler {
  constructor(
    private readonly sources: MarketingAttributionCommercialSourcePort,
    private readonly service: Pick<MarketingAttributionService, "enqueue">,
    private readonly config: XAdsAttributionConfig,
  ) {}

  async reconcile(limit = 100, now = new Date()) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TypeError("ATTRIBUTION_RECONCILIATION_LIMIT_INVALID");
    const readiness = evaluateXAdsAttributionReadiness(this.config);
    if (!readiness.available) return { eligible: 0, queued: 0, replayed: 0, noLongerEligible: 0, failed: 0, skipped: "ATTRIBUTION_NOT_CONFIGURED" as string | null };
    const sources = await this.sources.listEligible({ now, oldestAt: new Date(now.getTime() - 7 * DAY), noticeVersion: this.config.noticeVersion, regionReviewVersion: this.config.regionReviewVersion, limit });
    const summary = { eligible: sources.length, queued: 0, replayed: 0, noLongerEligible: 0, failed: 0, skipped: null as string | null };
    for (const source of sources) {
      try {
        const result = await this.service.enqueue({ ...source, value: source.value ?? undefined, currency: source.currency ?? undefined, now });
        if (result.replayed) summary.replayed += 1; else summary.queued += 1;
      } catch (error) {
        if (error instanceof TypeError && ["ATTRIBUTION_CONSENT_REQUIRED", "ATTRIBUTION_EVENT_TIME_INVALID", "ATTRIBUTION_IDENTIFIER_REQUIRED"].includes(error.message)) summary.noLongerEligible += 1;
        else summary.failed += 1;
      }
    }
    return summary;
  }
}
