import { getDb } from "@/lib/db";
import { DrizzleGovernanceRepository } from "./postgres-repository";
import { GovernanceService } from "./service";

export const PRODUCTION_GOVERNANCE_REPOSITORY = new DrizzleGovernanceRepository(getDb);
export const PRODUCTION_GOVERNANCE_SERVICE = new GovernanceService(
  PRODUCTION_GOVERNANCE_REPOSITORY,
);
