import { BudgetServiceError, type BudgetService } from "@/lib/agent-runtime/budgets/service";
import type { GenerationBudgetAuthority } from "./budget-authority";

/** Admits each paid generation through the same durable budget authority as workflow runs. */
export class RuntimeGenerationBudgetAuthority implements GenerationBudgetAuthority {
  constructor(private readonly budgets: BudgetService) {}
  async reserve(input: Parameters<GenerationBudgetAuthority["reserve"]>[0]) {
    try {
      const amount = String(input.quote.amount * input.quote.quantity);
      const plan = await this.budgets.planAdmission({
        workspaceId: input.workspaceId,
        principalId: input.principalId,
        workflowId: "studio-generation",
        workflowRevisionId: `model:${input.model.provider}:${input.model.model}:${input.model.version}`,
        runId: input.intentId,
        at: input.at,
        stepExposures: [{
          stepId: "generate",
          provider: input.model.provider,
          providerOperation: "generate",
          model: input.model.model,
          serviceTier: "default",
          automaticAttempts: 1,
          credentialSlotId: null,
          credentialProfileId: null,
          amountPerAttempt: amount,
          currency: "USD",
          pricingSnapshotIds: [input.model.inputSchemaDigest],
          pricingSource: "builtin_catalog",
        }],
      });
      await this.budgets.commitAdmission(plan);
      return { kind: "reserved" as const, reservationIds: plan.reservations.map((item) => item.id) };
    } catch (error) {
      if (error instanceof BudgetServiceError && error.code === "BUDGET_NOT_ADMISSIBLE") {
        return { kind: "denied" as const, code: error.code };
      }
      return { kind: "unavailable" as const, code: error instanceof BudgetServiceError ? error.code : "BUDGET_UNAVAILABLE" };
    }
  }
}
