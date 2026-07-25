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
import { createDeterministicWorkflowRunExecutorRegistry } from "../executors";
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
  WorkflowStepExecutor,
  WorkflowStepExecutorRegistry,
} from "../types";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const WORKSPACE_ID = "workspace_golden";
const PRINCIPAL_ID = "principal_golden";
const WORKFLOW_ID = "fixture-workflow";
const REVISION_ID = "revision_golden_1";
const REFERENCE_ARTIFACT_ID = "artifact_reference_golden";

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
} = {}) {
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
    { now: () => new Date(NOW) },
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
  const service = new WorkflowRunService(
    repository,
    revisions,
    new InMemoryWorkflowRunQueue(),
    options.executors ??
      createDeterministicWorkflowRunExecutorRegistry(
        GOLDEN_WORKFLOW_OPERATION_REGISTRY,
      ),
    runCursor(),
    { now: () => new Date(NOW) },
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
    dispatcher,
    repository,
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
    const { repository, service } = await setupGoldenRun({
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

  it("durably fails the active Attempt and Run when generated image storage fails", async () => {
    const {
      artifactRepository,
      artifactStore,
      repository,
      service,
    } = await setupGoldenRun();
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
    const failed = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_storage_failure",
    });
    expect(failed).toMatchObject({
      state: "failed",
      failureCode: "ARTIFACT_PERSISTENCE_FAILED",
      output: null,
      finalSnapshot: null,
    });
    const failedAttempts = await repository.listStepAttempts({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
    });
    expect(
      failedAttempts?.map(({ stepId, state, failureCode }) => ({
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
        state: "failed",
        failureCode: "ARTIFACT_PERSISTENCE_FAILED",
      },
    ]);
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
      { sequence: 6, type: "step.attempt.failed" },
      { sequence: 7, type: "run.failed" },
    ]);

    const replay = await service.executeOne({
      workspaceId: WORKSPACE_ID,
      runId: accepted.run.id,
      workerId: "worker_storage_failure_replay",
    });
    expect(replay).toEqual(failed);
    expect(
      await repository.listStepAttempts({
        workspaceId: WORKSPACE_ID,
        runId: accepted.run.id,
      }),
    ).toEqual(failedAttempts);
    expect(artifactRepository.artifacts.size).toBe(
      partialArtifactCount,
    );
    expect(artifactRepository.generatedOrigins.size).toBe(
      generatedOriginCount,
    );
    expect(
      (await service.listEvents({
        workspaceId: WORKSPACE_ID,
        principalId: PRINCIPAL_ID,
        workflowId: WORKFLOW_ID,
        runId: accepted.run.id,
        cursor: accepted.events.input.cursor,
      })).items,
    ).toEqual(events.items);
  });
});
