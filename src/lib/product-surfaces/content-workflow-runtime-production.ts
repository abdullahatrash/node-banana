import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "@/lib/agent-runtime/workflows";
import type { ResolvedWorkflowDefinition } from "@/lib/agent-runtime/workflows/types";
import type { WorkflowRunAcceptedDto } from "@/lib/agent-runtime/runs/types";
import { dispatchCapability } from "@/lib/agent-runtime/server-dispatcher";
import { getDb } from "@/lib/db";
import { contentWorkflowRevisions, contentWorkflows } from "@/lib/db/schema";
import { contentWorkflowGenerationRuns } from "@/lib/model-routing/db-schema";
import { generationOperationId } from "@/lib/model-routing/generation-operation";
import { CONTENT_GENERATION_DISPATCH_OPERATIONS, contentGenerationDispatchOperation } from "@/lib/model-routing/content-workflow-operation";
import type { ContentFormatDefinition } from "./content-format-definition";
import { ContentWorkflowRuntimeError, type ContentWorkflowRuntimePort } from "./content-workflow-runtime";

const digestOperation = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get("runtime.digest_text@1")!;
export const CONTENT_WORKFLOW_OPERATION_REGISTRY_DIGEST = canonicalDigest({
  base: GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest,
  contentDispatch: CONTENT_GENERATION_DISPATCH_OPERATIONS.map((operation) => ({ identity: operation.identity, digest: operation.contractDigest })),
});

export function resolvedContentWorkflowDefinition(definition: ContentFormatDefinition): ResolvedWorkflowDefinition {
  const workflow = definition.execution.workflow;
  if (!workflow || definition.execution.strategy !== "admitted_generation") throw new ContentWorkflowRuntimeError("CONTENT_CANONICAL_IMPORT_REQUIRED");
  const dispatch = contentGenerationDispatchOperation(workflow.operation, workflow.inputs);
  if (!dispatch) throw new ContentWorkflowRuntimeError("CONTENT_WORKFLOW_OPERATION_UNAVAILABLE");
  const declaredInputs = Object.fromEntries(workflow.inputs.map((name) => [name, { kind: "text" as const, required: true }]));
  return {
    schema: "content-workflow-revision-definition/v1", workflowId: workflow.id,
    name: `Content recipe: ${definition.format}`, description: `Pinned ${definition.id} revision ${definition.revision}`,
    inputs: declaredInputs, credentialSlots: {},
    steps: [
      { id: `validate_${definition.format}`, operation: { identity: digestOperation.identity, contractDigest: digestOperation.contractDigest }, inputs: { text: { from: "workflow_input", input: "recipe" } }, credentials: {}, config: {}, retry: { maxAttempts: 1, backoff: { initialMs: 0, maxMs: 0, multiplier: 1 } } },
      { id: `dispatch_${definition.format}`, operation: { identity: dispatch.identity, contractDigest: dispatch.contractDigest }, inputs: { guard: { from: "step_output", step: `validate_${definition.format}`, output: "textDigest" }, ...Object.fromEntries(workflow.inputs.map((name) => [name, { from: "workflow_input" as const, input: name }])) }, credentials: {}, config: {}, retry: { maxAttempts: 1, backoff: { initialMs: 0, maxMs: 0, multiplier: 1 } } },
    ],
    outputs: { receipt: { kind: "text", binding: { from: "step_output", step: `dispatch_${definition.format}`, output: "receipt" } } },
  };
}

export function productionContentWorkflowRuntime(input: { principalId: string; keyId: string }): ContentWorkflowRuntimePort {
  return {
    async ensureRevision({ workspaceId, definition }) {
      const workflow = definition.execution.workflow;
      if (!workflow) throw new ContentWorkflowRuntimeError("CONTENT_WORKFLOW_REVISION_UNAVAILABLE");
      const resolved = resolvedContentWorkflowDefinition(definition);
      const definitionDigest = canonicalDigest(resolved);
      const now = new Date();
      await getDb().transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`content-workflow:${workspaceId}:${workflow.id}`}, 0))`);
        await tx.insert(contentWorkflows).values({ workspaceId, id: workflow.id, currentRevision: definition.revision, createdByPrincipalId: input.principalId, createdByKeyId: input.keyId, authorizationEvidenceRef: `builtin:${definition.id}:v${definition.revision}`, createdAt: now, updatedAt: now }).onConflictDoNothing();
        await tx.insert(contentWorkflowRevisions).values({ workspaceId, id: workflow.revisionId, workflowId: workflow.id, revision: definition.revision, definitionDigest, definition: resolved, operationRegistryDigest: CONTENT_WORKFLOW_OPERATION_REGISTRY_DIGEST, authorPrincipalId: input.principalId, authorKeyId: input.keyId, authorizationEvidenceRef: `builtin:${definition.id}:v${definition.revision}`, createdAt: now }).onConflictDoNothing();
        await tx.update(contentWorkflows).set({ currentRevision: definition.revision, updatedAt: now }).where(and(eq(contentWorkflows.workspaceId, workspaceId), eq(contentWorkflows.id, workflow.id), eq(contentWorkflows.currentRevision, definition.revision - 1)));
        const [stored] = await tx.select({ currentRevision: contentWorkflows.currentRevision, revisionId: contentWorkflowRevisions.id, definition: contentWorkflowRevisions.definition, definitionDigest: contentWorkflowRevisions.definitionDigest, operationRegistryDigest: contentWorkflowRevisions.operationRegistryDigest }).from(contentWorkflows).innerJoin(contentWorkflowRevisions, and(eq(contentWorkflowRevisions.workspaceId, contentWorkflows.workspaceId), eq(contentWorkflowRevisions.workflowId, contentWorkflows.id), eq(contentWorkflowRevisions.id, workflow.revisionId))).where(and(eq(contentWorkflows.workspaceId, workspaceId), eq(contentWorkflows.id, workflow.id))).limit(1);
        if (!stored || stored.currentRevision !== definition.revision || stored.revisionId !== workflow.revisionId || stored.definitionDigest !== definitionDigest || canonicalDigest(stored.definition) !== definitionDigest || stored.operationRegistryDigest !== CONTENT_WORKFLOW_OPERATION_REGISTRY_DIGEST) throw new ContentWorkflowRuntimeError("CONTENT_WORKFLOW_REVISION_CONFLICT");
      });
    },
    async start(startInput) {
      const response = await dispatchCapability({ capability: "workflow_runs.start@3", input: { workflowId: startInput.workflowId, revisionId: startInput.revisionId, inputs: startInput.inputs, inputArtifactIds: [], inputStudioAssetIds: startInput.authorizedStudioAssetIds, idempotencyKey: startInput.idempotencyKey } }, { securityContext: { kind: "agent", workspaceId: startInput.workspaceId, principalId: startInput.servicePrincipalId, keyId: startInput.serviceKeyId } });
      if (response.type === "capability_error") throw new ContentWorkflowRuntimeError(response.code);
      return response.output as unknown as WorkflowRunAcceptedDto;
    },
    async bind(bindInput) {
      const binding = bindInput.intent.contentExecution!;
      const now = new Date();
      const [inserted] = await getDb().insert(contentWorkflowGenerationRuns).values({ workspaceId: bindInput.workspaceId, generationIntentId: bindInput.intent.id, generationOperationId: generationOperationId(bindInput.intent.id), contentPieceId: binding.contentPiece.id, contentPieceRevision: binding.contentPiece.revision, workflowId: binding.workflow.id, workflowRevisionId: binding.workflow.revisionId, workflowRunId: bindInput.run.id, recipeDigest: binding.digest, selectedModel: bindInput.intent.selectedModel, initiatedByUserId: bindInput.initiatedByUserId, initiatingAuthContextDigest: bindInput.initiatingAuthContextDigest, dispatchReceiptArtifactId: null, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ runId: contentWorkflowGenerationRuns.workflowRunId });
      if (!inserted) {
        const [stored] = await getDb().select().from(contentWorkflowGenerationRuns).where(and(eq(contentWorkflowGenerationRuns.workspaceId, bindInput.workspaceId), eq(contentWorkflowGenerationRuns.generationIntentId, bindInput.intent.id))).limit(1);
        if (!stored || stored.workflowRunId !== bindInput.run.id || stored.recipeDigest !== binding.digest || stored.initiatedByUserId !== bindInput.initiatedByUserId || stored.initiatingAuthContextDigest !== bindInput.initiatingAuthContextDigest) throw new ContentWorkflowRuntimeError("CONTENT_WORKFLOW_BINDING_CONFLICT");
      }
    },
  };
}
