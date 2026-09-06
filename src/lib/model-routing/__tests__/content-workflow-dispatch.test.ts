import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  intent: null as import("../types").GenerationIntent | null,
  definition: null as import("@/lib/product-surfaces/content-format-definition").ContentFormatDefinition | null,
  descriptor: null as import("../types").ModelDescriptor | null,
  resources: null as Awaited<ReturnType<typeof import("@/lib/product-surfaces/content-execution-resources-repository").loadContentExecutionResources>> | null,
  selectRows: [] as unknown[][],
  providerExecute: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => {
        const rows = mocks.selectRows.shift() ?? [];
        const query = {
          where: () => query,
          innerJoin: () => query,
          orderBy: () => query,
          limit: async () => rows,
          then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
        };
        return query;
      },
    }),
  }),
}));
vi.mock("../postgres-repository", () => ({ PostgresModelRoutingRepository: class { async getIntent() { return mocks.intent; } } }));
vi.mock("../catalog", async (original) => ({ ...(await original<typeof import("../catalog")>()), findCuratedModel: () => mocks.descriptor }));
vi.mock("@/lib/product-surfaces/content-format-registry", () => ({ resolveContentFormatDefinitionReference: async () => ({ definition: mocks.definition, reference: { id: mocks.definition?.id, revision: mocks.definition?.revision, digest: mocks.intent?.contentExecution?.formatDefinition.digest } }) }));
vi.mock("@/lib/product-surfaces/content-execution-resources-repository", () => ({ loadContentExecutionResources: async () => mocks.resources }));
vi.mock("../rights-evidence", () => ({ validateRightsEvidence: () => ({ ok: true }) }));
vi.mock("../source-validation", () => ({ validateGenerationSources: () => ({ ok: true }) }));
vi.mock("../brand-context", () => ({ loadImmutableBrandContext: async () => ({ context: mocks.intent?.brand.context, referenceUrls: [] }) }));
vi.mock("@/lib/byok/repository", () => ({ resolveDurableProviderKey: async () => ({ id: "credential_1", provider: "replicate", updatedAt: "2026-09-04T00:00:00Z", secret: "test-only" }), resolveManagedProviderKey: () => null }));
vi.mock("@/lib/storage", async (original) => ({ ...(await original<typeof import("@/lib/storage")>()), canUseS3Storage: () => true, createPresignedDownload: async ({ key }: { key: string }) => ({ downloadUrl: `https://assets.test/${key}` }) }));
vi.mock("../execution-production", () => ({ productionGenerationExecution: () => ({ execute: mocks.providerExecute }) }));
vi.mock("@/lib/agent-runtime/operational-metrics", async (original) => ({
  ...(await original<typeof import("@/lib/agent-runtime/operational-metrics")>()),
  emitArtifactBytesMetric: async () => undefined,
  emitProviderEffectMetric: async () => undefined,
  emitQueueWaitMetric: async () => undefined,
  emitQuotaDecisionMetric: async () => undefined,
  emitRunStatusMetric: async () => undefined,
}));

import { canonicalDigest, canonicalJson } from "@/lib/agent-tools/canonical";
import { AesGcmWorkflowRunEventCursorCodec } from "@/lib/agent-runtime/runs/cursor";
import { WorkflowRunExecutorRegistry } from "@/lib/agent-runtime/runs/executors";
import { InMemoryWorkflowRunQueue, InMemoryWorkflowRunRepository, InMemoryWorkflowRunRevisionReader } from "@/lib/agent-runtime/runs/memory";
import { WorkflowRunService } from "@/lib/agent-runtime/runs/service";
import { WorkflowRunSpendQuoteCodec } from "@/lib/agent-runtime/runs/spend-quote";
import type { WorkflowRunArtifactPort } from "@/lib/agent-runtime/runs/types";
import { InMemoryUsageRepository } from "@/lib/agent-runtime/usage/memory";
import { UsageLedgerService } from "@/lib/agent-runtime/usage/service";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "@/lib/agent-runtime/workflows";
import { contentFormatDefinition } from "@/lib/product-surfaces/content-format-definition";
import { buildContentGenerationRecipe, contentProviderPrompt } from "@/lib/product-surfaces/content-generation-recipe";
import type { ContentModelPolicy } from "@/lib/product-surfaces/content-model-policy";
import { ContentGenerationWorkflowService } from "@/lib/product-surfaces/content-workflow-runtime";
import { CONTENT_WORKFLOW_OPERATION_REGISTRY_DIGEST, resolvedContentWorkflowDefinition } from "@/lib/product-surfaces/content-workflow-runtime-production";
import { contentWorkflowRequestFromRun } from "../execute-admitted-generation";
import type { GenerationIntent, ModelDescriptor } from "../types";
import { contentGenerationDispatchOperation } from "../content-workflow-operation";

const now = new Date("2026-09-04T06:00:00.000Z");
const workspaceId = "workspace_1";
const userId = "user_1";
const directSourceAssetIds = ["asset_1", "asset_2"];
const mediaSetAssetIds = ["asset_set_2", "asset_set_1"];
const sourceAssetIds = [...directSourceAssetIds, ...mediaSetAssetIds];
const keyring = () => ({ active: { id: "test", key: Buffer.alloc(32, 7) }, all: [{ id: "test", key: Buffer.alloc(32, 7) }] });

function qualifiedDescriptor(): ModelDescriptor {
  return {
    provider: "replicate", model: "prunaai/p-video", label: "P-Video", capabilities: ["text_to_video", "image_to_video"], quality: "preview",
    contentLanguages: ["ar", "en", "mixed"], arabicVarieties: ["gulf"], verifiedRegions: ["replicate-us"], executionModes: ["async"], aspectRatios: ["9:16"], priceUsd: { basis: "second", amount: 0.01 }, lane: "preview",
    qualification: { status: "qualified", endpoint: "versioned", version: "pinned-version-1", inputSchemaDigest: `sha256:${"a".repeat(64)}`, executionPriceUsd: { basis: "second", amount: 0.01 }, maxQuantity: 60, cancelAfterSeconds: 600, outputShape: { width: 1080, height: 1920, fps: 30 }, inputContract: { promptKey: "prompt", aspectRatioKey: "aspect_ratio", quantityKey: "duration", imageKey: "images", imageMode: "array", safety: { parameterKey: "safe", safeValue: true }, lockedParameters: { safe: true } }, evidence: { id: "qualification_1", revision: 1, digest: `sha256:${"b".repeat(64)}`, issuedAt: now, expiresAt: new Date("2026-12-01T00:00:00Z"), signingKeyId: "key", license: { name: "commercial", commercialUse: true, derivativeUse: true, sourceUrl: "https://license.test", digest: `sha256:${"c".repeat(64)}` }, pricingSource: { sourceUrl: "https://pricing.test", digest: `sha256:${"d".repeat(64)}`, checkedAt: now }, qualificationRun: { id: "qualification_run_1", digest: `sha256:${"e".repeat(64)}`, completedAt: now } } },
  };
}

describe("typed Content Workflow provider dispatch", () => {
  it("starts a real typed WorkflowRun and reaches provider dispatch through its recipe snapshot", async () => {
    const definition = contentFormatDefinition("slideshow");
    const definitionDigest = canonicalDigest(definition) as `sha256:${string}`;
    const descriptor = qualifiedDescriptor();
    const model = { provider: "replicate" as const, model: descriptor.model, version: descriptor.qualification.status === "qualified" ? descriptor.qualification.version : "", inputSchemaDigest: descriptor.qualification.status === "qualified" ? descriptor.qualification.inputSchemaDigest : "" };
    const unsignedPolicy = { schema: "content-model-policy/v1" as const, id: definition.execution.modelPolicy!.id, revision: definition.execution.modelPolicy!.revision, format: "slideshow" as const, region: "replicate-us" as const, defaultModel: model, compatibleModels: [model], overrides: { mode: "explicit_exact_allowlist" as const, allowedFields: ["model"] as const, requireRequote: true as const } };
    const policy = { ...unsignedPolicy, digest: canonicalDigest(unsignedPolicy) } as ContentModelPolicy;
    const mediaSetDigest = canonicalDigest({ schema: "media-set-membership/v1", mediaSetId: "set_1", revision: 5, orderedAssetIds: mediaSetAssetIds }) as `sha256:${string}`;
    const payload = { format: "slideshow" as const, formatDefinition: { id: definition.id, revision: definition.revision, digest: definitionDigest }, contentLanguage: "ar" as const, arabicVariety: "gulf" as const, prompt: "إطلاق المنتج", script: "نص الحملة", aspectRatio: "9:16" as const, durationSeconds: 5, captionStyle: "brand", speaker: "", scene: "", sourceAssetIds: directSourceAssetIds, personaId: null, mediaSetIds: ["set_1"], mediaSetRevisionRefs: [{ mediaSetId: "set_1", revision: 5, digest: mediaSetDigest }], themeRevisionRefs: [], validationIssues: [], candidateArtifactIds: [], candidates: [], renderProofStatus: "not_requested" as const };
    const resources = { mediaSets: [{ mediaSetId: "set_1", revision: 5, digest: mediaSetDigest, orderedAssetIds: mediaSetAssetIds }], themes: [], orderedAssetIds: sourceAssetIds, orderedAssets: [] } as unknown as NonNullable<typeof mocks.resources>;
    const prompt = contentProviderPrompt(payload, resources);
    const contentExecution = buildContentGenerationRecipe({ contentPieceId: "piece_1", contentPieceRevision: 3, contentPiecePayload: payload, definition, definitionDigest, sourceTypes: new Map(sourceAssetIds.map((id) => [id, "image"])), modelPolicy: policy, resources });
    const brandProfile = { companyName: "Test" };
    const brandDigest = canonicalDigest(brandProfile) as `sha256:${string}`;
    const brandContext = { schema: "brand-context/v1", profileId: "brand_1", revision: 1, acceptedAt: now, contentLanguage: "ar", identity: { companyName: "Test", coreIdentity: "Test" }, offering: ["Test"], audiences: [{ name: "Creators", description: "Creators", weight: 1 }], benefits: ["Test"], differentiators: ["Test"], positioning: "Test", voice: { descriptors: ["clear"], do: ["be clear"], doNot: ["mislead"] }, palette: ["#000000"], constraints: { prohibitedClaims: [], prohibitedTopics: [] }, contentAngles: ["Test"], referenceAssets: [] };
    const context = { ...brandContext, digest: canonicalDigest(brandContext) as `sha256:${string}` };
    const sourceDigest = `sha256:${"3".repeat(64)}` as const;
    const studioAssetReferences = sourceAssetIds.map((assetId) => ({ assetId, digest: sourceDigest, type: "image" as const, mediaType: "image/png", sizeBytes: 42, width: 1080, height: 1920, durationSeconds: null }));
    const intent = { schema: "generation-intent/v1", id: "intent_1", workspaceId, brand: { profileId: "brand_1", revision: 1, digest: brandDigest, acceptedAt: now, context }, promptDigest: canonicalDigest(prompt), providerComposition: { schema: "provider-input-composition/v1", sourceAssetIds, providerMediaAssetIds: sourceAssetIds }, capability: "image_to_video", contentLanguage: "ar", arabicVariety: "gulf", rights: { snapshotId: "rights_1", revision: 1, digest: `sha256:${"f".repeat(64)}`, basis: "owned", permittedRemix: "transform", evidence: sourceAssetIds.map((sourceAssetId) => ({ sourceAssetId, sourceDigest })), sourceAssetIds }, remixBrief: { digest: `sha256:${"1".repeat(64)}`, preserve: [], transform: [], avoid: [] }, qualification: { id: "qualification_1", revision: 1, digest: `sha256:${"b".repeat(64)}`, expiresAt: new Date("2026-12-01T00:00:00Z") }, regionAdmission: { policyId: "region", policyVersion: 1, evidenceDigest: `sha256:${"2".repeat(64)}`, region: "replicate-us", routeId: "replicate", evidenceExpiresAt: new Date("2026-12-01T00:00:00Z") }, outputContract: { mediaType: "video", aspectRatio: "9:16", width: 1080, height: 1920, durationSeconds: 5, fps: 30, safetyParameterKey: "safe", safetyValue: true, lockedParametersDigest: canonicalDigest({ safe: true }) }, requestedModel: model, selectedModel: model, fallbackAuthorizationId: null, fundingMode: "byok", contentExecution, persona: null, quote: { currency: "USD", amount: 0.01, basis: "second", quantity: 5, quotedAt: now, expiresAt: new Date("2026-12-01T00:00:00Z") }, reservationIds: ["reservation_1"], createdByUserId: userId, createdAt: now } as unknown as GenerationIntent;
    mocks.intent = intent; mocks.definition = definition; mocks.descriptor = descriptor; mocks.resources = resources;
    mocks.providerExecute.mockResolvedValue({ kind: "accepted", operation: { id: "operation_1", state: "waiting_provider" }, provider: { state: "waiting_provider", predictionId: "prediction_1" } });

    const usageRepository = new InMemoryUsageRepository();
    const repository = new InMemoryWorkflowRunRepository(usageRepository);
    const revisions = new InMemoryWorkflowRunRevisionReader();
    const resolved = resolvedContentWorkflowDefinition(definition);
    revisions.put(workspaceId, { id: definition.execution.workflow!.revisionId, workflowId: definition.execution.workflow!.id, revision: definition.revision, definitionDigest: canonicalDigest(resolved), definition: resolved, operationRegistryDigest: CONTENT_WORKFLOW_OPERATION_REGISTRY_DIGEST });
    const noProviderBoundary = { invoke: vi.fn(async () => { throw new Error("Gemini provider must not run"); }) };
    const executors = WorkflowRunExecutorRegistry.createProduction(GOLDEN_WORKFLOW_OPERATION_REGISTRY, { text: noProviderBoundary, image: noProviderBoundary });
    const generated = new Map<string, { artifact: never; textContent: string | null }>();
    const artifacts: WorkflowRunArtifactPort = {
      getArtifact: async ({ artifactId }) => {
        const found = generated.get(artifactId);
        if (!found) throw new Error("Workflow artifact unavailable");
        return found;
      },
      getGeneratedArtifact: async ({ effectKey, outputName }) => generated.get(`${effectKey}:${outputName}`) ?? null,
      commitGenerated: async (input) => {
        const id = `artifact_${generated.size + 1}`;
        const value = { artifact: { id, workspaceId: input.workspaceId, digest: input.content.digest, kind: input.content.kind, mediaType: input.content.mediaType, sizeBytes: input.content.sizeBytes } as never, textContent: input.content.kind === "text" ? input.content.text : null };
        generated.set(id, value); generated.set(`${input.effectKey}:${input.outputName}`, value);
        return value.artifact;
      },
    };
    const runService = new WorkflowRunService(repository, revisions, new InMemoryWorkflowRunQueue(), executors, new AesGcmWorkflowRunEventCursorCodec(keyring), { now: () => now }, artifacts, new UsageLedgerService(usageRepository), undefined, undefined, new WorkflowRunSpendQuoteCodec(null), { resolveStudioAssets: async ({ workspaceId: requestedWorkspaceId, assetIds }) => requestedWorkspaceId === workspaceId ? assetIds.map((id) => studioAssetReferences.find((reference) => reference.assetId === id)!).filter(Boolean) : [] });
    const runtime = { ensureRevision: async () => undefined, start: (input: Parameters<import("@/lib/product-surfaces/content-workflow-runtime").ContentWorkflowRuntimePort["start"]>[0]) => runService.start({ workspaceId: input.workspaceId, workflowId: input.workflowId, revisionId: input.revisionId, inputs: input.inputs, inputArtifactIds: [], inputStudioAssetIds: input.authorizedStudioAssetIds, capability: "workflow_runs.start@3", principalId: input.servicePrincipalId, keyId: input.serviceKeyId, authorizationEvidenceRef: "test:content", idempotencyKey: input.idempotencyKey }), bind: async () => undefined };
    const accepted = await new ContentGenerationWorkflowService(runtime).start({ workspaceId, userId, authContextId: "auth_1", role: "owner", planTier: "pro", intent, definition, descriptor, prompt, sourceAssetIds, idempotencyKey: "content-run-1", servicePrincipalId: "agent_content", serviceKeyId: "key_content", authorizedStudioAssetIds: sourceAssetIds });
    const durable = repository.runs.get(`${workspaceId}\u0000${accepted.run.id}`)!;
    expect(durable.startSnapshot.inputs.some((candidate) => candidate.name === "recipe")).toBe(true);
    expect(durable.startSnapshot.artifactReferences).toEqual([]);
    expect(durable.startSnapshot).toMatchObject({ schema: "workflow-run-start-snapshot/v3", studioAssetReferences });
    expect(durable.startSnapshot.inputs.some((candidate) => candidate.name === "request")).toBe(false);
    const historical = structuredClone(durable);
    historical.startSnapshot.inputs = historical.startSnapshot.inputs.map((candidate) => candidate.name === "recipe" ? { ...candidate, name: "request" } : candidate);
    expect(contentWorkflowRequestFromRun({ run: historical, intent, workspaceId, userId, prompt, sourceAssetIds })).toBeNull();
    const recipeText = durable.startSnapshot.inputs.find((candidate) => candidate.name === "recipe")!.value as string;
    expect(JSON.parse(recipeText)).toMatchObject({ orderedInputArtifactIds: sourceAssetIds, orderedInputArtifacts: sourceAssetIds.map((artifactId) => ({ artifactId, digest: sourceDigest })), providerInputArtifactIds: sourceAssetIds });
    expect(contentWorkflowRequestFromRun({ run: durable, intent, workspaceId, userId, prompt, sourceAssetIds, studioAssets: studioAssetReferences })).not.toBeNull();
    const tampered = structuredClone(durable);
    if (tampered.startSnapshot.schema !== "workflow-run-start-snapshot/v3") throw new Error("Expected v3 snapshot");
    tampered.startSnapshot.studioAssetReferences = tampered.startSnapshot.studioAssetReferences.slice(1);
    expect(contentWorkflowRequestFromRun({ run: tampered, intent, workspaceId, userId, prompt, sourceAssetIds, studioAssets: studioAssetReferences })).toBeNull();
    const seedCompletedGuard = (runId: string, workflow: typeof resolved, recipe: string, suffix: string) => {
      const guardText = canonicalDigest(recipe);
      const guardArtifactDigest = canonicalDigest(guardText);
      const artifactId = `artifact_guard_${suffix}`;
      generated.set(artifactId, { artifact: { id: artifactId, workspaceId, digest: guardArtifactDigest, kind: "text", mediaType: "text/plain; charset=utf-8", sizeBytes: Buffer.byteLength(guardText) } as never, textContent: guardText });
      repository.stepAttempts.set(`guard_${suffix}`, { id: `attempt_guard_${suffix}`, workspaceId, runId, stepId: workflow.steps[0]!.id, attempt: 1, state: "completed", operationIdentity: workflow.steps[0]!.operation.identity, operationContractDigest: workflow.steps[0]!.operation.contractDigest, provider: "runtime", providerOperation: "digest_text", model: "sha256", intentDigest: canonicalDigest(recipe), effectKey: `workflow-effect:v1:${workspaceId}:${runId}:${workflow.steps[0]!.id}:1`, inputs: [], outputs: { textDigest: { artifactId, digest: guardArtifactDigest, kind: "text", mediaType: "text/plain; charset=utf-8", sizeBytes: Buffer.byteLength(guardText) } }, providerOperationRef: guardText, outcome: { kind: "succeeded", providerOperationRef: guardText }, reconciliation: null, failureCode: null, startedAt: now, completedAt: now } as never);
    };
    const executionRows = (policyDigest: string, run: typeof durable) => [
      [{ acceptedAt: now, profile: brandProfile }],
      [{ status: "held", amount: "0.05" }],
      [{ digest: intent.rights.digest, permittedRemix: "transform" }],
      sourceAssetIds.map((id) => ({ id, type: "image", storageKey: id, checksum: sourceDigest, mimeType: "image/png", sizeBytes: 42, width: 1080, height: 1920, durationSeconds: null, metadata: { uploadState: "ready", dimensionEvidence: "server-media-probe/v1" } })),
      [{ payload }],
      [{ digest: policyDigest }],
      [{ workflowId: run.workflowId, workflowRevisionId: run.workflowRevisionId, startSnapshot: run.startSnapshot }],
    ];
    seedCompletedGuard(accepted.run.id, resolved, recipeText, "v5");
    mocks.selectRows = executionRows(policy.digest, durable);
    await expect(runService.executeOne({ workspaceId, runId: accepted.run.id, workerId: "worker_v5" })).resolves.toMatchObject({ state: "completed" });
    expect(mocks.providerExecute).toHaveBeenCalledOnce();
    expect(mocks.providerExecute).toHaveBeenLastCalledWith(expect.objectContaining({ sourceUrls: sourceAssetIds.map((id) => `https://assets.test/${id}`) }));
    const v3Intent = structuredClone(intent) as GenerationIntent;
    const v3Definition = structuredClone(definition);
    const v3Binding = v3Intent.contentExecution! as unknown as { formatDefinition: { revision: number }; workflow: { id: string; revisionId: string; operation: string; inputs: string[] }; workflowInputs: Record<string, unknown>; digest: string; [key: string]: unknown };
    const v3Inputs = v3Binding.workflow.inputs.map((name) => name === "mediaSetRevisions" ? "mediaSetIds" : name === "themeInstructions" ? "themeRevisionRefs" : name);
    v3Binding.formatDefinition.revision = 3; v3Binding.workflow.revisionId = "builtin-2026-09-04-3"; v3Binding.workflow.operation = "runtime.dispatch_content_slideshow@1"; v3Binding.workflow.inputs = v3Inputs;
    v3Definition.revision = 3; v3Definition.execution.workflow = { id: v3Binding.workflow.id, revisionId: v3Binding.workflow.revisionId, operation: v3Binding.workflow.operation, inputs: v3Inputs } as never;
    v3Definition.execution.modelPolicy = { ...v3Definition.execution.modelPolicy!, id: "content.slideshow.v3", revision: 3 };
    const v3PolicyUnsigned = { ...unsignedPolicy, id: "content.slideshow.v3", revision: 3 };
    const v3Policy = { ...v3PolicyUnsigned, digest: canonicalDigest(v3PolicyUnsigned) } as ContentModelPolicy;
    v3Binding.modelPolicy = { ...v3Binding.modelPolicy as Record<string, unknown>, id: v3Policy.id, revision: v3Policy.revision, digest: v3Policy.digest };
    v3Binding.workflowInputs = { ...v3Binding.workflowInputs, mediaSetIds: payload.mediaSetIds, themeRevisionRefs: payload.themeRevisionRefs };
    delete v3Binding.workflowInputs.mediaSetRevisions; delete v3Binding.workflowInputs.themeInstructions;
    const { digest: _oldDigest, ...v3Unsigned } = v3Binding; v3Binding.digest = canonicalDigest(v3Unsigned);
    const v3Request = { ...JSON.parse(recipeText), contentExecutionDigest: v3Binding.digest, formatDefinition: v3Binding.formatDefinition, workflow: v3Binding.workflow, modelPolicy: v3Binding.modelPolicy, workflowInputs: v3Binding.workflowInputs };
    delete v3Request.orderedInputArtifacts;
    const v3Operation = contentGenerationDispatchOperation(v3Binding.workflow.operation, v3Inputs)!;
    const v3Resolved = resolvedContentWorkflowDefinition(v3Definition);
    const v3Dispatch = v3Resolved.steps[1]!;
    expect(v3Dispatch.operation).toEqual({ identity: v3Operation.identity, contractDigest: v3Operation.contractDigest });
    revisions.put(workspaceId, { id: v3Binding.workflow.revisionId, workflowId: v3Binding.workflow.id, revision: 3, definitionDigest: canonicalDigest(v3Resolved), definition: v3Resolved, operationRegistryDigest: CONTENT_WORKFLOW_OPERATION_REGISTRY_DIGEST });
    const v3TypedInputs = Object.fromEntries(v3Inputs.map((name: string) => [name, name === "recipe" ? canonicalJson(v3Request) : typeof v3Binding.workflowInputs[name] === "string" ? v3Binding.workflowInputs[name] : canonicalJson(v3Binding.workflowInputs[name] ?? null)]));
    const v3Accepted = await runService.start({ workspaceId, workflowId: v3Binding.workflow.id, revisionId: v3Binding.workflow.revisionId, inputs: v3TypedInputs, inputArtifactIds: [], capability: "workflow_runs.start@2", principalId: "agent_content", keyId: "key_content", authorizationEvidenceRef: "test:content:v3", idempotencyKey: "content-run-v3" });
    const v3Run = repository.runs.get(`${workspaceId}\u0000${v3Accepted.run.id}`)!;
    expect(contentWorkflowRequestFromRun({ run: v3Run, intent: v3Intent, workspaceId, userId, prompt, sourceAssetIds })).not.toBeNull();
    const v3RecipeText = v3Run.startSnapshot.inputs.find((candidate) => candidate.name === "recipe")!.value as string;
    seedCompletedGuard(v3Accepted.run.id, v3Resolved, v3RecipeText, "v3");

    mocks.intent = v3Intent; mocks.definition = v3Definition;

    mocks.selectRows = executionRows(v3Policy.digest, v3Run);
    await expect(runService.executeOne({ workspaceId, runId: v3Accepted.run.id, workerId: "worker_1" })).resolves.toMatchObject({ state: "completed" });
    expect(mocks.providerExecute).toHaveBeenCalledTimes(2);
    expect(mocks.providerExecute).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId, userId, intentId: v3Intent.id, rawPrompt: prompt, sourceUrls: sourceAssetIds.map((id) => `https://assets.test/${id}`) }));
    expect(mocks.selectRows).toHaveLength(0);
  });
});
