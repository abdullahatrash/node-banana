import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  PublishingPlanArtifactSnapshot,
  PublishingPlanArtifactSnapshotPort,
  PublishingPlanChannelSnapshot,
  PublishingPlanChannelSnapshotPort,
  PublishingPlanCommitResult,
  PublishingPlanMutationReceiptRecord,
  PublishingPlanRepository,
  PublishingPlanRecord,
  PublishingPlanRevisionRecord,
  PublishingPlanRuntimePolicyDecision,
  PublishingPlanRuntimePolicyPort,
  PublishingPlanValidationContextPort,
  PublishingPlanValidationContextSnapshot,
  PublishingPlanValidationSession,
} from "./types";
import {
  PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY,
  publishingPlanRuntimePolicyContractDigest,
} from "./production-digests";

function key(...parts: string[]): string {
  return parts.join("\u0000");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export class InMemoryPublishingPlanRepository
  implements PublishingPlanRepository
{
  readonly revisions = new Map<string, PublishingPlanRevisionRecord>();
  readonly plans = new Map<string, PublishingPlanRecord>();
  readonly receipts = new Map<string, PublishingPlanMutationReceiptRecord>();
  readonly consumedValidationSessions = new Set<string>();
  failNextCommit = false;
  beforeValidationSessionCheck: (() => void | Promise<void>) | null = null;
  private validationSessionVerifier: (
    session: PublishingPlanValidationSession,
  ) => Promise<boolean> = async () => false;
  private mutationTail: Promise<void> = Promise.resolve();

  private async lock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.mutationTail = previous.then(() => current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  setValidationSessionVerifier(
    verifier: (session: PublishingPlanValidationSession) => Promise<boolean>,
  ): void {
    this.validationSessionVerifier = verifier;
  }

  async readReceipt(
    input: Parameters<PublishingPlanRepository["readReceipt"]>[0],
  ) {
    const found = this.receipts.get(
      key(
        input.workspaceId,
        input.principalId,
        input.capability,
        input.idempotencyKey,
      ),
    );
    if (!found) return { kind: "absent" as const };
    return found.requestFingerprint === input.requestFingerprint
      ? { kind: "replayed" as const, revisionId: found.revisionId }
      : { kind: "conflict" as const };
  }

  async createRevision(
    input: Parameters<PublishingPlanRepository["createRevision"]>[0],
  ): Promise<PublishingPlanCommitResult> {
    return this.lock(async () => {
      const receiptKey = key(
        input.receipt.workspaceId,
        input.receipt.principalId,
        input.receipt.capability,
        input.receipt.idempotencyKey,
      );
      const existingReceipt = this.receipts.get(receiptKey);
      if (existingReceipt) {
        if (
          existingReceipt.requestFingerprint !== input.receipt.requestFingerprint
        ) {
          return { kind: "conflict" };
        }
        const revision = this.revisions.get(
          key(input.revision.workspaceId, existingReceipt.revisionId),
        );
        return revision
          ? { kind: "replayed", revision: clone(revision) }
          : { kind: "unavailable" };
      }
      if (this.failNextCommit) {
        this.failNextCommit = false;
        return { kind: "unavailable" };
      }
      const planKey = key(input.plan.workspaceId, input.plan.id);
      const existingPlan = this.plans.get(planKey);
      if (input.mode.kind === "new" && existingPlan) {
        return { kind: "plan_conflict" };
      }
      if (
        input.mode.kind === "edit" &&
        (!existingPlan ||
          existingPlan.createdByPrincipalId !== input.revision.authorPrincipalId)
      ) {
        return { kind: "plan_conflict" };
      }
      if (
        input.mode.kind === "edit" &&
        existingPlan!.currentRevision !== input.mode.expectedRevision
      ) {
        return { kind: "stale_revision" };
      }
      if (
        input.plan.id !== input.revision.planId ||
        input.plan.workspaceId !== input.revision.workspaceId ||
        input.plan.createdByPrincipalId !== input.revision.authorPrincipalId ||
        input.plan.createdByKeyId !== input.revision.authorKeyId ||
        input.plan.creationAuthorizationEvidenceRef !==
          input.revision.creationAuthorizationEvidenceRef ||
        input.validationSession.workspaceId !== input.revision.workspaceId ||
        input.validationSession.principalId !== input.revision.authorPrincipalId ||
        input.validationSession.planId !== input.revision.planId ||
        input.validationSession.definitionDigest !== input.revision.definitionDigest ||
        input.validationSession.submittedDraftDigest !==
          input.revision.validationEvidence.submittedDraftDigest ||
        input.validationSession.currentStateDigest !==
          input.revision.validationEvidence.currentStateDigest ||
        input.revision.validationEvidence.definitionDigest !==
          input.revision.definitionDigest ||
        input.validationSession.authorizationContext.keyId !==
          input.revision.authorKeyId ||
        input.validationSession.authorizationContext.authorizationEvidenceRef !==
          input.revision.creationAuthorizationEvidenceRef ||
        input.validationSession.authorizationContext.authorizationContractDigest !==
          input.revision.validationEvidence.context.authorizationContractDigest ||
        input.validationSession.authorizationContext.contextDigest !==
          input.revision.validationEvidence.context.contextDigest ||
        input.validationSession.authorizationContext.contextId !==
          input.revision.validationEvidence.context.contextId ||
        input.validationSession.authorizationContext.capability !==
          input.revision.validationEvidence.context.capability ||
        input.validationSession.authorizationContext.contextIssuedAt.toISOString() !==
          input.revision.validationEvidence.context.issuedAt ||
        input.validationSession.authorizationContext.contextExpiresAt.toISOString() !==
          input.revision.validationEvidence.context.expiresAt ||
        canonicalDigest(input.validationSession.authorizationContext.resources) !==
          canonicalDigest(input.revision.validationEvidence.context.resources) ||
        input.validationSession.issuedAt.getTime() > input.revision.createdAt.getTime() ||
        input.validationSession.expiresAt.getTime() <= input.revision.createdAt.getTime() ||
        input.validationSession.targets.length !== input.revision.definition.targets.length ||
        input.validationSession.targets.some((sessionTarget, index) => {
          const definitionTarget = input.revision.definition.targets[index];
          const evidenceTarget = input.revision.validationEvidence.targets[index];
          return (
            !definitionTarget ||
            !evidenceTarget ||
            sessionTarget.targetId !== definitionTarget.targetId ||
            sessionTarget.channelId !== definitionTarget.channelId ||
            sessionTarget.channelSnapshotDigest !==
              evidenceTarget.channel?.snapshotDigest ||
            sessionTarget.contentArtifactId !==
              definitionTarget.contentArtifactId ||
            JSON.stringify(sessionTarget.mediaArtifactIds) !==
              JSON.stringify(definitionTarget.mediaArtifactIds) ||
            JSON.stringify(sessionTarget.artifactSnapshotDigests) !==
              JSON.stringify(
                evidenceTarget.artifacts.map((artifact) => artifact.snapshotDigest),
              ) ||
            canonicalDigest(sessionTarget.settings) !==
              canonicalDigest(definitionTarget.settings) ||
            canonicalDigest(sessionTarget.timing) !==
              canonicalDigest(definitionTarget.timing) ||
            sessionTarget.policyEvidenceDigest !==
              evidenceTarget.policyEvidenceDigest ||
            sessionTarget.policyStateDigest !== evidenceTarget.policyStateDigest
          );
        }) ||
        this.consumedValidationSessions.has(input.validationSession.id)
      ) {
        return { kind: "validation_expired" };
      }
      await this.beforeValidationSessionCheck?.();
      if (!(await this.validationSessionVerifier(input.validationSession))) {
        return { kind: "validation_expired" };
      }
      this.consumedValidationSessions.add(input.validationSession.id);
      const currentRevision = existingPlan?.currentRevision ?? 0;
      const storedRevision = immutable(
        clone({ ...input.revision, revision: currentRevision + 1 }),
      );
      const storedReceipt = immutable(
        clone({ ...input.receipt, revisionId: storedRevision.id }),
      );
      this.revisions.set(
        key(storedRevision.workspaceId, storedRevision.id),
        storedRevision,
      );
      this.plans.set(
        planKey,
        immutable(
          clone({
            ...(existingPlan ?? input.plan),
            currentRevision: storedRevision.revision,
            updatedAt: storedRevision.createdAt,
          }),
        ),
      );
      this.receipts.set(receiptKey, storedReceipt);
      return { kind: "created", revision: clone(storedRevision) };
    });
  }

  async getRevision(
    input: Parameters<PublishingPlanRepository["getRevision"]>[0],
  ) {
    const found = this.revisions.get(key(input.workspaceId, input.revisionId));
    return found ? clone(found) : null;
  }

  async listRevisions(
    input: Parameters<PublishingPlanRepository["listRevisions"]>[0],
  ) {
    return [...this.revisions.values()]
      .filter(
        (revision) =>
          revision.workspaceId === input.workspaceId &&
          (!input.filters.planId || revision.planId === input.filters.planId) &&
          (!input.before ||
            revision.createdAt < input.before.createdAt ||
            (revision.createdAt.getTime() === input.before.createdAt.getTime() &&
              revision.id < input.before.id)),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id),
      )
      .slice(0, input.limit)
      .map(clone);
  }
}

export class InMemoryPublishingPlanValidationContexts
  implements PublishingPlanValidationContextPort
{
  readonly snapshots = new Map<string, PublishingPlanValidationContextSnapshot>();

  put(snapshot: PublishingPlanValidationContextSnapshot): void {
    this.snapshots.set(
      key(
        snapshot.workspaceId,
        snapshot.principalId,
        snapshot.keyId,
        snapshot.authorizationEvidenceRef,
        snapshot.capability,
      ),
      clone(snapshot),
    );
  }

  async resolveCurrent(
    input: Parameters<PublishingPlanValidationContextPort["resolveCurrent"]>[0],
  ) {
    const found = this.snapshots.get(
      key(
        input.workspaceId,
        input.principalId,
        input.keyId,
        input.authorizationEvidenceRef,
        input.capability,
      ),
    );
    return found ? clone(found) : null;
  }
}

export class InMemoryPublishingPlanArtifacts
  implements PublishingPlanArtifactSnapshotPort
{
  readonly snapshots = new Map<string, PublishingPlanArtifactSnapshot>();

  put(snapshot: PublishingPlanArtifactSnapshot): void {
    this.snapshots.set(key(snapshot.workspaceId, snapshot.id), clone(snapshot));
  }

  async getCurrent(
    input: Parameters<PublishingPlanArtifactSnapshotPort["getCurrent"]>[0],
  ) {
    const found = this.snapshots.get(key(input.workspaceId, input.artifactId));
    return found ? clone(found) : null;
  }
}

export class InMemoryPublishingPlanChannels
  implements PublishingPlanChannelSnapshotPort
{
  readonly snapshots = new Map<string, PublishingPlanChannelSnapshot>();

  put(snapshot: PublishingPlanChannelSnapshot): void {
    this.snapshots.set(key(snapshot.workspaceId, snapshot.id), clone(snapshot));
  }

  async getCurrent(
    input: Parameters<PublishingPlanChannelSnapshotPort["getCurrent"]>[0],
  ) {
    const found = this.snapshots.get(key(input.workspaceId, input.channelId));
    return found ? clone(found) : null;
  }
}

export class InMemoryPublishingPlanRuntimePolicy
  implements PublishingPlanRuntimePolicyPort
{
  readonly identity = PUBLISHING_PLAN_RUNTIME_POLICY_IDENTITY;
  readonly contractDigest = publishingPlanRuntimePolicyContractDigest();
  readonly blockedTargets = new Map<string, string[]>();

  block(targetId: string, reasonCodes = ["EMERGENCY_SPEND_SUSPENDED"]): void {
    this.blockedTargets.set(targetId, [...reasonCodes]);
  }

  async evaluate(
    input: Parameters<PublishingPlanRuntimePolicyPort["evaluate"]>[0],
  ): Promise<PublishingPlanRuntimePolicyDecision> {
    const reasonCodes = this.blockedTargets.get(input.target.targetId) ?? [];
    return {
      allowed: reasonCodes.length === 0,
      reasonCodes: [...reasonCodes],
      evidenceDigest: canonicalDigest({
        identity: this.identity,
        contractDigest: this.contractDigest,
        workspaceId: input.workspaceId,
        targetId: input.target.targetId,
        allowed: reasonCodes.length === 0,
        reasonCodes: [...reasonCodes].sort(),
      }),
      stateDigest: canonicalDigest({
        identity: this.identity,
        contractDigest: this.contractDigest,
        workspaceId: input.workspaceId,
        blockedTargets: [...this.blockedTargets.entries()]
          .map(([targetId, codes]) => [targetId, [...codes].sort()])
          .sort(([left], [right]) => String(left).localeCompare(String(right))),
      }),
    };
  }
}
