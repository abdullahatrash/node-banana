import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import {
  validateReplicateQualificationPortfolio,
  type QualificationPortfolioPreflight,
} from "@/lib/model-routing/qualification-portfolio";
import {
  inspectReplicateQualificationEnvironment,
  type QualificationPreflightCheck,
} from "@/lib/model-routing/qualification-preflight";

loadEnvConfig(process.cwd());

function errorCode(error: unknown) {
  if (!(error instanceof Error)) return "QUALIFICATION_PORTFOLIO_INVALID";
  return error.message.split("\n", 1)[0]?.trim() || "QUALIFICATION_PORTFOLIO_INVALID";
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--execute-paid-smoke")) {
    throw new Error("PAID_EXECUTION_FLAG_FORBIDDEN_IN_PREFLIGHT");
  }
  const json = args.includes("--json");
  const planPaths = args.filter((value) => !value.startsWith("--"));
  let portfolio: QualificationPortfolioPreflight | null = null;
  let portfolioCheck: QualificationPreflightCheck;
  let environmentChecks: QualificationPreflightCheck[] = [];

  if (planPaths.length === 0) {
    portfolioCheck = {
      id: "reviewed_portfolio",
      status: "blocked",
      detail: "Pass every reviewed qualification-plan JSON path in the intended paid batch.",
    };
  } else {
    try {
      const inputs = await Promise.all(
        planPaths.map(async (planPath) => JSON.parse(await readFile(planPath, "utf8")) as never),
      );
      portfolio = validateReplicateQualificationPortfolio(inputs);
      portfolioCheck = {
        id: "reviewed_portfolio",
        status: "ready",
        detail: `${portfolio.plans.length} plans cover ${portfolio.coveredCapabilities.length} capabilities with a combined maximum of $${portfolio.estimatedMaximumSpendUsd.toFixed(6)} and $${portfolio.remainingHeadroomUsd.toFixed(6)} headroom.`,
      };
      const signingKeyIds = [...new Set(portfolio.plans.map((plan) => plan.signingKeyId))];
      environmentChecks = signingKeyIds.flatMap((signingKeyId) =>
        inspectReplicateQualificationEnvironment(process.env, signingKeyId).checks.map((check) => ({
          ...check,
          id: signingKeyIds.length === 1 ? check.id : `${check.id}:${signingKeyId}`,
        })),
      );
    } catch (error) {
      portfolioCheck = { id: "reviewed_portfolio", status: "blocked", detail: errorCode(error) };
    }
  }

  const checks = [...environmentChecks, portfolioCheck];
  const report = {
    schema: "replicate-qualification-portfolio-operator-preflight/v1" as const,
    generatedAt: new Date().toISOString(),
    ready: checks.every((check) => check.status === "ready"),
    paidCallsMade: false as const,
    portfolio,
    checks,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("Replicate qualification portfolio preflight — no provider calls\n\n");
    for (const check of checks) {
      process.stdout.write(`${check.status === "ready" ? "[READY]" : "[BLOCKED]"} ${check.id}: ${check.detail}\n`);
    }
    process.stdout.write(`\nPaid calls made: no\nReady for the explicitly approved paid batch: ${report.ready ? "yes" : "no"}\n`);
  }
  if (!report.ready) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${errorCode(error)}\n`);
  process.exitCode = 1;
});
