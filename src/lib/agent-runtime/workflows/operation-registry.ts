import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import type {
  WorkflowOperationDefinition,
  WorkflowOperationRegistryReader,
} from "./types";

const EXACT_OPERATION =
  /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+@[1-9][0-9]{0,8}$/;

export function isExactWorkflowOperationIdentity(value: string): boolean {
  return EXACT_OPERATION.test(value);
}

type OperationInput = Omit<
  WorkflowOperationDefinition,
  "contractDigest" | "configSchema"
> & {
  config: z.ZodType<Record<string, unknown>>;
};

function contractValue(definition: OperationInput) {
  return {
    identity: definition.identity,
    inputs: definition.inputs,
    outputs: definition.outputs,
    configSchema: z.toJSONSchema(definition.config, { target: "draft-7" }),
    credentialRequirements: definition.credentialRequirements,
    retryBounds: definition.retryBounds,
  };
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function immutableDefinition(
  input: OperationInput,
): WorkflowOperationDefinition {
  const inputs = Object.freeze(
    Object.fromEntries(
      Object.entries(input.inputs).map(([name, port]) => [
        name,
        Object.freeze({ ...port }),
      ]),
    ),
  );
  const outputs = Object.freeze({ ...input.outputs });
  const credentialRequirements = Object.freeze(
    Object.fromEntries(
      Object.entries(input.credentialRequirements).map(
        ([name, requirement]) => [
          name,
          Object.freeze({ ...requirement }),
        ],
      ),
    ),
  );
  const retryBounds = Object.freeze({ ...input.retryBounds });
  const contractInput: OperationInput = {
    ...input,
    inputs,
    outputs,
    credentialRequirements,
    retryBounds,
  };
  const configSchema = immutablePlainValue(
    z.toJSONSchema(input.config, { target: "draft-7" }),
  ) as Record<string, unknown>;
  return Object.freeze({
    identity: contractInput.identity,
    lifecycle: contractInput.lifecycle,
    inputs,
    outputs,
    configSchema,
    credentialRequirements,
    retryBounds,
    contractDigest: canonicalDigest(contractValue(contractInput)),
  });
}

function immutablePlainValue<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutablePlainValue(child);
    Object.freeze(value);
  }
  return value;
}

export class WorkflowOperationRegistry
  implements WorkflowOperationRegistryReader
{
  private readonly definitions = new Map<string, WorkflowOperationDefinition>();
  private readonly configValidators = new Map<
    string,
    z.ZodType<Record<string, unknown>>
  >();
  readonly digest: string;

  constructor(inputs: OperationInput[]) {
    for (const input of inputs) {
      if (!isExactWorkflowOperationIdentity(input.identity)) {
        throw new TypeError(
          `Workflow operation requires an exact identity: ${input.identity}`,
        );
      }
      if (this.definitions.has(input.identity)) {
        throw new TypeError(`Duplicate workflow operation: ${input.identity}`);
      }
      const definition = immutableDefinition(input);
      this.definitions.set(input.identity, definition);
      this.configValidators.set(input.identity, input.config);
    }
    this.digest = canonicalDigest(
      [...this.definitions.values()]
        .sort((left, right) =>
          compareCodeUnits(left.identity, right.identity),
        )
        .map(({ identity, lifecycle, contractDigest }) => ({
          identity,
          lifecycle,
          contractDigest,
        })),
    );
  }

  get(identity: string): WorkflowOperationDefinition | undefined {
    return this.definitions.get(identity);
  }

  list(): WorkflowOperationDefinition[] {
    return [...this.definitions.values()].sort((left, right) =>
      compareCodeUnits(left.identity, right.identity),
    );
  }

  validateConfig(identity: string, value: unknown) {
    const validator = this.configValidators.get(identity);
    if (!validator) return { success: false as const, issues: [] };
    const result = validator.safeParse(value);
    return result.success
      ? { success: true as const, data: result.data }
      : {
          success: false as const,
          issues: result.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        };
  }
}

const RETRY_BOUNDS = {
  maxAttempts: 3,
  maxInitialMs: 60_000,
  maxBackoffMs: 300_000,
  maxMultiplier: 4,
  maxTotalDelayMs: 600_000,
} as const;

export const GOLDEN_WORKFLOW_OPERATION_REGISTRY =
  new WorkflowOperationRegistry([
    {
      identity: "gemini.generate_text@1",
      lifecycle: "active",
      inputs: {
        prompt: { kind: "text", required: true },
      },
      outputs: { text: "text" },
      config: z
        .object({
          model: z.enum([
            "gemini-2.5-flash",
            "gemini-3-flash-preview",
          ]),
          instruction: z.string().trim().min(1).max(4_000),
        })
        .strict(),
      credentialRequirements: {
        provider: { provider: "gemini", required: true },
      },
      retryBounds: RETRY_BOUNDS,
    },
    {
      identity: "gemini.generate_image@1",
      lifecycle: "active",
      inputs: {
        prompt: { kind: "text", required: true },
        referenceImage: { kind: "image", required: true },
      },
      outputs: { image: "image" },
      config: z
        .object({
          model: z.enum([
            "gemini-2.5-flash-image",
            "gemini-3-pro-image-preview",
          ]),
          aspectRatio: z.enum(["1:1", "4:5", "16:9"]),
        })
        .strict(),
      credentialRequirements: {
        provider: { provider: "gemini", required: true },
      },
      retryBounds: RETRY_BOUNDS,
    },
  ]);
