import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import { COMMON_DISCOVERY_ERRORS, QUERY_EFFECT, defineCapability } from "@/lib/agent-tools/registry";
import type { CapabilityErrorContract, CapabilityRegistration, JsonSchema, ResolvedSecurityContext } from "@/types/capabilities";
import { z } from "zod";
import { ARTIFACT_ID_PATTERN } from "../artifacts/validation";
import {
  PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES,
  PUBLISHING_APPROVAL_REQUEST_AUTHORIZATION,
  publishingApprovalRequestAuthorizationContractDigest,
} from "./authorization-contract";
import {
  PUBLISHING_APPROVAL_ERROR_CATALOG,
  PUBLISHING_APPROVAL_ERROR_CONTRACTS,
  PublishingApprovalServiceError,
} from "./errors";
import { PublishingApprovalService } from "./service";
import { publishingApprovalAgentDtoFromDto } from "./service";
import type { PublishingApprovalCursorCodec } from "./types";
import { InvalidPublishingApprovalCursorError } from "./cursor";
import { PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY, publishingPlanRuntimePolicyContractDigest } from "../publishing-plans/production-digests";

export {
  PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES,
  PUBLISHING_APPROVAL_REQUEST_AUTHORIZATION,
  publishingApprovalRequestAuthorizationContractDigest,
} from "./authorization-contract";

const lifecycle = { status: "active", introducedAt: "2026-08-08T00:00:00.000Z", recommended: true } as const;
const mutationEffect = { mutation: "runtime-state", visibility: "private", timing: "immediate", reversibility: "conditional", maySpendProviderBudget: false } as const;
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const artifactId = z.string().min(1).max(200).regex(ARTIFACT_ID_PATTERN);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const iso = z.string().datetime({ offset: true });
const evidenceRef = z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/);
const resources = z.object({ channelIds: z.array(id).min(1).max(50), artifactIds: z.array(artifactId).min(1).max(200) }).strict();
const validation = z.object({
  evidenceDigest: digest,
  currentStateDigest: digest,
  contextId: id,
  contextDigest: digest,
  evaluatedAt: iso,
  expiresAt: iso,
  runtimePolicyIdentity: z.literal(PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY),
  runtimePolicyContractDigest: z.literal(publishingPlanRuntimePolicyContractDigest()),
}).strict();
const authorityGrant = z.object({ channelId: id, grantId: id }).strict();
const decision = z.object({
  id,
  workspaceId: id,
  approvalRequestId: id,
  decision: z.enum(["approved", "denied"]),
  decidedByUserId: id,
  authorityEvidenceRef: evidenceRef,
  authorityEvidenceDigest: digest,
  authorityGrants: z.array(authorityGrant).min(1).max(50),
  inspectionDigest: digest,
  decidedAt: iso,
  authorizesExecution: z.literal(false),
}).strict();
const consumption = z.object({
  id,
  workspaceId: id,
  approvalRequestId: id,
  decisionId: id,
  consumingPrincipalId: id,
  consumingKeyId: id,
  capability: z.literal("publishing_plan_revisions.release@1"),
  authorizationContractDigest: digest,
  authorizationEvidenceRef: evidenceRef,
  authorizedResources: resources,
  authorizationIssuedAt: iso,
  authorizationExpiresAt: iso,
  consumedAt: iso,
}).strict();
const approval = z.object({
  id,
  workspaceId: id,
  planId: id,
  planRevisionId: id,
  planRevision: z.number().int().min(1),
  planRevisionDigest: digest,
  action: z.literal("publish"),
  targetIds: z.array(id).min(1).max(50),
  channelIds: z.array(id).min(1).max(50),
  artifactIds: z.array(artifactId).min(1).max(200),
  retrySource: z.object({ deliveryId: id, evidenceDigest: digest }).strict().nullable(),
  requestingPrincipalId: id,
  requestingKeyId: id,
  requestAuthorization: z.object({
    capability: z.literal("publishing_approvals.request@1"),
    contractDigest: digest,
    evidenceRef,
    resources,
  }).strict(),
  validation,
  decisionPolicy: z.object({ mode: z.literal("expires_at"), expiresAt: iso }).strict(),
  createdAt: iso,
  decision: decision.nullable(),
  consumption: consumption.nullable(),
  authorizesExecution: z.literal(false),
  status: z.enum(["pending", "approved", "denied", "consumed", "expired"]),
  inspectionDigest: digest,
}).strict();
const agentDecision = z.object({ approvalRef: id, decision: z.enum(["approved", "denied"]), decidedAt: iso, authorizesExecution: z.literal(false) }).strict();
const agentApproval = z.object({
  id, workspaceId: id, planId: id, planRevisionId: id, planRevision: z.number().int().min(1), planRevisionDigest: digest,
  action: z.literal("publish"), targetIds: z.array(id).min(1).max(50), channelIds: z.array(id).min(1).max(50), artifactIds: z.array(artifactId).min(1).max(200),
  retrySource: z.object({ deliveryId: id, evidenceDigest: digest }).strict().nullable(),
  validation, decisionPolicy: z.object({ mode: z.literal("expires_at"), expiresAt: iso }).strict(),
  status: z.enum(["pending", "approved", "denied", "consumed", "expired"]), decision: agentDecision.nullable(),
  consumption: z.object({ consumed: z.literal(true), consumedAt: iso }).strict().nullable(), createdAt: iso, authorizesExecution: z.literal(false),
}).strict();
const page = z.object({ schema: z.literal("publishing-approval-page/v1"), items: z.array(agentApproval).max(100), nextCursor: z.string().min(1).max(2048).nullable() }).strict();

function schema(value: z.ZodType): JsonSchema {
  return z.toJSONSchema(value, { target: "draft-7" }) as JsonSchema;
}

function agent(context: ResolvedSecurityContext | undefined) {
  if (!context || context.kind !== "agent") {
    throw new CapabilityFailure({ code: "CAPABILITY_NOT_AUTHORIZED", category: "authorization", message: "Only an authenticated Agent Principal may request Publishing Approval." });
  }
  return context;
}

function humanMutation(context: ResolvedSecurityContext | undefined) {
  if (!context || context.kind !== "human") {
    throw new CapabilityFailure({ code: "PUBLISHING_APPROVAL_AUTHORITY_REQUIRED", category: "authorization", message: "Only an authorized Human Principal may decide Publishing Approval." });
  }
  if (!context.idempotencyKey) {
    throw new CapabilityFailure({ code: "PUBLISHING_APPROVAL_INVALID_INPUT", category: "validation", message: "Idempotency-Key is required for a human Approval decision." });
  }
  return context as typeof context & { idempotencyKey: string };
}

function admittedResources(context: { authorizationAdmission?: { effectiveResources?: unknown } }, requested: { channelIds: string[]; artifactIds: string[] }): { channelIds: string[]; artifactIds: string[] } {
  const value = context.authorizationAdmission?.effectiveResources as { channelIds?: string[]; artifactIds?: string[] } | undefined;
  if (!value?.channelIds || !value.artifactIds) throw new CapabilityFailure({ code: "CAPABILITY_NOT_AUTHORIZED", category: "authorization", message: "Approval observation resources are not authorized." });
  if (requested.channelIds.some((id) => !value.channelIds!.includes(id)) || requested.artifactIds.some((id) => !value.artifactIds!.includes(id))) throw new CapabilityFailure({ code: "CAPABILITY_NOT_AUTHORIZED", category: "authorization", message: "Approval observation resources are not authorized." });
  return { channelIds: [...requested.channelIds], artifactIds: [...requested.artifactIds] };
}

function authorizationEvidence(context: { authorizationAdmission?: { operatorTraceRef?: string } }): string {
  const value = context.authorizationAdmission?.operatorTraceRef?.trim();
  if (!value) throw new CapabilityFailure({ code: "PUBLISHING_APPROVAL_PERSISTENCE_UNAVAILABLE", category: "internal", message: "Request authorization evidence is unavailable.", retryable: true });
  return value;
}

async function domain<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof InvalidPublishingApprovalCursorError) {
      throw new CapabilityFailure({ code: "PUBLISHING_APPROVAL_INVALID_INPUT", category: "validation", message: error.message });
    }
    if (!(error instanceof PublishingApprovalServiceError)) throw error;
    const contract = PUBLISHING_APPROVAL_ERROR_CATALOG[error.code];
    throw new CapabilityFailure({ code: error.code, category: contract.category, message: error.message, retryable: contract.retryable, details: error.details });
  }
}

function filterDigest(filters: { status?: string; planRevisionId?: string; channelIds: string[]; artifactIds: string[] }): string {
  return canonicalDigest({ schema: "publishing-approval-list-filter/v1", status: filters.status ?? null, planRevisionId: filters.planRevisionId ?? null, channelIds: [...filters.channelIds].sort(), artifactIds: [...filters.artifactIds].sort() });
}

const humanErrors: CapabilityErrorContract[] = [
  ...COMMON_DISCOVERY_ERRORS,
  {
    code: "HUMAN_CAPABILITY_NOT_AUTHORIZED",
    category: "authorization",
    retryable: false,
    description: "An authenticated Workspace owner or admin is required.",
  },
  {
    code: "IDEMPOTENCY_KEY_REQUIRED",
    category: "validation",
    retryable: false,
    description: "A transport Idempotency-Key is required for this mutation.",
  },
  ...PUBLISHING_APPROVAL_ERROR_CONTRACTS,
];

export function createPublishingApprovalRegistrations(
  service: PublishingApprovalService,
  cursorCodec?: PublishingApprovalCursorCodec,
): CapabilityRegistration[] {
  return [
    defineCapability({
      identity: PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.request,
      audience: "agent",
      summary: "Request durable human Approval for one exact current Publishing Plan Revision action and Target set.",
      lifecycle,
      input: z.object({
        idempotencyKey: z.string().min(8).max(200), revisionId: id,
        action: z.literal("publish"), targetIds: z.array(id).min(1).max(50),
        channelIds: z.array(id).min(1).max(50), artifactIds: z.array(artifactId).min(1).max(200),
        retrySource: z.object({ deliveryId: id, evidenceDigest: digest }).strict().optional(), expiresAt: iso,
      }).strict(),
      outputSchema: schema(agentApproval), effect: mutationEffect,
      approval: { mode: "manages-approval" }, idempotency: { mode: "key-required" },
      authorization: PUBLISHING_APPROVAL_REQUEST_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_APPROVAL_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(async () => publishingApprovalAgentDtoFromDto(await service.request({ ...input, workspaceId: principal.workspaceId, principalId: principal.principalId, keyId: principal.keyId, requestAuthorizationEvidenceRef: authorizationEvidence(context), requestAuthorizationContractDigest: publishingApprovalRequestAuthorizationContractDigest() })));
      },
    }),
    defineCapability({
      identity: PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.get,
      audience: "agent", summary: "Observe one requester-scoped redacted durable Publishing Approval request and decision.", lifecycle,
      input: z.object({ approvalRequestId: id, channelIds: z.array(id).min(1).max(50), artifactIds: z.array(artifactId).min(1).max(200) }).strict(), outputSchema: schema(agentApproval), effect: QUERY_EFFECT,
      approval: { mode: "none" }, idempotency: { mode: "retry-safe" }, authorization: PUBLISHING_APPROVAL_REQUEST_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_APPROVAL_ERROR_CONTRACTS],
      handler: (input, context) => { const principal = agent(context.securityContext); const admitted = admittedResources(context, input); return domain(() => service.getAgent({ workspaceId: principal.workspaceId, approvalRequestId: input.approvalRequestId, viewer: { principalId: principal.principalId, authorizedChannelIds: admitted.channelIds, authorizedArtifactIds: admitted.artifactIds } })); },
    }),
    defineCapability({
      identity: PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.list,
      audience: "agent", summary: "List requester-scoped redacted Publishing Approval requests using a sealed actor-bound cursor.", lifecycle,
      input: z.object({ channelIds: z.array(id).min(1).max(50), artifactIds: z.array(artifactId).min(1).max(200), status: z.enum(["pending", "approved", "denied", "consumed", "expired"]).optional(), planRevisionId: id.optional(), limit: z.number().int().min(1).max(100).default(50), cursor: z.string().min(1).max(2048).optional() }).strict(),
      outputSchema: schema(page), effect: QUERY_EFFECT, approval: { mode: "none" }, idempotency: { mode: "retry-safe" }, authorization: PUBLISHING_APPROVAL_REQUEST_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_APPROVAL_ERROR_CONTRACTS],
      handler: async (input, context) => {
        const principal = agent(context.securityContext);
        const admitted = admittedResources(context, input);
        const filters = { ...(input.status ? { status: input.status } : {}), ...(input.planRevisionId ? { planRevisionId: input.planRevisionId } : {}) };
        const digestValue = filterDigest({ ...filters, channelIds: input.channelIds, artifactIds: input.artifactIds });
        if (input.cursor && !cursorCodec) throw new CapabilityFailure({ code: "PUBLISHING_APPROVAL_INVALID_INPUT", category: "validation", message: "Approval cursor is invalid or unavailable." });
        const before = input.cursor ? cursorCodec!.open({ cursor: input.cursor, workspaceId: principal.workspaceId, actorId: principal.principalId, filterDigest: digestValue }) : undefined;
        const values = await domain(() => service.listAgent({ workspaceId: principal.workspaceId, filters, before, limit: input.limit + 1, viewer: { principalId: principal.principalId, authorizedChannelIds: admitted.channelIds, authorizedArtifactIds: admitted.artifactIds } }));
        const items = values.slice(0, input.limit);
        const last = items.at(-1);
        return { schema: "publishing-approval-page/v1" as const, items, nextCursor: values.length > input.limit && last && cursorCodec ? cursorCodec.seal({ workspaceId: principal.workspaceId, actorId: principal.principalId, filterDigest: digestValue, position: { createdAt: new Date(last.createdAt), id: last.id } }) : null };
      },
    }),
    defineCapability({
      identity: PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES.decide,
      audience: "human", summary: "Approve or deny one exact inspected Publishing Approval request with explicit current Channel authority.", lifecycle,
      input: z.object({ approvalRequestId: id, expectedInspectionDigest: digest, decision: z.enum(["approved", "denied"]) }).strict(),
      outputSchema: schema(approval), effect: mutationEffect, approval: { mode: "manages-approval" }, idempotency: { mode: "key-required" }, authorization: { resources: [] },
      errors: humanErrors,
      handler: (input, context) => { const human = humanMutation(context.securityContext); return domain(() => service.decide({ ...input, workspaceId: human.workspaceId, userId: human.userId, idempotencyKey: human.idempotencyKey })); },
    }),
  ];
}
