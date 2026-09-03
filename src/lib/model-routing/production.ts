import { getDb } from "@/lib/db";
import { PostgresModelRoutingRepository } from "./postgres-repository";
import { ModelRoutingService } from "./service";
import { RuntimeGenerationBudgetAuthority } from "./runtime-budget-authority";
import { GovernanceGenerationRegionAuthority } from "./generation-region";
import { PRODUCTION_GOVERNANCE_REPOSITORY } from "@/lib/governance/production";
const PRODUCTION_GENERATION_REGIONS = new GovernanceGenerationRegionAuthority(PRODUCTION_GOVERNANCE_REPOSITORY, (provider) => process.env[`PROVIDER_REGION_${provider.toUpperCase().replaceAll("-", "_")}`]?.trim() || null);
export const PRODUCTION_MODEL_ROUTING = new ModelRoutingService(
  new PostgresModelRoutingRepository(getDb),
  undefined,
  undefined,
  new RuntimeGenerationBudgetAuthority(getDb),
  PRODUCTION_GENERATION_REGIONS,
);
export { PRODUCTION_GENERATION_REGIONS };
