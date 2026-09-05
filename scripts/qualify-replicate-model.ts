import "./_load-env";

import { readFile } from "node:fs/promises";
import { ReplicateQualificationHttpExecution } from "@/lib/model-routing/qualification-http-execution";
import { executeReplicateQualification } from "@/lib/model-routing/qualification-runner";
import { PostgresQualificationRunLedger } from "@/lib/model-routing/qualification-ledger";
import { getDb } from "@/lib/db";

async function main() {
  const sourcePath = process.argv[2];
  const privateKey = process.env.MODEL_QUALIFICATION_SIGNING_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!sourcePath || !privateKey || process.argv[3] !== "--execute-paid-smoke") throw new Error("Usage: MODEL_QUALIFICATION_SIGNING_PRIVATE_KEY='<PEM>' pnpm qualify:replicate <qualification-plan.json> --execute-paid-smoke");
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
  const result = await executeReplicateQualification(source as never, privateKey, new ReplicateQualificationHttpExecution(), new PostgresQualificationRunLedger(getDb()));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "QUALIFICATION_FAILED"}\n`);
  process.exitCode = 1;
});
