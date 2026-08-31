import { describe, expect, it } from "vitest";
import { GOLDEN_WORKFLOW_OPERATION_REGISTRY } from "../../workflows";
import { GeminiTextAdapter } from "@/lib/provider-adapters/gemini/generate-content";
import { WorkflowRunExecutorRegistry } from "../executors";
import { createWorkflowStepExecutorFromProviderAdapter } from "../provider-adapter";

describe("Workflow Step admission exposure", () => {
  it("publishes exact zero ceilings for deterministic local and conformance executors", () => {
    const registry = WorkflowRunExecutorRegistry.createDeterministic(
      GOLDEN_WORKFLOW_OPERATION_REGISTRY,
    );
    const digest = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
      "runtime.digest_text@1",
    )!;
    const text = GOLDEN_WORKFLOW_OPERATION_REGISTRY.get(
      "gemini.generate_text@1",
    )!;

    expect(
      registry.get(digest.identity, digest.contractDigest)?.admissionExposure?.(),
    ).toMatchObject({
      certainty: "exact",
      serviceTier: "local",
      perAttemptCeiling: "0",
      currency: "USD",
    });
    expect(
      registry.get(text.identity, text.contractDigest)?.admissionExposure?.(),
    ).toMatchObject({
      certainty: "exact",
      serviceTier: "test",
      perAttemptCeiling: "0",
      currency: "USD",
    });
  });

  it("publishes explicit unknown exposure for the unbounded Gemini adapter contract", () => {
    const adapter = new GeminiTextAdapter();
    const executor = createWorkflowStepExecutorFromProviderAdapter(
      "gemini/generate-content",
      adapter,
      async () => {
        throw new Error("Admission exposure must not resolve credentials.");
      },
    );

    expect(executor.admissionExposure?.()).toMatchObject({
      provider: "gemini",
      providerOperation:
        "generativelanguage.v1beta.models.generateContent",
      model: "gemini-2.5-flash",
      serviceTier: "standard",
      certainty: "unknown",
      reason: "provider_contract_has_unbounded_billable_usage",
      perAttemptCeiling: null,
      currency: null,
      pricingSnapshotIds: [],
    });
  });
});
