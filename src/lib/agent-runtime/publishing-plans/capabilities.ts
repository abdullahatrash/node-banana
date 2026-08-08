import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { CapabilityFailure } from "@/lib/agent-tools/errors";
import {
  COMMON_DISCOVERY_ERRORS,
  QUERY_EFFECT,
  defineCapability,
} from "@/lib/agent-tools/registry";
import type {
  CapabilityRegistration,
  JsonSchema,
  ResolvedSecurityContext,
} from "@/types/capabilities";
import { z } from "zod";
import {
  ARTIFACT_ID_PATTERN,
  ARTIFACT_TEXT_MEDIA_TYPE,
} from "../artifacts/validation";
import {
  InvalidPublishingPlanCursorError,
} from "./cursor";
import {
  PUBLISHING_PLAN_ERROR_CATALOG,
  PUBLISHING_PLAN_ERROR_CONTRACTS,
  PublishingPlanServiceError,
} from "./errors";
import { PublishingPlanRevisionService } from "./service";
import type { PublishingPlanCursorCodec } from "./types";
import {
  PUBLISHING_PLAN_CAPABILITY_IDENTITIES,
  PUBLISHING_PLAN_CREATE_AUTHORIZATION,
  PUBLISHING_PLAN_VALIDATE_AUTHORIZATION,
} from "./authorization-contract";
import { PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY } from "./production-digests";
export {
  PUBLISHING_PLAN_CAPABILITY_IDENTITIES,
  PUBLISHING_PLAN_CREATE_AUTHORIZATION,
  PUBLISHING_PLAN_VALIDATE_AUTHORIZATION,
} from "./authorization-contract";

const lifecycle = {
  status: "active",
  introducedAt: "2026-08-08T00:00:00.000Z",
  recommended: true,
} as const;
const mutationEffect = {
  mutation: "runtime-state",
  visibility: "private",
  timing: "immediate",
  reversibility: "conditional",
  maySpendProviderBudget: false,
} as const;
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const artifactId = z.string().min(1).max(200).regex(ARTIFACT_ID_PATTERN);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const iso = z.string().datetime({ offset: true });
const settings = z.record(z.string(), z.unknown());
const draftTiming = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("now") }).strict(),
  z.object({ kind: z.literal("scheduled"), scheduledAt: iso }).strict(),
]);
const draftTarget = z
  .object({
    targetId: id,
    channelId: id,
    contentArtifactId: artifactId,
    mediaArtifactIds: z.array(artifactId).max(50),
    settings,
    timing: draftTiming,
  })
  .strict();
const draft = z
  .object({
    schema: z.literal("publishing-plan-draft/v1"),
    planId: id,
    channelIds: z.array(id).min(1).max(50),
    artifactIds: z.array(artifactId).min(1).max(200),
    targets: z.array(draftTarget).min(1).max(50),
  })
  .strict();
const normalizedTiming = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("now"), publishAt: iso }).strict(),
  z.object({ kind: z.literal("scheduled"), publishAt: iso }).strict(),
]);
const normalizedTarget = draftTarget
  .omit({ timing: true, settings: true })
  .extend({
    settings: z
      .object({ type: z.enum(["person", "organization"]) })
      .strict(),
    timing: normalizedTiming,
  })
  .strict();
const partialNormalizedTarget = draftTarget
  .omit({ timing: true })
  .extend({ timing: normalizedTiming })
  .strict();
const definition = draft
  .omit({ schema: true, targets: true })
  .extend({
    schema: z.literal("publishing-plan-revision-definition/v1"),
    targets: z.array(normalizedTarget),
  })
  .strict();
const partialDefinition = draft
  .omit({ schema: true, targets: true })
  .extend({
    schema: z.literal("publishing-plan-revision-definition/v1"),
    targets: z.array(partialNormalizedTarget),
  })
  .strict();
const blockerCode = z.enum([
  "CHANNEL_INACCESSIBLE",
  "ARTIFACT_MISSING",
  "CONTENT_INVALID",
  "MEDIA_INVALID",
  "SETTINGS_INVALID",
  "TIMING_INVALID",
  "CONTEXT_EXPIRED",
  "POLICY_BLOCKED",
]);
const blocker = z
  .object({
    code: blockerCode,
    targetId: id,
    path: z.string().min(1).max(500).regex(/^[^\u0000-\u001f\u007f]+$/),
    message: z.string().min(1).max(500).regex(/^[^\u0000-\u001f\u007f]+$/),
    details: z
      .object({
        reasonCodes: z
          .array(
            z.enum([
              "EMERGENCY_SPEND_SUSPENDED",
              "POLICY_EVALUATION_UNAVAILABLE",
              "POLICY_CONFIGURATION_INVALID",
            ]),
          )
          .max(32),
      })
      .strict()
      .optional(),
  })
  .strict();
const issue = z
  .object({
    code: z.literal("PUBLISHING_PLAN_DRAFT_INVALID"),
    path: z.string().min(1).max(500),
    message: z.string().min(1).max(500),
  })
  .strict();
const artifactEvidence = z
  .object({
    id: artifactId,
    digest,
    snapshotDigest: digest,
    kind: z.enum(["text", "image"]),
    mediaType: z.enum([
      ARTIFACT_TEXT_MEDIA_TYPE,
      "image/jpeg",
      "image/png",
      "image/gif",
    ]),
    sizeBytes: z.number().int().nonnegative().max(52_428_800),
  })
  .strict();
const channelEvidence = z
  .object({
    id,
    platform: z.literal("linkedin"),
    authorKind: z.enum(["person", "organization"]),
    snapshotDigest: digest,
    capabilityVersion: digest,
  })
  .strict();
const partialValidationEvidence = z
  .object({
    schema: z.literal("publishing-plan-validation-evidence/v1"),
    submittedDraftDigest: digest,
    definitionDigest: digest,
    currentStateDigest: digest,
    evaluatedAt: iso,
    context: z
      .object({
        contextId: id,
        contextDigest: digest,
        issuedAt: iso,
        expiresAt: iso,
        capability: z.enum([
          "publishing_plan_revisions.validate@1",
          "publishing_plan_revisions.create@1",
        ]),
        keyId: id,
        authorizationEvidenceRef: id,
        authorizationContractDigest: digest,
        resources: z
          .object({
            channelIds: z.array(id).min(1).max(50),
            artifactIds: z.array(artifactId).min(1).max(200),
          })
          .strict(),
      })
      .strict(),
    runtimePolicy: z
      .object({
        identity: z.literal(PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY),
        contractDigest: digest,
      })
      .strict(),
    targets: z.array(
      z
        .object({
          targetId: id,
          channel: channelEvidence.nullable(),
          artifacts: z.array(artifactEvidence).max(51),
          settingsDigest: digest,
          publishAt: iso.nullable(),
          policyEvidenceDigest: digest.nullable(),
          policyStateDigest: digest.nullable(),
          blockerCodes: z.array(blockerCode).max(8),
        })
        .strict(),
    ).min(1).max(50),
    authorizesExecution: z.literal(false),
  })
  .strict();
const successfulValidationEvidence = partialValidationEvidence
  .omit({ targets: true })
  .extend({
    targets: z
      .array(
        z
          .object({
            targetId: id,
            channel: channelEvidence,
            artifacts: z.array(artifactEvidence).min(1).max(51),
            settingsDigest: digest,
            publishAt: iso,
            policyEvidenceDigest: digest,
            policyStateDigest: digest,
            blockerCodes: z.tuple([]),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
const validationResult = z
  .object({
    schema: z.literal("publishing-plan-validation-result/v1"),
    valid: z.boolean(),
    issues: z.array(issue).max(250),
    blockers: z.array(blocker).max(400),
    definitionDigest: digest.nullable(),
    normalizedDefinition: partialDefinition.nullable(),
    evidence: partialValidationEvidence.nullable(),
  })
  .strict();
const revision = z
  .object({
    id,
    workspaceId: id,
    planId: id,
    revision: z.number().int().min(1),
    definitionDigest: digest,
    definition,
    validationEvidence: successfulValidationEvidence,
    author: z
      .object({
        principalId: id,
        keyId: id,
        creationAuthorizationEvidenceRef: z.string().min(1).max(200),
      })
      .strict(),
    createdAt: iso,
  })
  .strict();
const page = z
  .object({
    schema: z.literal("publishing-plan-revision-page/v1"),
    items: z.array(revision).max(100),
    nextCursor: z.string().min(1).max(2_048).nullable(),
  })
  .strict();

function schema(value: z.ZodType): JsonSchema {
  return z.toJSONSchema(value, { target: "draft-7" }) as JsonSchema;
}

function agent(
  context: ResolvedSecurityContext | undefined,
): Extract<ResolvedSecurityContext, { kind: "agent" }> {
  if (!context || context.kind !== "agent") {
    throw new CapabilityFailure({
      code: "CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Publishing Plan capability is not authorized.",
    });
  }
  return context;
}

function effectiveResources(context: {
  authorizationAdmission?: { effectiveResources?: unknown };
}) {
  const resources = context.authorizationAdmission?.effectiveResources;
  if (!resources) {
    throw new CapabilityFailure({
      code: "CAPABILITY_NOT_AUTHORIZED",
      category: "authorization",
      message: "Publishing Plan resources are not authorized.",
    });
  }
  return resources as NonNullable<
    typeof context.authorizationAdmission
  >["effectiveResources"] & {
    channelIds: string[];
    credentialProfileIds: string[];
    workflowIds: string[];
    automationIds: string[];
    artifactIds?: string[];
  };
}

function authorizationEvidence(context: {
  authorizationAdmission?: { operatorTraceRef?: string };
}): string {
  const value = context.authorizationAdmission?.operatorTraceRef?.trim();
  if (!value) {
    throw new CapabilityFailure({
      code: "PUBLISHING_PLAN_PERSISTENCE_UNAVAILABLE",
      category: "internal",
      message: "Creation authorization evidence is unavailable.",
      retryable: true,
    });
  }
  return value;
}

async function domain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InvalidPublishingPlanCursorError) {
      throw new CapabilityFailure({
        code: "PUBLISHING_PLAN_CURSOR_INVALID",
        category: "validation",
        message: error.message,
      });
    }
    if (!(error instanceof PublishingPlanServiceError)) throw error;
    const contract = PUBLISHING_PLAN_ERROR_CATALOG[error.code];
    throw new CapabilityFailure({
      code: error.code,
      category: contract.category,
      message: error.message,
      retryable: contract.retryable,
      details: error.details,
    });
  }
}

function filterDigest(filters: { planId?: string }): string {
  return canonicalDigest({
    schema: "publishing-plan-revision-list-filter/v1",
    planId: filters.planId ?? null,
  });
}

export function createPublishingPlanRegistrations(
  service: PublishingPlanRevisionService,
  cursorCodec?: PublishingPlanCursorCodec,
): CapabilityRegistration[] {
  return [
    defineCapability({
      identity: PUBLISHING_PLAN_CAPABILITY_IDENTITIES.validate,
      audience: "agent",
      summary: "Validate a Publishing Plan draft against current target state.",
      lifecycle,
      input: z.object({ draft }).strict(),
      outputSchema: schema(validationResult),
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: PUBLISHING_PLAN_VALIDATE_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_PLAN_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.validate({
            candidate: input.draft,
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            keyId: principal.keyId,
            authorizationEvidenceRef: authorizationEvidence(context),
            effectiveResources: effectiveResources(context),
          }),
        );
      },
    }),
    defineCapability({
      identity: PUBLISHING_PLAN_CAPABILITY_IDENTITIES.create,
      audience: "agent",
      summary: "Append one immutable, currently validated Publishing Plan Revision.",
      lifecycle,
      input: z
        .object({
          idempotencyKey: z.string().min(8).max(200),
          expectedRevision: z.number().int().min(1).optional(),
          draft,
        })
        .strict(),
      outputSchema: schema(revision),
      effect: mutationEffect,
      approval: { mode: "none" },
      idempotency: { mode: "key-required" },
      authorization: PUBLISHING_PLAN_CREATE_AUTHORIZATION,
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_PLAN_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.create({
            candidate: input.draft,
            workspaceId: principal.workspaceId,
            principalId: principal.principalId,
            keyId: principal.keyId,
            creationAuthorizationEvidenceRef: authorizationEvidence(context),
            effectiveResources: effectiveResources(context),
            idempotencyKey: input.idempotencyKey,
            expectedRevision: input.expectedRevision,
          }),
        );
      },
    }),
    defineCapability({
      identity: PUBLISHING_PLAN_CAPABILITY_IDENTITIES.get,
      audience: "agent",
      summary: "Read one immutable Publishing Plan Revision and safe evidence.",
      lifecycle,
      input: z.object({ revisionId: id }).strict(),
      outputSchema: schema(revision),
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_PLAN_ERROR_CONTRACTS],
      handler: (input, context) => {
        const principal = agent(context.securityContext);
        return domain(() =>
          service.getRevision(principal.workspaceId, input.revisionId),
        );
      },
    }),
    defineCapability({
      identity: PUBLISHING_PLAN_CAPABILITY_IDENTITIES.list,
      audience: "agent",
      summary: "List immutable Publishing Plan Revisions with a sealed cursor.",
      lifecycle,
      input: z
        .object({
          planId: id.optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().min(1).max(2_048).optional(),
        })
        .strict(),
      outputSchema: schema(page),
      effect: QUERY_EFFECT,
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      authorization: { resources: [] },
      errors: [...COMMON_DISCOVERY_ERRORS, ...PUBLISHING_PLAN_ERROR_CONTRACTS],
      handler: async (input, context) => {
        const principal = agent(context.securityContext);
        const filters = { ...(input.planId ? { planId: input.planId } : {}) };
        const digest = filterDigest(filters);
        if (input.cursor && !cursorCodec) {
          throw new CapabilityFailure({
            code: "PUBLISHING_PLAN_CURSOR_INVALID",
            category: "validation",
            message: "Publishing Plan cursor is invalid or unavailable.",
          });
        }
        const before = input.cursor
          ? await domain(async () =>
              cursorCodec!.open({
                cursor: input.cursor!,
                workspaceId: principal.workspaceId,
                principalId: principal.principalId,
                filterDigest: digest,
              }),
            )
          : undefined;
        const values = await domain(() =>
          service.listRevisions({
            workspaceId: principal.workspaceId,
            filters,
            before,
            limit: input.limit + 1,
          }),
        );
        const items = values.slice(0, input.limit);
        const last = items.at(-1);
        const nextCursor =
          values.length > input.limit && last && cursorCodec
            ? cursorCodec.seal({
                workspaceId: principal.workspaceId,
                principalId: principal.principalId,
                filterDigest: digest,
                position: { createdAt: new Date(last.createdAt), id: last.id },
              })
            : null;
        return {
          schema: "publishing-plan-revision-page/v1" as const,
          items,
          nextCursor,
        };
      },
    }),
  ];
}
