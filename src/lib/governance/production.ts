import { getDb } from "@/lib/db";
import { DrizzleGovernanceRepository } from "./postgres-repository";
import { GovernanceService } from "./service";
import { GovernanceExportWorker, S3GovernanceExportStore } from "./export-worker";
import { DrizzleGovernanceMembershipPort } from "./membership-postgres";

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
