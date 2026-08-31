import { getDb } from "@/lib/db";
import { BudgetService } from "./service";
import {
  DrizzleBudgetFxRateReader,
  DrizzleBudgetRepository,
} from "./postgres-repository";

export const PRODUCTION_BUDGET_REPOSITORY = new DrizzleBudgetRepository(getDb);
export const PRODUCTION_BUDGET_SERVICE = new BudgetService(
  PRODUCTION_BUDGET_REPOSITORY,
  new DrizzleBudgetFxRateReader(getDb),
);
