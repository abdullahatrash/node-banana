import { NextRequest } from "next/server";
import { z } from "zod";
import { noStoreJson } from "@/lib/agent-auth/http-request";
import { WORKSPACE_SERVICE_AGENT_RESOLVER } from "@/lib/agent-auth/workspace-service-agent";
import { authorizationContractDigestFor } from "@/lib/agent-tools/authorization-contract-digest";
import { getDb } from "@/lib/db";
import { findCuratedModel } from "@/lib/model-routing/catalog";
import { PostgresModelRoutingRepository } from "@/lib/model-routing/postgres-repository";
import { resolveContentFormatDefinitionReference } from "@/lib/product-surfaces/content-format-registry";
import { ContentGenerationWorkflowService, ContentWorkflowRuntimeError } from "@/lib/product-surfaces/content-workflow-runtime";
import { productionContentWorkflowRuntime } from "@/lib/product-surfaces/content-workflow-runtime-production";
import type { ContentFormat } from "@/lib/product-surfaces/definitions";
import { withStudioAuth } from "@/lib/studio/withStudioAuth";

const body = z.object({ intentId: z.string().min(1).max(200), prompt: z.string().min(1).max(50_000), sourceAssetIds: z.array(z.string().min(1).max(200)).max(20) }).strict();

export const POST = withStudioAuth<undefined>({ route: "/api/product-content/workflow-runs", action: "write", permission: "product:content:write" }, async (request: NextRequest, authz) => {
  const key = request.headers.get("idempotency-key");
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !key || key.length < 8 || request.headers.get("x-workspace-id") !== authz.workspaceId) return noStoreJson({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  try {
    const intent = await new PostgresModelRoutingRepository(getDb).getIntent(authz.workspaceId, parsed.data.intentId);
    if (!intent?.contentExecution) return noStoreJson({ success: false, code: "CONTENT_WORKFLOW_INTENT_REQUIRED" }, { status: 409 });
    const format = intent.contentExecution.formatDefinition.id.slice("content-format:".length) as ContentFormat;
    const resolved = await resolveContentFormatDefinitionReference(format, intent.contentExecution.formatDefinition);
    const descriptor = findCuratedModel(intent.selectedModel);
    if (!descriptor) return noStoreJson({ success: false, code: "CONTENT_MODEL_POLICY_MODEL_NOT_QUALIFIED" }, { status: 409 });
    const workflow = resolved.definition.execution.workflow;
    if (!workflow) return noStoreJson({ success: false, code: "CONTENT_CANONICAL_IMPORT_REQUIRED" }, { status: 409 });
    const contractDigest = authorizationContractDigestFor(
      { name: "workflow_runs.start", version: 2 },
      { resources: [
        { kind: "workflow", inputPath: "workflowId" },
        { kind: "artifact", inputPath: "inputArtifactIds" },
      ] },
    );
    const emptyResources = { channelIds: [], credentialProfileIds: [], workflowIds: [], automationIds: [], artifactIds: [] };
    let actor = await WORKSPACE_SERVICE_AGENT_RESOLVER.resolve({
      workspaceId: authz.workspaceId,
      purpose: "content_workflow",
      authority: { capability: "workflow_runs.start@2", authorizationContractDigest: contractDigest, resources: emptyResources },
    });
    await productionContentWorkflowRuntime(actor).ensureRevision({ workspaceId: authz.workspaceId, definition: resolved.definition });
    actor = await WORKSPACE_SERVICE_AGENT_RESOLVER.resolve({
      workspaceId: authz.workspaceId,
      purpose: "content_workflow",
      authority: {
        capability: "workflow_runs.start@2",
        authorizationContractDigest: contractDigest,
        resources: { ...emptyResources, workflowIds: [workflow.id] },
      },
    });
    const accepted = await new ContentGenerationWorkflowService(productionContentWorkflowRuntime(actor)).start({ workspaceId: authz.workspaceId, userId: authz.userId, authContextId: authz.authContextId, role: authz.role, planTier: authz.contentSession.planTier, intent, definition: resolved.definition, descriptor, prompt: parsed.data.prompt, sourceAssetIds: parsed.data.sourceAssetIds, idempotencyKey: key, servicePrincipalId: actor.principalId, serviceKeyId: actor.keyId });
    return noStoreJson({ success: true, workflowRun: accepted.run }, { status: 202 });
  } catch (error) {
    const code = error instanceof ContentWorkflowRuntimeError ? error.code : "CONTENT_WORKFLOW_UNAVAILABLE";
    return noStoreJson({ success: false, code }, { status: code.endsWith("UNAVAILABLE") ? 503 : 409 });
  }
});
