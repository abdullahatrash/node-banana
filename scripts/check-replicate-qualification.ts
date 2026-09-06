import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { inspectReplicateQualificationEnvironment, type QualificationPreflightCheck } from "@/lib/model-routing/qualification-preflight";
import { validateReplicateQualificationPlan, type QualificationPlanPreflight } from "@/lib/model-routing/qualification-runner";

loadEnvConfig(process.cwd());

function errorCode(error: unknown) {
  if (!(error instanceof Error)) return "QUALIFICATION_PLAN_INVALID";
  const firstLine = error.message.split("\n", 1)[0]?.trim();
  return firstLine || "QUALIFICATION_PLAN_INVALID";
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--execute-paid-smoke")) throw new Error("PAID_EXECUTION_FLAG_FORBIDDEN_IN_PREFLIGHT");
  const json = args.includes("--json");
  const planPath = args.find((value) => !value.startsWith("--"));
  let plan: QualificationPlanPreflight | null = null;
  let planCheck: QualificationPreflightCheck;

  if (!planPath) {
    planCheck = { id: "reviewed_plan", status: "blocked", detail: "Pass a reviewed qualification-plan JSON path." };
  } else {
    try {
      const source = JSON.parse(await readFile(planPath, "utf8")) as never;
      plan = validateReplicateQualificationPlan(source).summary;
      planCheck = {
        id: "reviewed_plan",
        status: "ready",
        detail: `${plan.model}@${plan.version} has ${plan.caseCount} cells and an estimated maximum of $${plan.estimatedMaximumSpendUsd.toFixed(6)}.`,
      };
    } catch (error) {
      planCheck = { id: "reviewed_plan", status: "blocked", detail: errorCode(error) };
    }
  }

  const environment = inspectReplicateQualificationEnvironment(process.env, plan?.signingKeyId);
  const checks = [...environment.checks, planCheck];
  const report = {
    schema: "replicate-qualification-operator-preflight/v1" as const,
    generatedAt: new Date().toISOString(),
    ready: checks.every((item) => item.status === "ready"),
    paidCallsMade: false as const,
    plan,
    checks,
  };

  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write("Replicate qualification preflight — no provider calls\n\n");
    for (const item of checks) process.stdout.write(`${item.status === "ready" ? "[READY]" : "[BLOCKED]"} ${item.id}: ${item.detail}\n`);
    process.stdout.write(`\nPaid calls made: no\nReady for explicit paid qualification: ${report.ready ? "yes" : "no"}\n`);
  }
  if (!report.ready) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${errorCode(error)}\n`);
  process.exitCode = 1;
});
