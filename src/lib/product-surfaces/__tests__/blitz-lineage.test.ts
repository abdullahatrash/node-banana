import { describe, expect, it } from "vitest";
import { isAdmittedBlitzArtifact, isAdmittedMetadataBlitzArtifact } from "../blitz-lineage";

const digest = `sha256:${"a".repeat(64)}` as const;
const base = {
  sourceAssetId: "source_1", rightsDigest: digest, remixBriefDigest: digest,
  generation: { assetId: "asset_1", intentId: "intent_1", operationId: "generation:intent_1" },
  receipt: { assetId: "asset_1", intentId: "intent_1", status: "ready", contentDigest: digest },
  intent: { outputContract: { mediaType: "video", aspectRatio: "9:16" }, rights: { digest, sourceAssetIds: ["source_1"] }, remixBrief: { digest } },
  operation: { state: "succeeded", artifactIds: ["asset_1"] }, artifactExists: true,
};

describe("Blitz artifact lineage", () => {
  it("accepts the exact succeeded 9:16 artifact receipt", () => {
    expect(isAdmittedBlitzArtifact(base as Parameters<typeof isAdmittedBlitzArtifact>[0])).toBe(true);
  });

  it.each([
    { generation: { ...base.generation, operationId: "generation:other" } },
    { receipt: { ...base.receipt, intentId: "intent_other" } },
    { intent: { ...base.intent, outputContract: { mediaType: "video", aspectRatio: null } } },
    { intent: { ...base.intent, rights: { digest: `sha256:${"b".repeat(64)}`, sourceAssetIds: ["source_1"] } } },
    { intent: { ...base.intent, remixBrief: { digest: `sha256:${"b".repeat(64)}` } } },
    { operation: { state: "outcome_unknown", artifactIds: ["asset_1"] } },
    { artifactExists: false },
  ])("rejects mismatched or non-final evidence", (override) => {
    expect(isAdmittedBlitzArtifact({ ...base, ...override } as Parameters<typeof isAdmittedBlitzArtifact>[0])).toBe(false);
  });

  it("admits only a source-free text-to-video artifact for metadata topics", () => {
    const metadata = {
      remixBriefDigest: digest,
      generation: base.generation,
      receipt: base.receipt,
      intent: { ...base.intent, capability: "text_to_video", rights: { ...base.intent.rights, sourceAssetIds: [], evidence: [] }, providerComposition: { sourceAssetIds: [] }, remixBrief: { digest, preserve: [], transform: [], avoid: [] } },
      operation: base.operation,
      artifactExists: true,
    };
    expect(isAdmittedMetadataBlitzArtifact(metadata as unknown as Parameters<typeof isAdmittedMetadataBlitzArtifact>[0])).toBe(true);
    expect(isAdmittedMetadataBlitzArtifact({ ...metadata, intent: { ...metadata.intent, capability: "video_to_video" } } as unknown as Parameters<typeof isAdmittedMetadataBlitzArtifact>[0])).toBe(false);
    expect(isAdmittedMetadataBlitzArtifact({ ...metadata, intent: { ...metadata.intent, rights: { ...metadata.intent.rights, sourceAssetIds: ["youtube-video"] } } } as unknown as Parameters<typeof isAdmittedMetadataBlitzArtifact>[0])).toBe(false);
    expect(isAdmittedMetadataBlitzArtifact({ ...metadata, intent: { ...metadata.intent, remixBrief: { ...metadata.intent.remixBrief, transform: ["source pacing"] } } } as unknown as Parameters<typeof isAdmittedMetadataBlitzArtifact>[0])).toBe(false);
  });
});
