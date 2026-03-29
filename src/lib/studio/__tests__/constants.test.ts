import { describe, it, expect } from "vitest";
import { MAX_PROJECTS_PER_WORKSPACE } from "../constants";

describe("studio constants", () => {
  it("MAX_PROJECTS_PER_WORKSPACE is a positive integer", () => {
    expect(MAX_PROJECTS_PER_WORKSPACE).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_PROJECTS_PER_WORKSPACE)).toBe(true);
  });
});
