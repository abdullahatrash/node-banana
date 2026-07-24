import { describe, expect, it } from "vitest";
import {
  artifactContentObjectKey,
  assertArtifactStagingLifecycleConfigured,
} from "../storage";

describe("Artifact storage configuration", () => {
  it("uses the full Workspace digest so long IDs with common prefixes differ", () => {
    const prefix = "workspace-".repeat(40);
    const digest = `sha256:${"a".repeat(64)}`;
    const left = artifactContentObjectKey(`${prefix}left`, digest);
    const right = artifactContentObjectKey(`${prefix}right`, digest);

    expect(left).not.toBe(right);
    expect(left).toMatch(
      /^agent-artifacts\/content\/[a-f0-9]{64}\/[a-f0-9]{64}$/,
    );
  });

  it("fails closed unless staging has a bounded bucket lifecycle", () => {
    expect(assertArtifactStagingLifecycleConfigured("1")).toBe(1);
    expect(assertArtifactStagingLifecycleConfigured("24")).toBe(24);
    for (const invalid of [undefined, "", "0", "25", "1.5", "NaN"]) {
      expect(() =>
        assertArtifactStagingLifecycleConfigured(invalid),
      ).toThrow(/agent-artifacts\/staging/);
    }
  });
});
