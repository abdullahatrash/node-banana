import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDefinition } = vi.hoisted(() => ({
  mockGetDefinition: vi.fn(),
}));

vi.mock("@/lib/social/publishing-settings", () => ({
  getPublishingSettingsDefinition: mockGetDefinition,
}));

import { getPublishingSettingsSchema } from "../settings";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPublishingSettingsSchema", () => {
  it("returns the label and safe defaults for a platform with settings", () => {
    mockGetDefinition.mockReturnValue({
      platform: "youtube",
      label: "YouTube",
      defaults: { privacyStatus: "private", madeForKids: false, tags: [] },
      normalize: () => ({}),
      validateForPublish: () => ({ valid: true, errors: [] }),
    });

    const schema = getPublishingSettingsSchema("youtube");

    expect(schema).toEqual({
      platform: "youtube",
      label: "YouTube",
      defaults: { privacyStatus: "private", madeForKids: false, tags: [] },
    });
  });

  it("returns null for a platform with no settings definition", () => {
    mockGetDefinition.mockImplementation(() => {
      throw new Error("not found");
    });

    expect(getPublishingSettingsSchema("bluesky")).toBeNull();
  });
});
