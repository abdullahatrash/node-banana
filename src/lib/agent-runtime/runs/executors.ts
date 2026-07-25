import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { WorkflowOperationRegistryReader } from "../workflows/types";
import {
  GOLDEN_BRIEF,
  GOLDEN_IMAGE_FIXTURES,
  GOLDEN_LINKEDIN_COPY,
  GOLDEN_PROVIDER_RESULTS,
} from "./fixtures/golden";
import type {
  WorkflowStepExecutor,
  WorkflowStepExecutorRegistry,
} from "./types";

const IDENTITY = "runtime.digest_text@1";

class DigestTextExecutor implements WorkflowStepExecutor {
  readonly provider = "runtime";
  readonly providerOperation = "digest_text";
  readonly model = "sha256";
  readonly calls: string[] = [];

  async execute(
    input: Parameters<WorkflowStepExecutor["execute"]>[0],
  ): ReturnType<WorkflowStepExecutor["execute"]> {
    this.calls.push(input.runId);
    const binding = input.step.inputs.text;
    if (!binding || binding.from !== "workflow_input") {
      throw new Error("Deterministic text binding is unavailable.");
    }
    const text = input.inputs.text?.textContent;
    if (typeof text !== "string") {
      throw new Error("Deterministic text input is unavailable.");
    }
    return Promise.resolve({
      kind: "legacy",
      output: { textDigest: canonicalDigest(text) },
    });
  }
}

class GoldenConformanceExecutor implements WorkflowStepExecutor {
  readonly provider = "conformance";
  readonly model = "golden-v1";
  readonly calls: Array<{ effectKey: string; intentDigest: string }> = [];
  private readonly ledger = new Map<
    string,
    { intentDigest: string; result: Awaited<ReturnType<WorkflowStepExecutor["execute"]>> }
  >();

  constructor(
    readonly providerOperation: "generate_text" | "generate_image",
  ) {}

  async execute(
    input: Parameters<WorkflowStepExecutor["execute"]>[0],
  ): ReturnType<WorkflowStepExecutor["execute"]> {
    const existing = this.ledger.get(input.effectKey);
    if (existing) {
      if (existing.intentDigest !== input.intentDigest) {
        throw new Error("Effect Key is bound to another provider intent.");
      }
      return structuredClone(existing.result);
    }

    let result: Awaited<ReturnType<WorkflowStepExecutor["execute"]>>;
    if (this.providerOperation === "generate_text") {
      const prompt = input.inputs.prompt?.textContent;
      if (prompt !== GOLDEN_BRIEF) {
        throw new Error("Golden copy intent does not match the frozen fixture.");
      }
      result = {
        kind: "generated",
        providerOperationRef:
          GOLDEN_PROVIDER_RESULTS.draftCopy.providerOperationRef,
        outputs: {
          text: {
            kind: "text",
            mediaType: "text/plain; charset=utf-8",
            bytes: Buffer.from(GOLDEN_LINKEDIN_COPY, "utf8"),
          },
        },
      };
    } else {
      const prompt = input.inputs.prompt?.textContent;
      const reference = input.inputs.referenceImage;
      if (
        prompt !== GOLDEN_LINKEDIN_COPY ||
        reference?.contentDigest !== GOLDEN_IMAGE_FIXTURES.reference.digest
      ) {
        throw new Error("Golden hero intent does not match the frozen fixture.");
      }
      const bytes = await readFile(
        resolve(process.cwd(), GOLDEN_IMAGE_FIXTURES.heroResult.path),
      );
      result = {
        kind: "generated",
        providerOperationRef:
          GOLDEN_PROVIDER_RESULTS.generateHero.providerOperationRef,
        outputs: {
          image: {
            kind: "image",
            mediaType: GOLDEN_IMAGE_FIXTURES.heroResult.mediaType,
            bytes,
            width: GOLDEN_IMAGE_FIXTURES.heroResult.width,
            height: GOLDEN_IMAGE_FIXTURES.heroResult.height,
          },
        },
      };
    }
    this.calls.push({
      effectKey: input.effectKey,
      intentDigest: input.intentDigest,
    });
    this.ledger.set(input.effectKey, {
      intentDigest: input.intentDigest,
      result: structuredClone(result),
    });
    return result;
  }
}

export class WorkflowRunExecutorRegistry
  implements WorkflowStepExecutorRegistry
{
  private readonly executors = new Map<string, WorkflowStepExecutor>();

  register(
    identity: string,
    contractDigest: string,
    executor: WorkflowStepExecutor,
  ): void {
    const key = `${identity}\u0000${contractDigest}`;
    if (this.executors.has(key)) {
      throw new TypeError(`Duplicate Workflow Run executor: ${identity}.`);
    }
    this.executors.set(key, executor);
  }

  get(identity: string, contractDigest: string) {
    return this.executors.get(`${identity}\u0000${contractDigest}`);
  }
}

export function createDeterministicWorkflowRunExecutorRegistry(
  operations: WorkflowOperationRegistryReader,
): WorkflowRunExecutorRegistry {
  const operation = operations.get(IDENTITY);
  if (!operation) {
    throw new TypeError(`${IDENTITY} must be published before execution.`);
  }
  const registry = new WorkflowRunExecutorRegistry();
  registry.register(
    operation.identity,
    operation.contractDigest,
    new DigestTextExecutor(),
  );
  for (const [identity, providerOperation] of [
    ["gemini.generate_text@1", "generate_text"],
    ["gemini.generate_image@1", "generate_image"],
  ] as const) {
    const definition = operations.get(identity);
    if (!definition) {
      throw new TypeError(`${identity} must be published before execution.`);
    }
    registry.register(
      identity,
      definition.contractDigest,
      new GoldenConformanceExecutor(providerOperation),
    );
  }
  return registry;
}
