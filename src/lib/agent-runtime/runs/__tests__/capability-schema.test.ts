import { describe, expect, it } from "vitest";
import {
  createWorkflowRunRegistrations,
  WORKFLOW_RUN_CAPABILITY_IDENTITIES,
} from "../capabilities";
import type { WorkflowRunService } from "../service";

function registration(name: string, version: number) {
  return createWorkflowRunRegistrations({} as WorkflowRunService).find(
    (candidate) =>
      candidate.identity.name === name && candidate.identity.version === version,
  )!;
}

describe("Workflow Run public schemas", () => {
  it("publishes a strict non-binding preview with immutable FX evidence", () => {
    const preview = registration(
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.preview.name,
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.preview.version,
    );
    expect(preview.effect).toEqual({
      mutation: "none",
      visibility: "private",
      timing: "immediate",
      reversibility: "reversible",
      maySpendProviderBudget: false,
    });
    expect(preview.idempotency).toEqual({ mode: "retry-safe" });
    expect(preview.authorization.resources).toEqual([
      { kind: "workflow", inputPath: "workflowId" },
      { kind: "artifact", inputPath: "inputArtifactIds" },
    ]);
    const schema = preview.outputSchema as any;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.ceiling.required).toContain("fxSnapshotIds");
    expect(schema.properties.ceiling.properties.fxSnapshotIds).toMatchObject({
      type: "array",
      uniqueItems: true,
    });
    const policyRevision =
      schema.properties.applicablePolicies.items.properties.revision;
    expect(policyRevision.additionalProperties).toBe(false);
    expect(policyRevision.properties).not.toHaveProperty("createdByUserId");
    for (const identity of [
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.start,
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.startV2,
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.retry,
    ]) {
      expect(registration(identity.name, identity.version).effect)
        .toMatchObject({ maySpendProviderBudget: true });
    }
  });

  it("discriminates legacy and provider-pinned start snapshots", () => {
    const schema = registration(
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.get.name,
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.get.version,
    ).outputSchema as any;
    const branches = schema.properties.startSnapshot.oneOf;
    expect(branches).toHaveLength(2);
    const legacy = branches.find(
      (branch: any) =>
        branch.properties.schema.const === "workflow-run-start-snapshot/v1",
    );
    const pinned = branches.find(
      (branch: any) =>
        branch.properties.schema.const === "workflow-run-start-snapshot/v2",
    );
    expect(legacy.properties).not.toHaveProperty("providerResolutions");
    expect(legacy.additionalProperties).toBe(false);
    expect(pinned.required).toContain("providerResolutions");
    expect(pinned.properties.providerResolutions.minItems).toBe(1);
    expect(pinned.properties.providerResolutions.items.required).toEqual(
      expect.arrayContaining([
        "stepId",
        "adapterModule",
        "adapterContractDigest",
        "provider",
        "providerOperation",
        "model",
        "effectKeySupport",
        "observation",
        "launchSafety",
      ]),
    );
  });

  it("publishes exact normalized provider metadata", () => {
    const schema = registration(
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.stepAttempts.name,
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.stepAttempts.version,
    ).outputSchema as any;
    const metadata = schema.properties.items.items.properties.providerMetadata;
    const exact = metadata.oneOf.find((branch: any) => branch.type === "object");
    expect(exact.additionalProperties).toBe(false);
    expect(exact.required).toEqual([
      "evidence",
      "usage",
      "retryAfterMs",
      "pollAfterMs",
    ]);
    expect(exact.properties.evidence.additionalProperties).toBe(false);
    const usage = exact.properties.usage.items.oneOf;
    expect(usage[0].properties.source.enum).toEqual([
      "reported",
      "measured",
      "estimated",
    ]);
    expect(usage[0].properties.quantity.type).toBe("string");
    expect(usage[1].properties.source.const).toBe("unknown");
    expect(usage[1].properties.quantity.type).toBe("null");
  });
});
