import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type { WorkflowOperationRegistryReader } from "../workflows/types";
import type {
  WorkflowStepExecutor,
  WorkflowStepExecutorRegistry,
} from "./types";

const IDENTITY = "runtime.digest_text@1";

class DigestTextExecutor implements WorkflowStepExecutor {
  readonly calls: string[] = [];

  async execute(
    input: Parameters<WorkflowStepExecutor["execute"]>[0],
  ): Promise<Record<string, unknown>> {
    this.calls.push(input.runId);
    const binding = input.step.inputs.text;
    if (!binding || binding.from !== "workflow_input") {
      throw new Error("Deterministic text binding is unavailable.");
    }
    const text = input.snapshot.inputs.find(
      (candidate) =>
        candidate.name === binding.input &&
        candidate.kind === "text",
    )?.value;
    if (typeof text !== "string") {
      throw new Error("Deterministic text input is unavailable.");
    }
    return {
      textDigest: canonicalDigest(text),
    };
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
  return registry;
}
