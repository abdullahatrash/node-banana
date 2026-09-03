import { getDb } from "@/lib/db";
import { DrizzleGovernanceRepository } from "./postgres-repository";
import { GovernanceService } from "./service";
import { GovernanceExportWorker, S3GovernanceExportStore } from "./export-worker";
import { DrizzleGovernanceMembershipPort } from "./membership-postgres";
import { ApplicationGovernanceBulkCapabilityPort, DrizzleGovernanceBulkAuthorizationPort, GovernanceBulkWorker } from "./bulk-worker";
import { GovernanceImportWorker } from "./import-worker";
import { GovernanceApprovalDeadlineWorker } from "./approval-worker";

export const PRODUCTION_GOVERNANCE_REPOSITORY = new DrizzleGovernanceRepository(getDb);
export const PRODUCTION_GOVERNANCE_SERVICE = new GovernanceService(
  PRODUCTION_GOVERNANCE_REPOSITORY,
  undefined,
  new DrizzleGovernanceMembershipPort(getDb),
);

export function getProductionGovernanceExportWorker(): GovernanceExportWorker {
  return new GovernanceExportWorker(
    PRODUCTION_GOVERNANCE_REPOSITORY,
    new S3GovernanceExportStore(),
    {
      encryptionKeyBase64: process.env.GOVERNANCE_EXPORT_ENCRYPTION_KEY ?? "",
      signingKeyBase64: process.env.GOVERNANCE_EXPORT_SIGNING_KEY ?? "",
    },
  );
}

export function getProductionGovernanceBulkWorker(): GovernanceBulkWorker {
  return new GovernanceBulkWorker(
    PRODUCTION_GOVERNANCE_REPOSITORY,
    new DrizzleGovernanceBulkAuthorizationPort(),
    new ApplicationGovernanceBulkCapabilityPort(),
  );
}

export function getProductionGovernanceImportWorker(): GovernanceImportWorker {
  return new GovernanceImportWorker(PRODUCTION_GOVERNANCE_REPOSITORY);
}

export function getProductionGovernanceApprovalDeadlineWorker(): GovernanceApprovalDeadlineWorker {
  return new GovernanceApprovalDeadlineWorker(PRODUCTION_GOVERNANCE_REPOSITORY);
}
