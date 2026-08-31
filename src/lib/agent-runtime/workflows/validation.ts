import { z } from "zod";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { CREDENTIAL_SLOT_PROVIDERS } from "@/types";
import type { AgentResourceConstraints } from "@/types/agentAuthorization";
import { isExactWorkflowOperationIdentity } from "./operation-registry";
import type {
  ResolvedWorkflowDefinition,
  WorkflowBinding,
  WorkflowCredentialSlotAdmissionPort,
  WorkflowDraft,
  WorkflowOperationDefinition,
  WorkflowOperationRegistryReader,
  WorkflowRetryPolicy,
  WorkflowValidationIssue,
  WorkflowValidationResult,
  WorkflowValidationWarning,
} from "./types";

const ID = /^[a-z][a-z0-9_-]{0,119}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_-]{0,119}$/;
const OPERATION =
  /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+@[1-9][0-9]{0,8}$/;

const workflowInputBindingSchema = z
  .object({
    from: z.literal("workflow_input"),
    input: z.string().regex(ID),
  })
  .strict();

const workflowStepBindingSchema = z
  .object({
    from: z.literal("step_output"),
    step: z.string().regex(ID),
    output: z.string().regex(KEY),
  })
  .strict();

const workflowBindingSchema = z.discriminatedUnion("from", [
  workflowInputBindingSchema,
  workflowStepBindingSchema,
]);

function boundedRecord<Value extends z.ZodType>(
  value: Value,
  maximum = 64,
) {
  return z
    .record(z.string().regex(KEY), value)
    .refine((record) => Object.keys(record).length <= maximum, {
      message: `Must contain at most ${maximum} entries.`,
    });
}

const retrySchema = z
  .object({
    maxAttempts: z.number().int(),
    backoff: z
      .object({
        initialMs: z.number().int(),
        maxMs: z.number().int(),
        multiplier: z.number(),
      })
      .strict(),
  })
  .strict();

export const workflowDraftSchema = z
  .object({
    schema: z.literal("content-workflow-draft/v1"),
    workflowId: z.string().regex(ID),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(2_000).optional(),
    inputs: boundedRecord(
      z
        .object({
          kind: z.enum(["text", "image"]),
          required: z.boolean(),
          description: z.string().trim().min(1).max(500).optional(),
        })
        .strict(),
    ),
    credentialSlots: boundedRecord(
      z
        .object({
          slotId: z.string().trim().min(1).max(200),
          provider: z.enum(CREDENTIAL_SLOT_PROVIDERS),
        })
        .strict(),
    ),
    steps: z
      .array(
        z
          .object({
            id: z.string().regex(ID),
            operation: z.string().regex(OPERATION),
            inputs: boundedRecord(workflowBindingSchema),
            credentials: boundedRecord(z.string().regex(ID)),
            config: z
              .record(z.string(), z.unknown())
              .refine((record) => Object.keys(record).length <= 64, {
                message: "Must contain at most 64 entries.",
              }),
            retry: retrySchema,
          })
          .strict(),
      )
      .min(1)
      .max(64),
    outputs: boundedRecord(workflowStepBindingSchema),
  })
  .strict();

type MutableIssue = WorkflowValidationIssue;

const SECRET_LIKE_KEY =
  /^(api[-_]?key|secret|access[-_]?token|refresh[-_]?token|password|authorization|headers?|cookie|env)$/i;

function scanCandidate(value: unknown): {
  secretPaths: string[];
  tooComplex: boolean;
} {
  const maximumNodes = 10_000;
  const maximumUtf8Bytes = 1_048_576;
  const maximumStringBytes = 16_384;
  const maximumKeyBytes = 256;
  const maximumSecretPaths = 64;
  const found: string[] = [];
  const seen = new WeakSet<object>();
  const stack: Array<{
    value: unknown;
    path: Array<string | number>;
    depth: number;
  }> = [{ value, path: [], depth: 0 }];
  let visited = 0;
  let utf8Bytes = 0;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    visited += 1;
    if (visited > maximumNodes || entry.depth > 64) {
      return { secretPaths: found, tooComplex: true };
    }
    if (typeof entry.value === "string") {
      const bytes = Buffer.byteLength(entry.value, "utf8");
      utf8Bytes += bytes;
      if (bytes > maximumStringBytes || utf8Bytes > maximumUtf8Bytes) {
        return { secretPaths: found, tooComplex: true };
      }
    }
    if (!entry.value || typeof entry.value !== "object") continue;
    // JSON cannot represent cycles or shared object references. Reject both
    // rather than letting later schema/canonical recursion revisit them.
    if (seen.has(entry.value as object)) {
      return { secretPaths: found, tooComplex: true };
    }
    seen.add(entry.value as object);
    if (Array.isArray(entry.value)) {
      if (visited + stack.length + entry.value.length > maximumNodes) {
        return { secretPaths: found, tooComplex: true };
      }
      for (let index = entry.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: entry.value[index],
          path: [...entry.path, index],
          depth: entry.depth + 1,
        });
      }
      continue;
    }
    const record = entry.value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (visited + stack.length + keys.length > maximumNodes) {
      return { secretPaths: found, tooComplex: true };
    }
    for (const key of keys) {
      const keyBytes = Buffer.byteLength(key, "utf8");
      utf8Bytes += keyBytes;
      if (keyBytes > maximumKeyBytes || utf8Bytes > maximumUtf8Bytes) {
        return { secretPaths: found, tooComplex: true };
      }
      const path = [...entry.path, key];
      if (SECRET_LIKE_KEY.test(key)) {
        found.push(path.join("."));
        if (found.length > maximumSecretPaths) {
          return {
            secretPaths: found.slice(0, maximumSecretPaths),
            tooComplex: true,
          };
        }
      }
      stack.push({
        value: record[key],
        path,
        depth: entry.depth + 1,
      });
    }
  }
  return { secretPaths: found, tooComplex: false };
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) =>
      compareCodeUnits(left, right),
    ),
  );
}

function canonicalConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalConfig);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, child]) => [key, canonicalConfig(child)]),
  );
}

function issue(
  errors: MutableIssue[],
  code: MutableIssue["code"],
  path: string,
  message: string,
): void {
  errors.push({ code, path, message });
}

function sortIssues<T extends { path: string; code: string }>(values: T[]): T[] {
  return values.sort(
    (left, right) =>
      compareCodeUnits(left.path, right.path) ||
      compareCodeUnits(left.code, right.code),
  );
}

function boundedIssues(
  values: WorkflowValidationIssue[],
): WorkflowValidationIssue[] {
  const unique = new Map<string, WorkflowValidationIssue>();
  for (const value of values) {
    unique.set(
      `${value.path}\u0000${value.code}\u0000${value.message}`,
      value,
    );
  }
  const sorted = sortIssues([...unique.values()]);
  if (sorted.length <= 128) return sorted;
  return sortIssues([
    ...sorted.slice(0, 127),
    {
      code: "WORKFLOW_FIELD_INVALID",
      path: "<root>",
      message: "Workflow validation issues were truncated.",
    },
  ]);
}

function operationRetryValid(
  retry: WorkflowRetryPolicy,
  operation: WorkflowOperationDefinition,
): boolean {
  const { backoff } = retry;
  const bounds = operation.retryBounds;
  if (
    retry.maxAttempts < 1 ||
    retry.maxAttempts > bounds.maxAttempts ||
    backoff.initialMs < 0 ||
    backoff.initialMs > bounds.maxInitialMs ||
    backoff.maxMs < backoff.initialMs ||
    backoff.maxMs > bounds.maxBackoffMs ||
    backoff.multiplier < 1 ||
    backoff.multiplier > bounds.maxMultiplier
  ) {
    return false;
  }
  let totalDelay = 0;
  for (let attempt = 1; attempt < retry.maxAttempts; attempt += 1) {
    totalDelay += Math.min(
      backoff.maxMs,
      Math.round(backoff.initialMs * backoff.multiplier ** (attempt - 1)),
    );
  }
  return totalDelay <= bounds.maxTotalDelayMs;
}

function bindingKind(
  binding: WorkflowBinding,
  draft: WorkflowDraft,
  steps: Map<string, WorkflowDraft["steps"][number]>,
  operations: Map<string, WorkflowOperationDefinition>,
) {
  if (binding.from === "workflow_input") {
    return draft.inputs[binding.input]?.kind;
  }
  const source = steps.get(binding.step);
  return source
    ? operations.get(source.id)?.outputs[binding.output]
    : undefined;
}

function topologicalOrder(
  draft: WorkflowDraft,
  stepIds: Set<string>,
): { order: string[]; cyclic: boolean } {
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const step of draft.steps) {
    incoming.set(step.id, new Set());
    outgoing.set(step.id, new Set());
  }
  for (const step of draft.steps) {
    for (const binding of Object.values(step.inputs)) {
      if (
        binding.from !== "step_output" ||
        !stepIds.has(binding.step) ||
        binding.step === step.id
      ) {
        if (binding.from === "step_output" && binding.step === step.id) {
          incoming.get(step.id)?.add(step.id);
        }
        continue;
      }
      incoming.get(step.id)?.add(binding.step);
      outgoing.get(binding.step)?.add(step.id);
    }
  }
  const ready = [...incoming.entries()]
    .filter(([, dependencies]) => dependencies.size === 0)
    .map(([id]) => id)
    .sort(compareCodeUnits);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (!id) break;
    order.push(id);
    for (const dependent of [...(outgoing.get(id) ?? [])].sort(
      compareCodeUnits,
    )) {
      const dependencies = incoming.get(dependent);
      dependencies?.delete(id);
      if (dependencies?.size === 0 && !order.includes(dependent)) {
        ready.push(dependent);
        ready.sort(compareCodeUnits);
      }
    }
  }
  return { order, cyclic: order.length !== incoming.size };
}

function emptyResult(
  operationRegistry: WorkflowOperationRegistryReader,
  errors: WorkflowValidationIssue[],
  warnings: WorkflowValidationWarning[] = [],
): WorkflowValidationResult {
  return {
    valid: false,
    errors: boundedIssues(errors),
    warnings: sortIssues(warnings),
    digest: null,
    operationRegistryDigest: operationRegistry.digest,
    resolvedCapabilities: [],
    normalizedDefinition: null,
  };
}

export class WorkflowRevisionValidator {
  constructor(
    private readonly operationRegistry: WorkflowOperationRegistryReader,
    private readonly credentialSlots: WorkflowCredentialSlotAdmissionPort,
  ) {}

  async validate(input: {
    candidate: unknown;
    workspaceId: string;
    principalId: string;
    effectiveResources: AgentResourceConstraints;
  }): Promise<WorkflowValidationResult> {
    const candidateScan = scanCandidate(input.candidate);
    if (candidateScan.tooComplex) {
      return emptyResult(this.operationRegistry, [
        ...candidateScan.secretPaths.map((path) => ({
          code: "WORKFLOW_SECRET_FIELD_FORBIDDEN" as const,
          path,
          message: "Secret-like fields are forbidden in Workflow drafts.",
        })),
        {
          code: "WORKFLOW_FIELD_INVALID",
          path: "<root>",
          message:
            "Workflow candidate is cyclic, shares object references, or exceeds structural limits.",
        },
      ]);
    }
    const parsed = workflowDraftSchema.safeParse(input.candidate);
    if (!parsed.success) {
      const errors: WorkflowValidationIssue[] = [
        ...candidateScan.secretPaths.map((path) => ({
          code: "WORKFLOW_SECRET_FIELD_FORBIDDEN" as const,
          path,
          message: "Secret-like fields are forbidden in Workflow drafts.",
        })),
        ...parsed.error.issues.map((entry) => ({
          code:
            entry.path.at(-1) === "operation" &&
            typeof entry.path.at(-2) === "number"
              ? ("WORKFLOW_CAPABILITY_IDENTITY_INVALID" as const)
              : ("WORKFLOW_FIELD_INVALID" as const),
          path: entry.path.join(".") || "<root>",
          message: entry.message,
        })),
      ];
      return emptyResult(this.operationRegistry, errors);
    }

    const draft = parsed.data;
    const errors: WorkflowValidationIssue[] =
      candidateScan.secretPaths.map((path) => ({
        code: "WORKFLOW_SECRET_FIELD_FORBIDDEN",
        path,
        message: "Secret-like fields are forbidden in Workflow drafts.",
      }));
    const warnings: WorkflowValidationWarning[] = [];
    const steps = new Map<string, WorkflowDraft["steps"][number]>();
    const operations = new Map<string, WorkflowOperationDefinition>();
    const normalizedConfigs = new Map<string, Record<string, unknown>>();
    const referencedCredentialSlots = new Set(
      draft.steps.flatMap((step) => Object.values(step.credentials)),
    );

    for (const slotName of Object.keys(draft.credentialSlots)) {
      if (!referencedCredentialSlots.has(slotName)) {
        issue(
          errors,
          "WORKFLOW_CREDENTIAL_SLOT_UNAVAILABLE",
          `credentialSlots.${slotName}`,
          "Credential Slot declaration is unused or unavailable.",
        );
      }
    }

    for (const [index, step] of draft.steps.entries()) {
      if (steps.has(step.id)) {
        issue(
          errors,
          "WORKFLOW_DUPLICATE_STEP",
          `steps.${index}.id`,
          `Step ID ${step.id} is duplicated.`,
        );
      } else {
        steps.set(step.id, step);
      }
      if (!isExactWorkflowOperationIdentity(step.operation)) {
        issue(
          errors,
          "WORKFLOW_CAPABILITY_IDENTITY_INVALID",
          `steps.${index}.operation`,
          "Workflow operations require an exact identity.",
        );
        continue;
      }
      const operation = this.operationRegistry.get(step.operation);
      if (!operation) {
        issue(
          errors,
          "WORKFLOW_CAPABILITY_NOT_FOUND",
          `steps.${index}.operation`,
          `Operation ${step.operation} is not published.`,
        );
        continue;
      }
      operations.set(step.id, operation);
      if (operation.lifecycle === "retired") {
        issue(
          errors,
          "WORKFLOW_CAPABILITY_RETIRED",
          `steps.${index}.operation`,
          `Operation ${step.operation} is retired.`,
        );
      } else if (operation.lifecycle === "deprecated") {
        warnings.push({
          code: "WORKFLOW_CAPABILITY_DEPRECATED",
          path: `steps.${index}.operation`,
          message: `Operation ${step.operation} is deprecated.`,
        });
      }
      const config = this.operationRegistry.validateConfig(
        operation.identity,
        step.config,
      );
      if (!config.success) {
        for (const entry of config.issues) {
          issue(
            errors,
            "WORKFLOW_FIELD_INVALID",
            `steps.${index}.config.${entry.path.join(".") || "<root>"}`,
            entry.message,
          );
        }
      } else {
        normalizedConfigs.set(step.id, config.data);
      }
      if (!operationRetryValid(step.retry, operation)) {
        issue(
          errors,
          "WORKFLOW_RETRY_POLICY_INVALID",
          `steps.${index}.retry`,
          "Retry policy exceeds the operation's published bounds.",
        );
      }
    }

    for (const [index, step] of draft.steps.entries()) {
      const operation = operations.get(step.id);
      if (!operation) continue;
      for (const [port, definition] of Object.entries(operation.inputs)) {
        if (definition.required && !step.inputs[port]) {
          issue(
            errors,
            "WORKFLOW_REQUIRED_INPUT_MISSING",
            `steps.${index}.inputs.${port}`,
            `Required input port ${port} is not bound.`,
          );
        }
      }
      for (const [port, binding] of Object.entries(step.inputs)) {
        const expected = operation.inputs[port];
        if (!expected) {
          issue(
            errors,
            "WORKFLOW_PORT_NOT_FOUND",
            `steps.${index}.inputs.${port}`,
            `Operation ${step.operation} has no input port ${port}.`,
          );
          continue;
        }
        if (
          binding.from === "workflow_input" &&
          !draft.inputs[binding.input]
        ) {
          issue(
            errors,
            "WORKFLOW_SOURCE_NOT_FOUND",
            `steps.${index}.inputs.${port}`,
            `Workflow input ${binding.input} does not exist.`,
          );
          continue;
        }
        if (
          binding.from === "workflow_input" &&
          expected.required &&
          draft.inputs[binding.input]?.required === false
        ) {
          issue(
            errors,
            "WORKFLOW_REQUIRED_INPUT_MISSING",
            `steps.${index}.inputs.${port}`,
            `Required port ${port} cannot bind optional Workflow input ${binding.input}.`,
          );
          continue;
        }
        if (binding.from === "step_output") {
          const source = steps.get(binding.step);
          if (!source) {
            issue(
              errors,
              "WORKFLOW_SOURCE_NOT_FOUND",
              `steps.${index}.inputs.${port}`,
              `Source step ${binding.step} does not exist.`,
            );
            continue;
          }
          if (!operations.get(source.id)?.outputs[binding.output]) {
            issue(
              errors,
              "WORKFLOW_PORT_NOT_FOUND",
              `steps.${index}.inputs.${port}`,
              `Source step ${binding.step} has no output ${binding.output}.`,
            );
            continue;
          }
        }
        const actual = bindingKind(binding, draft, steps, operations);
        if (actual && actual !== expected.kind) {
          issue(
            errors,
            "WORKFLOW_HANDLE_TYPE_MISMATCH",
            `steps.${index}.inputs.${port}`,
            `Expected ${expected.kind}, received ${actual}.`,
          );
        }
      }

      for (const [requirement, definition] of Object.entries(
        operation.credentialRequirements,
      )) {
        const slotName = step.credentials[requirement];
        if (definition.required && !slotName) {
          issue(
            errors,
            "WORKFLOW_CREDENTIAL_SLOT_MISSING",
            `steps.${index}.credentials.${requirement}`,
            `Required credential binding ${requirement} is missing.`,
          );
          continue;
        }
        if (!slotName) continue;
        const slot = draft.credentialSlots[slotName];
        if (!slot) {
          issue(
            errors,
            "WORKFLOW_CREDENTIAL_SLOT_MISSING",
            `steps.${index}.credentials.${requirement}`,
            `Credential Slot ${slotName} does not exist.`,
          );
          continue;
        }
        if (slot.provider !== definition.provider) {
          issue(
            errors,
            "WORKFLOW_CREDENTIAL_PROVIDER_MISMATCH",
            `steps.${index}.credentials.${requirement}`,
            `Credential Slot ${slotName} does not satisfy provider ${definition.provider}.`,
          );
          continue;
        }
        const accessible = await this.credentialSlots.isAccessible({
          workspaceId: input.workspaceId,
          principalId: input.principalId,
          slotId: slot.slotId,
          provider: definition.provider,
          effectiveResources: input.effectiveResources,
        });
        if (!accessible) {
          issue(
            errors,
            "WORKFLOW_CREDENTIAL_SLOT_UNAVAILABLE",
            `steps.${index}.credentials.${requirement}`,
            `Credential Slot ${slotName} is unavailable.`,
          );
        }
      }
      for (const requirement of Object.keys(step.credentials)) {
        if (!operation.credentialRequirements[requirement]) {
          issue(
            errors,
            "WORKFLOW_CREDENTIAL_SLOT_MISSING",
            `steps.${index}.credentials.${requirement}`,
            `Operation ${step.operation} has no credential requirement ${requirement}.`,
          );
        }
      }
    }

    for (const [name, binding] of Object.entries(draft.outputs)) {
      const source = steps.get(binding.step);
      if (!source) {
        issue(
          errors,
          "WORKFLOW_SOURCE_NOT_FOUND",
          `outputs.${name}`,
          `Source step ${binding.step} does not exist.`,
        );
      } else if (!operations.get(source.id)?.outputs[binding.output]) {
        issue(
          errors,
          "WORKFLOW_PORT_NOT_FOUND",
          `outputs.${name}`,
          `Source step ${binding.step} has no output ${binding.output}.`,
        );
      }
    }

    const topology = topologicalOrder(draft, new Set(steps.keys()));
    if (topology.cyclic) {
      issue(
        errors,
        "WORKFLOW_GRAPH_CYCLE",
        "steps",
        "Workflow input bindings contain a cycle.",
      );
    }
    if (errors.length > 0) {
      return emptyResult(this.operationRegistry, errors, warnings);
    }

    const stepById = new Map(draft.steps.map((step) => [step.id, step]));
    const normalizedDefinition: ResolvedWorkflowDefinition = {
      schema: "content-workflow-revision-definition/v1",
      workflowId: draft.workflowId,
      name: draft.name,
      ...(draft.description ? { description: draft.description } : {}),
      inputs: sortedRecord(draft.inputs),
      credentialSlots: sortedRecord(draft.credentialSlots),
      steps: topology.order.map((id) => {
        const step = stepById.get(id);
        const operation = operations.get(id);
        if (!step || !operation) {
          throw new TypeError("Validated Workflow topology is incomplete.");
        }
        return {
          id: step.id,
          operation: {
            identity: operation.identity,
            contractDigest: operation.contractDigest,
          },
          inputs: sortedRecord(step.inputs),
          credentials: sortedRecord(step.credentials),
          config: canonicalConfig(
            normalizedConfigs.get(step.id) ?? step.config,
          ) as Record<string, unknown>,
          retry: step.retry,
        };
      }),
      outputs: sortedRecord(
        Object.fromEntries(
          Object.entries(draft.outputs).map(([name, binding]) => {
            const kind = operations.get(binding.step)?.outputs[binding.output];
            if (!kind) {
              throw new TypeError("Validated Workflow output is incomplete.");
            }
            return [name, { kind, binding }];
          }),
        ),
      ),
    };
    return {
      valid: true,
      errors: [],
      warnings: sortIssues(warnings),
      // Revision identity covers executable behavior only. Logical Workflow
      // identity and display copy are retained for inspection but cannot make
      // two otherwise identical executable definitions distinct.
      digest: canonicalDigest({
        schema: normalizedDefinition.schema,
        inputs: Object.fromEntries(
          Object.entries(normalizedDefinition.inputs).map(
            ([name, definition]) => [
              name,
              { kind: definition.kind, required: definition.required },
            ],
          ),
        ),
        credentialSlots: normalizedDefinition.credentialSlots,
        steps: normalizedDefinition.steps,
        outputs: normalizedDefinition.outputs,
      }),
      operationRegistryDigest: this.operationRegistry.digest,
      resolvedCapabilities: normalizedDefinition.steps.map((step) => ({
        stepId: step.id,
        identity: step.operation.identity,
        contractDigest: step.operation.contractDigest,
      })),
      normalizedDefinition,
    };
  }
}
