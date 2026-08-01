import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { AesGcmArtifactCursorCodec } from "@/lib/agent-runtime/artifacts/cursor";
import {
  InMemoryArtifactContentStore,
  InMemoryArtifactMediaInspector,
  InMemoryArtifactRepository,
} from "@/lib/agent-runtime/artifacts/memory";
import { ArtifactService } from "@/lib/agent-runtime/artifacts/service";
import { createGeminiInvocationBoundary } from "@/lib/agent-runtime/provider-effects";
import { InMemoryCredentialVaultRepository } from "@/lib/credential-vault/memory-repository";
import {
  CredentialEffectExecutor,
  CredentialVaultService,
} from "@/lib/credential-vault/service";
import type { CredentialProviderEffectAdapter } from "@/lib/credential-vault/types";
import {
  GEMINI_TEXT_CONTRACT,
  GeminiTextAdapter,
} from "@/lib/provider-adapters/gemini/generate-content";
import { describe, expect, it } from "vitest";
import { createWorkflowStepExecutorFromProviderAdapter } from "../provider-adapter";
import { DeterministicProviderFaultKit } from "../testing/provider-adapter-fault-kit";
import type { WorkflowRunStartSnapshot, WorkflowStepExecutionInput } from "../types";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const cipher = {
  encrypt: (value: string) => `vault:${Buffer.from(value).toString("base64url")}`,
  decrypt: (value: string) =>
    Buffer.from(value.slice("vault:".length), "base64url").toString(),
};

class CompletionFaultRepository extends InMemoryCredentialVaultRepository {
  failNextCompletion = true;

  override async completeEffect(
    input: Parameters<InMemoryCredentialVaultRepository["completeEffect"]>[0],
  ): Promise<boolean> {
    if (this.failNextCompletion) {
      this.failNextCompletion = false;
      return false;
    }
    return super.completeEffect(input);
  }
}

async function fixture(options: {
  failNextCompletion?: boolean;
  launch?: Parameters<DeterministicProviderFaultKit["enqueueLaunch"]>[0];
} = {}) {
  let authorizationAllowed = true;
  const credentialRepository = new CompletionFaultRepository();
  credentialRepository.failNextCompletion =
    options.failNextCompletion ?? true;
  credentialRepository.addAdministrator("workspace_1", "human_1");
  credentialRepository.addPrincipal("workspace_1", "principal_1");
  const vault = new CredentialVaultService(
    credentialRepository,
    cipher,
    () => NOW,
  );
  const profile = await vault.createProfile({
    workspaceId: "workspace_1",
    actorUserId: "human_1",
    idempotencyKey: "create-gemini-profile-0001",
    name: "Gemini production",
    provider: "gemini",
    slotName: "provider",
    secret: "gemini-secret-canary-never-durable",
  });
  await vault.createSpendGrant({
    workspaceId: "workspace_1",
    actorUserId: "human_1",
    idempotencyKey: "create-gemini-grant-0001",
    principalId: "principal_1",
    profileId: profile.id,
    mode: "bounded",
    limitCents: 20,
  });
  credentialRepository.addWorkflowBinding({
    workspaceId: "workspace_1",
    workflowId: "workflow_1",
    workflowRevision: "revision_1",
    binding: {
      nodeId: "draft_copy",
      operationIdentity: GEMINI_TEXT_CONTRACT.identity.workflowOperationIdentity,
      slotId: profile.slotId!,
    },
  });
  const policy: CredentialProviderEffectAdapter = {
    provider: "gemini",
    validate: () => undefined,
    quote: () => ({ priceCeilingCents: 5 }),
    execute: async () => {
      throw new Error("Legacy provider path must not execute.");
    },
  };
  const credentialExecutor = new CredentialEffectExecutor(
    credentialRepository,
    cipher,
    { authorize: async () => ({ allowed: authorizationAllowed }) },
    {
      capability: { name: "credential_profiles.get", version: 1 },
      authorizationContractDigest: `sha256:${"a".repeat(64)}`,
    },
    [policy],
    () => NOW,
  );
  const artifactRepository = new InMemoryArtifactRepository();
  const artifacts = new ArtifactService(
    artifactRepository,
    new InMemoryArtifactContentStore(),
    new InMemoryArtifactMediaInspector(),
    new AesGcmArtifactCursorCodec(() => ({
      active: { id: "test", key: Buffer.alloc(32, 7) },
      all: [{ id: "test", key: Buffer.alloc(32, 7) }],
    })),
    { now: () => NOW },
  );
  const transport = new DeterministicProviderFaultKit();
  transport.enqueueLaunch(
    options.launch ?? {
      kind: "response",
      effectDisposition: "accepted",
      providerOperationRef: "gemini-response-recovery-1",
      response: {
        status: 200,
        requestId: "gemini-response-recovery-1",
        body: {
          responseId: "gemini-response-recovery-1",
          modelVersion: GEMINI_TEXT_CONTRACT.identity.model,
          text: "Durable launch copy",
          usage: { input: 8, output: 3 },
        },
      },
    },
  );
  const boundary = createGeminiInvocationBoundary({
    credentialExecutor,
    artifacts,
  });
  const executor = createWorkflowStepExecutorFromProviderAdapter(
    "gemini/generate-content",
    new GeminiTextAdapter(transport),
    boundary,
  );
  const definition = {
    schema: "content-workflow-revision-definition/v1" as const,
    workflowId: "workflow_1",
    name: "Recovery fixture",
    inputs: { prompt: { kind: "text" as const, required: true } },
    credentialSlots: {},
    steps: [
      {
        id: "draft_copy",
        operation: {
          identity: GEMINI_TEXT_CONTRACT.identity.workflowOperationIdentity,
          contractDigest:
            GEMINI_TEXT_CONTRACT.identity.workflowOperationContractDigest,
        },
        inputs: {
          prompt: { from: "workflow_input" as const, input: "prompt" },
        },
        credentials: {},
        config: { instruction: "Write concise copy." },
        retry: {
          maxAttempts: 1,
          backoff: { initialMs: 0, maxMs: 0, multiplier: 1 },
        },
      },
    ],
    outputs: {
      text: {
        kind: "text" as const,
        binding: {
          from: "step_output" as const,
          step: "draft_copy",
          output: "text",
        },
      },
    },
  };
  const snapshot: WorkflowRunStartSnapshot = {
    schema: "workflow-run-start-snapshot/v2",
    workflowId: "workflow_1",
    workflowRevisionId: "revision_1",
    workflowRevision: 1,
    definitionDigest: canonicalDigest(definition),
    operationRegistryDigest: `sha256:${"b".repeat(64)}`,
    definition,
    inputs: [{ name: "prompt", kind: "text", value: "Launch Node Banana" }],
    operationContracts: [
      {
        stepId: "draft_copy",
        identity: GEMINI_TEXT_CONTRACT.identity.workflowOperationIdentity,
        contractDigest:
          GEMINI_TEXT_CONTRACT.identity.workflowOperationContractDigest,
      },
    ],
    providerResolutions: [
      { stepId: "draft_copy", ...executor.providerResolution! },
    ],
    artifactReferences: [],
    credentialReferences: [
      { stepId: "draft_copy", requirement: "provider", slotId: profile.slotId! },
    ],
    authorization: {
      principalId: "principal_1",
      keyId: "key_1",
      evidenceRef: "trace_1",
    },
  };
  const input: WorkflowStepExecutionInput = {
    workspaceId: "workspace_1",
    runId: "run_1",
    stepAttemptId: "attempt_1",
    attempt: 1,
    // Valid runtime Effect Keys can be much longer than the Credential Vault's
    // opaque 200-character receipt reference limit.
    effectKey: `workflow-effect:v1:${"x".repeat(430)}`,
    intentDigest: `sha256:${"c".repeat(64)}`,
    snapshot,
    step: definition.steps[0],
    inputs: {
      prompt: {
        kind: "text",
        contentDigest: canonicalDigest("Launch Node Banana"),
        artifactId: null,
        textContent: "Launch Node Banana",
        mediaType: "text/plain; charset=utf-8",
        sizeBytes: 18,
        width: null,
        height: null,
        source: { kind: "workflow_input", inputName: "prompt" },
      },
    },
  };
  return {
    artifacts,
    credentialRepository,
    executor,
    input,
    revokeAuthorization: () => {
      authorizationAllowed = false;
    },
    transport,
  };
}

describe("Gemini durable provider settlement recovery", () => {
  it("recovers staged output after receipt completion fails without relaunching", async () => {
    const value = await fixture();
    const first = await value.executor.execute(value.input);
    expect(first).toMatchObject({
      kind: "outcome_unknown",
      failureCode: "CREDENTIAL_EFFECT_RECONCILIATION_REQUIRED",
    });
    const staged = await value.artifacts.getGeneratedArtifact({
      workspaceId: value.input.workspaceId,
      effectKey: value.input.effectKey,
      outputName: "text",
    });
    expect(staged?.textContent).toBe("Durable launch copy");
    expect(
      staged?.artifact.origin.kind === "generated"
        ? staged.artifact.origin.providerOperation.metadata
        : null,
    ).toMatchObject({
      evidence: { providerRequestId: "gemini-response-recovery-1" },
      usage: [
        {
          dimension: "gemini.tokens.input@1",
          source: "reported",
          quantity: "8",
        },
        {
          dimension: "gemini.tokens.output@1",
          source: "reported",
          quantity: "3",
        },
      ],
    });

    const recovered = await value.executor.reconcile!({
      ...value.input,
      providerOperationRef: null,
    });
    expect(recovered).toMatchObject({
      kind: "generated",
      providerOperationRef: "gemini-response-recovery-1",
      providerMetadata: {
        evidence: { providerRequestId: "gemini-response-recovery-1" },
        usage: [
          { dimension: "gemini.tokens.input@1", quantity: "8" },
          { dimension: "gemini.tokens.output@1", quantity: "3" },
        ],
      },
    });
    if (recovered.kind !== "generated") return;
    expect(Buffer.from(recovered.outputs.text.bytes).toString("utf8")).toBe(
      "Durable launch copy",
    );
    expect(value.transport.launchCalls).toHaveLength(1);
    expect(value.credentialRepository.spendEvents[0]?.effectRef.length).toBeLessThanOrEqual(
      200,
    );
    expect(value.credentialRepository.spendEvents[0]?.effectRef).not.toContain(
      value.input.effectKey,
    );

    const replay = await value.executor.reconcile!({
      ...value.input,
      providerOperationRef: null,
    });
    expect(replay.kind).toBe("generated");
    expect(value.transport.launchCalls).toHaveLength(1);
    expect(JSON.stringify(value.credentialRepository.spendEvents)).not.toContain(
      "gemini-secret-canary-never-durable",
    );
  });

  it.each([
    {
      name: "revoked credential",
      launch: {
        kind: "response" as const,
        effectDisposition: "not_created" as const,
        providerOperationRef: null,
        response: {
          status: 401,
          requestId: "gemini-revoked-1",
          body: { errorCode: "API_KEY_INVALID" },
        },
      },
      expectedKind: "failed_known",
      failureCode: "PROVIDER_CREDENTIAL_REJECTED",
      effectDisposition: "not_created",
    },
    {
      name: "terminal provider rejection",
      launch: {
        kind: "response" as const,
        effectDisposition: "terminal_failed" as const,
        providerOperationRef: "gemini-safety-1",
        response: {
          status: 200,
          requestId: "gemini-safety-1",
          body: {
            responseId: "gemini-safety-1",
            modelVersion: GEMINI_TEXT_CONTRACT.identity.model,
            blocked: true,
            finishReason: "SAFETY",
          },
        },
      },
      expectedKind: "failed_known",
      failureCode: "PROVIDER_SAFETY_REJECTION",
      effectDisposition: "terminal_failed",
    },
    {
      name: "pre-contact timeout",
      launch: {
        kind: "timeout" as const,
        effectDisposition: "not_created" as const,
        providerOperationRef: null,
      },
      expectedKind: "failed_known",
      failureCode: "PROVIDER_NOT_CONTACTED",
      effectDisposition: "not_created",
    },
    {
      name: "post-accept ambiguous disconnect",
      launch: {
        kind: "disconnect" as const,
        effectDisposition: "accepted" as const,
        providerOperationRef: "gemini-ambiguous-1",
      },
      expectedKind: "outcome_unknown",
      failureCode: "PROVIDER_TRANSPORT_OUTCOME_UNKNOWN",
      effectDisposition: "accepted",
    },
  ])(
    "settles controlled $name through the Credential boundary without relaunch",
    async (testCase) => {
      const value = await fixture({
        failNextCompletion: false,
        launch: testCase.launch,
      });
      const first = await value.executor.execute(value.input);
      expect(first).toMatchObject({
        kind: testCase.expectedKind,
        failureCode: testCase.failureCode,
        providerMetadata: {
          evidence: { effectDisposition: testCase.effectDisposition },
        },
      });
      const replay = await value.executor.execute(value.input);
      expect(replay.kind).toBe(testCase.expectedKind);
      expect(value.transport.launchCalls).toHaveLength(1);
      expect(JSON.stringify(value.credentialRepository.spendEvents)).not.toContain(
        "gemini-secret-canary-never-durable",
      );
    },
  );

  it("keeps recovery outcome unknown when credential authority was revoked after launch", async () => {
    const value = await fixture();
    await expect(value.executor.execute(value.input)).resolves.toMatchObject({
      kind: "outcome_unknown",
    });
    value.revokeAuthorization();
    await expect(value.executor.execute(value.input)).resolves.toMatchObject({
      kind: "outcome_unknown",
      failureCode: "PROVIDER_CREDENTIAL_RECOVERY_UNAVAILABLE",
      providerMetadata: {
        evidence: { effectDisposition: "unknown" },
      },
    });
    await expect(
      value.executor.reconcile!({
        ...value.input,
        providerOperationRef: null,
      }),
    ).resolves.toMatchObject({
      kind: "outcome_unknown",
      failureCode: "PROVIDER_CREDENTIAL_RECOVERY_UNAVAILABLE",
      providerMetadata: {
        evidence: { effectDisposition: "unknown" },
      },
    });
    expect(value.transport.launchCalls).toHaveLength(1);
  });
});
