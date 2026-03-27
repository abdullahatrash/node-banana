import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("social runtime bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { clearRegistry } = await import("@/lib/social/provider-registry");
    clearRegistry();
  });

  it("registers instagram and facebook providers for runtime routes", async () => {
    const registry = await import("@/lib/social/provider-registry");
    registry.clearRegistry();

    await import("@/lib/social/runtime-bootstrap");

    const identifiers = registry
      .listProviderCapabilities()
      .map((provider) => provider.identifier);

    expect(identifiers).toContain("instagram");
    expect(identifiers).toContain("facebook");
  });
});
