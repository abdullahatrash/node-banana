import { randomUUID } from "node:crypto";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { advanceApprovalDeadline } from "./approval-policy";
import type { ApprovalPolicyRevision, ContentAcceptanceProgress, GovernanceRepository, GovernanceResource } from "./types";

export class GovernanceApprovalDeadlineWorker {
  constructor(private readonly repository: GovernanceRepository, private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  async processWorkspace(workspaceId: string): Promise<number> {
    const requests = await this.repository.listResources<{ policySnapshot: ApprovalPolicyRevision; progress: ContentAcceptanceProgress; [key: string]: unknown }>({ workspaceId, kinds: ["approval_request"] });
    let changed = 0;
    for (const request of requests.filter((item) => ["pending", "escalated"].includes(item.status))) {
      const now = this.clock.now();
      const progress = advanceApprovalDeadline({ policy: request.body.policySnapshot, progress: request.body.progress, now });
      if (progress === request.body.progress) continue;
      const next: GovernanceResource = { ...request, version: request.version + 1, status: progress.status, body: { ...request.body, progress }, updatedAt: now };
      const result = await this.repository.commit({ receipt: { workspaceId, capability: "approval_deadlines.process@1", idempotencyKey: `approval-deadline-${request.id}-${request.version}`, requestDigest: canonicalDigest({ requestId: request.id, version: request.version, now: now.toISOString() }), result: { requestId: request.id, status: progress.status }, createdAt: now }, mutations: [{ type: "update", expectedVersion: request.version, resource: next }], audit: { schema: "workspace-audit-event/v1", id: `audit_${randomUUID().replaceAll("-", "")}`, workspaceId, actor: { kind: "system", id: null }, capability: "approval_deadlines.process@1", action: progress.status === "expired" ? "expire_content_acceptance" : "escalate_content_acceptance", resource: { kind: request.kind, id: request.id }, outcome: "completed", redactedDetails: {}, occurredAt: now } });
      if (result.type === "committed") changed += 1;
    }
    return changed;
  }
}
