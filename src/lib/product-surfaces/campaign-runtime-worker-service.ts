import { randomUUID } from "node:crypto";
import type { BlitzReplenisher } from "./blitz-replenisher";
import type { CampaignOccurrenceScheduler, ScheduledCampaignSnapshot } from "./campaign-scheduler";
import { campaignScheduleSnapshots } from "./campaign-scheduler";
import { campaignPayloadSchema } from "./definitions";

export interface CampaignRuntimeRecord {
  workspaceId: string; id: string; state: string; revision: number; payload: unknown; updatedByUserId: string;
}

export interface CampaignRuntimeScheduleStore {
  schedule(workspaceId: string, plans: ScheduledCampaignSnapshot[]): Promise<{ inserted: number; replayed: number }>;
  markStaleSubmissionsUnknown(input: { before: Date; now: Date; limit?: number }): Promise<number>;
  reconcileWorkflowRuns(input: { now: Date; limit?: number }): Promise<number>;
}

function localDateKey(at: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export class ProductCampaignRuntimeWorker {
  constructor(
    private readonly scheduleStore: CampaignRuntimeScheduleStore,
    private readonly scheduler: Pick<CampaignOccurrenceScheduler, "processDue">,
    private readonly replenisher: Pick<BlitzReplenisher, "replenish">,
    private readonly clock: () => Date,
    private readonly campaignPage: (at: Date) => Promise<CampaignRuntimeRecord[]>,
  ) {}

  async run(input: { workerId: string }) {
    const now = this.clock(); const campaigns = await this.campaignPage(now);
    const summary = { scanned: campaigns.length, scheduled: 0, scheduleReplayed: 0, replenished: 0, campaignFailures: 0, staleUnknown: 0, reconciled: 0, occurrences: { claimed: 0, started: 0, denied: 0, outcomeUnknown: 0 } };
    for (const row of campaigns) {
      try {
        const campaign = campaignPayloadSchema.parse(row.payload); const authority = campaign.runtime?.scheduleAuthority;
        if (!authority) throw new Error("CAMPAIGN_SCHEDULE_AUTHORITY_MISSING");
        const plans = campaignScheduleSnapshots({ workspaceId: row.workspaceId, campaign: { id: row.id, revision: row.revision, state: row.state, payload: campaign }, actor: authority, from: new Date(now.getTime() + 1_000), through: new Date(now.getTime() + 14 * 86_400_000) });
        const scheduled = await this.scheduleStore.schedule(row.workspaceId, plans); summary.scheduled += scheduled.inserted; summary.scheduleReplayed += scheduled.replayed;
        if (campaign.execution.replenishmentMode === "daily") {
          const result = await this.replenisher.replenish({ workspaceId: row.workspaceId, campaignId: row.id, invocation: "daily", actorUserId: row.updatedByUserId, sourceKey: `campaign-blitz:daily:${row.id}:${localDateKey(now, campaign.cadence.timezone)}` });
          if (result.kind === "completed") summary.replenished += result.created;
        }
      } catch { summary.campaignFailures++; }
    }
    summary.staleUnknown = await this.scheduleStore.markStaleSubmissionsUnknown({ before: new Date(now.getTime() - 5 * 60_000), now, limit: 50 });
    summary.reconciled = await this.scheduleStore.reconcileWorkflowRuns({ now, limit: 50 });
    summary.occurrences = await this.scheduler.processDue({ workerId: `${input.workerId}:${randomUUID()}`, limit: 20 });
    return summary;
  }
}
