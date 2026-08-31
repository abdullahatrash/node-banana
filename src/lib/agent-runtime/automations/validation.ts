import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { z } from "zod";
import type {
  AutomationReferencePort,
  AutomationRevisionInput,
  AutomationRevisionValidationIssue,
  AutomationRevisionValidationResult,
} from "./types";

const id = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const boundedText = z.string().max(16_000);

export const automationRevisionInputSchema = z
  .object({
    schema: z.literal("automation-revision-input/v1"),
    automationId: id,
    trigger: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("explicit_command") }).strict(),
      z.object({ kind: z.literal("schedule"), schedule: z.record(z.string(), z.unknown()) }).strict(),
      z.object({ kind: z.literal("external_event"), connector: z.record(z.string(), z.unknown()) }).strict(),
    ]),
    occurrencePolicy: z
      .object({
        overlap: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("queue") }).strict(),
          z.object({ mode: z.literal("skip") }).strict(),
          z.object({ mode: z.literal("parallel"), maximumConcurrency: z.number().int().min(1).max(100) }).strict(),
        ]),
        maximumMaterializationAttempts: z.number().int().min(1).max(8),
      })
      .strict(),
    action: z
      .object({
        kind: z.literal("start_workflow"),
        workflow: z
          .object({ workflowId: id, revisionId: id, revision: z.number().int().min(1), definitionDigest: digest })
          .strict(),
        inputs: z
          .object({ constants: z.record(id, boundedText).refine((value) => Object.keys(value).length <= 100), artifactBindings: z.record(id, id).refine((value) => Object.keys(value).length <= 100) })
          .strict(),
      })
      .strict(),
  })
  .strict();

function issue(code: string, path: string, message: string): AutomationRevisionValidationIssue {
  return { code, path, message };
}

function invalid(errors: AutomationRevisionValidationIssue[]): AutomationRevisionValidationResult {
  return {
    valid: false,
    errors,
    definitionDigest: null,
    normalizedDefinition: null,
    workflowResourceIds: [],
    artifactResourceIds: [],
    referenceSnapshot: null,
  };
}

export async function validateAutomationRevision(
  draft: unknown,
  input: { workspaceId: string; references: AutomationReferencePort },
): Promise<AutomationRevisionValidationResult> {
  const parsed = automationRevisionInputSchema.safeParse(draft);
  if (!parsed.success) {
    return invalid(
      parsed.error.issues.map((entry) =>
        issue("AUTOMATION_REVISION_INVALID", entry.path.join(".") || "$", entry.message),
      ),
    );
  }
  const definition = parsed.data as AutomationRevisionInput;
  if (definition.trigger.kind !== "explicit_command") {
    return invalid([
      issue(
        "AUTOMATION_TRIGGER_NOT_SUPPORTED",
        "trigger.kind",
        "#172 supports explicit commands only; schedules and external events require their dedicated runtime.",
      ),
    ]);
  }
  if (definition.occurrencePolicy.overlap.mode !== "queue") {
    return invalid([
      issue("AUTOMATION_OVERLAP_NOT_SUPPORTED", "occurrencePolicy.overlap.mode", "#172 supports FIFO queueing only."),
    ]);
  }
  const snapshot = await input.references.getWorkflowRevision({
    workspaceId: input.workspaceId,
    workflowId: definition.action.workflow.workflowId,
    revisionId: definition.action.workflow.revisionId,
  });
  if (
    !snapshot ||
    snapshot.revision !== definition.action.workflow.revision ||
    snapshot.definitionDigest !== definition.action.workflow.definitionDigest
  ) {
    return invalid([issue("AUTOMATION_WORKFLOW_REFERENCE_INVALID", "action.workflow", "The exact Workflow Revision is unavailable or changed.")]);
  }
  if (!snapshot.goldenWorkflow || snapshot.goldenWorkflow.kind !== "golden_linkedin_v1") {
    return invalid([issue("AUTOMATION_WORKFLOW_NOT_GOLDEN", "action.workflow", "The Workflow Revision is not an eligible deterministic golden Workflow.")]);
  }

  const errors: AutomationRevisionValidationIssue[] = [];
  const declared = new Map(snapshot.inputNames.map((entry) => [entry.name, entry]));
  const boundNames = new Set([
    ...Object.keys(definition.action.inputs.constants),
    ...Object.keys(definition.action.inputs.artifactBindings),
  ]);
  for (const name of Object.keys(definition.action.inputs.constants)) {
    if (declared.get(name)?.kind !== "text") errors.push(issue("AUTOMATION_INPUT_INVALID", `action.inputs.constants.${name}`, "The constant must bind an exact text input."));
  }
  for (const name of Object.keys(definition.action.inputs.artifactBindings)) {
    if (Object.hasOwn(definition.action.inputs.constants, name) || declared.get(name)?.kind !== "image") {
      errors.push(issue("AUTOMATION_INPUT_INVALID", `action.inputs.artifactBindings.${name}`, "The Artifact must bind one exact image input once."));
    }
  }
  for (const entry of snapshot.inputNames) {
    if (entry.required && !boundNames.has(entry.name)) errors.push(issue("AUTOMATION_INPUT_REQUIRED", `action.inputs.${entry.name}`, "A required Workflow input is not bound."));
  }
  for (const name of boundNames) {
    if (!declared.has(name)) errors.push(issue("AUTOMATION_INPUT_UNKNOWN", `action.inputs.${name}`, "The Workflow Revision does not declare this input."));
  }

  const artifactIds = [...new Set(Object.values(definition.action.inputs.artifactBindings))].sort();
  const artifacts = [];
  for (const artifactId of artifactIds) {
    const artifact = await input.references.getArtifact({ workspaceId: input.workspaceId, artifactId });
    if (!artifact || artifact.kind !== "image" || artifact.origin !== "imported") {
      errors.push(issue("AUTOMATION_ARTIFACT_INVALID", "action.inputs.artifactBindings", "An exact imported image Artifact is unavailable."));
    } else {
      artifacts.push({ id: artifact.id, digest: artifact.digest, kind: "image" as const, origin: "imported" as const });
    }
  }
  if (errors.length > 0) return invalid(errors);

  const normalizedDefinition: AutomationRevisionInput = {
    ...definition,
    action: {
      ...definition.action,
      inputs: {
        constants: Object.fromEntries(Object.entries(definition.action.inputs.constants).sort(([a], [b]) => a.localeCompare(b))),
        artifactBindings: Object.fromEntries(Object.entries(definition.action.inputs.artifactBindings).sort(([a], [b]) => a.localeCompare(b))),
      },
    },
  };
  return {
    valid: true,
    errors: [],
    definitionDigest: canonicalDigest(normalizedDefinition),
    normalizedDefinition,
    workflowResourceIds: [snapshot.workflowId],
    artifactResourceIds: artifactIds,
    referenceSnapshot: {
      operationRegistryDigest: snapshot.operationRegistryDigest,
      goldenWorkflowContractDigest: snapshot.goldenWorkflow.contractDigest,
      artifacts,
    },
  };
}
