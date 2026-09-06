import { describe, expect, it } from "vitest";
import {
  clampVideoDuration,
  supportedVideoDurations,
} from "../video-duration";

describe("qualified video duration projection", () => {
  it("keeps only presets admitted by the selected model", () => {
    expect(supportedVideoDurations(6)).toEqual([4, 5, 6]);
  });

  it("offers the model maximum when it is below every standard preset", () => {
    expect(supportedVideoDurations(3)).toEqual([3]);
  });

  it("uses the standard presets before a model contract is selected", () => {
    expect(supportedVideoDurations(null)).toEqual([4, 5, 6, 8, 10]);
  });

  it("clamps stale values to the largest admitted preset", () => {
    expect(clampVideoDuration(10, 6)).toBe(6);
    expect(clampVideoDuration(7, 10)).toBe(6);
  });
});
