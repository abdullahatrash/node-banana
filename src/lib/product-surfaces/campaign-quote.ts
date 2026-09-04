import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  workflowRunQuoteCeilingDigest,
  workflowRunQuoteInputDigest,
  type WorkflowRunAcceptedSpendQuote,
} from "@/lib/agent-runtime/runs/spend-quote";
import type { RunAdmissionPreview } from "@/lib/agent-runtime/budgets/types";

export type CampaignWorkflowBinding = {
  workflowId: string;
  workflowRevisionId: string;
  inputs: Record<string, string>;
  inputArtifactIds: string[];
};

export interface CampaignQuoteCodec { seal(payload: WorkflowRunAcceptedSpendQuote): string }

export class CampaignQuoteError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function issueCampaignAcceptedQuote(input: {
  preview: RunAdmissionPreview;
  binding: CampaignWorkflowBinding;
  workspaceId: string;
  userId: string;
  keyId: string;
  campaignId: string;
  campaignRevision: number;
  now: Date;
  codec: CampaignQuoteCodec;
  quoteId?: string;
}) {
  const { preview, binding } = input;
  if (!preview.admissible) throw new CampaignQuoteError(preview.denialReasons[0] ?? "CAMPAIGN_BUDGET_DENIED");
  if (!preview.ceiling.amount || !preview.ceiling.currency || preview.ceiling.certainty !== "conservative") throw new CampaignQuoteError("CAMPAIGN_EXACT_QUOTE_UNAVAILABLE");
  const providerModels = preview.stepExposures.map((exposure) => ({ provider: exposure.provider, model: exposure.model, pricePerAttempt: exposure.amountPerAttempt ?? "", automaticAttempts: exposure.automaticAttempts, pricingSnapshotIds: [...exposure.pricingSnapshotIds].sort() }));
  if (providerModels.some((model) => !model.pricePerAttempt || model.pricingSnapshotIds.length === 0)) throw new CampaignQuoteError("CAMPAIGN_EXACT_QUOTE_UNAVAILABLE");
  const pricingSnapshotIds = [...new Set(providerModels.flatMap((model) => model.pricingSnapshotIds))].sort();
  const quote: WorkflowRunAcceptedSpendQuote = {
    schema: "workflow-run-accepted-spend-quote/v1", quoteId: input.quoteId ?? `quote_${randomUUID().replaceAll("-", "")}`,
    sourceWorkspaceId: input.workspaceId, targetWorkspaceId: input.workspaceId, requestedByUserId: input.userId,
    delegatedPrincipalId: input.userId, delegatedKeyId: input.keyId, capability: "workflow_runs.start@2",
    workflowId: binding.workflowId, workflowRevisionId: binding.workflowRevisionId,
    inputDigest: workflowRunQuoteInputDigest({ workflowId: binding.workflowId, revisionId: binding.workflowRevisionId, inputs: binding.inputs, inputArtifactIds: binding.inputArtifactIds }),
    targetStateDigest: canonicalDigest({ campaignId: input.campaignId, campaignRevision: input.campaignRevision, state: "active" }),
    amount: preview.ceiling.amount, currency: preview.ceiling.currency, providerModels, pricingSnapshotIds,
    ceiling: { maximumAmount: preview.ceiling.amount, currency: preview.ceiling.currency, maximumProviderAttempts: providerModels.reduce((total, model) => total + model.automaticAttempts, 0) },
    ceilingDigest: "", quotedAt: input.now.toISOString(), expiresAt: new Date(input.now.getTime() + 5 * 60_000).toISOString(),
  };
  quote.ceilingDigest = workflowRunQuoteCeilingDigest(quote);
  try { return { quote, ref: input.codec.seal(quote) }; }
  catch { throw new CampaignQuoteError("CAMPAIGN_QUOTE_SIGNING_UNAVAILABLE"); }
}
