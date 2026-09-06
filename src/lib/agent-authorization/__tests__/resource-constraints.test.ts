import { describe, expect, it } from "vitest";
import {
  AGENT_RESOURCE_DESCRIPTORS,
  emptyResourceConstraints,
  intersectResourceConstraints,
  resourceConstraintKey,
  resourceConstraintRefs,
} from "../resource-constraints";

describe("Agent resource descriptors", () => {
  it("drives every kind, constraint key, empty value, intersection, and ref projection", () => {
    expect(AGENT_RESOURCE_DESCRIPTORS).toEqual([
      {
        kind: "channel",
        constraintKey: "channelIds",
        label: "Channel IDs",
      },
      {
        kind: "credential_profile",
        constraintKey: "credentialProfileIds",
        label: "Credential Profile IDs",
      },
      {
        kind: "workflow",
        constraintKey: "workflowIds",
        label: "Workflow IDs",
      },
      {
        kind: "automation",
        constraintKey: "automationIds",
        label: "Automation IDs",
      },
      {
        kind: "studio_asset",
        constraintKey: "studioAssetIds",
        label: "Studio Asset IDs",
      },
      {
        kind: "artifact",
        constraintKey: "artifactIds",
        label: "Artifact IDs",
      },
    ]);
    expect(
      Object.fromEntries(
        AGENT_RESOURCE_DESCRIPTORS.map(({ kind }) => [
          kind,
          resourceConstraintKey(kind),
        ]),
      ),
    ).toEqual({
      channel: "channelIds",
      credential_profile: "credentialProfileIds",
      workflow: "workflowIds",
      automation: "automationIds",
      studio_asset: "studioAssetIds",
      artifact: "artifactIds",
    });

    const empty = emptyResourceConstraints();
    expect(empty).toEqual({
      channelIds: [],
      credentialProfileIds: [],
      workflowIds: [],
      automationIds: [],
      studioAssetIds: [],
      artifactIds: [],
    });
    expect(emptyResourceConstraints().channelIds).not.toBe(empty.channelIds);

    const intersection = intersectResourceConstraints([
      {
        channelIds: ["channel-b", "channel-a"],
        credentialProfileIds: ["credential-1"],
        workflowIds: ["workflow-1"],
        automationIds: [],
        studioAssetIds: ["studio-2", "studio-1"],
        artifactIds: ["artifact-2", "artifact-1"],
      },
      {
        channelIds: ["channel-a"],
        credentialProfileIds: ["credential-1"],
        workflowIds: [],
        automationIds: ["automation-1"],
        studioAssetIds: ["studio-1"],
        artifactIds: ["artifact-1"],
      },
    ]);
    expect(intersection).toEqual({
      channelIds: ["channel-a"],
      credentialProfileIds: ["credential-1"],
      workflowIds: [],
      automationIds: [],
      studioAssetIds: ["studio-1"],
      artifactIds: ["artifact-1"],
    });
    expect(resourceConstraintRefs(intersection)).toEqual([
      { kind: "channel", id: "channel-a" },
      { kind: "credential_profile", id: "credential-1" },
      { kind: "studio_asset", id: "studio-1" },
      { kind: "artifact", id: "artifact-1" },
    ]);
  });
});
