import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import {
  dispatchCliCapability,
  dispatchMcpCapability,
} from "@/lib/agent-tools/adapters";
import { CapabilityDispatcher } from "@/lib/agent-tools/dispatcher";
import {
  createCapabilityRegistry,
  createDiscoveryRegistrations,
} from "@/lib/agent-tools/registry";
import type { CapabilityAuthorizer } from "@/types/agentAuthorization";
import { createGeminiInvocationBoundary } from "@/lib/agent-runtime/provider-effects";
import { InMemoryCredentialVaultRepository } from "@/lib/credential-vault/memory-repository";
import {
  CredentialEffectExecutor,
  CredentialVaultService,
} from "@/lib/credential-vault/service";
import type { CredentialProviderEffectAdapter } from "@/lib/credential-vault/types";
import type {
  GeminiImageIntent,
  GeminiTextIntent,
} from "@/lib/provider-adapters/gemini/generate-content";
import { describe, expect, it } from "vitest";
import fixture from "../../workflows/__fixtures__/linkedin-golden-workflow-v1.json";
import {
  GOLDEN_WORKFLOW_OPERATION_REGISTRY,
} from "../../workflows";
import {
  InMemoryWorkflowCredentialSlotAdmission,
} from "../../workflows/memory";
import type { WorkflowDraft } from "../../workflows/types";
import { WorkflowRevisionValidator } from "../../workflows/validation";
import { AesGcmArtifactCursorCodec } from "../../artifacts/cursor";
import {
  InMemoryArtifactContentStore,
  InMemoryArtifactRepository,
} from "../../artifacts/memory";
import { ArtifactService } from "../../artifacts/service";
import { SharpArtifactMediaInspector } from "../../artifacts/storage";
import { AesGcmWorkflowRunEventCursorCodec } from "../cursor";
import { createWorkflowRunRegistrations } from "../capabilities";
import {
  createDeterministicWorkflowRunExecutorRegistry,
  WorkflowRunExecutorRegistry,
} from "../executors";
import {
  GOLDEN_BRIEF,
  GOLDEN_IMAGE_FIXTURES,
  GOLDEN_LINKEDIN_COPY,
  GOLDEN_PROVIDER_RESULTS,
  GOLDEN_TEXT_BYTES,
} from "../fixtures/golden";
import {
  InMemoryWorkflowRunQueue,
  InMemoryWorkflowRunRepository,
  InMemoryWorkflowRunRevisionReader,
} from "../memory";
import { WorkflowRunService } from "../service";
import type {
  WorkflowRunClock,
  WorkflowStepExecutor,
  WorkflowStepExecutorRegistry,
} from "../types";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const WORKSPACE_ID = "workspace_golden";
const PRINCIPAL_ID = "principal_golden";
const WORKFLOW_ID = "fixture-workflow";
const REVISION_ID = "revision_golden_1";
const REFERENCE_ARTIFACT_ID = "artifact_reference_golden";
const liveGeminiEnabled =
  process.env.RUN_LIVE_GEMINI_BYOK === "1" &&
  process.env.ACK_LIVE_GEMINI_COST === "1" &&
  Boolean(process.env.GEMINI_API_KEY);
const liveGeminiIt = liveGeminiEnabled ? it : it.skip;

function artifactCursor() {
  return new AesGcmArtifactCursorCodec(() => ({
    active: { id: "test", key: Buffer.alloc(32, 3) },
    all: [{ id: "test", key: Buffer.alloc(32, 3) }],
  }));
}

function runCursor() {
  return new AesGcmWorkflowRunEventCursorCodec(() => ({
    active: { id: "test", key: Buffer.alloc(32, 7) },
    all: [{ id: "test", key: Buffer.alloc(32, 7) }],
  }));
}

async function setupGoldenRun(options: {
  executors?: WorkflowStepExecutorRegistry;
  createExecutors?: (
    artifacts: ArtifactService,
  ) => Promise<WorkflowStepExecutorRegistry> | WorkflowStepExecutorRegistry;
  clock?: WorkflowRunClock;
} = {}) {
  const clock = options.clock ?? { now: () => new Date(NOW) };
  const slots = new InMemoryWorkflowCredentialSlotAdmission();
  slots.allow({
    workspaceId: WORKSPACE_ID,
    slotId: "slot_gemini_golden",
    profileId: "profile_gemini_golden",
    provider: "gemini",
  });
  const validation = await new WorkflowRevisionValidator(
    GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    slots,
  ).validate({
    candidate: structuredClone(fixture) as WorkflowDraft,
    workspaceId: WORKSPACE_ID,
    principalId: PRINCIPAL_ID,
    effectiveResources: {
      channelIds: [],
      credentialProfileIds: ["profile_gemini_golden"],
      workflowIds: [],
      automationIds: [],
      artifactIds: [REFERENCE_ARTIFACT_ID],
    },
  });
  if (!validation.normalizedDefinition || !validation.digest) {
    throw new Error(`Golden Workflow did not validate: ${validation.errors}`);
  }

  const artifactRepository = new InMemoryArtifactRepository();
  const artifactStore = new InMemoryArtifactContentStore();
  const artifactService = new ArtifactService(
    artifactRepository,
    artifactStore,
    new SharpArtifactMediaInspector(),
    artifactCursor(),
    clock,
  );
  artifactRepository.contents.set(
    `${WORKSPACE_ID}:${GOLDEN_IMAGE_FIXTURES.reference.digest}`,
    {
      workspaceId: WORKSPACE_ID,
      digest: GOLDEN_IMAGE_FIXTURES.reference.digest,
      kind: "image",
      mediaType: GOLDEN_IMAGE_FIXTURES.reference.mediaType,
      sizeBytes: GOLDEN_IMAGE_FIXTURES.reference.sizeBytes,
      inlineText: null,
      storageKey: GOLDEN_IMAGE_FIXTURES.reference.path,
      width: GOLDEN_IMAGE_FIXTURES.reference.width,
      height: GOLDEN_IMAGE_FIXTURES.reference.height,
      createdAt: NOW,
    },
  );
  artifactRepository.artifacts.set(REFERENCE_ARTIFACT_ID, {
    id: REFERENCE_ARTIFACT_ID,
    workspaceId: WORKSPACE_ID,
    contentDigest: GOLDEN_IMAGE_FIXTURES.reference.digest,
    kind: "image",
    mediaType: GOLDEN_IMAGE_FIXTURES.reference.mediaType,
    sizeBytes: GOLDEN_IMAGE_FIXTURES.reference.sizeBytes,
    creatorPrincipalId: PRINCIPAL_ID,
    origin: "imported",
    importedAt: NOW,
    retentionMode: "workspace_default",
    retentionSnapshotAt: NOW,
    createdAt: NOW,
    deletedAt: null,
  });

  const repository = new InMemoryWorkflowRunRepository();
  const revisions = new InMemoryWorkflowRunRevisionReader();
  revisions.put(WORKSPACE_ID, {
    id: REVISION_ID,
    workflowId: WORKFLOW_ID,
    revision: 1,
    definitionDigest: validation.digest,
    definition: validation.normalizedDefinition,
    operationRegistryDigest: GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest,
  });
  const queue = new InMemoryWorkflowRunQueue();
  const executors =
    options.executors ??
    (options.createExecutors
      ? await options.createExecutors(artifactService)
      : createDeterministicWorkflowRunExecutorRegistry(
          GOLDEN_WORKFLOW_OPERATION_REGISTRY,
        ));
  const service = new WorkflowRunService(
    repository,
    revisions,
    queue,
    executors,
    runCursor(),
    clock,
    artifactService,
  );
  const authorizer: CapabilityAuthorizer = {
    authorize: async () => ({
      allowed: true,
      operatorTraceRef: "trace_golden",
      effectiveResources: {
        channelIds: [],
        credentialProfileIds: ["profile_gemini_golden"],
        workflowIds: [WORKFLOW_ID],
        automationIds: [],
        artifactIds: [REFERENCE_ARTIFACT_ID],
      },
    }),
  };
  const registry = createCapabilityRegistry([
    ...createDiscoveryRegistrations(),
    ...createWorkflowRunRegistrations(service),
  ]);
  const canonical = new CapabilityDispatcher(registry, authorizer);
  const dispatcher = {
    dispatch: (invocation: Parameters<typeof canonical.dispatch>[0]) =>
      canonical.dispatch(invocation, {
        securityContext: {
          kind: "agent",
          workspaceId: WORKSPACE_ID,
          principalId: PRINCIPAL_ID,
          keyId: "key_golden",
        },
      }),
  };
  return {
    artifactRepository,
    artifactService,
    artifactStore,
    clock,
    dispatcher,
    queue,
    repository,
    revisions,
    service,
  };
}

async function acceptGoldenRun(
  service: WorkflowRunService,
  idempotencyKey: string,
) {
  return service.start({
    workspaceId: WORKSPACE_ID,
    workflowId: WORKFLOW_ID,
    revisionId: REVISION_ID,
    inputs: {
      brief: GOLDEN_BRIEF,
      reference_image: REFERENCE_ARTIFACT_ID,
    },
    principalId: PRINCIPAL_ID,
    keyId: "key_golden",
    authorizationEvidenceRef: "trace_golden",
    idempotencyKey,
    inputArtifactIds: [REFERENCE_ARTIFACT_ID],
    capability: "workflow_runs.start@2",
  });
}

async function createLiveGoldenExecutors(
  artifacts: ArtifactService,
  secret: string,
): Promise<WorkflowStepExecutorRegistry> {
  const repository = new InMemoryCredentialVaultRepository();
  repository.addAdministrator(WORKSPACE_ID, "live-owner");
  repository.addPrincipal(WORKSPACE_ID, PRINCIPAL_ID);
  const cipher = {
    encrypt: (value: string) =>
      `live-vault:${Buffer.from(value, "utf8").toString("base64url")}`,
    decrypt: (value: string) =>
      Buffer.from(value.slice("live-vault:".length), "base64url").toString(
        "utf8",
      ),
  };
  const vault = new CredentialVaultService(repository, cipher, () => NOW);
  const profile = await vault.createProfile({
    workspaceId: WORKSPACE_ID,
    actorUserId: "live-owner",
    idempotencyKey: "live-golden-gemini-profile-0001",
    name: "Live golden Gemini",
    provider: "gemini",
    slotName: "generation_provider",
    secret,
  });
  const createdSlot = repository.slots.get(profile.slotId!);
  const storedProfile = repository.profiles.get(profile.id);
  if (!createdSlot || !storedProfile) {
    throw new Error("Live Credential Profile setup failed.");
  }
  repository.slots.delete(createdSlot.id);
  repository.slots.set("slot_gemini_golden", {
    ...createdSlot,
    id: "slot_gemini_golden",
  });
  storedProfile.slotId = "slot_gemini_golden";
  await vault.createSpendGrant({
    workspaceId: WORKSPACE_ID,
    actorUserId: "live-owner",
    idempotencyKey: "live-golden-gemini-grant-0001",
    principalId: PRINCIPAL_ID,
    profileId: profile.id,
    mode: "bounded",
    limitCents: 100,
  });
  for (const [nodeId, operationIdentity] of [
    ["draft_copy", "gemini.generate_text@1"],
    ["generate_hero", "gemini.generate_image@1"],
  ] as const) {
    repository.addWorkflowBinding({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      workflowRevision: REVISION_ID,
      binding: {
        nodeId,
        operationIdentity,
        slotId: "slot_gemini_golden",
      },
    });
  }
  const policy: CredentialProviderEffectAdapter = {
    provider: "gemini",
    validate: ({ operation, intent }) => {
      if (
        !["generate_text", "generate_image"].includes(operation) ||
        typeof intent.prompt !== "string"
      ) {
        throw new Error("Invalid live Gemini intent.");
      }
    },
    quote: ({ operation }) => ({
      priceCeilingCents: operation === "generate_image" ? 25 : 5,
    }),
    execute: async () => {
      throw new Error("The legacy provider path must remain disabled.");
    },
  };
  const credentialExecutor = new CredentialEffectExecutor(
    repository,
    cipher,
    { authorize: async () => ({ allowed: true }) },
    {
      capability: { name: "credential_profiles.get", version: 1 },
      authorizationContractDigest: `sha256:${"a".repeat(64)}`,
    },
    [policy],
    () => NOW,
  );
  return WorkflowRunExecutorRegistry.createProduction(
    GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    {
      text: createGeminiInvocationBoundary<GeminiTextIntent>({
        credentialExecutor,
        artifacts,
      }),
      image: createGeminiInvocationBoundary<GeminiImageIntent>({
        credentialExecutor,
        artifacts,
      }),
    },
  );
}

describe("complete deterministic golden Workflow", () => {
  it("produces inspectable copy and hero Artifacts with exact provenance, lineage, attempts, snapshots, and events", async () => {
    const { artifactService, dispatcher, service } = await setupGoldenRun();
    const startInput = {
      workflowId: WORKFLOW_ID,
      revisionId: REVISION_ID,
      inputs: {
        brief: GOLDEN_BRIEF,
        reference_image: REFERENCE_ARTIFACT_ID,
      },
      inputArtifactIds: [REFERENCE_ARTIFACT_ID],
      idempotencyKey: "golden-run-start-0001",
    };
    const cliStart = await dispatchCliCapability(
      "workflow_runs.start@2",
      startInput,
      dispatcher,
    );
    const mcpStart = await dispatchMcpCapability(
      "workflow_runs.start.v2",
      startInput,
      dispatcher,
    );
    expect(mcpStart).toEqual(cliStart);
    const accepted = (cliStart as {
      output: Awaited<ReturnType<WorkflowRunService["start"]>>;
    }).output;

    const afterCopy = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_copy",
    });
    expect(afterCopy).toMatchObject({
      state: "running",
      finalSnapshot: null,
      completedAt: null,
    });

    const completed = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_hero",
    });
    expect(completed.state).toBe("completed");
    expect(completed.finalSnapshotDigest).toBe(
      canonicalDigest(completed.finalSnapshot),
    );
    expect(completed.finalSnapshot?.outputs).toEqual(completed.output);
    expect(Object.keys(completed.finalSnapshot?.outputs ?? {}).sort()).toEqual([
      "hero_image",
      "post_copy",
    ]);

    const attempts = await service.listStepAttempts({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
    });
    expect(attempts.items).toHaveLength(2);
    const attemptInput = {
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
    };
    const cliAttempts = await dispatchCliCapability(
      "workflow_step_attempts.list@1",
      attemptInput,
      dispatcher,
    );
    const mcpAttempts = await dispatchMcpCapability(
      "workflow_step_attempts.list.v1",
      attemptInput,
      dispatcher,
    );
    expect(mcpAttempts).toEqual(cliAttempts);
    expect((cliAttempts as { output: unknown }).output).toEqual(attempts);
    expect(attempts.items.map((attempt) => ({
      stepId: attempt.stepId,
      state: attempt.state,
      attempt: attempt.attempt,
      provider: attempt.provider,
      effectKey: attempt.effectKey,
    }))).toEqual([
      {
        stepId: "draft_copy",
        state: "completed",
        attempt: 1,
        provider: "conformance",
        effectKey: `workflow-effect:v1:${WORKSPACE_ID}:${accepted.run.id}:draft_copy:1`,
      },
      {
        stepId: "generate_hero",
        state: "completed",
        attempt: 1,
        provider: "conformance",
        effectKey: `workflow-effect:v1:${WORKSPACE_ID}:${accepted.run.id}:generate_hero:1`,
      },
    ]);

    const copyReference = completed.finalSnapshot!.outputs.post_copy;
    const heroReference = completed.finalSnapshot!.outputs.hero_image;
    const copy = await service.getRunArtifact({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
      artifactId: copyReference.artifactId,
    });
    const hero = await service.getRunArtifact({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
      artifactId: heroReference.artifactId,
    });
    for (const { artifactId, providerOperationRef } of [
      {
        artifactId: copyReference.artifactId,
        providerOperationRef:
          GOLDEN_PROVIDER_RESULTS.draftCopy.providerOperationRef,
      },
      {
        artifactId: heroReference.artifactId,
        providerOperationRef:
          GOLDEN_PROVIDER_RESULTS.generateHero.providerOperationRef,
      },
    ]) {
      const input = {
        workflowId: WORKFLOW_ID,
        runId: accepted.run.id,
        artifactId,
      };
      const cli = await dispatchCliCapability(
        "workflow_run_artifacts.get@1",
        input,
        dispatcher,
      );
      const mcp = await dispatchMcpCapability(
        "workflow_run_artifacts.get.v1",
        input,
        dispatcher,
      );
      expect(mcp).toEqual(cli);
      const expectedProviderRef = {
        type: "capability_result",
        output: {
          artifact: {
            origin: {
              providerOperation: {
                ref: providerOperationRef,
              },
            },
          },
        },
      };
      expect(cli).toMatchObject(expectedProviderRef);
      expect(mcp).toMatchObject(expectedProviderRef);
    }
    expect(copy.textContent).toBe(GOLDEN_LINKEDIN_COPY);
    expect(copy.artifact).toMatchObject({
      digest: GOLDEN_TEXT_BYTES.linkedInCopy.digest,
      origin: {
        kind: "generated",
        outputName: "text",
        run: { runId: accepted.run.id },
        stepAttempt: { stepId: "draft_copy", attempt: 1 },
        providerOperation: {
          provider: "conformance",
          operationIdentity: "gemini.generate_text@1",
          operation: "generate_text",
          ref: GOLDEN_PROVIDER_RESULTS.draftCopy.providerOperationRef,
        },
      },
      lineage: {
        inputs: [{
          port: "prompt",
          source: { kind: "workflow_input", inputName: "brief" },
          artifactId: null,
        }],
      },
    });
    expect(hero.artifact).toMatchObject({
      digest: GOLDEN_IMAGE_FIXTURES.heroResult.digest,
      width: GOLDEN_IMAGE_FIXTURES.heroResult.width,
      height: GOLDEN_IMAGE_FIXTURES.heroResult.height,
      origin: {
        kind: "generated",
        outputName: "image",
        run: { runId: accepted.run.id },
        stepAttempt: { stepId: "generate_hero", attempt: 1 },
        providerOperation: {
          provider: "conformance",
          operationIdentity: "gemini.generate_image@1",
          operation: "generate_image",
          ref:
            GOLDEN_PROVIDER_RESULTS.generateHero.providerOperationRef,
        },
      },
      lineage: {
        sourceArtifactIds: [
          copyReference.artifactId,
          REFERENCE_ARTIFACT_ID,
        ],
      },
    });

    const page = await service.listEvents({
      workspaceId: WORKSPACE_ID,
      principalId: PRINCIPAL_ID,
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
      cursor: accepted.events.input.cursor,
    });
    expect(page.items.map(({ sequence, type }) => ({ sequence, type }))).toEqual([
      { sequence: 1, type: "run.accepted" },
      { sequence: 2, type: "step.attempt.started" },
      { sequence: 3, type: "artifact.generated" },
      { sequence: 4, type: "step.attempt.completed" },
      { sequence: 5, type: "step.attempt.started" },
      { sequence: 6, type: "artifact.generated" },
      { sequence: 7, type: "step.attempt.completed" },
      { sequence: 8, type: "run.completed" },
    ]);

    expect(
      await artifactService.getArtifact({
        workspaceId: WORKSPACE_ID,
        artifactId: copyReference.artifactId,
      }),
    ).toEqual(copy);
    expect(
      readFileSync(
        resolve(process.cwd(), GOLDEN_IMAGE_FIXTURES.heroResult.path),
    ).byteLength,
    ).toBe(heroReference.sizeBytes);
  });

  it("durably fails the active Attempt and Run when the provider throws", async () => {
    const base = createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const failingTextExecutor: WorkflowStepExecutor = {
      provider: "conformance",
      providerOperation: "generate_text",
      model: "golden-v1",
      async execute() {
        throw new Error("injected provider failure");
      },
    };
    const executors: WorkflowStepExecutorRegistry = {
      get(identity, contractDigest) {
        return identity === "gemini.generate_text@1"
          ? failingTextExecutor
          : base.get(identity, contractDigest);
      },
    };
    const { dispatcher, repository, service } = await setupGoldenRun({
      executors,
    });
    const accepted = await acceptGoldenRun(
      service,
      "golden-provider-failure-0001",
    );

    const failed = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_provider_failure",
    });
    expect(failed).toMatchObject({
      state: "failed",
      failureCode: "STEP_EXECUTION_FAILED",
      output: null,
      finalSnapshot: null,
    });
    const attempts = await repository.listStepAttempts({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
    });
    expect(attempts).toMatchObject([
      {
        stepId: "draft_copy",
        state: "failed",
        failureCode: "STEP_EXECUTION_FAILED",
        outputs: null,
      },
    ]);
    const firstEvents = await service.listEvents({
      workspaceId: WORKSPACE_ID,
      principalId: PRINCIPAL_ID,
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
      cursor: accepted.events.input.cursor,
    });
    expect(firstEvents.items.map(({ sequence, type }) => ({
      sequence,
      type,
    }))).toEqual([
      { sequence: 1, type: "run.accepted" },
      { sequence: 2, type: "step.attempt.started" },
      { sequence: 3, type: "step.attempt.failed" },
      { sequence: 4, type: "run.failed" },
    ]);

    const replay = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_provider_failure_replay",
    });
    expect(replay).toEqual(failed);
    expect(
      await repository.listStepAttempts({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
      }),
    ).toHaveLength(1);
    const replayEvents = await service.listEvents({
      workspaceId: WORKSPACE_ID,
      principalId: PRINCIPAL_ID,
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
      cursor: accepted.events.input.cursor,
    });
    expect(replayEvents.items).toEqual(firstEvents.items);
  });

  it("rejects a restarted executor that does not match the exact provider pin", async () => {
    const base = createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const { artifactService, clock, repository, revisions, service } =
      await setupGoldenRun({ executors: base });
    const accepted = await acceptGoldenRun(
      service,
      "golden-provider-pin-substitution-0001",
    );
    await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_provider_pin_copy",
    });
    let providerCalls = 0;
    const imageDefinition = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
      "gemini.generate_image@1",
    )!;
    const image = base.get(
      imageDefinition.identity,
      imageDefinition.contractDigest,
    )!;
    const substituted: WorkflowStepExecutorRegistry = {
      get: (identity, contractDigest) => {
        const executor = base.get(identity, contractDigest);
        if (identity !== imageDefinition.identity || !executor) return executor;
        return {
          ...image,
          model: "substituted-model-v1",
          providerResolution: {
            ...image.providerResolution!,
            model: "substituted-model-v1",
            adapterContractDigest: `sha256:${"f".repeat(64)}`,
          },
          execute: async (input) => {
            providerCalls += 1;
            return image.execute(input);
          },
        };
      },
    };
    const restarted = new WorkflowRunService(
      repository,
      revisions,
      new InMemoryWorkflowRunQueue(),
      substituted,
      runCursor(),
      clock,
      artifactService,
    );
    await expect(
      restarted.executeOne({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
        workerId: "worker_provider_pin_substitution",
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_RUN_UNSUPPORTED_WORKFLOW" });
    expect(providerCalls).toBe(0);
  });

  it("resumes the same Attempt and Effect Key when generated image storage fails", async () => {
    const base = createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const imageDefinition =
      GOLDEN_WORKFLOW_OPERATION_REGISTRY.get("gemini.generate_image@1")!;
    const imageBase = base.get(
      imageDefinition.identity,
      imageDefinition.contractDigest,
    )!;
    let providerExecutions = 0;
    let providerReconciliations = 0;
    const executors: WorkflowStepExecutorRegistry = {
      get: (identity, contractDigest) => {
        if (identity !== imageDefinition.identity) {
          return base.get(identity, contractDigest);
        }
        return {
          provider: imageBase.provider,
          providerOperation: imageBase.providerOperation,
          model: imageBase.model,
          execute: async (input) => {
            providerExecutions += 1;
            return imageBase.execute(input);
          },
          reconcile: async (input) => {
            providerReconciliations += 1;
            return imageBase.reconcile!(input);
          },
        };
      },
    };
    const {
      artifactRepository,
      artifactStore,
      repository,
      service,
    } = await setupGoldenRun({ executors });
    const accepted = await acceptGoldenRun(
      service,
      "golden-artifact-failure-0001",
    );
    const afterCopy = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_copy_before_storage_failure",
    });
    expect(afterCopy.state).toBe("running");

    artifactStore.failNextGeneratedWrite = true;
    await expect(
      service.executeOne({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
        workerId: "worker_storage_failure",
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
    });
    const interruptedAttempts = await repository.listStepAttempts({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
    });
    expect(
      interruptedAttempts?.map(({ stepId, state, failureCode }) => ({
        stepId,
        state,
        failureCode,
      })),
    ).toEqual([
      {
        stepId: "draft_copy",
        state: "completed",
        failureCode: null,
      },
      {
        stepId: "generate_hero",
        state: "running",
        failureCode: null,
      },
    ]);
    expect(interruptedAttempts?.[1]).toMatchObject({
      providerOperationRef:
        GOLDEN_PROVIDER_RESULTS.generateHero.providerOperationRef,
      outcome: {
        kind: "succeeded",
        providerOperationRef:
          GOLDEN_PROVIDER_RESULTS.generateHero.providerOperationRef,
      },
    });
    const partialArtifactCount = artifactRepository.artifacts.size;
    const generatedOriginCount =
      artifactRepository.generatedOrigins.size;
    expect(partialArtifactCount).toBe(2);
    expect(generatedOriginCount).toBe(1);

    const events = await service.listEvents({
      workspaceId: WORKSPACE_ID,
      principalId: PRINCIPAL_ID,
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
      cursor: accepted.events.input.cursor,
    });
    expect(events.items.map(({ sequence, type }) => ({
      sequence,
      type,
    }))).toEqual([
      { sequence: 1, type: "run.accepted" },
      { sequence: 2, type: "step.attempt.started" },
      { sequence: 3, type: "artifact.generated" },
      { sequence: 4, type: "step.attempt.completed" },
      { sequence: 5, type: "step.attempt.started" },
    ]);

    const recovered = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_storage_failure",
    });
    expect(recovered.state).toBe("completed");
    expect(await repository.listStepAttempts({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
    })).toHaveLength(2);
    expect(artifactRepository.artifacts.size).toBe(partialArtifactCount + 1);
    expect(artifactRepository.generatedOrigins.size).toBe(generatedOriginCount + 1);
    expect(providerExecutions).toBe(1);
    expect(providerReconciliations).toBe(1);
    expect(
      (await service.listEvents({
        workspaceId: WORKSPACE_ID,
        principalId: PRINCIPAL_ID,
        workflowId: WORKFLOW_ID,
        runId: accepted.run.id,
        cursor: accepted.events.input.cursor,
      })).items.map(({ type }) => type),
    ).toEqual([
      ...events.items.map(({ type }) => type),
      "artifact.generated",
      "step.attempt.completed",
      "run.completed",
    ]);
  });

  it("blocks a durable provider success after a fresh restart when reconciliation errors", async () => {
    const base = createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const imageDefinition =
      GOLDEN_WORKFLOW_OPERATION_REGISTRY.get("gemini.generate_image@1")!;
    const imageBase = base.get(
      imageDefinition.identity,
      imageDefinition.contractDigest,
    )!;
    let providerExecutions = 0;
    let providerReconciliations = 0;
    let reconciliationMode:
      | "throw"
      | "failed_known"
      | "different_success"
      | "succeeded" = "throw";
    const executors: WorkflowStepExecutorRegistry = {
      get: (identity, contractDigest) => {
        if (identity !== imageDefinition.identity) {
          return base.get(identity, contractDigest);
        }
        return {
          provider: imageBase.provider,
          providerOperation: imageBase.providerOperation,
          model: imageBase.model,
          execute: async (input) => {
            providerExecutions += 1;
            return imageBase.execute(input);
          },
          reconcile: async (input) => {
            providerReconciliations += 1;
            if (reconciliationMode === "throw") {
              throw new Error("provider reconciliation transport unavailable");
            }
            if (reconciliationMode === "failed_known") {
              return {
                kind: "failed_known",
                failureCode: "PROVIDER_REPORTED_FAILURE",
                retryable: false,
                providerOperationRef: input.providerOperationRef,
              };
            }
            const result = await imageBase.reconcile!(input);
            return reconciliationMode === "different_success" &&
              result.kind === "generated"
              ? {
                  ...result,
                  providerOperationRef: "provider:contradictory-success",
                }
              : result;
          },
        };
      },
    };
    const {
      artifactService,
      artifactStore,
      clock,
      repository,
      revisions,
      service,
    } = await setupGoldenRun({ executors });
    const accepted = await acceptGoldenRun(
      service,
      "golden-artifact-reconcile-error-0001",
    );
    await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_reconcile_error_copy",
    });
    artifactStore.failNextGeneratedWrite = true;
    await expect(
      service.executeOne({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
        workerId: "worker_reconcile_error_crash",
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
    });

    const restartedService = new WorkflowRunService(
      repository,
      revisions,
      new InMemoryWorkflowRunQueue(),
      executors,
      runCursor(),
      clock,
      artifactService,
    );
    const blocked = await restartedService.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_reconcile_error_crash",
    });
    expect(blocked.state).toBe("outcome_unknown");
    expect(providerExecutions).toBe(1);
    expect(providerReconciliations).toBe(1);
    const attempt = (
      await repository.listStepAttempts({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
      })
    )?.find((candidate) => candidate.stepId === "generate_hero");
    expect(attempt).toMatchObject({
      state: "outcome_unknown",
      providerOperationRef:
        GOLDEN_PROVIDER_RESULTS.generateHero.providerOperationRef,
      outcome: {
        kind: "outcome_unknown",
        failureCode: "PROVIDER_RECONCILIATION_UNAVAILABLE",
        priorSucceededProviderOperationRef:
          GOLDEN_PROVIDER_RESULTS.generateHero.providerOperationRef,
      },
    });
    reconciliationMode = "failed_known";
    await expect(
      restartedService.reconcile({
        workspaceId: WORKSPACE_ID,
        workflowId: WORKFLOW_ID,
        runId: accepted.run.id,
        stepAttemptId: attempt!.id,
        principalId: PRINCIPAL_ID,
        keyId: "key_golden",
        authorizationEvidenceRef: "trace_golden",
        idempotencyKey: "durable-success-failed-contradiction-0001",
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_RECONCILIATION_PENDING",
    });
    reconciliationMode = "different_success";
    await expect(
      restartedService.reconcile({
        workspaceId: WORKSPACE_ID,
        workflowId: WORKFLOW_ID,
        runId: accepted.run.id,
        stepAttemptId: attempt!.id,
        principalId: PRINCIPAL_ID,
        keyId: "key_golden",
        authorizationEvidenceRef: "trace_golden",
        idempotencyKey: "durable-success-ref-contradiction-0001",
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_RECONCILIATION_PENDING",
    });
    reconciliationMode = "succeeded";
    const reconciled = await restartedService.reconcile({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
      stepAttemptId: attempt!.id,
      principalId: PRINCIPAL_ID,
      keyId: "key_golden",
      authorizationEvidenceRef: "trace_golden",
      idempotencyKey: "durable-success-correct-reconciliation-0001",
    });
    expect(reconciled.run.state).toBe("completed");
  });

  it("reconciles an ambiguous launched Attempt after a fresh service restart without executing the provider again", async () => {
    const firstBase = createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const imageDefinition =
      GOLDEN_WORKFLOW_OPERATION_REGISTRY.get("gemini.generate_image@1")!;
    const firstImage = firstBase.get(
      imageDefinition.identity,
      imageDefinition.contractDigest,
    )!;
    let providerExecutions = 0;
    let providerReconciliations = 0;
    let externalResult:
      | Awaited<ReturnType<WorkflowStepExecutor["execute"]>>
      | null = null;
    let externalEffectKey: string | null = null;
    let externalIntentDigest: string | null = null;
    const firstExecutors: WorkflowStepExecutorRegistry = {
      get: (identity, contractDigest) => {
        if (identity !== imageDefinition.identity) {
          return firstBase.get(identity, contractDigest);
        }
        return {
          provider: firstImage.provider,
          providerOperation: firstImage.providerOperation,
          model: firstImage.model,
          providerResolution: {
            ...firstImage.providerResolution!,
            effectKeySupport: "unsupported" as const,
            launchSafety: {
              mode: "durable_at_most_once" as const,
              guard: "workflow-step-attempt/v1" as const,
              replay: "never_launch" as const,
            },
          },
          execute: async (input) => {
            providerExecutions += 1;
            const result = await firstImage.execute(input);
            externalResult = structuredClone(result);
            externalEffectKey = input.effectKey;
            externalIntentDigest = input.intentDigest;
            return result;
          },
        };
      },
    };
    const {
      artifactService,
      clock,
      repository,
      revisions,
      service,
    } = await setupGoldenRun({ executors: firstExecutors });
    const accepted = await acceptGoldenRun(
      service,
      "golden-provider-checkpoint-crash-0001",
    );
    await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_checkpoint_copy",
    });
    const recordProviderSuccess =
      repository.recordStepAttemptProviderSuccess.bind(repository);
    repository.recordStepAttemptProviderSuccess = async () => ({
      kind: "unavailable",
    });
    await expect(
      service.executeOne({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
        workerId: "worker_checkpoint_crash",
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
    });
    repository.recordStepAttemptProviderSuccess = recordProviderSuccess;
    expect(
      (
        await repository.listStepAttempts({
          workspaceId: WORKSPACE_ID,
          runId: accepted.run.id,
        })
      )?.find((attempt) => attempt.stepId === "generate_hero"),
    ).toMatchObject({
      state: "running",
      providerOperationRef: null,
      outcome: null,
      launchSafety: {
        mode: "durable_at_most_once",
        replay: "never_launch",
      },
    });

    const restartBase = createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const restartImage = restartBase.get(
      imageDefinition.identity,
      imageDefinition.contractDigest,
    )!;
    const restartExecutors: WorkflowStepExecutorRegistry = {
      get: (identity, contractDigest) => {
        if (identity !== imageDefinition.identity) {
          return restartBase.get(identity, contractDigest);
        }
        return {
          provider: restartImage.provider,
          providerOperation: restartImage.providerOperation,
          model: restartImage.model,
          providerResolution: {
            ...restartImage.providerResolution!,
            effectKeySupport: "unsupported" as const,
            launchSafety: {
              mode: "durable_at_most_once" as const,
              guard: "workflow-step-attempt/v1" as const,
              replay: "never_launch" as const,
            },
          },
          execute: async () => {
            providerExecutions += 1;
            throw new Error("Ambiguous launched effects must not execute again.");
          },
          reconcile: async (input) => {
            providerReconciliations += 1;
            if (
              !externalResult ||
              externalResult.kind !== "generated" ||
              input.effectKey !== externalEffectKey ||
              input.intentDigest !== externalIntentDigest
            ) {
              return {
                kind: "outcome_unknown",
                failureCode: "PROVIDER_RESULT_NOT_YET_RECOVERABLE",
                providerOperationRef: input.providerOperationRef,
              };
            }
            return structuredClone(externalResult);
          },
        };
      },
    };
    const restartedService = new WorkflowRunService(
      repository,
      revisions,
      new InMemoryWorkflowRunQueue(),
      restartExecutors,
      runCursor(),
      clock,
      artifactService,
    );
    const recovered = await restartedService.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_checkpoint_crash",
    });
    expect(recovered.state).toBe("completed");
    expect(providerExecutions).toBe(1);
    expect(providerReconciliations).toBe(1);
  });

  it("blocks an ambiguous launched Attempt when fresh-restart reconciliation errors", async () => {
    const firstBase = createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const imageDefinition =
      GOLDEN_WORKFLOW_OPERATION_REGISTRY.get("gemini.generate_image@1")!;
    const firstImage = firstBase.get(
      imageDefinition.identity,
      imageDefinition.contractDigest,
    )!;
    let providerExecutions = 0;
    let providerReconciliations = 0;
    const firstExecutors: WorkflowStepExecutorRegistry = {
      get: (identity, contractDigest) => {
        if (identity !== imageDefinition.identity) {
          return firstBase.get(identity, contractDigest);
        }
        return {
          provider: firstImage.provider,
          providerOperation: firstImage.providerOperation,
          model: firstImage.model,
          execute: async (input) => {
            providerExecutions += 1;
            return firstImage.execute(input);
          },
        };
      },
    };
    const {
      artifactService,
      clock,
      repository,
      revisions,
      service,
    } = await setupGoldenRun({ executors: firstExecutors });
    const accepted = await acceptGoldenRun(
      service,
      "golden-ambiguous-reconcile-error-0001",
    );
    await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_ambiguous_error_copy",
    });
    const recordProviderSuccess =
      repository.recordStepAttemptProviderSuccess.bind(repository);
    repository.recordStepAttemptProviderSuccess = async () => ({
      kind: "unavailable",
    });
    await expect(
      service.executeOne({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
        workerId: "worker_ambiguous_error_launch",
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
    });
    repository.recordStepAttemptProviderSuccess = recordProviderSuccess;

    const restartBase = createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const restartImage = restartBase.get(
      imageDefinition.identity,
      imageDefinition.contractDigest,
    )!;
    const restartResolution = {
      adapterModule: "runtime/legacy-executor",
      adapterContractDigest: canonicalDigest({
        schema: "runtime-step-executor/v1",
        operationIdentity: imageDefinition.identity,
        operationContractDigest: imageDefinition.contractDigest,
        provider: firstImage.provider,
        providerOperation: firstImage.providerOperation,
        model: firstImage.model,
      }),
      provider: firstImage.provider,
      providerOperation: firstImage.providerOperation,
      model: firstImage.model,
      effectKeySupport: "native" as const,
      observation: "none" as const,
      launchSafety: {
        mode: "native_effect_key" as const,
        guard: "workflow-step-attempt/v1" as const,
        replay: "provider_deduplicated" as const,
      },
    };
    const restartExecutors: WorkflowStepExecutorRegistry = {
      get: (identity, contractDigest) => {
        if (identity !== imageDefinition.identity) {
          return restartBase.get(identity, contractDigest);
        }
        return {
          provider: restartImage.provider,
          providerOperation: restartImage.providerOperation,
          model: restartImage.model,
          providerResolution: restartResolution,
          execute: async () => {
            providerExecutions += 1;
            throw new Error("Ambiguous launched effects must not execute again.");
          },
          reconcile: async () => {
            providerReconciliations += 1;
            throw new Error("provider reconciliation transport unavailable");
          },
        };
      },
    };
    const restartedService = new WorkflowRunService(
      repository,
      revisions,
      new InMemoryWorkflowRunQueue(),
      restartExecutors,
      runCursor(),
      clock,
      artifactService,
    );
    const blocked = await restartedService.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_ambiguous_error_launch",
    });
    expect(blocked.state).toBe("outcome_unknown");
    expect(providerExecutions).toBe(1);
    expect(providerReconciliations).toBe(1);
    const attempt = (
      await repository.listStepAttempts({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
      })
    )?.find((candidate) => candidate.stepId === "generate_hero");
    expect(attempt).toMatchObject({
      state: "outcome_unknown",
      providerOperationRef: null,
      outcome: {
        kind: "outcome_unknown",
        failureCode: "PROVIDER_RECONCILIATION_UNAVAILABLE",
        priorSucceededProviderOperationRef: null,
      },
    });
  });

  it("bounds automatic retries while retaining one Effect Key and ordered retry events", async () => {
    const base = createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const textDefinition =
      GOLDEN_WORKFLOW_OPERATION_REGISTRY.get("gemini.generate_text@1")!;
    const textBase = base.get(
      textDefinition.identity,
      textDefinition.contractDigest,
    )!;
    const effectKeys: string[] = [];
    let shouldFail = true;
    const retryingText: WorkflowStepExecutor = {
      provider: textBase.provider,
      providerOperation: textBase.providerOperation,
      model: textBase.model,
      execute: async (input) => {
        effectKeys.push(input.effectKey);
        if (shouldFail) {
          shouldFail = false;
          return {
            kind: "failed_known",
            failureCode: "TRANSIENT_PROVIDER_FAILURE",
            retryable: true,
            providerOperationRef: "provider:retryable:1",
          };
        }
        return textBase.execute(input);
      },
    };
    const executors: WorkflowStepExecutorRegistry = {
      get: (identity, contractDigest) =>
        identity === textDefinition.identity
          ? retryingText
          : base.get(identity, contractDigest),
    };
    let current = new Date(NOW);
    const { dispatcher, repository, service } = await setupGoldenRun({
      executors,
      clock: { now: () => new Date(current) },
    });
    const accepted = await acceptGoldenRun(
      service,
      "automatic-retry-start-0001",
    );
    const waiting = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_retry_1",
    });
    expect(waiting).toMatchObject({
      state: "waiting",
      failureCode: "TRANSIENT_PROVIDER_FAILURE",
      resumeAt: new Date(NOW.getTime() + 1_000).toISOString(),
    });
    await expect(
      service.executeOne({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
        workerId: "worker_too_early",
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_RUN_LEASE_BUSY" });
    current = new Date(NOW.getTime() + 1_000);
    const resumeInput = {
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
      waitEventSequence: 5,
      idempotencyKey: "automatic-retry-resume-0001",
    };
    await expect(
      service.resume({
        workspaceId: WORKSPACE_ID,
        principalId: PRINCIPAL_ID,
        keyId: "key_golden",
        authorizationEvidenceRef: "trace_golden",
        ...resumeInput,
        waitEventSequence: 4,
        idempotencyKey: "automatic-retry-wrong-generation-0001",
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_RUN_NOT_RESUMABLE" });
    const cliResume = await dispatchCliCapability(
      "workflow_runs.resume@1",
      resumeInput,
      dispatcher,
    );
    expect(cliResume).toMatchObject({
      type: "capability_result",
      output: {
        run: { state: "running" },
        inspect: { capability: "workflow_runs.get@1" },
        events: { capability: "workflow_run_events.list@1" },
      },
    });
    await expect(
      service.resume({
        workspaceId: WORKSPACE_ID,
        workflowId: WORKFLOW_ID,
        runId: "run_different",
        principalId: PRINCIPAL_ID,
        keyId: "key_golden",
        authorizationEvidenceRef: "trace_golden",
        waitEventSequence: resumeInput.waitEventSequence,
        idempotencyKey: resumeInput.idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const recovered = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_retry_2",
    });
    expect(recovered.state).toBe("running");
    const attempts = await repository.listStepAttempts({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
    });
    expect(attempts?.map(({ attempt, state, effectKey }) => ({
      attempt,
      state,
      effectKey,
    }))).toEqual([
      { attempt: 1, state: "failed", effectKey: effectKeys[0] },
      { attempt: 2, state: "completed", effectKey: effectKeys[0] },
    ]);
    expect(effectKeys).toEqual([effectKeys[0], effectKeys[0]]);
    const events = await service.listEvents({
      workspaceId: WORKSPACE_ID,
      principalId: PRINCIPAL_ID,
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
      cursor: accepted.events.input.cursor,
    });
    expect(events.items.map(({ type }) => type)).toEqual([
      "run.accepted",
      "step.attempt.started",
      "step.attempt.failed",
      "step.retry.scheduled",
      "run.waiting",
      "run.resumed",
      "step.attempt.started",
      "artifact.generated",
      "step.attempt.completed",
    ]);
    current = new Date(current.getTime() + 1);
    await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_retry_complete",
    });
    const mcpResume = await dispatchMcpCapability(
      "workflow_runs.resume.v1",
      resumeInput,
      dispatcher,
    );
    expect(mcpResume).toEqual(cliResume);
  });

  it("blocks unknown outcomes until reconciliation and replays the public mutation exactly", async () => {
    const base = createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const textDefinition =
      GOLDEN_WORKFLOW_OPERATION_REGISTRY.get("gemini.generate_text@1")!;
    const textBase = base.get(
      textDefinition.identity,
      textDefinition.contractDigest,
    )!;
    let executions = 0;
    let reconciliations = 0;
    const unknownText: WorkflowStepExecutor = {
      provider: textBase.provider,
      providerOperation: textBase.providerOperation,
      model: textBase.model,
      execute: async (input) => {
        executions += 1;
        return {
          kind: "outcome_unknown",
          failureCode: "PROVIDER_RESPONSE_LOST",
          providerOperationRef: `provider:unknown:${input.effectKey}`,
        };
      },
      reconcile: async (input) => {
        reconciliations += 1;
        const result = await textBase.execute(input);
        if (result.kind === "legacy") {
          throw new Error("Golden reconciliation cannot return a legacy result.");
        }
        return result;
      },
    };
    const executors: WorkflowStepExecutorRegistry = {
      get: (identity, contractDigest) =>
        identity === textDefinition.identity
          ? unknownText
          : base.get(identity, contractDigest),
    };
    const { dispatcher, repository, service } = await setupGoldenRun({
      executors,
    });
    const accepted = await acceptGoldenRun(
      service,
      "unknown-outcome-start-0001",
    );
    const blocked = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_unknown",
    });
    expect(blocked.state).toBe("outcome_unknown");
    await expect(
      service.resume({
        workspaceId: WORKSPACE_ID,
        workflowId: WORKFLOW_ID,
        runId: accepted.run.id,
        principalId: PRINCIPAL_ID,
        keyId: "key_golden",
        authorizationEvidenceRef: "trace_golden",
        waitEventSequence: 1,
        idempotencyKey: "unknown-resume-0001",
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_RECONCILIATION_REQUIRED",
    });
    const unknownAttempt = (
      await repository.listStepAttempts({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
      })
    )?.find((attempt) => attempt.state === "outcome_unknown");
    expect(unknownAttempt).toBeDefined();
    const reconcileInput = {
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
      stepAttemptId: unknownAttempt!.id,
      idempotencyKey: "unknown-reconcile-0001",
    };
    await expect(
      service.reconcile({
        workspaceId: WORKSPACE_ID,
        principalId: PRINCIPAL_ID,
        keyId: "key_golden",
        authorizationEvidenceRef: "trace_golden",
        ...reconcileInput,
        stepAttemptId: "attempt_wrong_generation",
        idempotencyKey: "unknown-wrong-attempt-0001",
      }),
    ).rejects.toMatchObject({
      code: "WORKFLOW_RUN_PERSISTENCE_UNAVAILABLE",
    });
    const cli = await dispatchCliCapability(
      "workflow_runs.reconcile@1",
      reconcileInput,
      dispatcher,
    );
    expect(cli).toMatchObject({
      type: "capability_result",
      output: {
        run: { state: "waiting" },
        inspect: { capability: "workflow_runs.get@1" },
        events: { capability: "workflow_run_events.list@1" },
      },
    });
    expect(executions).toBe(1);
    expect(reconciliations).toBe(1);
    await expect(
      service.reconcile({
        workspaceId: WORKSPACE_ID,
        workflowId: WORKFLOW_ID,
        runId: "run_different",
        principalId: PRINCIPAL_ID,
        keyId: "key_golden",
        authorizationEvidenceRef: "trace_golden",
        stepAttemptId: reconcileInput.stepAttemptId,
        idempotencyKey: reconcileInput.idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const completed = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_after_reconcile",
    });
    expect(completed.state).toBe("completed");
    const mcp = await dispatchMcpCapability(
      "workflow_runs.reconcile.v1",
      reconcileInput,
      dispatcher,
    );
    expect(mcp).toEqual(cli);
  });

  it("creates one linked derived Run for an exact manual retry and preserves the source byte-for-byte", async () => {
    const base = createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const imageDefinition =
      GOLDEN_WORKFLOW_OPERATION_REGISTRY.get("gemini.generate_image@1")!;
    const imageBase = base.get(
      imageDefinition.identity,
      imageDefinition.contractDigest,
    )!;
    const terminalImage: WorkflowStepExecutor = {
      provider: imageBase.provider,
      providerOperation: imageBase.providerOperation,
      model: imageBase.model,
      execute: async () => ({
        kind: "failed_known",
        failureCode: "PROVIDER_REJECTED",
        retryable: false,
        providerOperationRef: "provider:rejected:1",
      }),
    };
    const executors: WorkflowStepExecutorRegistry = {
      get: (identity, contractDigest) =>
        identity === imageDefinition.identity
          ? terminalImage
          : base.get(identity, contractDigest),
    };
    const { dispatcher, service } = await setupGoldenRun({ executors });
    const accepted = await acceptGoldenRun(
      service,
      "manual-retry-start-0001",
    );
    await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_source_copy",
    });
    const failed = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_source_image",
    });
    expect(failed.state).toBe("failed");
    const sourceBefore = JSON.stringify(
      await service.get({
        workspaceId: WORKSPACE_ID,
        workflowId: WORKFLOW_ID,
        runId: accepted.run.id,
      }),
    );
    const retryInput = {
      workflowId: WORKFLOW_ID,
      runId: accepted.run.id,
      idempotencyKey: "manual-retry-create-0001",
      inputArtifactIds: [REFERENCE_ARTIFACT_ID],
    };
    const cli = await dispatchCliCapability(
      "workflow_runs.retry@1",
      retryInput,
      dispatcher,
    );
    expect(cli).toMatchObject({
      type: "capability_result",
      output: {
        run: {
          state: "accepted",
          derivation: {
            kind: "manual_retry",
            sourceRunId: accepted.run.id,
            retryFromStepId: "generate_hero",
            reusedOutputs: [{ stepId: "draft_copy" }],
          },
        },
        inspect: { capability: "workflow_runs.get@1" },
        events: { capability: "workflow_run_events.list@1" },
      },
    });
    const derivedRunId = (cli as {
      type: "capability_result";
      output: { run: { id: string } };
    }).output.run.id;
    const derivedFailure = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: derivedRunId,
      workerId: "worker_derived_image",
    });
    expect(derivedFailure).toMatchObject({
      state: "failed",
      derivation: {
        sourceRunId: accepted.run.id,
        retryFromStepId: "generate_hero",
      },
    });
    const mcp = await dispatchMcpCapability(
      "workflow_runs.retry.v1",
      retryInput,
      dispatcher,
    );
    expect(mcp).toEqual(cli);
    const derivedAttempts = await service.listStepAttempts({
      workspaceId: WORKSPACE_ID,
      workflowId: WORKFLOW_ID,
      runId: derivedRunId,
    });
    expect(derivedAttempts.items).toHaveLength(1);
    expect(derivedAttempts.items[0]).toMatchObject({
      stepId: "generate_hero",
      inputs: [
        {
          source: {
            kind: "step_output",
            runId: accepted.run.id,
          },
        },
        expect.any(Object),
      ],
    });
    await expect(
      service.retry({
        workspaceId: WORKSPACE_ID,
        workflowId: WORKFLOW_ID,
        runId: "run_different",
        principalId: PRINCIPAL_ID,
        keyId: "key_golden",
        authorizationEvidenceRef: "trace_golden",
        idempotencyKey: retryInput.idempotencyKey,
        inputArtifactIds: [REFERENCE_ARTIFACT_ID],
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(
      JSON.stringify(
        await service.get({
          workspaceId: WORKSPACE_ID,
          workflowId: WORKFLOW_ID,
          runId: accepted.run.id,
        }),
      ),
    ).toBe(sourceBefore);
  });
});

describe("controlled Gemini BYOK golden Workflow live path", () => {
  liveGeminiIt(
    "resolves the Credential only at the effect boundary and produces both golden outputs",
    async () => {
      const secret = process.env.GEMINI_API_KEY!;
      const value = await setupGoldenRun({
        createExecutors: (artifacts) =>
          createLiveGoldenExecutors(artifacts, secret),
      });
      const accepted = await acceptGoldenRun(
        value.service,
        "live-golden-run-start-0001",
      );
      const afterText = await value.service.executeOne({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
        workerId: "live-gemini-text",
      });
      expect(afterText.state).toBe("running");
      const completed = await value.service.executeOne({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
        workerId: "live-gemini-image",
      });
      expect(completed).toMatchObject({
        state: "completed",
        finalSnapshot: {
          outputs: {
            post_copy: { kind: "text" },
            hero_image: { kind: "image", mediaType: "image/png" },
          },
        },
      });
      const attempts = await value.service.listStepAttempts({
        workspaceId: WORKSPACE_ID,
        workflowId: WORKFLOW_ID,
        runId: accepted.run.id,
      });
      expect(attempts.items).toHaveLength(2);
      expect(attempts.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stepId: "draft_copy",
            state: "completed",
            provider: "gemini",
            model: "gemini-2.5-flash",
            providerMetadata: {
              evidence: expect.objectContaining({
                effectDisposition: "accepted",
              }),
              usage: expect.any(Array),
              retryAfterMs: null,
              pollAfterMs: null,
            },
          }),
          expect.objectContaining({
            stepId: "generate_hero",
            state: "completed",
            provider: "gemini",
            model: "gemini-2.5-flash-image",
          }),
        ]),
      );
      const copy = await value.service.getRunArtifact({
        workspaceId: WORKSPACE_ID,
        workflowId: WORKFLOW_ID,
        runId: accepted.run.id,
        artifactId: completed.finalSnapshot!.outputs.post_copy.artifactId,
      });
      const hero = await value.service.getRunArtifact({
        workspaceId: WORKSPACE_ID,
        workflowId: WORKFLOW_ID,
        runId: accepted.run.id,
        artifactId: completed.finalSnapshot!.outputs.hero_image.artifactId,
      });
      expect(copy).toMatchObject({
        textContent: expect.any(String),
        artifact: {
          origin: {
            kind: "generated",
            providerOperation: {
              provider: "gemini",
              model: "gemini-2.5-flash",
              metadata: {
                evidence: expect.objectContaining({
                  effectDisposition: "accepted",
                }),
              },
            },
          },
        },
      });
      expect(hero.artifact).toMatchObject({
        kind: "image",
        mediaType: "image/png",
        origin: {
          kind: "generated",
          providerOperation: {
            provider: "gemini",
            model: "gemini-2.5-flash-image",
          },
        },
      });
      expect(
        JSON.stringify({ completed, attempts, copy, hero }),
      ).not.toContain(secret);
    },
    300_000,
  );
});
