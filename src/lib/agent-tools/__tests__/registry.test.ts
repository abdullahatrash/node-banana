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
    ).toEqual(["capabilities.get@1", "capabilities.list@1"]);
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
    expect(listMcpCapabilityTools().map((tool) => tool.name)).toEqual([
      "capabilities.get.v1",
      "capabilities.list.v1",
    ]);
    expect(
      listMcpCapabilityTools().some((tool) => tool.name.includes("latest")),
    ).toBe(false);
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
