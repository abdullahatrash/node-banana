import { describe, expect, it } from "vitest";
import {
  AesGcmPublishingDeliveryCursorCodec,
  InvalidPublishingDeliveryCursorError,
} from "../cursor";

const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

describe("Publishing Delivery sealed cursor", () => {
  it("round-trips only for the exact workspace, principal, and filter", () => {
    const codec = new AesGcmPublishingDeliveryCursorCodec(() => ({
      active: { id: "key_1", key },
      all: [{ id: "key_1", key }],
    }));
    const cursor = codec.seal({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      filterDigest: `sha256:${"a".repeat(64)}`,
      position: {
        acceptedAt: new Date("2026-08-09T12:00:00.000Z"),
        id: "delivery_1",
      },
    });
    expect(codec.open({
      cursor,
      workspaceId: "workspace_1",
      principalId: "principal_1",
      filterDigest: `sha256:${"a".repeat(64)}`,
    })).toEqual({
      acceptedAt: new Date("2026-08-09T12:00:00.000Z"),
      id: "delivery_1",
    });
    expect(() => codec.open({
      cursor,
      workspaceId: "workspace_1",
      principalId: "principal_2",
      filterDigest: `sha256:${"a".repeat(64)}`,
    })).toThrow(InvalidPublishingDeliveryCursorError);
  });
});
