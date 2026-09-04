import { describe, expect, it } from "vitest";

import { isQualificationHarnessAuthorized, resolveQualificationWebhookVersion } from "../qualification-webhook";

describe("qualification webhook trust", () => {
  it("uses a configured, sufficiently strong harness bearer token", () => {
    const token = "qualification-harness-secret-1234567890";
    expect(isQualificationHarnessAuthorized(`Bearer ${token}`, { QUALIFICATION_HARNESS_TOKEN: token })).toBe(true);
    expect(isQualificationHarnessAuthorized("Bearer wrong", { QUALIFICATION_HARNESS_TOKEN: token })).toBe(false);
    expect(isQualificationHarnessAuthorized(`Bearer ${token}`, { QUALIFICATION_HARNESS_TOKEN: "replace_me" })).toBe(false);
    expect(isQualificationHarnessAuthorized("Bearer short", { QUALIFICATION_HARNESS_TOKEN: "short" })).toBe(false);
  });

  it("requires exact official-model identity", () => {
    expect(resolveQualificationWebhookVersion({ model: "prunaai/p-video", modelVersion: "prunaai/p-video", providerModel: "prunaai/p-video", providerVersion: "hidden" })).toBe("prunaai/p-video");
    expect(resolveQualificationWebhookVersion({ model: "prunaai/p-video", modelVersion: "prunaai/p-video", providerModel: null, providerVersion: "hidden" })).toBeNull();
    expect(resolveQualificationWebhookVersion({ model: "prunaai/p-video", modelVersion: "prunaai/p-video", providerModel: "other/model", providerVersion: "hidden" })).toBeNull();
  });

  it("requires exact immutable version identity for community models", () => {
    expect(resolveQualificationWebhookVersion({ model: "owner/model", modelVersion: "version-123", providerModel: "owner/model", providerVersion: "version-123" })).toBe("version-123");
    expect(resolveQualificationWebhookVersion({ model: "owner/model", modelVersion: "version-123", providerModel: "owner/model", providerVersion: "version-456" })).toBeNull();
  });
});
