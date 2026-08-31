import type {
  AnalysisFailure,
  OnboardingAnalysisInput,
  OnboardingAnalysisWorkStage,
} from "@/lib/onboarding/analysis-worker";

export async function executeOnboardingBrandAnalysis(input: OnboardingAnalysisInput) {
  "use workflow";

  try {
    await executeStage(input, "start");
    await executeStage(input, "source");
    await executeStage(input, "profile");
    await executeStage(input, "activation");
    await executeStage(input, "finalize");
    return { status: "ready" as const, runId: input.runId };
  } catch (error) {
    const failure = serializableFailure(error);
    await recordFailure(input, failure);
    return { status: "failed" as const, runId: input.runId, errorCode: failure.code };
  }
}

export function serializableFailure(error: unknown): AnalysisFailure {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
  ) {
    return { code: error.code.slice(0, 120), retryable: error.retryable };
  }
  if (error instanceof Error) {
    const match = /^ONBOARDING_ANALYSIS_FAILURE:(true|false):([A-Z0-9_]{1,120})$/.exec(
      error.message,
    );
    if (match) return { retryable: match[1] === "true", code: match[2] };
  }
  return { code: "ANALYSIS_INTERNAL_ERROR", retryable: true };
}

async function executeStage(
  input: OnboardingAnalysisInput,
  stage: OnboardingAnalysisWorkStage,
) {
  "use step";

  const { createProductionOnboardingAnalysisWorker } = await import(
    "@/lib/onboarding/production"
  );
  const { classifyAnalysisFailure } = await import(
    "@/lib/onboarding/analysis-worker"
  );
  try {
    await createProductionOnboardingAnalysisWorker().executeStage(input, stage);
  } catch (error) {
    const failure = classifyAnalysisFailure(error);
    throw new Error(
      `ONBOARDING_ANALYSIS_FAILURE:${failure.retryable}:${failure.code}`,
    );
  }
}

async function recordFailure(input: OnboardingAnalysisInput, failure: AnalysisFailure) {
  "use step";

  const { createProductionOnboardingAnalysisWorker } = await import(
    "@/lib/onboarding/production"
  );
  await createProductionOnboardingAnalysisWorker().fail(input, failure);
}
