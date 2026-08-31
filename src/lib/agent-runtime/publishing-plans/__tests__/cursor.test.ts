import { describe, expect, it } from "vitest";
import {
  AesGcmPublishingPlanCursorCodec,
  InvalidPublishingPlanCursorError,
  publishingPlanCursorKeysFromEnvironment,
} from "../cursor";

describe("AesGcmPublishingPlanCursorCodec", () => {
  it("binds a cursor to principal, Workspace, and filters", () => {
    const keys = {
      active: { id: "key1", key: Buffer.alloc(32, 7) },
      all: [{ id: "key1", key: Buffer.alloc(32, 7) }],
    };
    const codec = new AesGcmPublishingPlanCursorCodec(() => keys);
    const cursor = codec.seal({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      filterDigest: "sha256:filter",
      position: {
        createdAt: new Date("2026-08-08T12:00:00.000Z"),
        id: "ppr_1",
      },
    });

    expect(
      codec.open({
        cursor,
        workspaceId: "workspace_1",
        principalId: "principal_1",
        filterDigest: "sha256:filter",
      }),
    ).toEqual({
      createdAt: new Date("2026-08-08T12:00:00.000Z"),
      id: "ppr_1",
    });
    expect(() =>
      codec.open({
        cursor,
        workspaceId: "workspace_1",
        principalId: "principal_2",
        filterDigest: "sha256:filter",
      }),
    ).toThrow(InvalidPublishingPlanCursorError);
    expect(() =>
      codec.open({
        cursor,
        workspaceId: "workspace_1",
        principalId: "principal_1",
        filterDigest: "sha256:other",
      }),
    ).toThrow(InvalidPublishingPlanCursorError);
  });

  it("requires a Publishing Plan-specific cursor keyring", () => {
    const prior = process.env.PUBLISHING_PLAN_CURSOR_KEYS;
    const artifactPrior = process.env.ARTIFACT_CURSOR_KEYS;
    try {
      delete process.env.PUBLISHING_PLAN_CURSOR_KEYS;
      process.env.ARTIFACT_CURSOR_KEYS = `artifact:${Buffer.alloc(32, 1).toString("base64url")}`;
      expect(() => publishingPlanCursorKeysFromEnvironment()).toThrow(
        "PUBLISHING_PLAN_CURSOR_KEYS is required",
      );
      process.env.PUBLISHING_PLAN_CURSOR_KEYS = `publishing:${Buffer.alloc(32, 2).toString("base64url")}`;
      expect(publishingPlanCursorKeysFromEnvironment()).toMatchObject({
        active: { id: "publishing" },
      });
    } finally {
      if (prior === undefined) delete process.env.PUBLISHING_PLAN_CURSOR_KEYS;
      else process.env.PUBLISHING_PLAN_CURSOR_KEYS = prior;
      if (artifactPrior === undefined) delete process.env.ARTIFACT_CURSOR_KEYS;
      else process.env.ARTIFACT_CURSOR_KEYS = artifactPrior;
    }
  });
});
