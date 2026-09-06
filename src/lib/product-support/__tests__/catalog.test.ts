import { describe, expect, it } from "vitest";
import { GUIDE_ENTRIES, RELEASE_NOTES, ROADMAP_ITEMS } from "../catalog";

describe("product support catalog", () => {
  it("keeps guidance and release facts explicitly versioned", () => {
    expect(GUIDE_ENTRIES.length).toBeGreaterThanOrEqual(6);
    expect(GUIDE_ENTRIES.every((entry) => entry.version > 0 && entry.transcriptKeys.length >= 3)).toBe(true);
    expect(RELEASE_NOTES.every((release) => /^\d{4}\.\d{2}\.\d+$/.test(release.version) && release.factKeys.length > 0)).toBe(true);
  });

  it("keeps public roadmap promises distinct and bounded", () => {
    expect(new Set(ROADMAP_ITEMS.map((item) => item.id)).size).toBe(ROADMAP_ITEMS.length);
    expect(ROADMAP_ITEMS.some((item) => item.target === null)).toBe(true);
  });
});
