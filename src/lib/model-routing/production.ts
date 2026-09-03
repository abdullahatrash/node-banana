import { getDb } from "@/lib/db";
import { PostgresModelRoutingRepository } from "./postgres-repository";
import { ModelRoutingService } from "./service";
import { PRODUCTION_BUDGET_SERVICE } from "@/lib/agent-runtime/budgets/production";
import { RuntimeGenerationBudgetAuthority } from "./runtime-budget-authority";
export const PRODUCTION_MODEL_ROUTING = new ModelRoutingService(
  new PostgresModelRoutingRepository(getDb),
  undefined,
  undefined,
  new RuntimeGenerationBudgetAuthority(PRODUCTION_BUDGET_SERVICE),
);
