import { describe, expect, it } from "vitest";
import { PublishingPlatformRegistry } from "../platform-registry";

describe("Publishing Platform production registry", () => {
  it("does not register the deterministic fake as a live Platform", async () => {
    const {
      PRODUCTION_PUBLISHING_DELIVERY_RECOVERY_AUTHORIZATION,
      PRODUCTION_PUBLISHING_DELIVERY_SERVICE,
      PRODUCTION_PUBLISHING_PLATFORM_REGISTRY,
    } = await import(
      "../production"
    );
    expect(PRODUCTION_PUBLISHING_PLATFORM_REGISTRY).toBeInstanceOf(
      PublishingPlatformRegistry,
    );
    expect(PRODUCTION_PUBLISHING_PLATFORM_REGISTRY.get("linkedin")).toBeNull();
    expect((PRODUCTION_PUBLISHING_DELIVERY_SERVICE as unknown as {
      recoveryAuthorization: unknown;
    }).recoveryAuthorization).toBe(
      PRODUCTION_PUBLISHING_DELIVERY_RECOVERY_AUTHORIZATION,
    );
  });
});
