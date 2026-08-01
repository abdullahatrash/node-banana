import { describe, expect, it } from "vitest";
import { InMemoryObservabilityRepository } from "../memory";
import { ObservabilityService } from "../service";
import { createObservabilityRegistrations, OBSERVABILITY_CAPABILITY_IDENTITIES } from "../capabilities";
import type { SupportBundleApplication } from "../support-bundles";
import type { ObservabilityCursorCodec } from "../types";

const codec: ObservabilityCursorCodec = {
  encode: async (value) => JSON.stringify(value),
  decode: async (value) => JSON.parse(value),
};

function registrations() {
  return createObservabilityRegistrations(
    new ObservabilityService(new InMemoryObservabilityRepository(), codec),
    {} as SupportBundleApplication,
  );
}

function schema(name: string) {
  return registrations().find((item) => item.identity.name === name)!.outputSchema as any;
}

describe("observability public capability schemas", () => {
  it("publishes fixed metric dimensions with no arbitrary value branch", () => {
    const metric = schema(OBSERVABILITY_CAPABILITY_IDENTITIES.metricsList.name)
      .properties.items.items;
    const dimensions = metric.properties.dimensions.items.oneOf;
    expect(dimensions).toHaveLength(7);
    for (const branch of dimensions) {
      expect(branch.additionalProperties).toBe(false);
      expect(branch.properties.key.const).toEqual(expect.any(String));
      expect(branch.properties.value.enum.length).toBeGreaterThan(0);
    }
    expect(metric.properties).not.toHaveProperty("workspaceId");
    expect(metric.properties).not.toHaveProperty("id");
    expect(metric.properties).not.toHaveProperty("expiresAt");
  });

  it("never accepts or returns operator identity fields", () => {
    const issue = registrations().find(
      (item) => item.identity.name === OBSERVABILITY_CAPABILITY_IDENTITIES.operatorGrantIssue.name,
    )!;
    expect(issue.input.safeParse({
      operatorId: "other_user",
      scopes: ["trace.read"],
      expiresAt: "2026-08-02T00:00:00.000Z",
    }).success).toBe(false);
    expect(issue.outputSchema).not.toHaveProperty("operatorId");
    expect((issue.outputSchema as any).properties).not.toHaveProperty("operatorId");
    expect((issue.outputSchema as any).properties).not.toHaveProperty("issuedByUserId");
  });

  it("accepts only exact resource/projection pairs and explicit consent", () => {
    const create = registrations().find(
      (item) => item.identity.name === OBSERVABILITY_CAPABILITY_IDENTITIES.supportBundleCreate.name,
    )!;
    const valid = {
      selections: [{ resourceKind: "artifact", resourceId: "artifact_1", projectionKind: "artifact_metadata" }],
      purpose: "support_case",
      consentExpiresAt: "2026-08-02T00:00:00.000Z",
      consentConfirmed: true,
    };
    expect(create.input.safeParse(valid).success).toBe(true);
    expect(create.input.safeParse({
      ...valid,
      selections: [{ ...valid.selections[0], projectionKind: "run_summary" }],
    }).success).toBe(false);
    expect(create.input.safeParse({ ...valid, contentDigest: `sha256:${"a".repeat(64)}` }).success).toBe(false);
    expect(create.input.safeParse({ ...valid, consentConfirmed: false }).success).toBe(false);
    expect(create.idempotency).toEqual({ mode: "key-required" });
  });

  it("bounds all public collections", () => {
    const audit = registrations().find(
      (item) => item.identity.name === OBSERVABILITY_CAPABILITY_IDENTITIES.supportBundleAuditList.name,
    )!;
    expect(audit.input.safeParse({ bundleId: "bundle_1", operatorGrantId: "grant_1", limit: 101 }).success).toBe(false);
    expect((audit.outputSchema as any).properties.items).toMatchObject({ type: "array" });
    const grants = schema(OBSERVABILITY_CAPABILITY_IDENTITIES.operatorGrantsList.name);
    expect(grants.properties.items.maxItems).toBe(100);
  });
});
