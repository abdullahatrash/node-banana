import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  PublishingApprovalAuthoritySession,
  PublishingApprovalCreateResult,
  PublishingApprovalDecideResult,
  PublishingApprovalMutationReceiptRecord,
  PublishingApprovalRepository,
  PublishingApprovalRequestRecord,
  PublishingApprovalRetrySourceRecord,
  PublishingApprovalValidationSession,
} from "./types";
import { publishingApprovalInspectionDigest } from "./validation";

function key(...parts: string[]): string {
  return parts.join("\u0000");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryPublishingApprovalRepository
  implements PublishingApprovalRepository
{
  readonly requests = new Map<string, PublishingApprovalRequestRecord>();
  readonly receipts = new Map<string, PublishingApprovalMutationReceiptRecord>();
  readonly retrySources = new Map<string, PublishingApprovalRetrySourceRecord>();
  private validationVerifier: (session: PublishingApprovalValidationSession) => Promise<boolean> = async () => false;
  private authorityVerifier: (session: PublishingApprovalAuthoritySession) => Promise<boolean> = async () => false;
  private tail: Promise<void> = Promise.resolve();
  failNextMutation = false;

  seedRetrySource(source: PublishingApprovalRetrySourceRecord): void {
    this.retrySources.set(key(source.workspaceId, source.deliveryId), clone(source));
  }

  setValidationSessionVerifier(verifier: (session: PublishingApprovalValidationSession) => Promise<boolean>): void {
    this.validationVerifier = verifier;
  }

  setAuthoritySessionVerifier(verifier: (session: PublishingApprovalAuthoritySession) => Promise<boolean>): void {
    this.authorityVerifier = verifier;
  }

  private async lock<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.tail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tail = prior.then(() => current);
    await prior;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async readMutationReceipt(input: Parameters<PublishingApprovalRepository["readMutationReceipt"]>[0]) {
    const receipt = this.receipts.get(key(input.workspaceId, input.actorKind, input.actorId, input.capability, input.idempotencyKey));
    if (!receipt) return { kind: "absent" as const };
    return receipt.requestFingerprint === input.requestFingerprint
      ? { kind: "replayed" as const, approvalRequestId: receipt.approvalRequestId, decisionId: receipt.decisionId }
      : { kind: "conflict" as const };
  }

  async createRequest(input: Parameters<PublishingApprovalRepository["createRequest"]>[0]): Promise<PublishingApprovalCreateResult> {
    return this.lock(async () => {
      const receiptKey = key(input.receipt.workspaceId, input.receipt.actorKind, input.receipt.actorId, input.receipt.capability, input.receipt.idempotencyKey);
      const existingReceipt = this.receipts.get(receiptKey);
      if (existingReceipt) {
        if (existingReceipt.requestFingerprint !== input.receipt.requestFingerprint) return { kind: "conflict" };
        const replay = this.requests.get(key(input.request.workspaceId, existingReceipt.approvalRequestId));
        return replay ? { kind: "replayed", request: clone(replay) } : { kind: "unavailable" };
      }
      if (this.failNextMutation) { this.failNextMutation = false; return { kind: "unavailable" }; }
      if (
        input.validationSession.schema !== "publishing-approval-validation-session/v1" ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(input.validationSession.id) ||
        input.validationSession.workspaceId !== input.request.workspaceId ||
        input.validationSession.planRevisionId !== input.request.planRevisionId ||
        input.validationSession.planRevisionDigest !== input.request.planRevisionDigest ||
        canonicalDigest(input.validationSession.targetIds) !== canonicalDigest(input.request.targetIds) ||
        canonicalDigest(input.validationSession.binding) !== canonicalDigest(input.request.validation) ||
        input.validationSession.expiresAt.toISOString() !== input.request.validation.expiresAt ||
        input.validationSession.issuedAt.getTime() < new Date(input.request.validation.evaluatedAt).getTime() ||
        input.validationSession.issuedAt.getTime() > input.request.createdAt.getTime() ||
        input.validationSession.expiresAt.getTime() <= input.request.createdAt.getTime() ||
        !(await this.validationVerifier(clone(input.validationSession)))
      ) return { kind: "stale_validation" };
      if (input.request.retrySource) {
        const source = this.retrySources.get(key(
          input.request.workspaceId,
          input.request.retrySource.deliveryId,
        ));
        if (
          !source ||
          source.evidenceDigest !== input.request.retrySource.evidenceDigest ||
          source.desiredState !== "publish" ||
          !((source.state === "failed_transient" &&
            source.failureClass === "transient" && source.retryable) ||
            (source.state === "failed_terminal" &&
              source.failureClass === "terminal" && !source.retryable)) ||
          source.planId !== input.request.planId ||
          source.planRevisionId !== input.request.planRevisionId ||
          source.planRevision !== input.request.planRevision ||
          source.planRevisionDigest !== input.request.planRevisionDigest ||
          source.requestingPrincipalId !== input.request.requestingPrincipalId ||
          canonicalDigest([source.targetId]) !== canonicalDigest(input.request.targetIds) ||
          canonicalDigest([source.channelId]) !== canonicalDigest(input.request.channelIds) ||
          canonicalDigest([...source.artifactIds].sort()) !==
            canonicalDigest([...input.request.artifactIds].sort())
        ) return { kind: "stale_validation" };
      }
      const requestKey = key(input.request.workspaceId, input.request.id);
      if (this.requests.has(requestKey)) return { kind: "conflict" };
      this.requests.set(requestKey, clone(input.request));
      this.receipts.set(receiptKey, clone(input.receipt));
      return { kind: "created", request: clone(input.request) };
    });
  }

  async getRequest(input: Parameters<PublishingApprovalRepository["getRequest"]>[0]) {
    const request = this.requests.get(key(input.workspaceId, input.approvalRequestId));
    return request && (!input.requestingPrincipalId || request.requestingPrincipalId === input.requestingPrincipalId) ? clone(request) : null;
  }

  async listRequests(input: Parameters<PublishingApprovalRepository["listRequests"]>[0]) {
    return [...this.requests.values()]
      .filter((request) => request.workspaceId === input.workspaceId)
      .filter((request) => !input.filters.requestingPrincipalId || request.requestingPrincipalId === input.filters.requestingPrincipalId)
      .filter((request) => !input.filters.authorizedChannelIds || request.channelIds.every((id) => input.filters.authorizedChannelIds!.includes(id)))
      .filter((request) => !input.filters.authorizedArtifactIds || request.artifactIds.every((id) => input.filters.authorizedArtifactIds!.includes(id)))
      .filter((request) => !input.filters.planRevisionId || request.planRevisionId === input.filters.planRevisionId)
      .filter((request) => {
        if (!input.filters.status) return true;
        const status = request.consumption
          ? "consumed"
          : request.decision?.decision ?? (request.decisionPolicy.expiresAt.getTime() <= input.evaluatedAt.getTime() ? "expired" : "pending");
        return status === input.filters.status;
      })
      .filter((request) => !input.before || request.createdAt.getTime() < input.before.createdAt.getTime() || (request.createdAt.getTime() === input.before.createdAt.getTime() && request.id < input.before.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, input.limit)
      .map(clone);
  }

  async decide(input: Parameters<PublishingApprovalRepository["decide"]>[0]): Promise<PublishingApprovalDecideResult> {
    return this.lock(async () => {
      const receiptKey = key(input.receipt.workspaceId, input.receipt.actorKind, input.receipt.actorId, input.receipt.capability, input.receipt.idempotencyKey);
      const existingReceipt = this.receipts.get(receiptKey);
      if (existingReceipt) {
        if (existingReceipt.requestFingerprint !== input.receipt.requestFingerprint) return { kind: "conflict" };
        const replay = this.requests.get(key(input.receipt.workspaceId, existingReceipt.approvalRequestId));
        return replay ? { kind: "replayed", request: clone(replay) } : { kind: "unavailable" };
      }
      if (this.failNextMutation) { this.failNextMutation = false; return { kind: "unavailable" }; }
      const requestKey = key(input.decision.workspaceId, input.decision.approvalRequestId);
      const request = this.requests.get(requestKey);
      if (!request) return { kind: "unavailable" };
      if (publishingApprovalInspectionDigest(request) !== input.expectedInspectionDigest) return { kind: "stale_view" };
      if (request.decision) return { kind: "final" };
      if (request.decisionPolicy.expiresAt.getTime() <= input.decision.decidedAt.getTime()) return { kind: "expired" };
      if (
        input.validationSession.schema !== "publishing-approval-validation-session/v1" ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(input.validationSession.id) ||
        input.validationSession.workspaceId !== request.workspaceId ||
        input.validationSession.planRevisionId !== request.planRevisionId ||
        input.validationSession.planRevisionDigest !== request.planRevisionDigest ||
        canonicalDigest(input.validationSession.targetIds) !== canonicalDigest(request.targetIds) ||
        canonicalDigest(input.validationSession.binding) !== canonicalDigest(request.validation) ||
        input.validationSession.expiresAt.toISOString() !== request.validation.expiresAt ||
        input.validationSession.issuedAt.getTime() < new Date(request.validation.evaluatedAt).getTime() ||
        input.validationSession.issuedAt.getTime() > input.decision.decidedAt.getTime() ||
        input.validationSession.expiresAt.getTime() <= input.decision.decidedAt.getTime() ||
        !(await this.validationVerifier(clone(input.validationSession)))
      ) return { kind: "stale_validation" };
      if (
        input.authoritySession.schema !== "publishing-approval-authority-session/v1" ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(input.authoritySession.id) ||
        input.authoritySession.workspaceId !== request.workspaceId ||
        input.authoritySession.userId !== input.decision.decidedByUserId ||
        (input.authoritySession.subjectRole !== "owner" && input.authoritySession.subjectRole !== "admin") ||
        input.authoritySession.action !== request.action ||
        canonicalDigest(input.authoritySession.channelIds) !== canonicalDigest(request.channelIds) ||
        new Set(input.authoritySession.channelIds).size !== input.authoritySession.channelIds.length ||
        input.authoritySession.grants.length !== request.channelIds.length ||
        input.authoritySession.grants.some((grant, index) => grant.channelId !== request.channelIds[index]) ||
        new Set(input.authoritySession.grants.map((grant) => grant.grantId)).size !== input.authoritySession.grants.length ||
        input.authoritySession.issuedAt.getTime() > input.decision.decidedAt.getTime() ||
        input.authoritySession.expiresAt.getTime() <= input.decision.decidedAt.getTime() ||
        canonicalDigest(input.authoritySession.grants) !== canonicalDigest(input.decision.authorityGrants) ||
        !(await this.authorityVerifier(clone(input.authoritySession)))
      ) return { kind: "authority_stale" };
      const updated = { ...request, decision: clone(input.decision) };
      this.requests.set(requestKey, updated);
      this.receipts.set(receiptKey, clone(input.receipt));
      return { kind: "decided", request: clone(updated) };
    });
  }
}
