import { getDb } from "@/lib/db";
import { PostgresModelRoutingRepository } from "./postgres-repository";
import { ModelRoutingService } from "./service";
import { RuntimeGenerationBudgetAuthority } from "./runtime-budget-authority";
export const PRODUCTION_MODEL_ROUTING = new ModelRoutingService(
  new PostgresModelRoutingRepository(getDb),
  undefined,
  undefined,
  new RuntimeGenerationBudgetAuthority(getDb),
);
