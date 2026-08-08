import { describe, expect, it } from "vitest";
import { PRODUCTION_CAPABILITY_REGISTRY } from "../../server-dispatcher";
import { PUBLISHING_PLAN_CAPABILITY_IDENTITIES } from "../authorization-contract";

describe("Publishing Plan production registration", () => {
  it("publishes the same four capabilities to CLI and MCP transports", () => {
    for (const identity of Object.values(PUBLISHING_PLAN_CAPABILITY_IDENTITIES)) {
      const definition = PRODUCTION_CAPABILITY_REGISTRY.getDefinition(identity);
      expect(definition).toMatchObject({ identity, audience: "agent" });
    }
  });
});
