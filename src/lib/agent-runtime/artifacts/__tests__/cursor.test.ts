import { describe, expect, it } from "vitest";
import {
  AesGcmArtifactCursorCodec,
  InvalidArtifactCursorError,
  artifactCursorKeysFromEnvironment,
} from "../cursor";

describe("AesGcmArtifactCursorCodec", () => {
  it("opens cursors from a rotated read key without exposing bound values", () => {
    const oldKey = { id: "old", key: Buffer.alloc(32, 1) };
    const nextKey = { id: "next", key: Buffer.alloc(32, 2) };
    const oldCodec = new AesGcmArtifactCursorCodec(() => ({
      active: oldKey,
      all: [oldKey],
    }));
    const cursor = oldCodec.seal({
      workspaceId: "workspace-secret",
      principalId: "principal-secret",
      filterDigest: `sha256:${"a".repeat(64)}`,
      position: {
        createdAt: new Date("2026-07-25T00:00:00.000Z"),
        id: "artifact-1",
      },
    });
    const rotated = new AesGcmArtifactCursorCodec(() => ({
      active: nextKey,
      all: [nextKey, oldKey],
    }));

    expect(cursor).not.toContain("workspace-secret");
    expect(cursor).not.toContain("principal-secret");
    expect(
      rotated.open({
        cursor,
        workspaceId: "workspace-secret",
        principalId: "principal-secret",
        filterDigest: `sha256:${"a".repeat(64)}`,
      }),
    ).toEqual({
      createdAt: new Date("2026-07-25T00:00:00.000Z"),
      id: "artifact-1",
    });
  });

  it("rejects tampering with one indistinguishable cursor error", () => {
    const key = { id: "current", key: Buffer.alloc(32, 3) };
    const codec = new AesGcmArtifactCursorCodec(() => ({
      active: key,
      all: [key],
    }));
    const cursor = codec.seal({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      filterDigest: `sha256:${"b".repeat(64)}`,
      position: { createdAt: new Date(), id: "artifact-1" },
    });
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;

    expect(() =>
      codec.open({
        cursor: tampered,
        workspaceId: "workspace-1",
        principalId: "principal-1",
        filterDigest: `sha256:${"b".repeat(64)}`,
      }),
    ).toThrow(InvalidArtifactCursorError);
  });

  it("rejects non-canonical base64url cursor segments", () => {
    const key = { id: "current", key: Buffer.alloc(32, 4) };
    const codec = new AesGcmArtifactCursorCodec(() => ({
      active: key,
      all: [key],
    }));
    const cursor = codec.seal({
      workspaceId: "workspace-1",
      principalId: "principal-1",
      filterDigest: `sha256:${"c".repeat(64)}`,
      position: { createdAt: new Date(), id: "artifact-1" },
    });
    const parts = cursor.split(".");
    parts[2] = `${parts[2]}=`;

    expect(() =>
      codec.open({
        cursor: parts.join("."),
        workspaceId: "workspace-1",
        principalId: "principal-1",
        filterDigest: `sha256:${"c".repeat(64)}`,
      }),
    ).toThrow(InvalidArtifactCursorError);
  });

  it("rejects non-canonical and duplicate environment key entries", () => {
    const original = process.env.ARTIFACT_CURSOR_KEYS;
    try {
      for (const invalid of [
        "",
        `current:${Buffer.alloc(32, 5).toString("base64url")}=`,
        "current:not-base64url!",
        `same:${Buffer.alloc(32, 5).toString("base64url")},same:${Buffer.alloc(32, 6).toString("base64url")}`,
      ]) {
        process.env.ARTIFACT_CURSOR_KEYS = invalid;
        expect(() => artifactCursorKeysFromEnvironment()).toThrow();
      }
    } finally {
      if (original === undefined) {
        delete process.env.ARTIFACT_CURSOR_KEYS;
      } else {
        process.env.ARTIFACT_CURSOR_KEYS = original;
      }
    }
  });
});
