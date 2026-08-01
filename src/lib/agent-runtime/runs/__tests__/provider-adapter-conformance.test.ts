import { describe, expect, it } from "vitest";
import {
  ScriptedProviderAdapter,
  type ScriptedProviderIntent,
  type ScriptedProviderOutput,
} from "@/lib/provider-adapters/conformance/scripted";
import { PROVIDER_ADAPTER_MANIFEST } from "@/lib/provider-adapters/manifest";
import { WorkflowRunExecutorRegistry } from "../executors";
import {
  createWorkflowStepExecutorFromProviderAdapter,
  type ProviderAdapter,
  type WorkflowProviderOutputs,
} from "../provider-adapter";
import {
  DeterministicProviderFaultKit,
  providerResponse,
} from "../testing/provider-adapter-fault-kit";
import {
  describeProviderAdapterConformance,
  type ProviderAdapterConformanceSubject,
} from "../testing/provider-adapter-conformance";
import type { WorkflowStepExecutor } from "../types";

const PROVIDER_REF = "provider:conformance:effect_1";

const scriptedSubject = {
  module: "conformance/scripted",
  name: "scripted deterministic",
  createAdapter: (transport) => new ScriptedProviderAdapter(transport),
  request: {
    effectKey: "effect_conformance_1",
    intentDigest:
      "sha256:bb8fc62581e0d9d4f0d570f45a3f81a47a0f1cb9dcf76035fb7a413d0c0a0b31",
    intent: { prompt: "Create deterministic copy." },
    credentials: {
      primary: {
        profileId: "credential_profile_conformance",
        version: 1,
        secret: "conformance-secret-canary-never-expose",
      },
    },
  },
  providerOperationRef: PROVIDER_REF,
  fixtures: {
    success: {
      state: "succeeded",
      providerOperationRef: PROVIDER_REF,
      text: "Deterministic provider output.",
    },
    knownTerminalFailure: {
      state: "failed",
      providerOperationRef: PROVIDER_REF,
      failureCode: "PROVIDER_REJECTED_REQUEST",
      retryable: false,
      retryAfterMs: null,
      effectDisposition: "terminal_failed",
    },
    knownRetryableFailure: {
      state: "failed",
      providerOperationRef: null,
      failureCode: "PROVIDER_RATE_LIMITED",
      retryable: true,
      retryAfterMs: 1_000,
      effectDisposition: "not_created",
    },
    pending: {
      state: "pending",
      providerOperationRef: PROVIDER_REF,
      pollAfterMs: 500,
    },
    malformed: {
      providerOperationRef: PROVIDER_REF,
      state: "unexpected-provider-state",
    },
    successWithUsage: {
      state: "succeeded",
      providerOperationRef: PROVIDER_REF,
      text: "Usage-bearing provider output.",
      usage: {
        "provider.tokens.input@1": "12",
        "provider.tokens.output@1": "7",
      },
    },
    secretBearingMalformed: (secret) => ({
      state: "malformed",
      rawBody: `credential=${secret}`,
      headers: { authorization: `Bearer ${secret}` },
      url: `https://provider.invalid/task?token=${secret}`,
    }),
    successWithSecretOutput: (secret) => ({
      state: "succeeded",
      providerOperationRef: PROVIDER_REF,
      text: secret,
    }),
  },
  assertSuccess: (outcome) => {
    expect(outcome.providerOperationRef).toBe(PROVIDER_REF);
    expect(Buffer.from(outcome.outputs.text.bytes).toString("utf8")).toBe(
      "Deterministic provider output.",
    );
  },
} satisfies ProviderAdapterConformanceSubject<
  ScriptedProviderIntent,
  ScriptedProviderOutput
> & { module: (typeof PROVIDER_ADAPTER_MANIFEST)[number]["module"] };

const conformanceSubjects = [scriptedSubject] as const;

describe("Provider Adapter conformance catalog", () => {
  it("runs the reusable suite for every manifested adapter", () => {
    const modules = conformanceSubjects.map((subject) => subject.module);
    expect(new Set(modules).size).toBe(modules.length);
    expect(modules).toEqual(
      PROVIDER_ADAPTER_MANIFEST.map((entry) => entry.module),
    );
  });
});

for (const subject of conformanceSubjects) {
  describeProviderAdapterConformance(subject);
}

describe("Provider Adapter runtime bridge", () => {
  it("resolves credentials at invocation time and preserves normalized metadata", async () => {
    const transport = new DeterministicProviderFaultKit();
    transport.enqueueLaunch({
      kind: "response",
      effectDisposition: "accepted",
      providerOperationRef: PROVIDER_REF,
      response: providerResponse({
        state: "succeeded",
        providerOperationRef: PROVIDER_REF,
        text: "Bridged provider output.",
        usage: {
          "provider.tokens.input@1": "4",
          "provider.tokens.output@1": "3",
        },
      }),
    });
    const executor = createWorkflowStepExecutorFromProviderAdapter(
      new ScriptedProviderAdapter(transport) as ProviderAdapter<
        { prompt: string },
        WorkflowProviderOutputs
      >,
      async () => ({
        intent: { prompt: "Resolve only at the effect boundary." },
        credentials: {
          primary: {
            profileId: "credential_profile_bridge",
            version: 3,
            secret: "bridge-secret-canary",
          },
        },
      }),
    );
    const result = await executor.execute({
      effectKey: "effect_bridge_1",
      intentDigest:
        "sha256:ea006c0b50d1d9b395d499424c277731179465fab8e84558e54e2874294e6465",
    } as Parameters<WorkflowStepExecutor["execute"]>[0]);
    expect(result).toMatchObject({
      kind: "generated",
      providerMetadata: {
        evidence: { effectDisposition: "accepted" },
        usage: expect.arrayContaining([
          {
            dimension: "provider.tokens.output@1",
            unit: "count",
            source: "reported",
            quantity: "3",
          },
        ]),
      },
    });
    expect(transport.launchCalls[0]?.credentials.primary).toMatchObject({
      profileId: "credential_profile_bridge",
      version: 3,
      secret: "bridge-secret-canary",
    });
  });

  it("does not substitute an Effect Key for a missing provider operation reference", async () => {
    const transport = new DeterministicProviderFaultKit();
    const executor = createWorkflowStepExecutorFromProviderAdapter(
      new ScriptedProviderAdapter(transport) as ProviderAdapter<
        { prompt: string },
        WorkflowProviderOutputs
      >,
      () => ({ intent: { prompt: "Never reached." }, credentials: {} }),
    );
    const result = await executor.reconcile!({
      effectKey: "effect_bridge_ambiguous",
      intentDigest:
        "sha256:e4f3ce36d78274bce570057224d008938c9f39dc25f9947a6da316dd34e96e3e",
      providerOperationRef: null,
    } as Parameters<NonNullable<WorkflowStepExecutor["reconcile"]>>[0]);
    expect(result).toEqual({
      kind: "outcome_unknown",
      failureCode: "PROVIDER_OPERATION_REFERENCE_UNAVAILABLE",
      providerOperationRef: null,
    });
    expect(transport.observationCalls).toHaveLength(0);
  });

  it("rejects registration when the provider has no proven Effect Key support", () => {
    const transport = new DeterministicProviderFaultKit();
    const base = new ScriptedProviderAdapter(transport);
    const unsupported = {
      ...base,
      contract: { ...base.contract, effectKeySupport: "unsupported" as const },
      execute: base.execute.bind(base),
      observe: base.observe.bind(base),
    } as ProviderAdapter<{ prompt: string }, WorkflowProviderOutputs>;
    expect(() =>
      new WorkflowRunExecutorRegistry().registerProviderAdapter(
        scriptedSubject.module,
        unsupported.contract.identity.workflowOperationIdentity,
        unsupported.contract.identity.workflowOperationContractDigest,
        unsupported,
        () => ({ intent: { prompt: "Never launched." }, credentials: {} }),
      ),
    ).toThrow("Provider Adapter must support the runtime Effect Key");
  });
});
