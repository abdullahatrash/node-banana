import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { canonicalDigest } from "@/lib/agent-tools/canonical";
import { PRODUCTION_ARTIFACT_SERVICE } from "@/lib/agent-runtime/artifacts";
import { AgentAuthorizationService } from "@/lib/agent-authorization/service";
import { DrizzleAgentAuthorizationRepository } from "@/lib/agent-authorization/repository";
import {
  CREDENTIAL_PROFILE_GET_IDENTITY,
  authorizationContractDigestFor,
} from "@/lib/agent-tools/registry";
import { credentialSecretCipher } from "@/lib/credential-vault/crypto";
import { DrizzleCredentialVaultRepository } from "@/lib/credential-vault/repository";
import {
  CredentialEffectExecutor,
  CredentialProviderEffectError,
  CredentialVaultError,
} from "@/lib/credential-vault/service";
import type {
  CredentialProviderEffectAdapter,
  CredentialSafeEffectResult,
} from "@/lib/credential-vault/types";
import type {
  ProviderOutcome,
  ProviderUsageEvidence,
  SafeProviderEvidence,
  WorkflowProviderInvocationBoundary,
  WorkflowProviderOutputs,
} from "./runs/provider-adapter";
import type {
  WorkflowRunArtifactPort,
  WorkflowStepExecutionInput,
  WorkflowStepProviderMetadata,
  WorkflowStepReconciliationInput,
} from "./runs/types";
import type {
  GeminiImageIntent,
  GeminiTextIntent,
} from "@/lib/provider-adapters/gemini/generate-content";

const geminiCredentialPolicy: CredentialProviderEffectAdapter = {
  provider: "gemini",
  validate: ({ operation, intent }) => {
    if (
      !["generate_text", "generate_image"].includes(operation) ||
      !intent ||
      typeof intent.prompt !== "string"
    ) {
      throw new CredentialVaultError(
        "INVALID_INPUT",
        "Gemini provider intent is invalid.",
      );
    }
  },
  quote: ({ operation }) => ({
    priceCeilingCents: operation === "generate_image" ? 25 : 5,
  }),
  execute: async () => {
    throw new Error("The legacy credential adapter path is disabled.");
  },
};

export const PRODUCTION_AGENT_AUTHORIZER = new AgentAuthorizationService(
  new DrizzleAgentAuthorizationRepository(getDb),
);

export const CREDENTIAL_EFFECT_EXECUTOR = new CredentialEffectExecutor(
  new DrizzleCredentialVaultRepository(getDb),
  credentialSecretCipher,
  PRODUCTION_AGENT_AUTHORIZER,
  {
    capability: CREDENTIAL_PROFILE_GET_IDENTITY,
    authorizationContractDigest: authorizationContractDigestFor(
      CREDENTIAL_PROFILE_GET_IDENTITY,
      {
        resources: [
          { kind: "credential_profile", inputPath: "credentialProfileId" },
        ],
      },
    ),
  },
  [geminiCredentialPolicy],
);

function safeCredentialFailure(
  error: unknown,
): ProviderOutcome<WorkflowProviderOutputs> {
  const unavailable =
    error instanceof CredentialVaultError &&
    ["CREDENTIAL_UNAVAILABLE", "SPEND_NOT_AUTHORIZED", "FORBIDDEN"].includes(
      error.code,
    );
  if (error instanceof CredentialProviderEffectError) {
    return {
      kind: "outcome_unknown",
      providerOperationRef: null,
      failureCode: error.failureCode,
      pollAfterMs: null,
      evidence: {
        providerRequestId: null,
        httpStatus: null,
        providerCode: null,
        operatorTraceRef: null,
        effectDisposition: "unknown",
      },
      usage: [],
    };
  }
  return unavailable
    ? {
        kind: "failed_known",
        providerOperationRef: null,
        failureCode: "PROVIDER_CREDENTIAL_UNAVAILABLE",
        retryHint: { retryable: false, retryAfterMs: null },
        evidence: {
          providerRequestId: null,
          httpStatus: null,
          providerCode: null,
          operatorTraceRef: null,
          effectDisposition: "not_created",
        },
        usage: [],
      }
    : {
        kind: "outcome_unknown",
        providerOperationRef: null,
        failureCode: "CREDENTIAL_EFFECT_RECONCILIATION_REQUIRED",
        pollAfterMs: null,
        evidence: {
          providerRequestId: null,
          httpStatus: null,
          providerCode: null,
          operatorTraceRef: null,
          effectDisposition: "unknown",
        },
        usage: [],
      };
}

function safeCredentialRecoveryFailure(
  error: unknown,
): ProviderOutcome<WorkflowProviderOutputs> {
  return {
    kind: "outcome_unknown",
    providerOperationRef: null,
    failureCode:
      error instanceof CredentialProviderEffectError
        ? error.failureCode
        : error instanceof CredentialVaultError &&
            ["CREDENTIAL_UNAVAILABLE", "SPEND_NOT_AUTHORIZED", "FORBIDDEN"].includes(
              error.code,
            )
          ? "PROVIDER_CREDENTIAL_RECOVERY_UNAVAILABLE"
          : "CREDENTIAL_EFFECT_RECONCILIATION_REQUIRED",
    pollAfterMs: null,
    evidence: {
      providerRequestId: null,
      httpStatus: null,
      providerCode: null,
      operatorTraceRef: null,
      effectDisposition: "unknown",
    },
    usage: [],
  };
}

function providerIntent(input: WorkflowStepExecutionInput):
  | GeminiTextIntent
  | GeminiImageIntent {
  const prompt = input.inputs.prompt?.textContent;
  if (!prompt) throw new Error("Gemini prompt is unavailable.");
  if (input.step.operation.identity === "gemini.generate_text@1") {
    const instruction = input.step.config.instruction;
    if (typeof instruction !== "string") {
      throw new Error("Gemini text instruction is unavailable.");
    }
    return { prompt, instruction };
  }
  const reference = input.inputs.referenceImage;
  const aspectRatio = input.step.config.aspectRatio;
  if (
    !reference?.bytes ||
    !["image/png", "image/jpeg", "image/webp"].includes(reference.mediaType) ||
    !["1:1", "4:5", "16:9"].includes(String(aspectRatio))
  ) {
    throw new Error("Gemini reference image is unavailable.");
  }
  return {
    prompt,
    aspectRatio: aspectRatio as GeminiImageIntent["aspectRatio"],
    referenceImage: {
      bytes: reference.bytes,
      mediaType: reference.mediaType as GeminiImageIntent["referenceImage"]["mediaType"],
    },
  };
}

interface DurableOutputReference {
  artifactId: string;
  digest: string;
  kind: "text" | "image";
  mediaType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

interface DurableGeminiSettlement {
  schema: "gemini-effect-settlement/v1";
  kind: ProviderOutcome<WorkflowProviderOutputs>["kind"];
  providerOperationRef: string | null;
  failureCode: string | null;
  retryable: boolean | null;
  retryAfterMs: number | null;
  pollAfterMs: number | null;
  evidence: SafeProviderEvidence;
  usage: ProviderUsageEvidence[];
  outputs: Record<string, DurableOutputReference>;
}

const safeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,499}$/);
const durableUsageSchema = z.discriminatedUnion("source", [
  z.object({
    dimension: z.string().regex(/^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$/),
    unit: z.enum(["count", "byte", "millisecond", "megapixel"]),
    source: z.enum(["reported", "measured", "estimated"]),
    quantity: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/),
  }).strict(),
  z.object({
    dimension: z.string().regex(/^[a-z][a-z0-9_.-]{0,99}@[1-9][0-9]{0,8}$/),
    unit: z.enum(["count", "byte", "millisecond", "megapixel"]),
    source: z.literal("unknown"),
    quantity: z.null(),
  }).strict(),
]);
const durableSettlementSchema = z.object({
  schema: z.literal("gemini-effect-settlement/v1"),
  kind: z.enum(["succeeded", "failed_known", "outcome_unknown"]),
  providerOperationRef: safeId.nullable(),
  failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(),
  retryable: z.boolean().nullable(),
  retryAfterMs: z.number().int().nonnegative().nullable(),
  pollAfterMs: z.number().int().nonnegative().nullable(),
  evidence: z.object({
    providerRequestId: safeId.nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    providerCode: safeId.nullable(),
    operatorTraceRef: safeId.nullable(),
    effectDisposition: z.enum([
      "not_created",
      "accepted",
      "terminal_failed",
      "unknown",
    ]),
  }).strict(),
  usage: z.array(durableUsageSchema),
  outputs: z.record(
    z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/),
    z.object({
      artifactId: z.string().min(1).max(200),
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      kind: z.enum(["text", "image"]),
      mediaType: z.string().min(1).max(200),
      sizeBytes: z.number().int().nonnegative(),
      width: z.number().int().positive().nullable(),
      height: z.number().int().positive().nullable(),
    }).strict(),
  ),
}).strict();

function durableSettlement(
  outcome: ProviderOutcome<WorkflowProviderOutputs>,
  outputs: Record<string, DurableOutputReference>,
): DurableGeminiSettlement {
  return {
    schema: "gemini-effect-settlement/v1",
    kind: outcome.kind,
    providerOperationRef: outcome.providerOperationRef,
    failureCode: outcome.kind === "succeeded" ? null : outcome.failureCode,
    retryable:
      outcome.kind === "failed_known" ? outcome.retryHint.retryable : null,
    retryAfterMs:
      outcome.kind === "failed_known" ? outcome.retryHint.retryAfterMs : null,
    pollAfterMs:
      outcome.kind === "outcome_unknown" ? outcome.pollAfterMs : null,
    evidence: { ...outcome.evidence },
    usage: outcome.usage.map((item) => ({ ...item })),
    outputs: structuredClone(outputs),
  };
}

function normalizedMetadata(
  outcome: ProviderOutcome<WorkflowProviderOutputs>,
): WorkflowStepProviderMetadata {
  return {
    evidence: { ...outcome.evidence },
    usage: outcome.usage.map((item) => ({ ...item })),
    retryAfterMs:
      outcome.kind === "failed_known" ? outcome.retryHint.retryAfterMs : null,
    pollAfterMs:
      outcome.kind === "outcome_unknown" ? outcome.pollAfterMs : null,
  };
}

function providerResolution(input: WorkflowStepExecutionInput) {
  const resolution = input.snapshot.providerResolutions?.find(
    (candidate) => candidate.stepId === input.step.id,
  );
  if (!resolution) throw new Error("Provider resolution is unavailable.");
  return resolution;
}

function assertGeneratedOrigin(
  input: WorkflowStepExecutionInput,
  outputName: string,
  artifact: Awaited<ReturnType<WorkflowRunArtifactPort["getArtifact"]>>["artifact"],
): void {
  const resolution = providerResolution(input);
  const origin = artifact.origin;
  if (
    origin.kind !== "generated" ||
    origin.effectKey !== input.effectKey ||
    origin.outputName !== outputName ||
    origin.run.runId !== input.runId ||
    origin.run.startSnapshotDigest !== canonicalDigest(input.snapshot) ||
    origin.stepAttempt.stepAttemptId !== input.stepAttemptId ||
    origin.stepAttempt.stepId !== input.step.id ||
    origin.stepAttempt.attempt !== input.attempt ||
    origin.providerOperation.provider !== resolution.provider ||
    origin.providerOperation.operationIdentity !== input.step.operation.identity ||
    origin.providerOperation.operation !== resolution.providerOperation ||
    origin.providerOperation.model !== resolution.model ||
    origin.providerOperation.intentDigest !== input.intentDigest
  ) {
    throw new Error("Generated Artifact provenance does not match the provider attempt.");
  }
}

async function restoreOutput(
  input: WorkflowStepExecutionInput,
  outputName: string,
  reference: DurableOutputReference,
  artifacts: WorkflowRunArtifactPort,
): Promise<WorkflowProviderOutputs[string]> {
  const found = await artifacts.getArtifact({
    workspaceId: input.workspaceId,
    artifactId: reference.artifactId,
  });
  assertGeneratedOrigin(input, outputName, found.artifact);
  if (
    found.artifact.digest !== reference.digest ||
    found.artifact.kind !== reference.kind ||
    found.artifact.mediaType !== reference.mediaType ||
    found.artifact.sizeBytes !== reference.sizeBytes ||
    found.artifact.width !== reference.width ||
    found.artifact.height !== reference.height
  ) {
    throw new Error("Generated Artifact reference does not match durable content.");
  }
  if (reference.kind === "text") {
    if (found.textContent === null) throw new Error("Generated text is unavailable.");
    return {
      kind: "text",
      mediaType: reference.mediaType,
      bytes: Buffer.from(found.textContent, "utf8"),
    };
  }
  if (!artifacts.readArtifactBytes || reference.width === null || reference.height === null) {
    throw new Error("Generated image bytes are unavailable.");
  }
  return {
    kind: "image",
    mediaType: reference.mediaType,
    bytes: await artifacts.readArtifactBytes({
      workspaceId: input.workspaceId,
      artifactId: reference.artifactId,
    }),
    width: reference.width,
    height: reference.height,
  };
}

async function restoreSettlement(
  input: WorkflowStepExecutionInput,
  value: CredentialSafeEffectResult,
  artifacts: WorkflowRunArtifactPort,
): Promise<ProviderOutcome<WorkflowProviderOutputs>> {
  const parsed = durableSettlementSchema.parse(value) as DurableGeminiSettlement;
  const expectedOutput =
    input.step.operation.identity === "gemini.generate_text@1" ? "text" : "image";
  const outputNames = Object.keys(parsed.outputs);
  if (
    (parsed.kind === "succeeded" &&
      (parsed.failureCode !== null ||
        parsed.retryable !== null ||
        parsed.retryAfterMs !== null ||
        parsed.pollAfterMs !== null ||
        outputNames.length !== 1 ||
        outputNames[0] !== expectedOutput)) ||
    (parsed.kind === "failed_known" &&
      (parsed.failureCode === null ||
        parsed.retryable === null ||
        parsed.pollAfterMs !== null ||
        outputNames.length !== 0)) ||
    (parsed.kind === "outcome_unknown" &&
      (parsed.failureCode === null ||
        parsed.retryable !== null ||
        parsed.retryAfterMs !== null ||
        outputNames.length !== 0))
  ) {
    throw new Error("Durable provider settlement is inconsistent.");
  }
  const safeResult = parsed;
  if (safeResult.kind === "succeeded") {
    if (!safeResult.providerOperationRef) {
      throw new Error("Durable provider success is missing its reference.");
    }
    const outputs: WorkflowProviderOutputs = {};
    for (const [name, reference] of Object.entries(safeResult.outputs)) {
      outputs[name] = await restoreOutput(input, name, reference, artifacts);
    }
    return {
      kind: "succeeded",
      providerOperationRef: safeResult.providerOperationRef,
      outputs,
      evidence: safeResult.evidence,
      usage: safeResult.usage,
    };
  }
  if (safeResult.kind === "failed_known" && safeResult.failureCode) {
    return {
      kind: "failed_known",
      providerOperationRef: safeResult.providerOperationRef,
      failureCode: safeResult.failureCode,
      retryHint: safeResult.retryable
        ? { retryable: true, retryAfterMs: safeResult.retryAfterMs }
        : { retryable: false, retryAfterMs: null },
      evidence: safeResult.evidence,
      usage: safeResult.usage,
    };
  }
  if (safeResult.kind === "outcome_unknown" && safeResult.failureCode) {
    return {
      kind: "outcome_unknown",
      providerOperationRef: safeResult.providerOperationRef,
      failureCode: safeResult.failureCode,
      pollAfterMs: safeResult.pollAfterMs,
      evidence: safeResult.evidence,
      usage: safeResult.usage,
    };
  }
  throw new Error("Durable provider settlement is inconsistent.");
}

async function settleGeneratedOutputs(
  input: WorkflowStepExecutionInput,
  outcome: Extract<ProviderOutcome<WorkflowProviderOutputs>, { kind: "succeeded" }>,
  artifacts: WorkflowRunArtifactPort,
): Promise<Record<string, DurableOutputReference>> {
  const resolution = providerResolution(input);
  const settled: Record<string, DurableOutputReference> = {};
  for (const [outputName, output] of Object.entries(outcome.outputs).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  )) {
    const contentDigest = `sha256:${createHash("sha256")
      .update(output.bytes)
      .digest("hex")}`;
    const metadata = await artifacts.commitGenerated({
      workspaceId: input.workspaceId,
      creatorPrincipalId: input.snapshot.authorization.principalId,
      effectKey: input.effectKey,
      outputName,
      content:
        output.kind === "text"
          ? {
              kind: "text",
              text: Buffer.from(output.bytes).toString("utf8"),
              mediaType: output.mediaType,
              digest: contentDigest,
              sizeBytes: output.bytes.byteLength,
            }
          : {
              kind: "image",
              bytes: output.bytes,
              mediaType: output.mediaType,
              digest: contentDigest,
              sizeBytes: output.bytes.byteLength,
              width: output.width,
              height: output.height,
            },
      origin: {
        workflowId: input.snapshot.workflowId,
        workflowRevisionId: input.snapshot.workflowRevisionId,
        workflowRevision: input.snapshot.workflowRevision,
        definitionDigest: input.snapshot.definitionDigest,
        runId: input.runId,
        runStartSnapshotDigest: canonicalDigest(input.snapshot),
        stepAttemptId: input.stepAttemptId,
        stepId: input.step.id,
        attempt: input.attempt,
        provider: resolution.provider,
        operationIdentity: input.step.operation.identity,
        providerOperation: resolution.providerOperation,
        providerOperationRef: outcome.providerOperationRef,
        model: resolution.model,
        intentDigest: input.intentDigest,
        providerMetadata: normalizedMetadata(outcome),
      },
      lineageInputs: Object.entries(input.inputs).map(([port, value]) => {
        if (!value.source) throw new Error("Provider input lineage is unavailable.");
        return {
          port,
          kind: value.kind,
          source: value.source,
          contentDigest: value.contentDigest,
          sourceArtifactId: value.artifactId,
        };
      }),
    });
    settled[outputName] = {
      artifactId: metadata.id,
      digest: metadata.digest,
      kind: metadata.kind,
      mediaType: metadata.mediaType,
      sizeBytes: metadata.sizeBytes,
      width: metadata.width,
      height: metadata.height,
    };
  }
  return settled;
}

function unknownRecovery(
  failureCode = "PROVIDER_EFFECT_RECONCILIATION_REQUIRED",
): ProviderOutcome<WorkflowProviderOutputs> {
  return {
    kind: "outcome_unknown",
    providerOperationRef: null,
    failureCode,
    pollAfterMs: null,
    evidence: {
      providerRequestId: null,
      httpStatus: null,
      providerCode: null,
      operatorTraceRef: null,
      effectDisposition: "unknown",
    },
    usage: [],
  };
}

async function recoverFromGeneratedArtifact(
  input: WorkflowStepExecutionInput,
  artifacts: WorkflowRunArtifactPort,
): Promise<{
  outcome: Extract<ProviderOutcome<WorkflowProviderOutputs>, { kind: "succeeded" }>;
  safeResult: DurableGeminiSettlement;
  reconciliationReference: string;
} | null> {
  if (!artifacts.getGeneratedArtifact) return null;
  const outputName =
    input.step.operation.identity === "gemini.generate_text@1"
      ? "text"
      : input.step.operation.identity === "gemini.generate_image@1"
        ? "image"
        : null;
  if (!outputName) return null;
  const found = await artifacts.getGeneratedArtifact({
    workspaceId: input.workspaceId,
    effectKey: input.effectKey,
    outputName,
  });
  if (!found) return null;
  assertGeneratedOrigin(input, outputName, found.artifact);
  const reference: DurableOutputReference = {
    artifactId: found.artifact.id,
    digest: found.artifact.digest,
    kind: found.artifact.kind,
    mediaType: found.artifact.mediaType,
    sizeBytes: found.artifact.sizeBytes,
    width: found.artifact.width,
    height: found.artifact.height,
  };
  const origin = found.artifact.origin;
  if (origin.kind !== "generated" || !origin.providerOperation.metadata) {
    return null;
  }
  const recoveredMetadata = origin.providerOperation.metadata;
  const outputs = {
    [outputName]: await restoreOutput(input, outputName, reference, artifacts),
  };
  const outcome: Extract<
    ProviderOutcome<WorkflowProviderOutputs>,
    { kind: "succeeded" }
  > = {
    kind: "succeeded",
    providerOperationRef: origin.providerOperation.ref,
    outputs,
    evidence: {
      ...recoveredMetadata.evidence,
    },
    usage: recoveredMetadata.usage.map((item) => ({ ...item })),
  };
  const safeResult = durableSettlement(outcome, { [outputName]: reference });
  return {
    outcome,
    safeResult,
    reconciliationReference: `artifact-output-set:${canonicalDigest({
      [outputName]: reference,
    })}`,
  };
}

export function createGeminiInvocationBoundary<I extends
  GeminiTextIntent | GeminiImageIntent>(dependencies: {
    credentialExecutor?: CredentialEffectExecutor;
    artifacts?: WorkflowRunArtifactPort;
  } = {}): WorkflowProviderInvocationBoundary<I> {
  const credentialExecutor =
    dependencies.credentialExecutor ?? CREDENTIAL_EFFECT_EXECUTOR;
  const artifacts = dependencies.artifacts ?? PRODUCTION_ARTIFACT_SERVICE;

  const effectRefFor = (input: WorkflowStepExecutionInput) =>
    `credential-effect:v1:${canonicalDigest({
      workspaceId: input.workspaceId,
      effectKey: input.effectKey,
      stepAttemptId: input.stepAttemptId,
      attempt: input.attempt,
    })}`;
  const securityContextFor = (input: WorkflowStepExecutionInput) => ({
    workspaceId: input.workspaceId,
    principalId: input.snapshot.authorization.principalId,
    keyId: input.snapshot.authorization.keyId,
  });

  const recover = async (
    input: WorkflowStepExecutionInput,
  ): Promise<ProviderOutcome<WorkflowProviderOutputs>> => {
    const securityContext = securityContextFor(input);
    const effectRef = effectRefFor(input);
    const receipt = await credentialExecutor.inspectEffectForRecovery({
      securityContext,
      effectRef,
    });
    if (receipt.kind === "completed") {
      return restoreSettlement(input, receipt.safeResult, artifacts);
    }
    if (receipt.kind === "failed") {
      if (receipt.safeResult) {
        return restoreSettlement(input, receipt.safeResult, artifacts);
      }
      return {
        kind: "failed_known",
        providerOperationRef: null,
        failureCode: receipt.failureCode,
        retryHint: { retryable: false, retryAfterMs: null },
        evidence: {
          providerRequestId: null,
          httpStatus: null,
          providerCode: receipt.failureCode,
          operatorTraceRef: null,
          effectDisposition: "not_created",
        },
        usage: [],
      };
    }
    if (receipt.kind === "pending" || receipt.kind === "unknown") {
      const recovered = await recoverFromGeneratedArtifact(input, artifacts);
      if (!recovered) return unknownRecovery();
      const reconciled = await credentialExecutor.reconcileDurableEffect({
        securityContext,
        effectRef,
        safeResult: recovered.safeResult as unknown as CredentialSafeEffectResult,
        reconciliationReference: recovered.reconciliationReference,
      });
      return reconciled ? recovered.outcome : unknownRecovery();
    }
    return unknownRecovery("PROVIDER_EFFECT_RECEIPT_UNAVAILABLE");
  };

  return {
    async invoke(input, execute) {
      let inspectingExistingEffect = false;
      try {
        const intent = providerIntent(input) as I;
        const credentialReference = input.snapshot.credentialReferences.find(
          (reference) =>
            reference.stepId === input.step.id &&
            reference.requirement === "provider",
        );
        if (!credentialReference) {
          throw new CredentialVaultError(
            "CREDENTIAL_UNAVAILABLE",
            "The snapshotted Credential Slot is unavailable.",
          );
        }
        const securityContext = securityContextFor(input);
        const effectRef = effectRefFor(input);
        inspectingExistingEffect = true;
        const existing = await credentialExecutor.inspectEffectForRecovery({
          securityContext,
          effectRef,
        });
        if (existing.kind !== "absent") return await recover(input);
        inspectingExistingEffect = false;

        const effectIntent = await credentialExecutor.snapshotEffectIntent({
          securityContext,
          binding: {
            nodeId: input.step.id,
            operationIdentity: input.step.operation.identity,
            slotId: credentialReference.slotId,
          },
          workflowStepRef: {
            workflowId: input.snapshot.workflowId,
            workflowRevision: input.snapshot.workflowRevisionId,
            nodeId: input.step.id,
            operationIdentity: input.step.operation.identity,
          },
          // Credential reservations are per semantic Attempt so a provider-
          // proven not-created retry can reserve again. The provider still
          // receives the stable Workflow Effect Key through `execute`.
          effectRef,
          providerIntent: intent,
        });
        let settledOutputs: Record<string, DurableOutputReference> = {};
        const result =
          await credentialExecutor.withCredentialMaterialForEffect<
            ProviderOutcome<WorkflowProviderOutputs>
          >({
            securityContext,
            effectIntent,
            providerIntent: intent,
            invoke: async (credential) => {
              const outcome = await execute({
                intent,
                credentials: { primary: credential },
              });
              if (outcome.kind === "succeeded") {
                settledOutputs = await settleGeneratedOutputs(
                  input,
                  outcome,
                  artifacts,
                );
              }
              return outcome;
            },
            summarize: (outcome) =>
              durableSettlement(
                outcome,
                settledOutputs,
              ) as unknown as CredentialSafeEffectResult,
            disposition: (outcome) =>
              outcome.kind === "outcome_unknown"
                ? {
                    kind: "outcome_unknown" as const,
                    failureCode: outcome.failureCode,
                  }
                : outcome.kind === "failed_known" &&
                    outcome.evidence.effectDisposition === "not_created"
                  ? {
                      kind: "failed_not_started" as const,
                      failureCode: outcome.failureCode,
                    }
                  : { kind: "completed" as const },
          });
        return result.replayed
          ? restoreSettlement(input, result.safeResult, artifacts)
          : result.result;
      } catch (error) {
        return inspectingExistingEffect
          ? safeCredentialRecoveryFailure(error)
          : safeCredentialFailure(error);
      }
    },
    async recover(input: WorkflowStepReconciliationInput) {
      try {
        return await recover(input);
      } catch (error) {
        return safeCredentialRecoveryFailure(error);
      }
    },
  };
}
