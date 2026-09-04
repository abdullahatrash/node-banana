import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { RunAdmissionPreview } from "@/lib/agent-runtime/budgets/types";
import type { WorkflowRunAcceptedDto } from "@/lib/agent-runtime/runs/types";
import { campaignPayloadSchema } from "./definitions";
import { issueCampaignAcceptedQuote, type CampaignQuoteCodec } from "./campaign-quote";
import { planCampaignOccurrences } from "./campaign-schedule-policy";

export interface ScheduledCampaignSnapshot {
  workspaceId: string;
  campaignId: string;
  campaignRevision: number;
  campaignDigest: string;
  scheduledAt: Date;
  occurrenceKey: string;
  format: string;
  timezone: string;
  channels: string[];
  approvalMode: "request_human" | "evaluate_policy";
  autoPublishGrantId: string | null;
  fundingMode: "byok" | "managed";
  budgetCeilingCents: number;
  creditCeiling: number;
  workflow: { workflowId: string; workflowRevisionId: string; inputs: Record<string, string>; inputArtifactIds: string[] };
  actor: { principalId: string; keyId: string; authorizationEvidenceRef: string };
}

export interface ClaimedCampaignOccurrence extends ScheduledCampaignSnapshot { id: string; leaseToken: string }

export interface CampaignSchedulerRepository {
  schedule(workspaceId: string, plans: ScheduledCampaignSnapshot[]): Promise<{ inserted: number; replayed: number }>;
  cancelFuture(workspaceId: string, campaignId: string, after: Date): Promise<number>;
  claimDue(input: { workerId: string; now: Date; leaseUntil: Date; limit: number }): Promise<ClaimedCampaignOccurrence[]>;
  markSubmitting(input: { occurrence: ClaimedCampaignOccurrence; now: Date }): Promise<boolean>;
  bindRun(input: { occurrence: ClaimedCampaignOccurrence; runId: string; startSnapshotDigest: string; quoteId: string; quotedAmount: string; currency: string; acceptedAt: Date }): Promise<void>;
  fail(input: { occurrence: ClaimedCampaignOccurrence; code: string; outcomeUnknown: boolean; now: Date }): Promise<void>;
}

export interface ScheduledCampaignWorkflowRuntime {
  preview(input: { workspaceId: string; workflowId: string; revisionId: string; inputs: Record<string, unknown>; principalId: string; inputArtifactIds: string[] }): Promise<RunAdmissionPreview>;
  start(input: { workspaceId: string; workflowId: string; revisionId: string; inputs: Record<string, unknown>; principalId: string; keyId: string; authorizationEvidenceRef: string; idempotencyKey: string; inputArtifactIds: string[]; capability: "workflow_runs.start@2"; acceptedSpendQuoteRef: string }): Promise<WorkflowRunAcceptedDto>;
}

export function campaignScheduleSnapshots(input: {
  workspaceId: string;
  campaign: { id: string; revision: number; state: string; payload: unknown };
  actor: ScheduledCampaignSnapshot["actor"];
  from: Date;
  through: Date;
}) {
  if (input.campaign.state !== "active") return [];
  const campaign = campaignPayloadSchema.parse(input.campaign.payload);
  if (!campaign.execution.workflow) throw new Error("CAMPAIGN_WORKFLOW_BINDING_REQUIRED");
  const campaignDigest = canonicalDigest({ revision: input.campaign.revision, payload: campaign });
  return planCampaignOccurrences({ campaignId: input.campaign.id, campaignRevision: input.campaign.revision, cadence: { ...campaign.cadence, weekStart: campaign.cadence.weekStart }, formatMix: campaign.formatMix, from: input.from, through: input.through }).map((plan) => ({
    workspaceId: input.workspaceId, campaignId: input.campaign.id, campaignRevision: input.campaign.revision, campaignDigest, scheduledAt: plan.scheduledAt, occurrenceKey: plan.occurrenceKey, format: plan.format, timezone: campaign.cadence.timezone,
    channels: [...campaign.channelIds], approvalMode: campaign.reviewMode, autoPublishGrantId: campaign.autoPublishGrantId, fundingMode: campaign.execution.mode, budgetCeilingCents: campaign.execution.budgetCents, creditCeiling: campaign.execution.creditCeiling,
    workflow: structuredClone(campaign.execution.workflow), actor: structuredClone(input.actor),
  }));
}

export class CampaignOccurrenceScheduler {
  constructor(private readonly repository: CampaignSchedulerRepository, private readonly runtime: ScheduledCampaignWorkflowRuntime, private readonly codec: CampaignQuoteCodec, private readonly clock = () => new Date()) {}

  async processDue(input: { workerId: string; limit?: number }) {
    const now = this.clock(); const claimed = await this.repository.claimDue({ workerId: input.workerId, now, leaseUntil: new Date(now.getTime() + 120_000), limit: Math.min(50, Math.max(1, input.limit ?? 20)) });
    const summary = { claimed: claimed.length, started: 0, denied: 0, outcomeUnknown: 0 };
    for (const occurrence of claimed) {
      try {
        const runtimeInputs = { ...occurrence.workflow.inputs, contentFormat: occurrence.format, scheduledAt: occurrence.scheduledAt.toISOString(), channelIds: JSON.stringify(occurrence.channels), approvalMode: occurrence.approvalMode, autoPublishGrantId: occurrence.autoPublishGrantId ?? "" };
        const preview = await this.runtime.preview({ workspaceId: occurrence.workspaceId, workflowId: occurrence.workflow.workflowId, revisionId: occurrence.workflow.workflowRevisionId, inputs: runtimeInputs, principalId: occurrence.actor.principalId, inputArtifactIds: occurrence.workflow.inputArtifactIds });
        const amountCents = Math.ceil(Number(preview.ceiling.amount ?? Number.POSITIVE_INFINITY) * 100);
        if (!preview.admissible || !Number.isSafeInteger(amountCents) || amountCents > occurrence.budgetCeilingCents) { await this.repository.fail({ occurrence, code: "CAMPAIGN_OCCURRENCE_BUDGET_DENIED", outcomeUnknown: false, now: this.clock() }); summary.denied++; continue; }
        const acceptedQuote = issueCampaignAcceptedQuote({ preview, binding: occurrence.workflow, workspaceId: occurrence.workspaceId, userId: occurrence.actor.principalId, keyId: occurrence.actor.keyId, campaignId: occurrence.campaignId, campaignRevision: occurrence.campaignRevision, now, codec: this.codec });
        const submitting = await this.repository.markSubmitting({ occurrence, now: this.clock() });
        if (!submitting) continue;
        try {
        const accepted = await this.runtime.start({ workspaceId: occurrence.workspaceId, workflowId: occurrence.workflow.workflowId, revisionId: occurrence.workflow.workflowRevisionId, inputs: runtimeInputs, principalId: occurrence.actor.principalId, keyId: occurrence.actor.keyId, authorizationEvidenceRef: occurrence.actor.authorizationEvidenceRef, idempotencyKey: occurrence.occurrenceKey, inputArtifactIds: occurrence.workflow.inputArtifactIds, capability: "workflow_runs.start@2", acceptedSpendQuoteRef: acceptedQuote.ref });
        await this.repository.bindRun({ occurrence, runId: accepted.run.id, startSnapshotDigest: accepted.run.startSnapshotDigest, quoteId: acceptedQuote.quote.quoteId, quotedAmount: acceptedQuote.quote.amount, currency: acceptedQuote.quote.currency, acceptedAt: new Date(accepted.run.acceptedAt) }); summary.started++;
        } catch (error) {
          const code = error instanceof Error ? error.message : "CAMPAIGN_OCCURRENCE_START_UNKNOWN";
          await this.repository.fail({ occurrence, code, outcomeUnknown: true, now: this.clock() }); summary.outcomeUnknown++;
        }
      } catch (error) {
        const code = error instanceof Error ? error.message : "CAMPAIGN_OCCURRENCE_ADMISSION_FAILED";
        await this.repository.fail({ occurrence, code, outcomeUnknown: false, now: this.clock() }); summary.denied++;
      }
    }
    return summary;
  }
}
