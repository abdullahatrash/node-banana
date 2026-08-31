import { describe, expect, it } from "vitest";
import { AesGcmUsageCursorCodec, InvalidUsageCursorError } from "../cursor";

const oldKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const activeKey = Uint8Array.from({ length: 32 }, (_, index) => 32 - index);

describe("AesGcmUsageCursorCodec", () => {
  it("round-trips and survives key rotation", () => {
    const old = new AesGcmUsageCursorCodec(() => ({ active: { id: "old", key: oldKey }, all: [{ id: "old", key: oldKey }] }));
    const cursor = old.seal({
      workspaceId: "workspace_1", callerId: "agent:principal_1", collection: "usage_records.list@1",
      filterDigest: `sha256:${"a".repeat(64)}`,
      position: { recordedAt: new Date("2026-08-01T00:00:00.000Z"), id: "usage_1" },
    });
    const rotated = new AesGcmUsageCursorCodec(() => ({
      active: { id: "active", key: activeKey },
      all: [{ id: "active", key: activeKey }, { id: "old", key: oldKey }],
    }));
    expect(rotated.open({
      cursor, workspaceId: "workspace_1", callerId: "agent:principal_1", collection: "usage_records.list@1",
      filterDigest: `sha256:${"a".repeat(64)}`,
    })).toEqual({ recordedAt: new Date("2026-08-01T00:00:00.000Z"), id: "usage_1" });
  });

  it("rejects tampering and changed security/filter bindings", () => {
    const codec = new AesGcmUsageCursorCodec(() => ({ active: { id: "active", key: activeKey }, all: [{ id: "active", key: activeKey }] }));
    const input = {
      workspaceId: "workspace_1", callerId: "human:user_1", collection: "usage_events.list@1",
      filterDigest: `sha256:${"b".repeat(64)}`,
      position: { recordedAt: new Date("2026-08-01T00:00:00.000Z"), id: "event_1" },
    };
    const cursor = codec.seal(input);
    const tamperedCursor = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    for (const changed of [
      { ...input, cursor: tamperedCursor },
      { ...input, cursor, workspaceId: "workspace_2" },
      { ...input, cursor, callerId: "human:user_2" },
      { ...input, cursor, collection: "usage_records.list@1" },
      { ...input, cursor, filterDigest: `sha256:${"c".repeat(64)}` },
    ]) {
      expect(() => codec.open(changed)).toThrow(InvalidUsageCursorError);
    }
  });
});
