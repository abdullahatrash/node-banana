import { readFile } from "node:fs/promises";
import { produceReplicateQualificationEnvelope } from "@/lib/model-routing/qualification-runner";

async function main() {
  const sourcePath = process.argv[2];
  const privateKey = process.env.MODEL_QUALIFICATION_SIGNING_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!sourcePath || !privateKey) throw new Error("Usage: MODEL_QUALIFICATION_SIGNING_PRIVATE_KEY='<PEM>' pnpm qualify:replicate <reviewed-attestation.json>");
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
  process.stdout.write(`${JSON.stringify(produceReplicateQualificationEnvelope(source as never, privateKey), null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "QUALIFICATION_FAILED"}\n`);
  process.exitCode = 1;
});
