/**
 * THROWAWAY PROTOTYPE.
 *
 * Strict public schemas and semantic validation for issue 140. Nothing here is
 * wired to the production runtime.
 */

import { z } from "zod";
import { createHash } from "node:crypto";

export const contentKinds = ["text", "image", "audio", "video", "json"] as const;
export type ContentKind = (typeof contentKinds)[number];

const ContentKindSchema = z.enum(contentKinds);

const WorkflowInputBindingSchema = z.strictObject({
  from: z.literal("workflow-input"),
  input: z.string().min(1),
});

const StepOutputBindingSchema = z.strictObject({
  from: z.literal("step-output"),
  step: z.string().min(1),
  output: z.string().min(1),
});

export const BindingSchema = z.discriminatedUnion("from", [
  WorkflowInputBindingSchema,
  StepOutputBindingSchema,
]);

export type Binding = z.infer<typeof BindingSchema>;

const WorkflowInputSchema = z.strictObject({
  type: ContentKindSchema,
  required: z.boolean().default(true),
  description: z.string().optional(),
});

const CredentialSlotSchema = z.strictObject({
  capability: z.string().regex(/^[a-z][a-z0-9.-]*$/),
  description: z.string().min(1),
});

const WorkflowStepSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  uses: z.string().regex(/^[a-z][a-z0-9.-]*\/v[1-9][0-9]*$/),
  inputs: z.record(z.string(), BindingSchema),
  credentials: z.record(z.string(), z.string().min(1)),
  config: z.record(z.string(), z.unknown()).default({}),
  retry: z
    .strictObject({
      maxAttempts: z.number().int().min(1).max(10),
      backoff: z
        .strictObject({
          initialMs: z.number().int().min(0).max(60_000),
          maxMs: z.number().int().min(0).max(300_000),
          multiplier: z.number().min(1).max(10),
        })
        .refine((backoff) => backoff.maxMs >= backoff.initialMs, {
          message: "maxMs must be greater than or equal to initialMs",
        }),
    })
    .default({
      maxAttempts: 1,
      backoff: { initialMs: 0, maxMs: 0, multiplier: 1 },
    }),
});

export const ContentWorkflowV1Schema = z.strictObject({
  schema: z.literal("content-workflow/v1"),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().optional(),
  inputs: z.record(z.string(), WorkflowInputSchema),
  credentialSlots: z.record(z.string(), CredentialSlotSchema),
  steps: z.array(WorkflowStepSchema).min(1),
  outputs: z.record(z.string(), StepOutputBindingSchema),
  ui: z
    .strictObject({
      positions: z.record(
        z.string(),
        z.strictObject({
          x: z.number(),
          y: z.number(),
        }),
      ),
    })
    .optional(),
});

export type ContentWorkflowV1 = z.infer<typeof ContentWorkflowV1Schema>;

export const ContentWorkflowVersionV1Schema = z
  .strictObject({
    schema: z.literal("content-workflow-version/v1"),
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    version: z.number().int().positive(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    definition: ContentWorkflowV1Schema,
  })
  .superRefine((persisted, context) => {
    if (persisted.id !== persisted.definition.id) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "must match definition.id",
      });
    }
    if (persisted.version !== persisted.definition.version) {
      context.addIssue({
        code: "custom",
        path: ["version"],
        message: "must match definition.version",
      });
    }
    if (persisted.digest !== digestDefinition(persisted.definition)) {
      context.addIssue({
        code: "custom",
        path: ["digest"],
        message: "must be the SHA-256 digest of the canonical definition",
      });
    }
  });

export type ContentWorkflowVersionV1 = z.infer<
  typeof ContentWorkflowVersionV1Schema
>;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function digestDefinition(definition: ContentWorkflowV1): string {
  const digest = createHash("sha256")
    .update(canonicalize(definition))
    .digest("hex");
  return `sha256:${digest}`;
}

export function persistWorkflowVersion(
  authored: ContentWorkflowV1,
): ContentWorkflowVersionV1 {
  const definition = ContentWorkflowV1Schema.parse(authored);

  return ContentWorkflowVersionV1Schema.parse({
    schema: "content-workflow-version/v1",
    id: definition.id,
    version: definition.version,
    digest: digestDefinition(definition),
    definition,
  });
}

export interface OperationDefinition {
  inputs: Record<string, { type: ContentKind; required: boolean }>;
  outputs: Record<string, ContentKind>;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  configSchema: z.ZodType;
  credentialRequirements: Record<
    string,
    { capability: string; required: boolean }
  >;
}

export type OperationRegistry = Record<string, OperationDefinition>;

export const PROTOTYPE_OPERATION_REGISTRY: OperationRegistry = {
  "ai.text.generate/v1": {
    inputs: {
      prompt: { type: "text", required: true },
    },
    outputs: {
      text: "text",
    },
    inputSchema: z.strictObject({
      prompt: z.string().min(1),
    }),
    outputSchema: z.strictObject({
      text: z.string().min(1),
    }),
    configSchema: z.strictObject({
      model: z.enum([
        "google/gemini-2.5-flash",
        "google/gemini-3-flash-preview",
      ]),
      instruction: z.string().min(1),
    }),
    credentialRequirements: {
      provider: {
        capability: "google.generative-ai",
        required: true,
      },
    },
  },
  "ai.image.generate/v1": {
    inputs: {
      prompt: { type: "text", required: true },
      referenceImage: { type: "image", required: false },
    },
    outputs: {
      image: "image",
    },
    inputSchema: z.strictObject({
      prompt: z.string().min(1),
      referenceImage: z.string().min(1).optional(),
    }),
    outputSchema: z.strictObject({
      image: z.string().min(1),
    }),
    configSchema: z.strictObject({
      model: z.enum([
        "google/gemini-2.5-flash-image",
        "google/gemini-3-pro-image-preview",
      ]),
      aspectRatio: z.enum(["1:1", "4:5", "16:9"]),
    }),
    credentialRequirements: {
      provider: {
        capability: "google.generative-ai",
        required: true,
      },
    },
  },
};

export interface WorkflowValidation {
  ok: boolean;
  errors: string[];
  order: string[];
  workflow?: ContentWorkflowV1;
}

const secretLikeKey =
  /^(api[-_]?key|secret|access[-_]?token|refresh[-_]?token|password|authorization|headers?|cookie|env)$/i;

function findSecretLikePaths(
  value: unknown,
  path: Array<string | number> = [],
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findSecretLikePaths(item, [...path, index]),
    );
  }
  if (!value || typeof value !== "object") return [];

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, nested]) => {
      const nextPath = [...path, key];
      const own = secretLikeKey.test(key) ? [nextPath.join(".")] : [];
      return [...own, ...findSecretLikePaths(nested, nextPath)];
    },
  );
}

function bindingType(
  binding: Binding,
  workflow: ContentWorkflowV1,
  steps: Map<string, ContentWorkflowV1["steps"][number]>,
  registry: OperationRegistry,
): ContentKind | undefined {
  if (binding.from === "workflow-input") {
    return workflow.inputs[binding.input]?.type;
  }

  const sourceStep = steps.get(binding.step);
  if (!sourceStep) return undefined;
  return registry[sourceStep.uses]?.outputs[binding.output];
}

function topologicalOrder(
  workflow: ContentWorkflowV1,
): { order: string[]; cycle: boolean } {
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();

  for (const step of workflow.steps) {
    incoming.set(step.id, new Set());
    outgoing.set(step.id, new Set());
  }

  for (const step of workflow.steps) {
    for (const binding of Object.values(step.inputs)) {
      if (binding.from !== "step-output") continue;
      incoming.get(step.id)?.add(binding.step);
      outgoing.get(binding.step)?.add(step.id);
    }
  }

  const ready = workflow.steps
    .map((step) => step.id)
    .filter((id) => incoming.get(id)?.size === 0);
  const order: string[] = [];

  while (ready.length > 0) {
    const id = ready.shift();
    if (!id) break;
    order.push(id);

    for (const dependent of outgoing.get(id) ?? []) {
      const dependencies = incoming.get(dependent);
      dependencies?.delete(id);
      if (dependencies?.size === 0) ready.push(dependent);
    }
  }

  return { order, cycle: order.length !== workflow.steps.length };
}

export function validateWorkflow(
  candidate: unknown,
  registry: OperationRegistry = PROTOTYPE_OPERATION_REGISTRY,
): WorkflowValidation {
  const secretPaths = findSecretLikePaths(candidate);
  const parsed = ContentWorkflowV1Schema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [
        ...secretPaths.map(
          (path) =>
            `${path}: secret-like fields are forbidden in Content Workflows`,
        ),
        ...parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
        ),
      ],
      order: [],
    };
  }

  const workflow = parsed.data;
  const errors: string[] = secretPaths.map(
    (path) => `${path}: secret-like fields are forbidden in Content Workflows`,
  );
  const steps = new Map<string, ContentWorkflowV1["steps"][number]>();

  for (const step of workflow.steps) {
    if (steps.has(step.id)) {
      errors.push(`steps: duplicate step id "${step.id}"`);
    }
    steps.set(step.id, step);
  }

  for (const step of workflow.steps) {
    const operation = registry[step.uses];
    if (!operation) {
      errors.push(`${step.id}.uses: unknown operation "${step.uses}"`);
      continue;
    }

    const config = operation.configSchema.safeParse(step.config);
    if (!config.success) {
      for (const issue of config.error.issues) {
        errors.push(
          `${step.id}.config.${issue.path.join(".") || "<root>"}: ${issue.message}`,
        );
      }
    }

    for (const [requirement, definition] of Object.entries(
      operation.credentialRequirements,
    )) {
      const slotName = step.credentials[requirement];
      if (definition.required && !slotName) {
        errors.push(
          `${step.id}.credentials: missing required binding "${requirement}"`,
        );
        continue;
      }
      if (!slotName) continue;

      const slot = workflow.credentialSlots[slotName];
      if (!slot) {
        errors.push(
          `${step.id}.credentials.${requirement}: unknown Credential Slot "${slotName}"`,
        );
      } else if (slot.capability !== definition.capability) {
        errors.push(
          `${step.id}.credentials.${requirement}: slot capability ${slot.capability} does not satisfy ${definition.capability}`,
        );
      }
    }

    for (const requirement of Object.keys(step.credentials)) {
      if (!operation.credentialRequirements[requirement]) {
        errors.push(
          `${step.id}.credentials.${requirement}: operation has no such credential requirement`,
        );
      }
    }

    for (const [port, definition] of Object.entries(operation.inputs)) {
      if (definition.required && !step.inputs[port]) {
        errors.push(`${step.id}.inputs: missing required port "${port}"`);
      }
    }

    for (const [port, binding] of Object.entries(step.inputs)) {
      const inputDefinition = operation.inputs[port];
      if (!inputDefinition) {
        errors.push(`${step.id}.inputs.${port}: operation has no such port`);
        continue;
      }

      if (
        binding.from === "workflow-input" &&
        !workflow.inputs[binding.input]
      ) {
        errors.push(
          `${step.id}.inputs.${port}: unknown workflow input "${binding.input}"`,
        );
        continue;
      }

      if (binding.from === "step-output") {
        const source = steps.get(binding.step);
        if (!source) {
          errors.push(
            `${step.id}.inputs.${port}: unknown source step "${binding.step}"`,
          );
          continue;
        }
        if (!registry[source.uses]?.outputs[binding.output]) {
          errors.push(
            `${step.id}.inputs.${port}: "${binding.step}" has no output "${binding.output}"`,
          );
          continue;
        }
      }

      const actualType = bindingType(binding, workflow, steps, registry);
      if (actualType && actualType !== inputDefinition.type) {
        errors.push(
          `${step.id}.inputs.${port}: expected ${inputDefinition.type}, received ${actualType}`,
        );
      }
    }
  }

  for (const [name, binding] of Object.entries(workflow.outputs)) {
    const source = steps.get(binding.step);
    if (!source) {
      errors.push(`outputs.${name}: unknown source step "${binding.step}"`);
      continue;
    }
    if (!registry[source.uses]?.outputs[binding.output]) {
      errors.push(
        `outputs.${name}: "${binding.step}" has no output "${binding.output}"`,
      );
    }
  }

  for (const stepId of Object.keys(workflow.ui?.positions ?? {})) {
    if (!steps.has(stepId)) {
      errors.push(`ui.positions: unknown step "${stepId}"`);
    }
  }

  const topology = topologicalOrder(workflow);
  if (topology.cycle) {
    errors.push("steps: input bindings contain a cycle");
  }

  return {
    ok: errors.length === 0,
    errors,
    order: topology.order,
    workflow,
  };
}

const InlineStorageSchema = z.strictObject({
  type: z.literal("inline"),
  value: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

const AssetStorageSchema = z.strictObject({
  type: z.literal("asset"),
  assetId: z.string().min(1),
});

export const ArtifactV1Schema = z.strictObject({
  schema: z.literal("artifact/v1"),
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  kind: ContentKindSchema,
  mediaType: z.string().min(1),
  storage: z.discriminatedUnion("type", [
    InlineStorageSchema,
    AssetStorageSchema,
  ]),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  origin: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("workflow-step"),
      runId: z.string().min(1),
      stepId: z.string().min(1),
      attempt: z.number().int().positive(),
      outputPort: z.string().min(1),
      operation: z.string().min(1),
    }),
    z.strictObject({
      type: z.literal("import"),
      importedBy: z.strictObject({
        type: z.literal("actor-ref"),
        ref: z.string().min(1),
      }),
      importedAt: z.string().min(1),
      externalSource: z
        .strictObject({
          uri: z.string().min(1),
          attribution: z.string().min(1).optional(),
        })
        .optional(),
    }),
  ]),
  lineage: z.strictObject({
    parentArtifactIds: z.array(z.string()),
  }),
  createdAt: z.string().min(1),
});

export type ArtifactV1 = z.infer<typeof ArtifactV1Schema>;

export const RunErrorSchema = z.discriminatedUnion("classification", [
  z.strictObject({
    code: z.string().min(1),
    safeMessage: z.string().min(1),
    classification: z.literal("transient"),
    retryable: z.literal(true),
  }),
  z.strictObject({
    code: z.string().min(1),
    safeMessage: z.string().min(1),
    classification: z.literal("terminal"),
    retryable: z.literal(false),
  }),
]);

const StepAttemptSchema = z.strictObject({
  number: z.number().int().positive(),
  state: z.enum(["running", "succeeded", "failed", "cancelled"]),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
  error: RunErrorSchema.optional(),
  retryAfterMs: z.number().int().nonnegative().optional(),
});

const StepRunSchema = z.strictObject({
  state: z.enum([
    "pending",
    "running",
    "waiting",
    "succeeded",
    "reused",
    "failed",
    "cancelled",
  ]),
  attempts: z.array(StepAttemptSchema),
  outputArtifactIds: z.record(z.string(), z.string()),
  reusedFrom: z
    .strictObject({
      runId: z.string().min(1),
      artifactIds: z.array(z.string().min(1)),
    })
    .optional(),
});

export const WorkflowRunV1Schema = z.strictObject({
  schema: z.literal("workflow-run/v1"),
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  workflow: z.strictObject({
    id: z.string().min(1),
    version: z.number().int().positive(),
    digest: z.string().startsWith("sha256:"),
  }),
  state: z.enum([
    "queued",
    "running",
    "waiting",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  revision: z.number().int().nonnegative(),
  lastEventSequence: z.number().int().positive(),
  resolvedInputs: z.record(z.string(), z.unknown()),
  resolvedCredentialSlots: z.record(
    z.string(),
    z.strictObject({
      capability: z.string().min(1),
      profileRef: z.string().min(1),
      profileVersion: z.number().int().positive(),
      credentialRef: z.string().min(1),
      credentialVersion: z.number().int().positive(),
    }),
  ),
  steps: z.record(z.string(), StepRunSchema),
  outputArtifactIds: z.record(z.string(), z.string()),
  derivedFrom: z
    .strictObject({
      runId: z.string().min(1),
      retryFromStepId: z.string().min(1),
      reusedArtifactIds: z.array(z.string().min(1)),
    })
    .optional(),
  failure: z
    .strictObject({
      stepId: z.string().min(1),
      attempt: z.number().int().positive(),
      error: RunErrorSchema,
    })
    .optional(),
  waiting: z
    .strictObject({
      kind: z.enum(["external-input", "approval"]),
      reason: z.string().min(1),
    })
    .optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type WorkflowRunV1 = z.infer<typeof WorkflowRunV1Schema>;

export const WorkflowRunEventV1Schema = z.strictObject({
  schema: z.literal("workflow-run-event/v1"),
  runId: z.string().min(1),
  sequence: z.number().int().positive(),
  type: z.enum([
    "run.created",
    "run.started",
    "run.waiting",
    "run.succeeded",
    "run.failed",
    "run.cancelled",
    "run.derived",
    "step.started",
    "step.succeeded",
    "step.failed",
    "step.retry-scheduled",
    "step.cancelled",
    "artifact.created",
  ]),
  at: z.string().min(1),
  refs: z
    .strictObject({
      stepId: z.string().min(1).optional(),
      attempt: z.number().int().positive().optional(),
      artifactId: z.string().min(1).optional(),
      relatedRunId: z.string().min(1).optional(),
    })
    .default({}),
  payload: z
    .strictObject({
      reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
      error: RunErrorSchema.optional(),
      backoffMs: z.number().int().nonnegative().optional(),
    })
    .default({}),
});

export type WorkflowRunEventV1 = z.infer<typeof WorkflowRunEventV1Schema>;
