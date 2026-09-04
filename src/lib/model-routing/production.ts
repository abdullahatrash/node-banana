import { getDb } from "@/lib/db";
import { PostgresModelRoutingRepository } from "./postgres-repository";
import { ModelRoutingService } from "./service";
import { RuntimeGenerationBudgetAuthority } from "./runtime-budget-authority";
import { ManagedGenerationBudgetAuthority } from "./managed-budget-authority";
import { GovernanceGenerationRegionAuthority } from "./generation-region";
import { PRODUCTION_GOVERNANCE_REPOSITORY } from "@/lib/governance/production";
const PRODUCTION_GENERATION_REGIONS = new GovernanceGenerationRegionAuthority(PRODUCTION_GOVERNANCE_REPOSITORY, (provider) => process.env[`PROVIDER_REGION_${provider.toUpperCase().replaceAll("-", "_")}`]?.trim() || null);
const managedCommercial = {
  issueQuote: async (...args: Parameters<(typeof import("@/lib/commercial/production"))["COMMERCIAL"]["issueQuote"]>) => (await import("@/lib/commercial/production")).COMMERCIAL.issueQuote(...args),
  acceptQuote: async (...args: Parameters<(typeof import("@/lib/commercial/production"))["COMMERCIAL"]["acceptQuote"]>) => (await import("@/lib/commercial/production")).COMMERCIAL.acceptQuote(...args),
  reserveQuote: async (...args: Parameters<(typeof import("@/lib/commercial/production"))["COMMERCIAL"]["reserveQuote"]>) => (await import("@/lib/commercial/production")).COMMERCIAL.reserveQuote(...args),
  settleGenerationEffect: async (...args: Parameters<(typeof import("@/lib/commercial/production"))["COMMERCIAL"]["settleGenerationEffect"]>) => (await import("@/lib/commercial/production")).COMMERCIAL.settleGenerationEffect(...args),
};
export const PRODUCTION_MODEL_ROUTING = new ModelRoutingService(
  new PostgresModelRoutingRepository(getDb),
  undefined,
  undefined,
  new ManagedGenerationBudgetAuthority(new RuntimeGenerationBudgetAuthority(getDb), managedCommercial),
  PRODUCTION_GENERATION_REGIONS,
);
export { PRODUCTION_GENERATION_REGIONS };
