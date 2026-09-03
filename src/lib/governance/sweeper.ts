import { GOVERNANCE_RESOURCE_KINDS, type GovernanceJobCursor, type GovernanceRepository, type GovernanceResource } from "./types";
import {
  getProductionGovernanceApprovalDeadlineWorker,
  getProductionGovernanceBulkWorker,
  getProductionGovernanceDeletionWorker,
  getProductionGovernanceExportWorker,
  getProductionGovernanceImportWorker,
  getProductionGovernanceMembershipProjectionWorker,
  getProductionGovernanceSafetyAppealWorker,
  getProductionGovernanceSecretDeliverySweeper,
  PRODUCTION_GOVERNANCE_REPOSITORY,
} from "./production";

interface GovernanceSweepWorkers {
  export: { process(input: { workspaceId: string; kind: "audit_export" | "workspace_export"; exportId: string }): Promise<void> };
  bulk: { process(input: { workspaceId: string; operationId: string }): Promise<void> };
  import: { process(input: { workspaceId: string; importId: string }): Promise<void> };
  deletion: { process(input: { workspaceId: string; deletionReceiptId: string }): Promise<void> };
  safety: { process(input: { workspaceId: string; appealId: string }): Promise<void> };
  approvals: { processWorkspace(workspaceId: string): Promise<number> };
  membership: { sweep(input: { limit: number }): Promise<{ scanned: number; succeeded: number; retryPending: number; deadLetter: number }> };
  secrets: { purge(input: { limit: number }): Promise<number> };
}

export interface GovernanceSweepSummary {
  workspaces: number;
  examined: number;
  dispatched: number;
  failed: number;
  deadlinesAdvanced: number;
  membershipProjection: { scanned: number; succeeded: number; retryPending: number; deadLetter: number };
  expiredSecretDeliveriesPurged: number;
  nextCursor: GovernanceJobCursor | null;
}

export function encodeGovernanceJobCursor(cursor: GovernanceJobCursor): string {
  return Buffer.from(JSON.stringify({ ...cursor, updatedAt: cursor.updatedAt.toISOString() }), "utf8").toString("base64url");
}

export function decodeGovernanceJobCursor(value: string): GovernanceJobCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const updatedAt = new Date(String(parsed.updatedAt));
    if (!Number.isFinite(updatedAt.getTime()) || typeof parsed.workspaceId !== "string" || typeof parsed.id !== "string" || typeof parsed.kind !== "string" || !GOVERNANCE_RESOURCE_KINDS.includes(parsed.kind as never)) return null;
    return { updatedAt, workspaceId: parsed.workspaceId, kind: parsed.kind as GovernanceJobCursor["kind"], id: parsed.id };
  } catch {
    return null;
  }
}

/** Durable recovery entry point; individual workers acquire their own fenced leases. */
export class GovernanceRecoverySweep {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly workers: GovernanceSweepWorkers,
  ) {}

  async run(input: { maxJobs: number; after?: GovernanceJobCursor; evaluatedAt?: Date }): Promise<GovernanceSweepSummary> {
    const evaluatedAt = input.evaluatedAt ?? new Date();
    const resources = await this.repository.listClaimableGovernanceJobs({ evaluatedAt, after: input.after, limit: input.maxJobs });
    const workspaceIds = [...new Set(resources.map((resource) => resource.workspaceId))];
    const last = resources.at(-1);
    const summary: GovernanceSweepSummary = { workspaces: workspaceIds.length, examined: resources.length, dispatched: 0, failed: 0, deadlinesAdvanced: 0, membershipProjection: { scanned: 0, succeeded: 0, retryPending: 0, deadLetter: 0 }, expiredSecretDeliveriesPurged: 0, nextCursor: resources.length === input.maxJobs && last ? { updatedAt: last.updatedAt, workspaceId: last.workspaceId, kind: last.kind, id: last.id } : null };
    for (const workspaceId of workspaceIds) {
      for (const resource of resources.filter((candidate) => candidate.workspaceId === workspaceId)) {
        const dispatch = this.dispatchFor(resource);
        if (!dispatch) continue;
        try {
          await dispatch();
          summary.dispatched += 1;
        } catch {
          // The worker owns durable failed/ambiguous outcome recording.
          summary.failed += 1;
        }
      }
      try {
        summary.deadlinesAdvanced += await this.workers.approvals.processWorkspace(workspaceId);
      } catch {
        summary.failed += 1;
      }
    }
    try {
      summary.membershipProjection = await this.workers.membership.sweep({ limit: input.maxJobs });
    } catch {
      summary.failed += 1;
    }
    try {
      summary.expiredSecretDeliveriesPurged = await this.workers.secrets.purge({ limit: input.maxJobs });
    } catch {
      summary.failed += 1;
    }
    return summary;
  }

  private dispatchFor(resource: GovernanceResource): (() => Promise<void>) | null {
    const workspaceId = resource.workspaceId;
    if ((resource.kind === "audit_export" || resource.kind === "workspace_export") && ["queued", "running"].includes(resource.status)) {
      const kind = resource.kind;
      return () => this.workers.export.process({ workspaceId, kind, exportId: resource.id });
    }
    if (resource.kind === "bulk_operation" && ["queued", "running", "cancelling"].includes(resource.status)) {
      return () => this.workers.bulk.process({ workspaceId, operationId: resource.id });
    }
    if (resource.kind === "workspace_import" && ["queued", "running"].includes(resource.status)) {
      return () => this.workers.import.process({ workspaceId, importId: resource.id });
    }
    if (resource.kind === "deletion_receipt" && ["queued", "delayed", "running"].includes(resource.status)) {
      return () => this.workers.deletion.process({ workspaceId, deletionReceiptId: resource.id });
    }
    if (resource.kind === "safety_appeal" && ["revalidation_queued", "revalidation_running"].includes(resource.status)) {
      return () => this.workers.safety.process({ workspaceId, appealId: resource.id });
    }
    return null;
  }
}

export async function runProductionGovernanceSweep(input: { maxJobs: number; after?: GovernanceJobCursor }) {
  return new GovernanceRecoverySweep(PRODUCTION_GOVERNANCE_REPOSITORY, {
    export: getProductionGovernanceExportWorker(),
    bulk: getProductionGovernanceBulkWorker(),
    import: getProductionGovernanceImportWorker(),
    deletion: getProductionGovernanceDeletionWorker(),
    safety: getProductionGovernanceSafetyAppealWorker(),
    approvals: getProductionGovernanceApprovalDeadlineWorker(),
    membership: getProductionGovernanceMembershipProjectionWorker(),
    secrets: getProductionGovernanceSecretDeliverySweeper(),
  }).run(input);
}
