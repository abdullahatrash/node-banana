import { and, eq } from "drizzle-orm";
import { PRODUCTION_WORKFLOW_RUN_SERVICE } from "@/lib/agent-runtime/runs/production";
import { productionWorkflowRunSpendQuoteCodec } from "@/lib/agent-runtime/runs/spend-quote";
import type { RunAdmissionPreview } from "@/lib/agent-runtime/budgets/types";
import type { WorkflowRunAcceptedDto } from "@/lib/agent-runtime/runs/types";
import { getDb } from "@/lib/db";
import { workspaceProductRecords } from "@/lib/db/schema";
import { campaignPayloadSchema } from "./definitions";
import { updateProductRecord, type ProductRecord } from "@/lib/product-surfaces/repository";
import { CampaignQuoteError, issueCampaignAcceptedQuote } from "./campaign-quote";
import { PRODUCTION_CAMPAIGN_SCHEDULER_REPOSITORY } from "./campaign-scheduler-repository";
import { validateCampaignAuthoringPayload } from "./campaign-authoring";
import { canonicalDigest } from "@/lib/agent-tools/canonical";

export class CampaignRuntimeError extends Error {
  constructor(readonly code: string) { super(code); }
}

export interface CampaignWorkflowRuntime {
  preview(input: { workspaceId: string; workflowId: string; revisionId: string; inputs: Record<string, unknown>; principalId: string; inputArtifactIds: string[] }): Promise<RunAdmissionPreview>;
  start(input: { workspaceId: string; workflowId: string; revisionId: string; inputs: Record<string, unknown>; principalId: string; keyId: string; authorizationEvidenceRef: string; idempotencyKey: string; inputArtifactIds: string[]; capability: "workflow_runs.start@2"; acceptedSpendQuoteRef: string }): Promise<WorkflowRunAcceptedDto>;
}

async function campaignRecord(input: { workspaceId: string; id: string }) {
  const [record] = await getDb().select().from(workspaceProductRecords).where(and(
    eq(workspaceProductRecords.workspaceId, input.workspaceId),
    eq(workspaceProductRecords.id, input.id),
    eq(workspaceProductRecords.kind, "campaign_automation"),
  )).limit(1);
  if (!record) throw new CampaignRuntimeError("CAMPAIGN_NOT_FOUND");
  return record;
}

function stableActivationQuoteId(campaignId: string, campaignRevision: number) {
  return `quote_${canonicalDigest({ campaignId, campaignRevision, purpose: "campaign_activation" }).slice("sha256:".length)}`;
}

export async function previewCampaignCommand(input: {
  workspaceId: string;
  userId: string;
  authContextId: string;
  id: string;
  expectedRevision: number;
  runtime?: CampaignWorkflowRuntime;
  now?: Date;
}) {
  const record = await campaignRecord(input);
  if (record.revision !== input.expectedRevision) throw new CampaignRuntimeError("CAMPAIGN_REVISION_CONFLICT");
  const campaign = campaignPayloadSchema.parse(record.payload);
  const validation = await validateCampaignAuthoringPayload({ workspaceId: input.workspaceId, userId: input.userId, payload: campaign, complete: true, now: input.now });
  if (validation.issues.length) throw new CampaignRuntimeError(validation.issues[0]!);
  const binding = campaign.execution.workflow!;
  const preview = await (input.runtime ?? PRODUCTION_WORKFLOW_RUN_SERVICE).preview({ workspaceId: input.workspaceId, workflowId: binding.workflowId, revisionId: binding.workflowRevisionId, inputs: binding.inputs, principalId: input.userId, inputArtifactIds: binding.inputArtifactIds });
  if (!preview.admissible) return { admissible: false as const, denialReasons: preview.denialReasons, warnings: preview.warnings, evaluatedAt: preview.evaluatedAt.toISOString() };
  const activationRevision = record.state === "draft" ? record.revision + 1 : record.revision;
  let quote;
  try {
    quote = issueCampaignAcceptedQuote({
      preview, binding, workspaceId: input.workspaceId, userId: input.userId,
      keyId: `human-session:${input.authContextId}`, campaignId: record.id,
      campaignRevision: activationRevision, now: input.now ?? new Date(),
      codec: productionWorkflowRunSpendQuoteCodec(),
      quoteId: stableActivationQuoteId(record.id, activationRevision),
    }).quote;
  } catch (error) {
    throw new CampaignRuntimeError(error instanceof CampaignQuoteError ? error.code : "CAMPAIGN_QUOTE_SIGNING_UNAVAILABLE");
  }
  return {
    admissible: true as const,
    denialReasons: [],
    warnings: preview.warnings,
    evaluatedAt: preview.evaluatedAt.toISOString(),
    quote: {
      quoteId: quote.quoteId, amount: quote.amount, currency: quote.currency,
      expiresAt: quote.expiresAt, maximumProviderAttempts: quote.ceiling.maximumProviderAttempts,
      providerModels: quote.providerModels.map(({ provider, model, pricePerAttempt, automaticAttempts }) => ({ provider, model, pricePerAttempt, automaticAttempts })),
    },
  };
}

export async function activateCampaignCommand(input: {
  workspaceId: string;
  userId: string;
  authContextId: string;
  id: string;
  expectedRevision: number;
  idempotencyKey: string;
  runtime?: CampaignWorkflowRuntime;
  now?: Date;
}): Promise<ProductRecord> {
  const runtime = input.runtime ?? PRODUCTION_WORKFLOW_RUN_SERVICE;
  const record = await campaignRecord(input);
  if (record.revision !== input.expectedRevision && record.state !== "validating") throw new CampaignRuntimeError("CAMPAIGN_REVISION_CONFLICT");
  const campaign = campaignPayloadSchema.parse(record.payload);
  const validation = await validateCampaignAuthoringPayload({ workspaceId: input.workspaceId, userId: input.userId, payload: campaign, complete: true, now: input.now });
  if (validation.issues.length) throw new CampaignRuntimeError(validation.issues[0]!);
  const binding = campaign.execution.workflow;
  if (!binding) throw new CampaignRuntimeError("CAMPAIGN_WORKFLOW_BINDING_REQUIRED");
  if (campaign.validationErrors.length) throw new CampaignRuntimeError("CAMPAIGN_VALIDATION_FAILED");
  const artifactIds = [...new Set(binding.inputArtifactIds)];
  if (artifactIds.length !== binding.inputArtifactIds.length) throw new CampaignRuntimeError("CAMPAIGN_ARTIFACT_BINDINGS_INVALID");
  const keyId = `human-session:${input.authContextId}`;
  const now = input.now ?? new Date();
  // Admission and quote signing happen before any state transition. A denied or
  // unquotable request therefore remains an editable draft rather than a
  // misleading partially-launched campaign.
  const preview = await runtime.preview({ workspaceId: input.workspaceId, workflowId: binding.workflowId, revisionId: binding.workflowRevisionId, inputs: binding.inputs, principalId: input.userId, inputArtifactIds: artifactIds });
  const activationRevision = record.state === "validating" ? record.revision : record.revision + 1;
  let acceptedQuote;
  try { acceptedQuote = issueCampaignAcceptedQuote({ preview, binding, workspaceId: input.workspaceId, userId: input.userId, keyId, campaignId: record.id, campaignRevision: activationRevision, now, codec: productionWorkflowRunSpendQuoteCodec(), quoteId: stableActivationQuoteId(record.id, activationRevision) }); }
  catch (error) { throw new CampaignRuntimeError(error instanceof CampaignQuoteError ? error.code : "CAMPAIGN_QUOTE_SIGNING_UNAVAILABLE"); }
  const validating = record.state === "validating" ? record : await updateProductRecord({
    workspaceId: input.workspaceId,
    userId: input.userId,
    id: record.id,
    expectedKind: "campaign_automation",
    expectedRevision: record.revision,
    state: "validating",
    idempotencyKey: `${input.idempotencyKey}:validate`,
  });
  if (!validating) throw new CampaignRuntimeError("CAMPAIGN_NOT_FOUND");
  if (validating.revision !== activationRevision) throw new CampaignRuntimeError("CAMPAIGN_REVISION_CONFLICT");
  const accepted = await runtime.start({
    workspaceId: input.workspaceId,
    workflowId: binding.workflowId,
    revisionId: binding.workflowRevisionId,
    inputs: binding.inputs,
    principalId: input.userId,
    keyId,
    authorizationEvidenceRef: `campaign:${record.id}:revision:${validating.revision}`,
    idempotencyKey: `campaign-activation:${record.id}:revision:${validating.revision}`,
    inputArtifactIds: artifactIds,
    capability: "workflow_runs.start@2",
    acceptedSpendQuoteRef: acceptedQuote.ref,
  });
  const nextPayload = campaignPayloadSchema.parse({
    ...campaign,
    runtime: {
      runId: accepted.run.id,
      workflowId: accepted.run.workflowId,
      workflowRevisionId: accepted.run.workflowRevisionId,
      state: accepted.run.state,
      startSnapshotDigest: accepted.run.startSnapshotDigest,
      quoteId: acceptedQuote.quote.quoteId,
      quotedAmount: acceptedQuote.quote.amount,
      currency: acceptedQuote.quote.currency,
      acceptedAt: accepted.run.acceptedAt,
      scheduleAuthority: { principalId: input.userId, keyId, authorizationEvidenceRef: `campaign:${record.id}:revision:${validating.revision}` },
    },
  });
  const active = await updateProductRecord({
    workspaceId: input.workspaceId,
    userId: input.userId,
    id: record.id,
    expectedKind: "campaign_automation",
    expectedRevision: validating.revision,
    state: "active",
    payload: nextPayload,
    idempotencyKey: `${input.idempotencyKey}:activate`,
  });
  if (!active) throw new CampaignRuntimeError("CAMPAIGN_NOT_FOUND");
  return active;
}

export async function pauseCampaignCommand(input: { workspaceId: string; userId: string; id: string; expectedRevision: number; idempotencyKey: string }) {
  const paused = await updateProductRecord({ ...input, expectedKind: "campaign_automation", state: "paused" });
  if (!paused) throw new CampaignRuntimeError("CAMPAIGN_NOT_FOUND");
  await PRODUCTION_CAMPAIGN_SCHEDULER_REPOSITORY.cancelFuture(input.workspaceId, input.id, new Date());
  return paused;
}

export async function resumeCampaignCommand(input: { workspaceId: string; userId: string; id: string; expectedRevision: number; idempotencyKey: string; now?: Date }) {
  const record = await campaignRecord(input);
  if (record.state !== "paused") throw new CampaignRuntimeError("CAMPAIGN_RESUME_NOT_ALLOWED");
  const payload = campaignPayloadSchema.parse(record.payload);
  const validation = await validateCampaignAuthoringPayload({ workspaceId: input.workspaceId, userId: input.userId, payload, complete: true, now: input.now });
  if (validation.issues.length) throw new CampaignRuntimeError(validation.issues[0]!);
  const active = await updateProductRecord({ ...input, expectedKind: "campaign_automation", state: "active" });
  if (!active) throw new CampaignRuntimeError("CAMPAIGN_NOT_FOUND");
  return active;
}

export async function archiveCampaignCommand(input: { workspaceId: string; userId: string; id: string; expectedRevision: number; idempotencyKey: string; discard: boolean }) {
  const record = await campaignRecord(input);
  if (input.discard && record.state !== "draft") throw new CampaignRuntimeError("CAMPAIGN_DISCARD_NOT_ALLOWED");
  const archived = await updateProductRecord({ workspaceId: input.workspaceId, userId: input.userId, id: input.id, expectedRevision: input.expectedRevision, expectedKind: "campaign_automation", state: "archived", idempotencyKey: input.idempotencyKey });
  if (!archived) throw new CampaignRuntimeError("CAMPAIGN_NOT_FOUND");
  await PRODUCTION_CAMPAIGN_SCHEDULER_REPOSITORY.cancelFuture(input.workspaceId, input.id, new Date());
  return archived;
}
