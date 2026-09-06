import type { QualificationRunnerInput, QualificationSmokeCase } from "./qualification-runner";
import {
  MAX_QUALIFICATION_SPEND_USD,
  validateReplicateQualificationPlan,
  type QualificationPlanPreflight,
} from "./qualification-runner";

export const REQUIRED_REPLICATE_PORTFOLIO_CAPABILITIES = [
  "text_to_image",
  "image_to_image",
  "text_to_video",
  "image_to_video",
] as const satisfies readonly QualificationSmokeCase["capability"][];

export type QualificationPortfolioPreflight = {
  schema: "replicate-qualification-portfolio-preflight/v1";
  plans: QualificationPlanPreflight[];
  requiredCapabilities: QualificationSmokeCase["capability"][];
  coveredCapabilities: QualificationSmokeCase["capability"][];
  estimatedMaximumSpendUsd: number;
  hardCapUsd: number;
  remainingHeadroomUsd: number;
};

function roundedUsd(value: number) {
  return Number(value.toFixed(6));
}

/**
 * Pure, no-network validation for the complete Replicate launch portfolio.
 * The durable ledger remains authoritative for spend already committed by the
 * provider account; this check prevents a reviewed batch from exceeding the
 * same ceiling before an operator begins any paid run.
 */
export function validateReplicateQualificationPortfolio(
  inputs: readonly QualificationRunnerInput[],
  at = new Date(),
  requiredCapabilities: readonly QualificationSmokeCase["capability"][] = REQUIRED_REPLICATE_PORTFOLIO_CAPABILITIES,
): QualificationPortfolioPreflight {
  if (inputs.length === 0) throw new Error("QUALIFICATION_PORTFOLIO_EMPTY");

  const plans = inputs.map((input) => validateReplicateQualificationPlan(input, at).summary);
  if (new Set(plans.map((plan) => plan.runId)).size !== plans.length) {
    throw new Error("QUALIFICATION_PORTFOLIO_RUN_ID_DUPLICATE");
  }
  if (new Set(plans.map((plan) => `${plan.model}@${plan.version}`)).size !== plans.length) {
    throw new Error("QUALIFICATION_PORTFOLIO_EXECUTION_DUPLICATE");
  }

  const covered = new Set(plans.flatMap((plan) => plan.capabilities));
  for (const capability of requiredCapabilities) {
    if (!covered.has(capability)) {
      throw new Error(`QUALIFICATION_PORTFOLIO_CAPABILITY_REQUIRED:${capability}`);
    }
  }

  const estimatedMaximumSpendUsd = roundedUsd(
    plans.reduce((sum, plan) => sum + plan.estimatedMaximumSpendUsd, 0),
  );
  if (
    !Number.isFinite(estimatedMaximumSpendUsd)
    || estimatedMaximumSpendUsd <= 0
    || estimatedMaximumSpendUsd >= MAX_QUALIFICATION_SPEND_USD
  ) {
    throw new Error("QUALIFICATION_PORTFOLIO_BUDGET_CAP_EXCEEDED");
  }

  return {
    schema: "replicate-qualification-portfolio-preflight/v1",
    plans,
    requiredCapabilities: [...requiredCapabilities],
    coveredCapabilities: [...covered],
    estimatedMaximumSpendUsd,
    hardCapUsd: MAX_QUALIFICATION_SPEND_USD,
    remainingHeadroomUsd: roundedUsd(MAX_QUALIFICATION_SPEND_USD - estimatedMaximumSpendUsd),
  };
}
