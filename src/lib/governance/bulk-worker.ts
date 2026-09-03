import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { authorizationContractDigestFor } from "@/lib/agent-tools/registry";
import { getDb } from "@/lib/db";
import { assets, contentWorkflows, runtimePublishingDeliveries, socialAccounts, socialPosts, workspaceGovernanceResources, workspaceMembers } from "@/lib/db/schema";
import {
  WorkflowRunSpendQuoteCodec,
  workflowRunQuoteCeilingDigest,
  workflowRunQuoteInputDigest,
  type WorkflowRunAcceptedSpendQuote,
} from "@/lib/agent-runtime/runs/spend-quote";
import type {
  BulkOperationItem,
  GovernanceAuditEvent,
  GovernanceBulkAuthorizationPort,
  GovernanceBulkCapabilityPort,
  GovernanceBulkPreviewPort,
  GovernanceRepository,
  GovernanceResource,
} from "./types";

function audit(job: GovernanceResource, action: string, outcome: GovernanceAuditEvent["outcome"], now: Date): GovernanceAuditEvent {
  return { schema: "workspace-audit-event/v1", id: `audit_${randomUUID().replaceAll("-", "")}`, workspaceId: job.workspaceId, actor: { kind: "system", id: null }, capability: "bulk.process@1", action, resource: { kind: job.kind, id: job.id }, outcome, redactedDetails: {}, occurredAt: now };
}

function terminalStatus(items: BulkOperationItem[]): string {
  if (items.some((item) => item.state === "outcome_unknown")) return "outcome_unknown";
  if (items.some((item) => item.state === "failed_known")) return "failed_known";
  if (items.every((item) => item.state === "cancelled")) return "cancelled";
  if (items.some((item) => item.state === "cancelled")) return "cancelled";
  return "succeeded";
}

const BULK_LEASE_MS = 15 * 60_000;
interface BulkLease { id: string; claimedAt: string; expiresAt: string; attempt: number }
interface BulkJobBody {
  requestedByUserId: string; concurrency: number; cancellationRequestedAt: string | null;
  items: BulkOperationItem[]; lease: BulkLease | null; [key: string]: unknown;
}

export class GovernanceBulkWorker {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly authorization: GovernanceBulkAuthorizationPort,
    private readonly capabilities: GovernanceBulkCapabilityPort,
    private readonly clock: { now(): Date } = { now: () => new Date() },
    private readonly preview: GovernanceBulkPreviewPort | null = null,
  ) {}

  async process(input: { workspaceId: string; operationId: string }): Promise<void> {
    const found = await this.repository.getResource<BulkJobBody>({ workspaceId: input.workspaceId, kind: "bulk_operation", id: input.operationId });
    if (!found || ["succeeded", "failed_known", "outcome_unknown", "cancelled"].includes(found.status)) return;
    const claimed = await this.claim(found);
    if (!claimed) return;
    let job: GovernanceResource = claimed;

    while (true) {
      const body = job.body as BulkJobBody;
      if (job.status === "cancelling" || body.cancellationRequestedAt) {
        const items = body.items.map((item) => ["queued", "previewed"].includes(item.state) ? { ...item, state: "cancelled" as const, outcome: { safeReason: "cancelled_before_dispatch" } } : item);
        await this.transition(job, terminalStatus(items), { ...body, lease: null, items, completedAt: this.clock.now().toISOString() }, "cancel_bulk_processing", "completed");
        return;
      }
      const batch = body.items.filter((item) => item.state === "queued").slice(0, body.concurrency);
      if (!batch.length) {
        const final = terminalStatus(body.items);
        await this.transition(job, final, { ...body, lease: null, completedAt: this.clock.now().toISOString() }, "complete_bulk_processing", final === "succeeded" ? "completed" : "failed");
        return;
      }
      const batchIds = new Set(batch.map((item) => item.id));
      const renewedLease = body.lease ? { ...body.lease, expiresAt: new Date(this.clock.now().getTime() + BULK_LEASE_MS).toISOString() } : null;
      job = await this.transition(job, "running", { ...body, lease: renewedLease, items: body.items.map((item) => batchIds.has(item.id) ? { ...item, state: "running" } : item) }, "dispatch_bulk_batch", "accepted");
      const outcomes = await Promise.all(batch.map(async (item) => {
        const actor = await this.authorization.resolveActor({ sourceWorkspaceId: input.workspaceId, targetWorkspaceId: item.targetWorkspaceId, userId: body.requestedByUserId, capability: item.capability, targetKind: item.targetKind, targetId: item.targetId, evaluatedAt: this.clock.now() });
        if (!actor) return { item, result: { type: "failed_known" as const, code: "TARGET_WORKSPACE_FORBIDDEN" } };
        const pinned = (item.outcome as { preview?: Awaited<ReturnType<GovernanceBulkPreviewPort["inspect"]>> } | null)?.preview;
        if (this.preview) {
          const quoteRef = pinned?.type === "ready" && pinned.quote.required ? pinned.quote.ref : null;
          const current = await this.preview.inspect({ sourceWorkspaceId: input.workspaceId, requestedByUserId: body.requestedByUserId, capability: item.capability, targetWorkspaceId: item.targetWorkspaceId, targetKind: item.targetKind, targetId: item.targetId, capabilityInput: item.input, quoteRef, evaluatedAt: this.clock.now() });
          if (pinned?.type !== "ready" || current.type !== "ready" || current.authorizationContractDigest !== pinned.authorizationContractDigest || current.targetStateDigest !== pinned.targetStateDigest || current.quote.digest !== pinned.quote.digest) {
            return { item, result: { type: "failed_known" as const, code: "BULK_PREVIEW_STALE" } };
          }
        }
        try {
          return { item, result: await this.capabilities.execute({ actor, capability: item.capability, capabilityInput: item.input, idempotencyKey: item.idempotencyKey, acceptedQuoteRef: pinned?.type === "ready" && pinned.quote.required ? pinned.quote.ref : null }) };
        } catch {
          return { item, result: { type: "outcome_unknown" as const, safeReason: "dispatcher_transport_interrupted" } };
        }
      }));
      const latest = await this.repository.getResource({ workspaceId: input.workspaceId, kind: "bulk_operation", id: input.operationId });
      if (!latest) return;
      const latestBody = latest.body as typeof body;
      const byId = new Map(outcomes.map(({ item, result }) => [item.id, result]));
      const items = latestBody.items.map((item) => {
        const outcome = byId.get(item.id);
        if (!outcome || item.state !== "running") return item;
        if (outcome.type === "succeeded") return { ...item, state: "succeeded" as const, outcome: { output: outcome.output } };
        if (outcome.type === "failed_known") return { ...item, state: "failed_known" as const, outcome: { code: outcome.code } };
        return { ...item, state: "outcome_unknown" as const, outcome: { safeReason: outcome.safeReason } };
      });
      job = await this.transition(latest, latest.status, { ...latestBody, items }, "record_bulk_batch", "completed");
    }
  }

  async recoverExpired(input: { workspaceId: string }): Promise<number> {
    const now = this.clock.now();
    const jobs = (await this.repository.listResources<BulkJobBody>({ workspaceId: input.workspaceId, kinds: ["bulk_operation"] }))
      .filter((job) => ["running", "cancelling"].includes(job.status));
    const expired = jobs.filter((job) => !job.body.lease || new Date(job.body.lease.expiresAt) <= now);
    for (const job of expired) await this.process({ workspaceId: input.workspaceId, operationId: job.id });
    return expired.length;
  }

  private async claim(job: GovernanceResource<BulkJobBody>): Promise<GovernanceResource<BulkJobBody> | null> {
    const now = this.clock.now();
    if (job.body.lease && new Date(job.body.lease.expiresAt) > now) return null;
    if (!["queued", "running", "cancelling"].includes(job.status)) throw new Error("Bulk Operation is not claimable.");
    const interrupted = job.body.items.map((item) => item.state === "running" ? { ...item, state: "outcome_unknown" as const, outcome: { safeReason: "worker_interrupted_after_dispatch" } } : item);
    const lease: BulkLease = { id: `lease_${randomUUID().replaceAll("-", "")}`, claimedAt: now.toISOString(), expiresAt: new Date(now.getTime() + BULK_LEASE_MS).toISOString(), attempt: (job.body.lease?.attempt ?? 0) + 1 };
    const next: GovernanceResource<BulkJobBody> = { ...job, version: job.version + 1, status: job.status === "cancelling" ? "cancelling" : "running", body: { ...job.body, items: interrupted, lease, startedAt: (job.body.startedAt as string | undefined) ?? now.toISOString() }, updatedAt: now };
    const outcome = await this.repository.commit({ receipt: { workspaceId: job.workspaceId, capability: "bulk.claim@1", idempotencyKey: `bulk-claim-${job.id}-${job.version}-${lease.id}`, requestDigest: canonicalDigest({ operationId: job.id, version: job.version, lease }), result: { operationId: job.id, leaseId: lease.id }, createdAt: now }, mutations: [{ type: "update", expectedVersion: job.version, resource: next }], audit: audit(job, "claim_bulk_processing", "accepted", now) });
    return outcome.type === "committed" ? next : null;
  }

  private async transition(job: GovernanceResource, status: string, body: Record<string, unknown>, action: string, outcome: GovernanceAuditEvent["outcome"]): Promise<GovernanceResource> {
    const now = this.clock.now();
    const next: GovernanceResource = { ...job, version: job.version + 1, status, body, updatedAt: now };
    const committed = await this.repository.commit({ receipt: { workspaceId: job.workspaceId, capability: "bulk.process@1", idempotencyKey: `${action}-${job.id}-${job.version}`, requestDigest: canonicalDigest({ jobId: job.id, version: job.version, action }), result: { operationId: job.id, status }, createdAt: now }, mutations: [{ type: "update", expectedVersion: job.version, resource: next }], audit: audit(job, action, outcome, now) });
    if (committed.type === "conflict") throw new Error("Bulk Operation changed concurrently.");
    return next;
  }
}

export class DrizzleGovernanceBulkAuthorizationPort implements GovernanceBulkAuthorizationPort {
  async resolveActor(input: Parameters<GovernanceBulkAuthorizationPort["resolveActor"]>[0]) {
    const [membership] = await getDb().select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.targetWorkspaceId), eq(workspaceMembers.userId, input.userId))).limit(1);
    if (!membership) return null;
    if (input.sourceWorkspaceId === input.targetWorkspaceId) {
      return { workspaceId: input.targetWorkspaceId, userId: input.userId, legacyRole: membership.role, authContextId: `bulk:${input.sourceWorkspaceId}:${input.userId}` };
    }
    const [assignment] = await getDb().select({ id: workspaceGovernanceResources.id }).from(workspaceGovernanceResources).where(and(
      eq(workspaceGovernanceResources.workspaceId, input.sourceWorkspaceId),
      eq(workspaceGovernanceResources.kind, "portfolio_assignment"),
      eq(workspaceGovernanceResources.status, "active"),
      sql`${workspaceGovernanceResources.body}->>'assigneeUserId' = ${input.userId}`,
      sql`${workspaceGovernanceResources.body}->>'sourceWorkspaceId' = ${input.sourceWorkspaceId}`,
      sql`${workspaceGovernanceResources.body}->>'targetWorkspaceId' = ${input.targetWorkspaceId}`,
      sql`${workspaceGovernanceResources.body}->'permissions' @> '["bulk"]'::jsonb`,
      sql`${workspaceGovernanceResources.body}->'capabilityAllowlist' @> ${JSON.stringify([input.capability])}::jsonb`,
      sql`${workspaceGovernanceResources.body}->'resourceAllowlist' @> ${JSON.stringify([{ kind: input.targetKind, id: input.targetId }])}::jsonb`,
      or(isNull(sql`${workspaceGovernanceResources.body}->>'expiresAt'`), gt(sql`(${workspaceGovernanceResources.body}->>'expiresAt')::timestamptz`, input.evaluatedAt)),
    )).limit(1);
    return assignment ? { workspaceId: input.targetWorkspaceId, userId: input.userId, legacyRole: membership.role, authContextId: `bulk:${assignment.id}:${input.userId}`, portfolioAssignmentId: assignment.id } : null;
  }
}

export class ApplicationGovernanceBulkCapabilityPort implements GovernanceBulkCapabilityPort {
  async execute(input: Parameters<GovernanceBulkCapabilityPort["execute"]>[0]) {
    const { dispatchCapability } = await import("@/lib/agent-runtime/server-dispatcher");
    const delegated = delegatedAgent(input.capabilityInput);
    const capabilityInput = withoutDelegatedAgent(input.capabilityInput);
    if (input.capability === "workflow_runs.start@2" && (!delegated || !input.acceptedQuoteRef)) {
      return { type: "failed_known" as const, code: "DELEGATED_AGENT_QUOTE_REQUIRED" };
    }
    const response = delegated && input.capability === "workflow_runs.start@2" && input.acceptedQuoteRef
      ? await dispatchCapability({ capability: input.capability, input: { ...capabilityInput, acceptedSpendQuoteRef: input.acceptedQuoteRef, idempotencyKey: `bulk-quote:${canonicalDigest(input.acceptedQuoteRef)}` } }, { securityContext: { kind: "agent", workspaceId: input.actor.workspaceId, principalId: delegated.principalId, keyId: delegated.keyId } })
      : await dispatchCapability({ capability: input.capability, input: capabilityInput }, { securityContext: { kind: "human", workspaceId: input.actor.workspaceId, userId: input.actor.userId, role: input.actor.legacyRole, authContextId: input.actor.authContextId, idempotencyKey: input.idempotencyKey } });
    if (response.type === "capability_error") return { type: "failed_known" as const, code: response.code };
    return { type: "succeeded" as const, output: response.output };
  }
}

interface DelegatedBulkAgent {
  principalId: string;
  keyId: string;
}

function delegatedAgent(value: Record<string, unknown>): DelegatedBulkAgent | null {
  const raw = value.delegatedAgent;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const principalId = (raw as Record<string, unknown>).principalId;
  const keyId = (raw as Record<string, unknown>).keyId;
  return typeof principalId === "string" && principalId.length > 0 && typeof keyId === "string" && keyId.length > 0
    ? { principalId, keyId }
    : null;
}

function withoutDelegatedAgent(value: Record<string, unknown>): Record<string, unknown> {
  const { delegatedAgent: _delegatedAgent, ...runtimeInput } = value;
  return runtimeInput;
}

type WorkflowPreviewService = { preview(input: { workspaceId: string; workflowId: string; revisionId: string; inputs: Record<string, unknown>; principalId: string; inputArtifactIds: string[] }): Promise<import("@/lib/agent-runtime/budgets/types").RunAdmissionPreview> };

/** Issues and revalidates signed, actor/target/input-bound quotes from the
 * actual Workflow Run budget preview. No caller-authored price is accepted. */
export class WorkflowRunGovernanceBulkQuotePort {
  private readonly codec: WorkflowRunSpendQuoteCodec;

  constructor(
    private readonly service: WorkflowPreviewService,
    private readonly key: Uint8Array | null = (() => { const value = Buffer.from(process.env.GOVERNANCE_BULK_QUOTE_SIGNING_KEY ?? "", "base64"); return value.length === 32 ? value : null; })(),
  ) { this.codec = new WorkflowRunSpendQuoteCodec(this.key); }

  async quote(input: Parameters<GovernanceBulkPreviewPort["inspect"]>[0] & { targetStateDigest: string }) {
    if (input.capability !== "workflow_runs.start@2" || input.targetKind !== "content" || !this.key) return null;
    const delegated = delegatedAgent(input.capabilityInput);
    const runtimeInput = withoutDelegatedAgent(input.capabilityInput);
    if (!delegated) return null;
    const workflowId = typeof runtimeInput.workflowId === "string" ? runtimeInput.workflowId : "";
    const revisionId = typeof runtimeInput.revisionId === "string" ? runtimeInput.revisionId : "";
    const inputs = runtimeInput.inputs;
    const artifactIds = runtimeInput.inputArtifactIds;
    if (workflowId !== input.targetId || !revisionId || !inputs || typeof inputs !== "object" || Array.isArray(inputs) || !Array.isArray(artifactIds) || artifactIds.some((id) => typeof id !== "string")) return null;
    const preview = await this.service.preview({ workspaceId: input.targetWorkspaceId, workflowId, revisionId, inputs: inputs as Record<string, unknown>, principalId: delegated.principalId, inputArtifactIds: artifactIds as string[] });
    if (!preview.admissible || !preview.ceiling.amount || !preview.ceiling.currency || preview.ceiling.certainty !== "conservative") return null;
    const providerModels = preview.stepExposures.map((exposure) => ({
      provider: exposure.provider,
      model: exposure.model,
      pricePerAttempt: exposure.amountPerAttempt ?? "",
      automaticAttempts: exposure.automaticAttempts,
      pricingSnapshotIds: [...exposure.pricingSnapshotIds].sort(),
    }));
    if (providerModels.some((item) => !item.pricePerAttempt || item.pricingSnapshotIds.length === 0)) return null;
    const inputDigest = workflowRunQuoteInputDigest({ workflowId, revisionId, inputs: inputs as Record<string, unknown>, inputArtifactIds: artifactIds as string[] });
    const pricingSnapshotIds = [...new Set(providerModels.flatMap((item) => item.pricingSnapshotIds))].sort();
    let payload: WorkflowRunAcceptedSpendQuote;
    if (input.quoteRef) {
      const opened = this.open(input.quoteRef);
      if (!opened || opened.expiresAt <= input.evaluatedAt.toISOString()) return null;
      payload = opened;
      const current = { amount: preview.ceiling.amount, currency: preview.ceiling.currency, providerModels, pricingSnapshotIds, ceiling: { maximumAmount: preview.ceiling.amount, currency: preview.ceiling.currency, maximumProviderAttempts: providerModels.reduce((total, model) => total + model.automaticAttempts, 0) } };
      if (
        payload.sourceWorkspaceId !== input.sourceWorkspaceId || payload.targetWorkspaceId !== input.targetWorkspaceId ||
        payload.requestedByUserId !== input.requestedByUserId || payload.workflowId !== workflowId ||
        payload.delegatedPrincipalId !== delegated.principalId || payload.delegatedKeyId !== delegated.keyId ||
        payload.workflowRevisionId !== revisionId || payload.inputDigest !== inputDigest ||
        payload.targetStateDigest !== input.targetStateDigest || workflowRunQuoteCeilingDigest(current) !== payload.ceilingDigest
      ) return null;
    } else {
      payload = {
        schema: "workflow-run-accepted-spend-quote/v1",
        quoteId: `quote_${randomUUID().replaceAll("-", "")}`,
        sourceWorkspaceId: input.sourceWorkspaceId,
        targetWorkspaceId: input.targetWorkspaceId,
        requestedByUserId: input.requestedByUserId,
        delegatedPrincipalId: delegated.principalId,
        delegatedKeyId: delegated.keyId,
        capability: "workflow_runs.start@2",
        workflowId,
        workflowRevisionId: revisionId,
        inputDigest,
        targetStateDigest: input.targetStateDigest,
        amount: preview.ceiling.amount,
        currency: preview.ceiling.currency,
        providerModels,
        pricingSnapshotIds,
        ceiling: { maximumAmount: preview.ceiling.amount, currency: preview.ceiling.currency, maximumProviderAttempts: providerModels.reduce((total, model) => total + model.automaticAttempts, 0) },
        ceilingDigest: "",
        quotedAt: input.evaluatedAt.toISOString(),
        expiresAt: new Date(input.evaluatedAt.getTime() + 5 * 60_000).toISOString(),
      };
      payload.ceilingDigest = workflowRunQuoteCeilingDigest(payload);
    }
    const ref = this.codec.seal(payload);
    return { required: true as const, ref, amount: payload.amount, currency: payload.currency, source: "workflow_run_budget_preview" as const, providerModels: payload.providerModels, quotedAt: payload.quotedAt, expiresAt: payload.expiresAt, targetStateDigest: payload.targetStateDigest, digest: canonicalDigest(payload) };
  }

  private open(ref: string): WorkflowRunAcceptedSpendQuote | null { return this.codec.open(ref); }
}

/** Production preview admission: exact target state + registry schema + current
 * composite human authorization. Spend-capable capabilities remain fail-closed
 * until a domain quote can be verified; caller-provided quote references are
 * never treated as authoritative. */
export class ProductionGovernanceBulkPreviewPort implements GovernanceBulkPreviewPort {
  constructor(
    private readonly authorization = new DrizzleGovernanceBulkAuthorizationPort(),
    private readonly spendQuotes: WorkflowRunGovernanceBulkQuotePort | null = null,
  ) {}

  async inspect(input: Parameters<GovernanceBulkPreviewPort["inspect"]>[0]): Promise<Awaited<ReturnType<GovernanceBulkPreviewPort["inspect"]>>> {
    const actor = await this.authorization.resolveActor({ sourceWorkspaceId: input.sourceWorkspaceId, targetWorkspaceId: input.targetWorkspaceId, userId: input.requestedByUserId, capability: input.capability, targetKind: input.targetKind, targetId: input.targetId, evaluatedAt: input.evaluatedAt });
    if (!actor) return { type: "blocked", code: "TARGET_WORKSPACE_FORBIDDEN" };
    const targetState = await this.targetState(input);
    if (!targetState) return { type: "blocked", code: "TARGET_NOT_FOUND_OR_UNSUPPORTED" };
    const [{ parseCapabilityIdentity }, runtime] = await Promise.all([import("@/lib/agent-tools/dispatcher"), import("@/lib/agent-runtime/server-dispatcher")]);
    const identity = parseCapabilityIdentity(input.capability);
    if (!identity) return { type: "blocked", code: "CAPABILITY_IDENTITY_INVALID" };
    const registration = runtime.PRODUCTION_CAPABILITY_REGISTRY.getRegistration(identity);
    const definition = runtime.PRODUCTION_CAPABILITY_REGISTRY.getDefinition(identity);
    if (!registration || !definition || definition.lifecycle.status === "retired") return { type: "blocked", code: "CAPABILITY_NOT_EXECUTABLE" };
    const delegated = delegatedAgent(input.capabilityInput);
    const runtimeInput = withoutDelegatedAgent(input.capabilityInput);
    if (!registration.input.safeParse(runtimeInput).success) return { type: "blocked", code: "CAPABILITY_INPUT_INVALID" };
    if (!definition.effect.maySpendProviderBudget && input.quoteRef) return { type: "blocked", code: "UNVERIFIED_QUOTE_REFERENCE" };
    const authorizationContractDigest = authorizationContractDigestFor(identity, registration.authorization);
    if (definition.effect.maySpendProviderBudget && !delegated) return { type: "blocked", code: "DELEGATED_AGENT_AUTHORITY_REQUIRED" };
    const resources = delegated
      ? [{ kind: "workflow" as const, id: input.targetId }, ...((runtimeInput.inputArtifactIds as string[] | undefined) ?? []).map((id) => ({ kind: "artifact" as const, id }))]
      : [];
    const securityContext = delegated
      ? { kind: "agent" as const, workspaceId: actor.workspaceId, principalId: delegated.principalId, keyId: delegated.keyId }
      : { kind: "human" as const, workspaceId: actor.workspaceId, userId: actor.userId, role: actor.legacyRole, authContextId: actor.authContextId };
    const admission = await runtime.PRODUCTION_CAPABILITY_AUTHORIZER.authorize({ securityContext, audience: registration.audience ?? "agent", capability: identity, authorizationContractDigest, resources, resourceExtractionValid: true, effect: definition.effect });
    if (!admission.allowed) return { type: "blocked", code: admission.code ?? "CAPABILITY_NOT_AUTHORIZED" };
    if (!admission.operatorTraceRef) return { type: "blocked", code: "AUTHORIZATION_EVIDENCE_UNAVAILABLE" };
    const quote = definition.effect.maySpendProviderBudget
      ? await this.spendQuotes?.quote({ ...input, targetStateDigest: canonicalDigest(targetState) }) ?? null
      : { required: false as const, amount: "0" as const, currency: "USD" as const, source: "capability_effect_contract" as const, digest: canonicalDigest({ capability: identity, contractDigest: definition.contractDigest, maySpendProviderBudget: false, amount: "0", currency: "USD" }) };
    if (!quote) return { type: "blocked", code: "AUTHORITATIVE_BULK_QUOTE_REQUIRED" };
    return { type: "ready", authorizationEvidenceRef: admission.operatorTraceRef, authorizationContractDigest, targetStateDigest: canonicalDigest(targetState), entitlement: "exact_capability_granted", quote };
  }

  private async targetState(input: Parameters<GovernanceBulkPreviewPort["inspect"]>[0]): Promise<Record<string, unknown> | null> {
    const db = getDb();
    if (input.targetKind === "content") {
      const [row] = await db.select({ id: contentWorkflows.id, currentRevision: contentWorkflows.currentRevision, updatedAt: contentWorkflows.updatedAt }).from(contentWorkflows).where(and(eq(contentWorkflows.workspaceId, input.targetWorkspaceId), eq(contentWorkflows.id, input.targetId))).limit(1);
      return row ?? null;
    }
    if (input.targetKind === "asset") {
      const [row] = await db.select({ id: assets.id, checksum: assets.checksum, deletedAt: assets.deletedAt, updatedAt: assets.updatedAt }).from(assets).where(and(eq(assets.workspaceId, input.targetWorkspaceId), eq(assets.id, input.targetId), isNull(assets.deletedAt))).limit(1);
      return row ?? null;
    }
    if (input.targetKind === "social_post") {
      const [row] = await db.select({ id: socialPosts.id, status: socialPosts.status, updatedAt: socialPosts.updatedAt }).from(socialPosts).where(and(eq(socialPosts.workspaceId, input.targetWorkspaceId), eq(socialPosts.id, input.targetId))).limit(1);
      return row ?? null;
    }
    if (input.targetKind === "channel") {
      const [row] = await db.select({ id: socialAccounts.id, disabled: socialAccounts.disabled, requiresReauth: socialAccounts.requiresReauth, updatedAt: socialAccounts.updatedAt }).from(socialAccounts).where(and(eq(socialAccounts.workspaceId, input.targetWorkspaceId), eq(socialAccounts.id, input.targetId))).limit(1);
      return row && !row.disabled && !row.requiresReauth ? row : null;
    }
    if (input.targetKind === "publishing_delivery") {
      const [row] = await db.select({ id: runtimePublishingDeliveries.id, state: runtimePublishingDeliveries.state, updatedAt: runtimePublishingDeliveries.updatedAt }).from(runtimePublishingDeliveries).where(and(eq(runtimePublishingDeliveries.workspaceId, input.targetWorkspaceId), eq(runtimePublishingDeliveries.id, input.targetId))).limit(1);
      return row ?? null;
    }
    return null;
  }
}
