import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  GEMINI_IMAGE_CONTRACT,
  GEMINI_TEXT_CONTRACT,
  GeminiImageAdapter,
  GeminiTextAdapter,
} from "@/lib/provider-adapters/gemini/generate-content";
import { PROVIDER_ADAPTER_MANIFEST } from "@/lib/provider-adapters/manifest";
import {
  canonicalProviderAdapterContractDigest,
  canonicalProviderSchemaDigest,
  executeProviderEffect,
  parseProviderOutcome,
  projectProviderUsageCeilings,
} from "../provider-adapter";
import { DeterministicProviderFaultKit } from "../testing/provider-adapter-fault-kit";
import { WorkflowRunExecutorRegistry } from "../executors";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "../../workflows";

const DIGEST =
  "sha256:bb8fc62581e0d9d4f0d570f45a3f81a47a0f1cb9dcf76035fb7a413d0c0a0b31";
const credentials = {
  primary: {
    profileId: "credential_profile_gemini",
    version: 4,
    secret: "gemini-secret-canary-never-persist",
  },
};

function png(width = 1024, height = 1024): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("Gemini BYOK Provider Adapters", () => {
  it("matches both reviewed exact identities in the manifest", () => {
    for (const contract of [GEMINI_TEXT_CONTRACT, GEMINI_IMAGE_CONTRACT]) {
      expect(PROVIDER_ADAPTER_MANIFEST).toContainEqual(
        expect.objectContaining({
          module: "gemini/generate-content",
          workflowOperationIdentity:
            contract.identity.workflowOperationIdentity,
          workflowOperationContractDigest:
            contract.identity.workflowOperationContractDigest,
          provider: "gemini",
          operation: contract.identity.operation,
          model: contract.identity.model,
        }),
      );
      expect(contract.effectKeySupport).toBe("unsupported");
      expect(contract.launchSafety).toEqual({
        mode: "durable_at_most_once",
        guard: "workflow-step-attempt/v1",
        replay: "never_launch",
      });
    }
  });

  it("fingerprints the canonical input/output schemas used at runtime", () => {
    for (const contract of [GEMINI_TEXT_CONTRACT, GEMINI_IMAGE_CONTRACT]) {
      expect(contract.inputSchemaDigest).toBe(
        canonicalProviderSchemaDigest(
          z.toJSONSchema(contract.inputSchema, { unrepresentable: "any" }),
        ),
      );
      expect(contract.outputSchemaDigest).toBe(
        canonicalProviderSchemaDigest(
          z.toJSONSchema(contract.outputSchema, { unrepresentable: "any" }),
        ),
      );
    }
    expect(
      GEMINI_IMAGE_CONTRACT.inputSchema.safeParse({
        prompt: "Reference",
        aspectRatio: "1:1",
        referenceImage: { bytes: png(), mediaType: "image/jpeg" },
      }).success,
    ).toBe(true);
    expect(
      GEMINI_IMAGE_CONTRACT.outputSchema.safeParse({
        image: {
          kind: "image",
          mediaType: "image/jpeg",
          bytes: png(),
          width: 1,
          height: 1,
        },
      }).success,
    ).toBe(false);
    for (const bytes of [
      new Int8Array(4),
      new Uint8ClampedArray(4),
      new Uint16Array(4),
      new DataView(new ArrayBuffer(4)),
      { [Symbol.toStringTag]: "Uint8Array" },
    ]) {
      expect(
        GEMINI_IMAGE_CONTRACT.inputSchema.safeParse({
          prompt: "Reference",
          aspectRatio: "1:1",
          referenceImage: { bytes, mediaType: "image/png" },
        }).success,
      ).toBe(false);
    }
    const altered = {
      ...GEMINI_IMAGE_CONTRACT,
      outputSchemaDigest: `sha256:${"0".repeat(64)}`,
    };
    expect(canonicalProviderAdapterContractDigest(altered)).not.toBe(
      canonicalProviderAdapterContractDigest(GEMINI_IMAGE_CONTRACT),
    );
  });

  it("pins explicit fail-closed usage ceilings in the reviewed contract digest", () => {
    const ceilings = projectProviderUsageCeilings(GEMINI_TEXT_CONTRACT);
    expect(ceilings).toEqual([
      {
        dimension: "gemini.tokens.input@1",
        unit: "count",
        maximumQuantity: null,
      },
      {
        dimension: "gemini.tokens.output@1",
        unit: "count",
        maximumQuantity: null,
      },
    ]);
    expect(Object.isFrozen(ceilings)).toBe(true);
    expect(ceilings.every(Object.isFrozen)).toBe(true);

    const bounded = {
      ...GEMINI_TEXT_CONTRACT,
      usageDimensions: GEMINI_TEXT_CONTRACT.usageDimensions.map((dimension) => ({
        ...dimension,
        maximumQuantity:
          dimension.dimension === "gemini.tokens.output@1" ? "8192" : null,
      })),
    };
    expect(canonicalProviderAdapterContractDigest(bounded)).not.toBe(
      canonicalProviderAdapterContractDigest(GEMINI_TEXT_CONTRACT),
    );
  });

  it("resolves and reopens only the exact snapshotted production adapter", () => {
    const boundary = {
      invoke: async () => {
        throw new Error("not invoked during admission");
      },
    };
    const registry = WorkflowRunExecutorRegistry.createProduction(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
      { text: boundary, image: boundary },
    );
    const operation = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
      "gemini.generate_text@1",
    )!;
    const executor = registry.resolve(
      operation.identity,
      operation.contractDigest,
      { model: "gemini-2.5-flash" },
    )!;
    expect(executor.providerResolution).toMatchObject({
      provider: "gemini",
      providerOperation:
        "generativelanguage.v1beta.models.generateContent",
      model: "gemini-2.5-flash",
      effectKeySupport: "unsupported",
      launchSafety: { replay: "never_launch" },
    });
    expect(
      registry.resolve(operation.identity, operation.contractDigest, {
        model: "gemini-latest",
      }),
    ).toBeUndefined();
    expect(
      registry.getPinned(operation.identity, operation.contractDigest, {
        ...executor.providerResolution!,
        model: "gemini-latest",
      }),
    ).toBeUndefined();
  });
  it("normalizes exact-model text success and reported usage", async () => {
    const transport = new DeterministicProviderFaultKit();
    transport.enqueueLaunch({
      kind: "response",
      effectDisposition: "accepted",
      providerOperationRef: "gemini-response-text-1",
      response: {
        status: 200,
        requestId: "gemini-response-text-1",
        body: {
          responseId: "gemini-response-text-1",
          modelVersion: "gemini-2.5-flash",
          text: "Node Banana is live — turn a brief into a visual workflow.",
          usage: { input: 21, output: 14 },
        },
      },
    });
    const outcome = await executeProviderEffect(
      new GeminiTextAdapter(transport),
      {
        effectKey: "workflow-effect:v1:workspace:run:draft_copy:1",
        intentDigest: DIGEST,
        intent: {
          prompt: "Announce Node Banana.",
          instruction: "Write concise LinkedIn launch copy.",
        },
        credentials,
      },
    );
    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") return;
    expect(Buffer.from(outcome.outputs.text.bytes).toString("utf8")).toContain(
      "Node Banana",
    );
    expect(outcome.usage).toContainEqual({
      dimension: "gemini.tokens.input@1",
      unit: "count",
      source: "reported",
      quantity: "21",
    });
    expect(JSON.stringify(outcome)).not.toContain(credentials.primary.secret);
  });

  it("converts provider cost references into opaque evidence IDs at the boundary", () => {
    const outcome = parseProviderOutcome(GEMINI_TEXT_CONTRACT, {
      kind: "succeeded",
      providerOperationRef: "gemini-response-cost-1",
      outputs: {
        text: {
          kind: "text",
          mediaType: "text/plain; charset=utf-8",
          bytes: new TextEncoder().encode("ok"),
        },
      },
      evidence: {
        providerRequestId: "request_cost_1",
        httpStatus: 200,
        providerCode: null,
        operatorTraceRef: null,
        effectDisposition: "accepted",
      },
      usage: [{
        dimension: "gemini.tokens.input@1",
        unit: "count",
        source: "reported",
        quantity: "1",
      }],
      reportedCost: {
        amount: "0.01",
        currency: "USD",
        evidenceRef: "https://provider.invalid/invoice?token=secret",
      },
    });
    expect(outcome.reportedCost?.evidenceRef).toMatch(/^evidence:sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(outcome)).not.toContain("provider.invalid");
    expect(JSON.stringify(outcome)).not.toContain("secret");
  });

  it("normalizes an inline PNG image without leaking input bytes", async () => {
    const transport = new DeterministicProviderFaultKit();
    const generated = png(512, 512);
    transport.enqueueLaunch({
      kind: "response",
      effectDisposition: "accepted",
      providerOperationRef: "gemini-response-image-1",
      response: {
        status: 200,
        requestId: "gemini-response-image-1",
        body: {
          responseId: "gemini-response-image-1",
          modelVersion: "gemini-2.5-flash-image",
          image: {
            data: Buffer.from(generated).toString("base64"),
            mediaType: "image/png",
          },
          usage: { input: 50, output: 10 },
        },
      },
    });
    const outcome = await executeProviderEffect(
      new GeminiImageAdapter(transport),
      {
        effectKey: "workflow-effect:v1:workspace:run:generate_hero:1",
        intentDigest: DIGEST,
        intent: {
          prompt: "Create a square launch hero.",
          aspectRatio: "1:1",
          referenceImage: { bytes: png(), mediaType: "image/png" },
        },
        credentials,
      },
    );
    expect(outcome).toMatchObject({
      kind: "succeeded",
      outputs: { image: { kind: "image", width: 512, height: 512 } },
    });
  });

  it("classifies revoked/rejected credentials as known and not created", async () => {
    const transport = new DeterministicProviderFaultKit();
    transport.enqueueLaunch({
      kind: "response",
      effectDisposition: "not_created",
      providerOperationRef: null,
      response: {
        status: 401,
        requestId: null,
        body: { errorCode: "HTTP_401" },
      },
    });
    const outcome = await executeProviderEffect(
      new GeminiTextAdapter(transport),
      {
        effectKey: "workflow-effect:v1:workspace:run:draft_copy:1",
        intentDigest: DIGEST,
        intent: { prompt: "Launch", instruction: "Write copy" },
        credentials,
      },
    );
    expect(outcome).toMatchObject({
      kind: "failed_known",
      failureCode: "PROVIDER_CREDENTIAL_REJECTED",
      evidence: { effectDisposition: "not_created" },
    });
  });

  it.each([
    { status: 400, errorCode: "API_KEY_INVALID" },
    { status: 403, errorCode: "PERMISSION_DENIED" },
  ])("classifies $errorCode as a rejected credential", async ({ status, errorCode }) => {
    const transport = new DeterministicProviderFaultKit();
    transport.enqueueLaunch({
      kind: "response",
      effectDisposition: "not_created",
      providerOperationRef: null,
      response: { status, requestId: null, body: { errorCode } },
    });
    await expect(
      executeProviderEffect(new GeminiTextAdapter(transport), {
        effectKey: "workflow-effect:v1:workspace:run:draft_copy:1",
        intentDigest: DIGEST,
        intent: { prompt: "Launch", instruction: "Write copy" },
        credentials,
      }),
    ).resolves.toMatchObject({
      kind: "failed_known",
      failureCode: "PROVIDER_CREDENTIAL_REJECTED",
      evidence: { providerCode: errorCode, effectDisposition: "not_created" },
    });
  });

  it.each(["SPII", "IMAGE_PROHIBITED_CONTENT", "NO_IMAGE"])(
    "retains terminal finish reason %s as safe evidence",
    async (finishReason) => {
      const transport = new DeterministicProviderFaultKit();
      transport.enqueueLaunch({
        kind: "response",
        effectDisposition: "terminal_failed",
        providerOperationRef: "gemini-terminal-1",
        response: {
          status: 200,
          requestId: "gemini-terminal-1",
          body: {
            responseId: "gemini-terminal-1",
            modelVersion: "gemini-2.5-flash",
            blocked: true,
            finishReason,
          },
        },
      });
      await expect(
        executeProviderEffect(new GeminiTextAdapter(transport), {
          effectKey: "workflow-effect:v1:workspace:run:draft_copy:1",
          intentDigest: DIGEST,
          intent: { prompt: "Launch", instruction: "Write copy" },
          credentials,
        }),
      ).resolves.toMatchObject({
        kind: "failed_known",
        failureCode: "PROVIDER_SAFETY_REJECTION",
        evidence: {
          providerCode: `FINISH_REASON_${finishReason}`,
          effectDisposition: "terminal_failed",
        },
      });
    },
  );

  it("maps unrecognized provider codes and finish reasons to fixed evidence", async () => {
    const providerCodeTransport = new DeterministicProviderFaultKit();
    providerCodeTransport.enqueueLaunch({
      kind: "response",
      effectDisposition: "not_created",
      providerOperationRef: null,
      response: {
        status: 400,
        requestId: null,
        body: { errorCode: "API_KEY_CANARY_FROM_PROVIDER_BODY" },
      },
    });
    await expect(
      executeProviderEffect(new GeminiTextAdapter(providerCodeTransport), {
        effectKey: "workflow-effect:v1:workspace:run:draft_copy:1",
        intentDigest: DIGEST,
        intent: { prompt: "Launch", instruction: "Write copy" },
        credentials,
      }),
    ).resolves.toMatchObject({
      evidence: { providerCode: "PROVIDER_ERROR" },
    });

    const finishReasonTransport = new DeterministicProviderFaultKit();
    finishReasonTransport.enqueueLaunch({
      kind: "response",
      effectDisposition: "terminal_failed",
      providerOperationRef: "gemini-terminal-unknown",
      response: {
        status: 200,
        requestId: "gemini-terminal-unknown",
        body: { finishReason: "PROMPT_CANARY_FROM_PROVIDER_BODY" },
      },
    });
    await expect(
      executeProviderEffect(new GeminiTextAdapter(finishReasonTransport), {
        effectKey: "workflow-effect:v1:workspace:run:draft_copy:1",
        intentDigest: DIGEST,
        intent: { prompt: "Launch", instruction: "Write copy" },
        credentials,
      }),
    ).resolves.toMatchObject({
      evidence: { providerCode: "FINISH_REASON_UNKNOWN" },
    });
  });

  it.each([
    "STOP",
    "MAX_TOKENS",
    "LANGUAGE",
    "OTHER",
    "MALFORMED_FUNCTION_CALL",
    "UNEXPECTED_TOOL_CALL",
  ])("classifies terminal no-output reason %s without inventing success", async (finishReason) => {
    const transport = new DeterministicProviderFaultKit();
    transport.enqueueLaunch({
      kind: "response",
      effectDisposition: "terminal_failed",
      providerOperationRef: "gemini-terminal-empty-1",
      response: {
        status: 200,
        requestId: "gemini-terminal-empty-1",
        body: {
          responseId: "gemini-terminal-empty-1",
          modelVersion: "gemini-2.5-flash",
          finishReason,
        },
      },
    });
    await expect(
      executeProviderEffect(new GeminiTextAdapter(transport), {
        effectKey: "workflow-effect:v1:workspace:run:draft_copy:1",
        intentDigest: DIGEST,
        intent: { prompt: "Launch", instruction: "Write copy" },
        credentials,
      }),
    ).resolves.toMatchObject({
      kind: "failed_known",
      failureCode: "PROVIDER_GENERATION_TERMINATED",
      evidence: {
        providerCode: `FINISH_REASON_${finishReason}`,
        effectDisposition: "terminal_failed",
      },
    });
  });

  it("distinguishes a pre-contact timeout from an ambiguous disconnect", async () => {
    const before = new DeterministicProviderFaultKit();
    before.enqueueLaunch({
      kind: "timeout",
      effectDisposition: "not_created",
      providerOperationRef: null,
    });
    const after = new DeterministicProviderFaultKit();
    after.enqueueLaunch({
      kind: "disconnect",
      effectDisposition: "accepted",
      providerOperationRef: "gemini-response-ambiguous-1",
    });
    const request = {
      effectKey: "workflow-effect:v1:workspace:run:draft_copy:1",
      intentDigest: DIGEST,
      intent: { prompt: "Launch", instruction: "Write copy" },
      credentials,
    };
    await expect(
      executeProviderEffect(new GeminiTextAdapter(before), request),
    ).resolves.toMatchObject({
      kind: "failed_known",
      evidence: { effectDisposition: "not_created" },
    });
    await expect(
      executeProviderEffect(new GeminiTextAdapter(after), request),
    ).resolves.toMatchObject({
      kind: "outcome_unknown",
      providerOperationRef: "gemini-response-ambiguous-1",
      evidence: { effectDisposition: "accepted" },
    });
  });

  it("treats malformed success or model drift as ambiguous", async () => {
    const transport = new DeterministicProviderFaultKit();
    transport.enqueueLaunch({
      kind: "response",
      effectDisposition: "accepted",
      providerOperationRef: "gemini-response-drift-1",
      response: {
        status: 200,
        requestId: "gemini-response-drift-1",
        body: {
          responseId: "gemini-response-drift-1",
          modelVersion: "gemini-latest",
          text: "Unpinned response",
        },
      },
    });
    await expect(
      executeProviderEffect(new GeminiTextAdapter(transport), {
        effectKey: "workflow-effect:v1:workspace:run:draft_copy:1",
        intentDigest: DIGEST,
        intent: { prompt: "Launch", instruction: "Write copy" },
        credentials,
      }),
    ).resolves.toMatchObject({
      kind: "outcome_unknown",
      failureCode: "PROVIDER_RESPONSE_AMBIGUOUS",
    });
  });
});
