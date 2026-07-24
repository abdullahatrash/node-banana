import { z } from "zod";
import {
  CAPABILITY_DISPATCHER,
  CAPABILITY_GET_IDENTITY,
  CAPABILITY_LIST_IDENTITY,
  CAPABILITY_REGISTRY,
  COMMON_DISCOVERY_ERRORS,
  canonicalDigest,
  contractDigestFor,
  createCapabilityRegistry,
  dispatchCapability,
  formatCapabilityIdentity,
  listMcpCapabilityTools,
  type CapabilityDefinition,
  type CapabilityRegistration,
} from "@/lib/agent-tools";

function contractWithoutPublication(
  definition: CapabilityDefinition,
): Omit<CapabilityDefinition, "contractDigest" | "lifecycle"> {
  const { contractDigest: _digest, lifecycle: _lifecycle, ...contract } =
    definition;
  return contract;
}

describe("production Capability Registry", () => {
  it("publishes the two exact discovery contracts with canonical digests", async () => {
    const response = await dispatchCapability({
      capability: CAPABILITY_LIST_IDENTITY,
      input: {},
    });

    expect(response.type).toBe("capability_result");
    if (response.type !== "capability_result") return;

    const output = response.output as {
      items: CapabilityDefinition[];
      registryDigest: string;
    };
    expect(
      output.items.map((definition) =>
        formatCapabilityIdentity(definition.identity),
      ),
    ).toEqual([
      "agents.current.get@1",
      "capabilities.get@1",
      "capabilities.list@1",
    ]);
    expect(output.registryDigest).toBe(CAPABILITY_REGISTRY.digest);

    for (const definition of output.items) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(definition.contractDigest).toBe(
        contractDigestFor(contractWithoutPublication(definition)),
      );
      expect(definition.lifecycle).toMatchObject({
        status: "active",
        recommended: true,
      });
      expect(definition.schemas.input).toMatchObject({ type: "object" });
      expect(definition.schemas.output).toMatchObject({ type: "object" });
      expect(definition.effect).toEqual({
        mutation: "none",
        visibility: "private",
        timing: "immediate",
        reversibility: "reversible",
        maySpendProviderBudget: false,
      });
      expect(definition.approval).toEqual({ mode: "none" });
      expect(definition.idempotency).toEqual({ mode: "retry-safe" });
      expect(definition.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining([
          "CAPABILITY_NOT_FOUND",
          "CAPABILITY_VERSION_RETIRED",
          "VALIDATION_FAILED",
        ]),
      );
    }
  });

  it("gets an exact definition and returns a stable error for an unknown one", async () => {
    const found = await CAPABILITY_DISPATCHER.dispatch({
      capability: CAPABILITY_GET_IDENTITY,
      input: CAPABILITY_LIST_IDENTITY,
    });
    expect(found).toMatchObject({
      type: "capability_result",
      capability: CAPABILITY_GET_IDENTITY,
      status: "completed",
      output: { identity: CAPABILITY_LIST_IDENTITY },
    });

    const missing = await CAPABILITY_DISPATCHER.dispatch({
      capability: CAPABILITY_GET_IDENTITY,
      input: { name: "missing.capability", version: 1 },
    });
    expect(missing).toMatchObject({
      type: "capability_error",
      capability: CAPABILITY_GET_IDENTITY,
      code: "CAPABILITY_NOT_FOUND",
      category: "not_found",
      retryable: false,
    });
  });

  it("rejects aliases and never generates an executable latest tool", async () => {
    const response = await dispatchCapability({
      capability: "capabilities.list@latest",
      input: {},
    });
    expect(response).toMatchObject({
      type: "capability_error",
      capability: null,
      code: "CAPABILITY_IDENTITY_INVALID",
    });
    const mcpTools = await listMcpCapabilityTools();
    expect(mcpTools.map((tool) => tool.name)).toEqual([
      "agents.current.get.v1",
      "capabilities.get.v1",
      "capabilities.list.v1",
    ]);
    expect(mcpTools.some((tool) => tool.name.includes("latest"))).toBe(false);
  });

  it("fully specifies every structured field in discovery output schemas", async () => {
    const response = await CAPABILITY_DISPATCHER.dispatch({
      capability: CAPABILITY_GET_IDENTITY,
      input: CAPABILITY_GET_IDENTITY,
    });
    expect(response.type).toBe("capability_result");
    if (response.type !== "capability_result") return;

    const definition = response.output as CapabilityDefinition;
    const outputSchema = definition.schemas.output as {
      properties: Record<string, Record<string, unknown>>;
    };
    const properties = outputSchema.properties;

    expect(properties.lifecycle).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["status", "introducedAt", "recommended"],
      properties: {
        status: {
          enum: ["experimental", "active", "deprecated", "retired"],
        },
        replacement: {
          required: ["name", "version"],
        },
      },
    });
    expect(properties.schemas).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["input", "output"],
      properties: {
        input: { $ref: "http://json-schema.org/draft-07/schema#" },
        output: { $ref: "http://json-schema.org/draft-07/schema#" },
      },
    });
    expect(properties.effect).toMatchObject({
      additionalProperties: false,
      required: [
        "mutation",
        "visibility",
        "timing",
        "reversibility",
        "maySpendProviderBudget",
      ],
      properties: {
        mutation: { enum: ["none", "runtime-state", "external-system"] },
      },
    });
    expect(properties.approval).toMatchObject({
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: {
          enum: ["none", "manages-approval", "required-before-effect"],
        },
      },
    });
    expect(properties.idempotency).toMatchObject({
      additionalProperties: false,
      required: ["mode"],
      properties: {
        mode: { enum: ["retry-safe", "intrinsic", "key-required"] },
      },
    });
    expect(properties.errors).toMatchObject({
      type: "array",
      minItems: 1,
      items: {
        additionalProperties: false,
        required: ["code", "category", "retryable", "description"],
        properties: {
          code: { pattern: "^[A-Z][A-Z0-9_]*$" },
          category: {
            enum: [
              "validation",
              "not_found",
              "lifecycle",
              "authorization",
              "approval",
              "conflict",
              "internal",
            ],
          },
        },
      },
    });
  });

  it("canonicalizes object key order for contract and request digests", () => {
    expect(canonicalDigest({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalDigest({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("enforces lifecycle publication invariants", () => {
    const invalid: CapabilityRegistration = {
      identity: { name: "fixtures.invalid", version: 1 },
      summary: "Invalid recommendation.",
      lifecycle: {
        status: "retired",
        introducedAt: "2026-01-01T00:00:00.000Z",
        retiredAt: "2026-02-01T00:00:00.000Z",
        recommended: true,
      },
      input: z.object({}).strict(),
      outputSchema: { type: "object" },
      effect: {
        mutation: "none",
        visibility: "private",
        timing: "immediate",
        reversibility: "reversible",
        maySpendProviderBudget: false,
      },
      approval: { mode: "none" },
      idempotency: { mode: "retry-safe" },
      errors: COMMON_DISCOVERY_ERRORS,
      handler: () => ({}),
    };
    expect(() => createCapabilityRegistry([invalid])).toThrow(
      "Only an active capability may be recommended",
    );
  });
});
