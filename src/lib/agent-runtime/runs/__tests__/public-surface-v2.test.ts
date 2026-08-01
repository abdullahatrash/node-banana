import { describe, expect, it } from "vitest";
import {
  dispatchCliCapability,
  dispatchMcpCapability,
} from "@/lib/agent-tools/adapters";
import { CapabilityDispatcher } from "@/lib/agent-tools/dispatcher";
import {
  createCapabilityRegistry,
  createDiscoveryRegistrations,
} from "@/lib/agent-tools/registry";
import type {
  CapabilityAuthorizationRequest,
  CapabilityAuthorizer,
} from "@/types/agentAuthorization";
import type { ArtifactMetadata } from "../../artifacts/types";
import type { ResolvedWorkflowDefinition } from "../../workflows/types";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "../../workflows";
import {
  GOLDEN_BRIEF,
  GOLDEN_IMAGE_FIXTURES,
  GOLDEN_LINKEDIN_COPY,
  GOLDEN_OPERATION_CONTRACTS,
  GOLDEN_TEXT_BYTES,
  GOLDEN_WORKFLOW_DEFINITION_DIGEST,
  GOLDEN_WORKFLOW_DRAFT,
} from "../fixtures/golden";
import { createWorkflowRunRegistrations } from "../capabilities";
import { AesGcmWorkflowRunEventCursorCodec } from "../cursor";
import { createDeterministicWorkflowRunExecutorRegistry } from "../executors";
import {
  InMemoryWorkflowRunQueue,
  InMemoryWorkflowRunRepository,
  InMemoryWorkflowRunRevisionReader,
} from "../memory";
import { WorkflowRunService } from "../service";
import type {
  WorkflowRunArtifactPort,
  WorkflowStepAttemptRecord,
} from "../types";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const WORKSPACE_ID = "workspace_1";
const PRINCIPAL_ID = "principal_1";
const WORKFLOW_ID = "fixture-workflow";
const REVISION_ID = "revision_golden_1";
const REFERENCE_ARTIFACT_ID = "artifact_reference";
const GENERATED_ARTIFACT_ID = "artifact_copy";

function resolvedGoldenWorkflow(): ResolvedWorkflowDefinition {
  const draft = structuredClone(GOLDEN_WORKFLOW_DRAFT);
  return {
    schema: "content-workflow-revision-definition/v1",
    workflowId: draft.workflowId,
    name: draft.name,
    description: draft.description,
    inputs: draft.inputs,
    credentialSlots: draft.credentialSlots,
    steps: draft.steps.map((step) => {
      const operation = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
        step.operation,
      );
      if (!operation) throw new Error(`Missing ${step.operation}.`);
      return {
        ...step,
        operation: {
          identity: operation.identity,
          contractDigest: operation.contractDigest,
        },
      };
    }),
    outputs: Object.fromEntries(
      Object.entries(draft.outputs).map(([name, binding]) => {
        const step = draft.steps.find(
          (candidate) => candidate.id === binding.step,
        );
        const operation = step
          ? GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(step.operation)
          : undefined;
        const kind = operation?.outputs[binding.output];
        if (!kind) throw new Error(`Missing output contract for ${name}.`);
        return [name, { kind, binding }];
      }),
    ),
  };
}

function importedReference(): ArtifactMetadata {
  return {
    id: REFERENCE_ARTIFACT_ID,
    workspaceId: WORKSPACE_ID,
    kind: "image",
    digest: GOLDEN_IMAGE_FIXTURES.reference.digest,
    sizeBytes: GOLDEN_IMAGE_FIXTURES.reference.sizeBytes,
    mediaType: GOLDEN_IMAGE_FIXTURES.reference.mediaType,
    width: GOLDEN_IMAGE_FIXTURES.reference.width,
    height: GOLDEN_IMAGE_FIXTURES.reference.height,
    creatorPrincipalId: PRINCIPAL_ID,
    origin: {
      kind: "imported",
      importedAt: NOW.toISOString(),
    },
    retention: {
      mode: "workspace_default",
      snapshotAt: NOW.toISOString(),
    },
    lineage: { inputs: [], sourceArtifactIds: [] },
    createdAt: NOW.toISOString(),
  };
}

function generatedCopy(runId: string): ArtifactMetadata {
  return {
    id: GENERATED_ARTIFACT_ID,
    workspaceId: WORKSPACE_ID,
    kind: "text",
    digest: GOLDEN_TEXT_BYTES.linkedInCopy.digest,
    sizeBytes: GOLDEN_TEXT_BYTES.linkedInCopy.sizeBytes,
    mediaType: GOLDEN_TEXT_BYTES.linkedInCopy.mediaType,
    width: null,
    height: null,
    creatorPrincipalId: PRINCIPAL_ID,
    origin: {
      kind: "generated",
      generatedAt: NOW.toISOString(),
      workflowRevision: {
        workflowId: WORKFLOW_ID,
        revisionId: REVISION_ID,
        revision: 1,
        definitionDigest: GOLDEN_WORKFLOW_DEFINITION_DIGEST,
      },
      run: {
        runId,
        startSnapshotDigest: `sha256:${"2".repeat(64)}`,
      },
      stepAttempt: {
        stepAttemptId: "attempt_copy_1",
        stepId: "draft_copy",
        attempt: 1,
      },
      providerOperation: {
        provider: "conformance",
        operationIdentity: GOLDEN_OPERATION_CONTRACTS.draftCopy.identity,
        operation: "generate_text",
        ref: "conformance:golden:draft_copy:v1",
        model: "golden-v1",
        intentDigest: `sha256:${"3".repeat(64)}`,
        metadata: null,
      },
      effectKey: `workflow-effect:v1:${WORKSPACE_ID}:${runId}:draft_copy:1`,
      outputName: "text",
    },
    retention: {
      mode: "workspace_default",
      snapshotAt: NOW.toISOString(),
    },
    lineage: {
      inputs: [{
        port: "prompt",
        kind: "text",
        source: { kind: "workflow_input", inputName: "brief" },
        contentDigest: GOLDEN_TEXT_BYTES.brief.digest,
        artifactId: null,
      }],
      sourceArtifactIds: [],
    },
    createdAt: NOW.toISOString(),
  };
}

function setup() {
  const repository = new InMemoryWorkflowRunRepository();
  const revisions = new InMemoryWorkflowRunRevisionReader();
  revisions.put(WORKSPACE_ID, {
    id: REVISION_ID,
    workflowId: WORKFLOW_ID,
    revision: 1,
    definitionDigest: GOLDEN_WORKFLOW_DEFINITION_DIGEST,
    definition: resolvedGoldenWorkflow(),
    operationRegistryDigest: GOLDEN_WORKFLOW_OPERATION_REGISTRY.digest,
  });
  let generated: ArtifactMetadata | null = null;
  const artifacts: WorkflowRunArtifactPort = {
    getArtifact: async ({ workspaceId, artifactId }) => {
      if (workspaceId !== WORKSPACE_ID) throw new Error("unavailable");
      if (artifactId === REFERENCE_ARTIFACT_ID) {
        return { artifact: importedReference(), textContent: null };
      }
      if (artifactId === GENERATED_ARTIFACT_ID && generated) {
        return {
          artifact: structuredClone(generated),
          textContent: GOLDEN_LINKEDIN_COPY,
        };
      }
      throw new Error("unavailable");
    },
    commitGenerated: async () => {
      throw new Error("not used by public-surface tests");
    },
  };
  const service = new WorkflowRunService(
    repository,
    revisions,
    new InMemoryWorkflowRunQueue(),
    createDeterministicWorkflowRunExecutorRegistry(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    ),
    new AesGcmWorkflowRunEventCursorCodec(() => ({
      active: { id: "test", key: Buffer.alloc(32, 8) },
      all: [{ id: "test", key: Buffer.alloc(32, 8) }],
    })),
    { now: () => NOW },
    artifacts,
  );
  const requests: CapabilityAuthorizationRequest[] = [];
  const authorizer: CapabilityAuthorizer = {
    authorize: async (request) => {
      requests.push(request);
      return {
        allowed: true,
        operatorTraceRef: `trace_${requests.length}`,
        effectiveResources: {
          channelIds: [],
          credentialProfileIds: ["profile_gemini_golden"],
          workflowIds: [WORKFLOW_ID],
          automationIds: [],
          artifactIds: [REFERENCE_ARTIFACT_ID, GENERATED_ARTIFACT_ID],
        },
      };
    },
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
          keyId: "key_1",
        },
      }),
  };
  return {
    dispatcher,
    registry,
    repository,
    requests,
    setGenerated(value: ArtifactMetadata) {
      generated = structuredClone(value);
    },
  };
}

function startInput() {
  return {
    workflowId: WORKFLOW_ID,
    revisionId: REVISION_ID,
    idempotencyKey: "golden-start-v2",
    inputs: {
      brief: GOLDEN_BRIEF,
      reference_image: REFERENCE_ARTIFACT_ID,
    },
    inputArtifactIds: [REFERENCE_ARTIFACT_ID],
  };
}

describe("Workflow Run v2 public surface parity", () => {
  it("replays one Artifact-authorized acceptance across CLI and MCP", async () => {
    const { dispatcher, requests } = setup();
    const cli = await dispatchCliCapability(
      "workflow_runs.start@2",
      startInput(),
      dispatcher,
    );
    const mcp = await dispatchMcpCapability(
      "workflow_runs.start.v2",
      startInput(),
      dispatcher,
    );

    expect(cli).toMatchObject({
      type: "capability_result",
      status: "accepted",
    });
    expect(mcp).toEqual(cli);
    expect(requests.slice(-2).map(({ resources }) => resources)).toEqual([
      [
        { kind: "workflow", id: WORKFLOW_ID },
        { kind: "artifact", id: REFERENCE_ARTIFACT_ID },
      ],
      [
        { kind: "workflow", id: WORKFLOW_ID },
        { kind: "artifact", id: REFERENCE_ARTIFACT_ID },
      ],
    ]);
  });

  it("rejects missing, duplicate, and non-exact input Artifact declarations", async () => {
    const { dispatcher } = setup();
    for (const input of [
      { ...startInput(), inputArtifactIds: [] },
      {
        ...startInput(),
        inputArtifactIds: [
          REFERENCE_ARTIFACT_ID,
          REFERENCE_ARTIFACT_ID,
        ],
      },
    ]) {
      await expect(
        dispatchCliCapability("workflow_runs.start@2", input, dispatcher),
      ).resolves.toMatchObject({
        type: "capability_error",
        code: "VALIDATION_FAILED",
      });
    }
    await expect(
      dispatchCliCapability(
        "workflow_runs.start@2",
        {
          ...startInput(),
          inputArtifactIds: ["artifact_other"],
        },
        dispatcher,
      ),
    ).resolves.toMatchObject({
      type: "capability_error",
      code: "WORKFLOW_RUN_INVALID_INPUT",
    });
  });

  it("lists Step Attempts and inspects one Run-owned Artifact identically", async () => {
    const value = setup();
    const started = await dispatchCliCapability(
      "workflow_runs.start@2",
      startInput(),
      value.dispatcher,
    );
    if (started.type !== "capability_result") {
      throw new Error("Workflow Run acceptance expected.");
    }
    const runId = (started.output as { run: { id: string } }).run.id;
    const attempt: WorkflowStepAttemptRecord = {
      id: "attempt_copy_1",
      workspaceId: WORKSPACE_ID,
      runId,
      stepId: "draft_copy",
      attempt: 1,
      state: "completed",
      operationIdentity: GOLDEN_OPERATION_CONTRACTS.draftCopy.identity,
      operationContractDigest:
        GOLDEN_OPERATION_CONTRACTS.draftCopy.contractDigest,
      provider: "conformance",
      providerOperation: "generate_text",
      model: "golden-v1",
      intentDigest: `sha256:${"3".repeat(64)}`,
      effectKey: `workflow-effect:v1:${WORKSPACE_ID}:${runId}:draft_copy:1`,
      providerOperationRef: `conformance:${runId}:draft_copy`,
      outcome: {
        kind: "succeeded",
        providerOperationRef: `conformance:${runId}:draft_copy`,
      },
      providerMetadata: {
        evidence: {
          providerRequestId: `conformance:${runId}:draft_copy`,
          httpStatus: 200,
          providerCode: null,
          operatorTraceRef: null,
          effectDisposition: "accepted",
        },
        usage: [
          {
            dimension: "conformance.tokens.input@1",
            unit: "count",
            source: "reported",
            quantity: "8",
          },
        ],
        retryAfterMs: null,
        pollAfterMs: null,
      },
      reconciliation: null,
      inputs: [{
        port: "prompt",
        kind: "text",
        source: { kind: "workflow_input", inputName: "brief" },
        contentDigest: GOLDEN_TEXT_BYTES.brief.digest,
        artifactId: null,
      }],
      outputs: {
        text: {
          artifactId: GENERATED_ARTIFACT_ID,
          digest: GOLDEN_TEXT_BYTES.linkedInCopy.digest,
          kind: "text",
          mediaType: GOLDEN_TEXT_BYTES.linkedInCopy.mediaType,
          sizeBytes: GOLDEN_TEXT_BYTES.linkedInCopy.sizeBytes,
        },
      },
      failureCode: null,
      startedAt: NOW,
      completedAt: NOW,
    };
    value.repository.stepAttempts.set(attempt.id, attempt);
    value.setGenerated(generatedCopy(runId));

    const attemptsInput = { workflowId: WORKFLOW_ID, runId };
    const cliAttempts = await dispatchCliCapability(
      "workflow_step_attempts.list@1",
      attemptsInput,
      value.dispatcher,
    );
    const mcpAttempts = await dispatchMcpCapability(
      "workflow_step_attempts.list.v1",
      attemptsInput,
      value.dispatcher,
    );
    expect(mcpAttempts).toEqual(cliAttempts);
    expect(cliAttempts).toMatchObject({
      type: "capability_result",
      output: {
        items: [{
          id: attempt.id,
          provider: "conformance",
          operationIdentity: "gemini.generate_text@1",
          outputs: {
            text: { artifactId: GENERATED_ARTIFACT_ID },
          },
          providerMetadata: {
            evidence: {
              providerRequestId: `conformance:${runId}:draft_copy`,
              httpStatus: 200,
              effectDisposition: "accepted",
            },
            usage: [{ quantity: "8" }],
          },
        }],
      },
    });

    const artifactInput = {
      workflowId: WORKFLOW_ID,
      runId,
      artifactId: GENERATED_ARTIFACT_ID,
    };
    const cliArtifact = await dispatchCliCapability(
      "workflow_run_artifacts.get@1",
      artifactInput,
      value.dispatcher,
    );
    const mcpArtifact = await dispatchMcpCapability(
      "workflow_run_artifacts.get.v1",
      artifactInput,
      value.dispatcher,
    );
    expect(mcpArtifact).toEqual(cliArtifact);
    expect(cliArtifact).toMatchObject({
      type: "capability_result",
      output: {
        artifact: {
          id: GENERATED_ARTIFACT_ID,
          origin: {
            kind: "generated",
            providerOperation: {
              provider: "conformance",
              operationIdentity: "gemini.generate_text@1",
              operation: "generate_text",
              ref: "conformance:golden:draft_copy:v1",
            },
          },
        },
        textContent: GOLDEN_LINKEDIN_COPY,
      },
    });
    expect(value.requests.slice(-4).map(({ resources }) => resources))
      .toEqual([
        [{ kind: "workflow", id: WORKFLOW_ID }],
        [{ kind: "workflow", id: WORKFLOW_ID }],
        [{ kind: "workflow", id: WORKFLOW_ID }],
        [{ kind: "workflow", id: WORKFLOW_ID }],
      ]);
  });
});
