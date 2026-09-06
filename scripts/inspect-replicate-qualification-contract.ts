import "./_load-env";

import { inspectReplicateQualificationContract } from "@/lib/model-routing/qualification-contract-inspector";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--execute-paid-smoke")) throw new Error("PAID_EXECUTION_FLAG_FORBIDDEN_IN_CONTRACT_INSPECTION");
  const model = args.find((argument) => !argument.startsWith("--"));
  if (!model) throw new Error("Usage: pnpm qualify:replicate:inspect <curated-owner/model>");
  const report = await inspectReplicateQualificationContract({ model });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "QUALIFICATION_CONTRACT_INSPECTION_FAILED"}\n`);
  process.exitCode = 1;
});
