import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { AgentResourceConstraints } from "@/types/agentAuthorization";
import { PublishingPlanServiceError } from "./errors";
import type {
  PublishingPlanClock,
  PublishingPlanListFilters,
  PublishingPlanListPosition,
  PublishingPlanRepository,
  PublishingPlanRevisionDto,
  PublishingPlanRevisionRecord,
  PublishingPlanSuccessfulValidationEvidence,
  PublishingPlanValidationResult,
} from "./types";
import { PublishingPlanValidator } from "./validation";

const ID = /^[A-Za-z0-9_-]{1,200}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,200}$/;
const systemClock: PublishingPlanClock = { now: () => new Date() };

function identifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!ID.test(normalized)) {
    throw new PublishingPlanServiceError(
      "PUBLISHING_PLAN_INVALID_INPUT",
      `${label} is invalid.`,
    );
  }
  return normalized;
}

function idempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!IDEMPOTENCY_KEY.test(normalized)) {
    throw new PublishingPlanServiceError(
      "PUBLISHING_PLAN_INVALID_INPUT",
      "A stable idempotency key between 8 and 200 visible ASCII characters is required.",
    );
  }
  return normalized;
}

function evidenceRef(value: string, label: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new PublishingPlanServiceError(
      "PUBLISHING_PLAN_PERSISTENCE_UNAVAILABLE",
      `${label} is unavailable.`,
    );
  }
  return normalized;
}

function requestFingerprint(candidate: unknown, expectedRevision?: number): string {
  try {
    return canonicalDigest({
      capability: "publishing_plan_revisions.create@1",
      candidate,
      expectedRevision: expectedRevision ?? null,
    });
  } catch {
    throw new PublishingPlanServiceError(
      "PUBLISHING_PLAN_INVALID_INPUT",
      "Publishing Plan draft must be canonical JSON.",
    );
  }
}

export function publishingPlanRevisionDto(
  revision: PublishingPlanRevisionRecord,
): PublishingPlanRevisionDto {
  return {
    id: revision.id,
    workspaceId: revision.workspaceId,
    planId: revision.planId,
    revision: revision.revision,
    definitionDigest: revision.definitionDigest,
    definition: structuredClone(revision.definition),
    validationEvidence: structuredClone(revision.validationEvidence),
    author: {
      principalId: revision.authorPrincipalId,
      keyId: revision.authorKeyId,
      creationAuthorizationEvidenceRef:
        revision.creationAuthorizationEvidenceRef,
    },
    createdAt: revision.createdAt.toISOString(),
  };
}

export class PublishingPlanRevisionService {
  constructor(
    private readonly repository: PublishingPlanRepository,
    private readonly validator: PublishingPlanValidator,
    private readonly clock: PublishingPlanClock = systemClock,
  ) {}

  validate(input: {
    candidate: unknown;
    workspaceId: string;
    principalId: string;
    keyId: string;
    authorizationEvidenceRef: string;
    effectiveResources: AgentResourceConstraints;
  }): Promise<PublishingPlanValidationResult> {
    return this.validator.validate({
      ...input,
      authorizationContext: {
        keyId: evidenceRef(input.keyId, "Author key"),
        authorizationEvidenceRef: evidenceRef(
          input.authorizationEvidenceRef,
          "Authorization evidence",
        ),
        capability: "publishing_plan_revisions.validate@1",
      },
    });
  }

  async create(input: {
    candidate: unknown;
    workspaceId: string;
    principalId: string;
    keyId: string;
    creationAuthorizationEvidenceRef: string;
    effectiveResources: AgentResourceConstraints;
    idempotencyKey: string;
    expectedRevision?: number;
  }): Promise<PublishingPlanRevisionDto> {
    const key = idempotencyKey(input.idempotencyKey);
    const principalId = evidenceRef(input.principalId, "Author Principal");
    const keyId = evidenceRef(input.keyId, "Author key");
    const authorizationEvidence = evidenceRef(
      input.creationAuthorizationEvidenceRef,
      "Creation authorization evidence",
    );
    if (
      input.expectedRevision !== undefined &&
      (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
    ) {
      throw new PublishingPlanServiceError(
        "PUBLISHING_PLAN_INVALID_INPUT",
        "Expected Revision must be a positive integer when editing.",
      );
    }
    const fingerprint = requestFingerprint(input.candidate, input.expectedRevision);
    const prior = await this.repository.readReceipt({
      workspaceId: input.workspaceId,
      principalId,
      capability: "publishing_plan_revisions.create@1",
      idempotencyKey: key,
      requestFingerprint: fingerprint,
    });
    if (prior.kind === "conflict") {
      throw new PublishingPlanServiceError(
        "PUBLISHING_PLAN_IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to another Publishing Plan request.",
      );
    }
    if (prior.kind === "replayed") {
      const revision = await this.repository.getRevision({
        workspaceId: input.workspaceId,
        revisionId: prior.revisionId,
      });
      if (!revision) {
        throw new PublishingPlanServiceError(
          "PUBLISHING_PLAN_PERSISTENCE_UNAVAILABLE",
          "The original Publishing Plan Revision receipt is unavailable.",
        );
      }
      return publishingPlanRevisionDto(revision);
    }

    const { result: validation, validationSession } =
      await this.validator.validateForCommit({
        candidate: input.candidate,
        workspaceId: input.workspaceId,
        principalId,
        effectiveResources: input.effectiveResources,
        authorizationContext: {
          keyId,
          authorizationEvidenceRef: authorizationEvidence,
          capability: "publishing_plan_revisions.create@1",
        },
      });
    if (
      !validation.valid ||
      !validation.definitionDigest ||
      !validation.normalizedDefinition ||
      !validation.evidence ||
      !validationSession
    ) {
      throw new PublishingPlanServiceError(
        "PUBLISHING_PLAN_VALIDATION_FAILED",
        "Current validation blocked Publishing Plan Revision creation.",
        {
          issues: validation.issues,
          blockers: validation.blockers.map((blocker) => ({
            code: blocker.code,
            targetId: blocker.targetId,
            path: blocker.path,
            ...(blocker.details ? { details: blocker.details } : {}),
          })),
        },
      );
    }
    const now = this.clock.now();
    const successfulEvidence =
      validation.evidence as PublishingPlanSuccessfulValidationEvidence;
    const revision: PublishingPlanRevisionRecord = {
      id: `ppr_${randomUUID().replaceAll("-", "")}`,
      workspaceId: input.workspaceId,
      planId: validation.normalizedDefinition.planId,
      revision: 0,
      definitionDigest: validation.definitionDigest,
      definition: validation.normalizedDefinition,
      validationEvidence: successfulEvidence,
      authorPrincipalId: principalId,
      authorKeyId: keyId,
      creationAuthorizationEvidenceRef: authorizationEvidence,
      createdAt: now,
    };
    const result = await this.repository.createRevision({
      plan: {
        id: revision.planId,
        workspaceId: input.workspaceId,
        currentRevision: 0,
        createdByPrincipalId: principalId,
        createdByKeyId: keyId,
        creationAuthorizationEvidenceRef: authorizationEvidence,
        createdAt: now,
        updatedAt: now,
      },
      mode:
        input.expectedRevision === undefined
          ? { kind: "new" }
          : { kind: "edit", expectedRevision: input.expectedRevision },
      revision,
      receipt: {
        workspaceId: input.workspaceId,
        principalId,
        capability: "publishing_plan_revisions.create@1",
        idempotencyKey: key,
        requestFingerprint: fingerprint,
        revisionId: revision.id,
        createdAt: now,
      },
      validationSession,
    });
    if (result.kind === "conflict") {
      throw new PublishingPlanServiceError(
        "PUBLISHING_PLAN_IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to another Publishing Plan request.",
      );
    }
    if (result.kind === "unavailable") {
      throw new PublishingPlanServiceError(
        "PUBLISHING_PLAN_PERSISTENCE_UNAVAILABLE",
        "Publishing Plan Revision creation could not be committed.",
      );
    }
    if (result.kind === "plan_conflict") {
      throw new PublishingPlanServiceError(
        "PUBLISHING_PLAN_EDIT_CONFLICT",
        "The Publishing Plan cannot be created or edited by this request.",
      );
    }
    if (result.kind === "stale_revision") {
      throw new PublishingPlanServiceError(
        "PUBLISHING_PLAN_REVISION_CONFLICT",
        "The expected Publishing Plan Revision is stale.",
      );
    }
    if (result.kind === "validation_expired") {
      throw new PublishingPlanServiceError(
        "PUBLISHING_PLAN_VALIDATION_EXPIRED",
        "Current validation changed before the revision committed.",
      );
    }
    return publishingPlanRevisionDto(result.revision);
  }

  async getRevision(
    workspaceId: string,
    revisionId: string,
  ): Promise<PublishingPlanRevisionDto> {
    const revision = await this.repository.getRevision({
      workspaceId,
      revisionId: identifier(revisionId, "Revision ID"),
    });
    if (!revision) {
      throw new PublishingPlanServiceError(
        "PUBLISHING_PLAN_NOT_FOUND",
        "Publishing Plan Revision is unavailable.",
      );
    }
    return publishingPlanRevisionDto(revision);
  }

  async listRevisions(input: {
    workspaceId: string;
    filters?: PublishingPlanListFilters;
    before?: PublishingPlanListPosition;
    limit: number;
  }): Promise<PublishingPlanRevisionDto[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 101) {
      throw new PublishingPlanServiceError(
        "PUBLISHING_PLAN_INVALID_INPUT",
        "Publishing Plan page size is invalid.",
      );
    }
    const filters = {
      ...(input.filters?.planId
        ? { planId: identifier(input.filters.planId, "Plan ID") }
        : {}),
    };
    const revisions = await this.repository.listRevisions({
      workspaceId: input.workspaceId,
      filters,
      before: input.before,
      limit: input.limit,
    });
    return revisions.map(publishingPlanRevisionDto);
  }
}
