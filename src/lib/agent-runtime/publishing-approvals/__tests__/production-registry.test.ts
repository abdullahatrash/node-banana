import { describe, expect, it } from "vitest";
import { PRODUCTION_CAPABILITY_REGISTRY } from "../../server-dispatcher";
import { PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES } from "../authorization-contract";

describe("Publishing Approval production registration", () => {
  it("publishes the exact request/observe/decide identities through the live dispatcher registry", () => {
    const expectedAudience = {
      request: "agent",
      get: "agent",
      list: "agent",
      decide: "human",
    } as const;
    for (const name of ["request", "get", "list", "decide"] as const) {
      const identity = PUBLISHING_APPROVAL_CAPABILITY_IDENTITIES[name];
      expect(PRODUCTION_CAPABILITY_REGISTRY.getDefinition(identity)).toMatchObject({
        identity,
        audience: expectedAudience[name],
      });
    }
  });
});
