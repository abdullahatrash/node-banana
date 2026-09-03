import { isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import type { GovernanceRepository, GovernanceResource } from "./types";
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
}

/** Durable recovery entry point; individual workers acquire their own fenced leases. */
export class GovernanceRecoverySweep {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly workers: GovernanceSweepWorkers,
  ) {}

  async run(input: { workspaceIds: string[]; maxJobsPerWorkspace: number }): Promise<GovernanceSweepSummary> {
    const summary: GovernanceSweepSummary = { workspaces: 0, examined: 0, dispatched: 0, failed: 0, deadlinesAdvanced: 0, membershipProjection: { scanned: 0, succeeded: 0, retryPending: 0, deadLetter: 0 }, expiredSecretDeliveriesPurged: 0 };
    for (const workspaceId of input.workspaceIds) {
      summary.workspaces += 1;
      const resources = (await this.repository.listResources({ workspaceId })).slice(0, input.maxJobsPerWorkspace);
      summary.examined += resources.length;
      for (const resource of resources) {
        const dispatch = this.dispatchFor(workspaceId, resource);
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
      summary.membershipProjection = await this.workers.membership.sweep({ limit: input.maxJobsPerWorkspace });
    } catch {
      summary.failed += 1;
    }
    try {
      summary.expiredSecretDeliveriesPurged = await this.workers.secrets.purge({ limit: input.maxJobsPerWorkspace });
    } catch {
      summary.failed += 1;
    }
    return summary;
  }

  private dispatchFor(workspaceId: string, resource: GovernanceResource): (() => Promise<void>) | null {
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

export async function runProductionGovernanceSweep(input: { workspaceLimit: number; maxJobsPerWorkspace: number }) {
  const workspaceRows = await getDb().select({ id: workspaces.id }).from(workspaces)
    .where(isNull(workspaces.deletedAt)).limit(input.workspaceLimit);
  return new GovernanceRecoverySweep(PRODUCTION_GOVERNANCE_REPOSITORY, {
    export: getProductionGovernanceExportWorker(),
    bulk: getProductionGovernanceBulkWorker(),
    import: getProductionGovernanceImportWorker(),
    deletion: getProductionGovernanceDeletionWorker(),
    safety: getProductionGovernanceSafetyAppealWorker(),
    approvals: getProductionGovernanceApprovalDeadlineWorker(),
    membership: getProductionGovernanceMembershipProjectionWorker(),
    secrets: getProductionGovernanceSecretDeliverySweeper(),
  }).run({ workspaceIds: workspaceRows.map((row) => row.id), maxJobsPerWorkspace: input.maxJobsPerWorkspace });
}
