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
  it("publishes start@3 with distinct exact Studio Asset authorization", () => {
    const current = registration(
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.startV3.name,
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.startV3.version,
    );
    expect(current.lifecycle.recommended).toBe(true);
    expect(current.authorization.resources).toEqual([
      { kind: "workflow", inputPath: "workflowId" },
      { kind: "artifact", inputPath: "inputArtifactIds" },
      { kind: "studio_asset", inputPath: "inputStudioAssetIds" },
    ]);
    expect(registration(WORKFLOW_RUN_CAPABILITY_IDENTITIES.startV2.name, WORKFLOW_RUN_CAPABILITY_IDENTITIES.startV2.version).lifecycle.recommended).toBe(false);
  });

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
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.startV3,
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.retry,
    ]) {
      expect(registration(identity.name, identity.version).effect)
        .toMatchObject({ maySpendProviderBudget: true });
      expect(registration(identity.name, identity.version).errors).toContainEqual(
        expect.objectContaining({
          code: "QUOTA_EXCEEDED",
          category: "authorization",
          retryable: false,
        }),
      );
    }
  });

  it("discriminates legacy and provider-pinned start snapshots", () => {
    const schema = registration(
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.get.name,
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.get.version,
    ).outputSchema as any;
    const branches = schema.properties.startSnapshot.oneOf;
    expect(branches).toHaveLength(3);
    const legacy = branches.find(
      (branch: any) =>
        branch.properties.schema.const === "workflow-run-start-snapshot/v1",
    );
    const pinned = branches.find(
      (branch: any) =>
        branch.properties.schema.const === "workflow-run-start-snapshot/v2",
    );
    const studioPinned = branches.find(
      (branch: any) =>
        branch.properties.schema.const === "workflow-run-start-snapshot/v3",
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
        "usageCeilings",
      ]),
    );
    expect(studioPinned.required).toEqual(expect.arrayContaining(["providerResolutions", "studioAssetReferences"]));
    expect(studioPinned.properties.studioAssetReferences.items.required).toEqual(["assetId", "digest", "type", "mediaType", "sizeBytes", "width", "height", "durationSeconds"]);
    expect(
      pinned.properties.providerResolutions.items.properties.usageCeilings.items.required,
    ).toEqual(["dimension", "unit", "maximumQuantity"]);
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

  it("publishes a strict event discriminator with no arbitrary data branch", () => {
    const schema = registration(
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.events.name,
      WORKFLOW_RUN_CAPABILITY_IDENTITIES.events.version,
    ).outputSchema as any;
    const event = schema.properties.items.items;
    expect(event.oneOf).toHaveLength(15);
    for (const branch of event.oneOf) {
      expect(branch.additionalProperties).toBe(false);
      expect(branch.properties.type.const).toEqual(expect.any(String));
      expect(branch.properties.data.additionalProperties).toBe(false);
      expect(branch.properties.data).not.toHaveProperty("patternProperties");
    }
    const accepted = event.oneOf.find(
      (branch: any) => branch.properties.type.const === "run.accepted",
    );
    expect(accepted.properties.data.properties.startSnapshotDigest).toEqual({
      type: "string",
      pattern: "^sha256:[a-f0-9]{64}$",
    });
  });
});
