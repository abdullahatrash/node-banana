import * as publicSurface from "../index";
import { describe, expect, it } from "vitest";

describe("Artifact public surface", () => {
  it("exposes only capability registration and the production service", () => {
    expect(Object.keys(publicSurface).sort()).toEqual([
      "ARTIFACT_CAPABILITY_IDENTITIES",
      "PRODUCTION_ARTIFACT_SERVICE",
      "createArtifactRegistrations",
    ]);
    for (const internal of [
      "AesGcmArtifactCursorCodec",
      "InvalidArtifactCursorError",
      "artifactCursorKeysFromEnvironment",
      "InMemoryArtifactContentStore",
      "InMemoryArtifactMediaInspector",
      "InMemoryArtifactRepository",
      "DrizzleArtifactRepository",
      "S3ArtifactContentStore",
      "SharpArtifactMediaInspector",
    ]) {
      expect(publicSurface).not.toHaveProperty(internal);
    }
  });
});
