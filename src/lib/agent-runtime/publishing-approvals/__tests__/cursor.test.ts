import { describe, expect, it } from "vitest";
import { AesGcmPublishingApprovalCursorCodec, InvalidPublishingApprovalCursorError } from "../cursor";

function codec() {
  return new AesGcmPublishingApprovalCursorCodec(() => ({
    active: { id: "active", key: Buffer.alloc(32, 7) },
    all: [{ id: "active", key: Buffer.alloc(32, 7) }],
  }));
}

describe("Publishing Approval cursor", () => {
  it("seals position to Workspace, actor, filter, and order", () => {
    const value = codec();
    const cursor = value.seal({ workspaceId: "workspace_1", actorId: "principal_1", filterDigest: `sha256:${"a".repeat(64)}`, position: { createdAt: new Date("2026-08-08T12:00:00.000Z"), id: "par_1" } });
    expect(value.open({ cursor, workspaceId: "workspace_1", actorId: "principal_1", filterDigest: `sha256:${"a".repeat(64)}` })).toEqual({ createdAt: new Date("2026-08-08T12:00:00.000Z"), id: "par_1" });
    expect(() => value.open({ cursor, workspaceId: "workspace_1", actorId: "principal_2", filterDigest: `sha256:${"a".repeat(64)}` })).toThrow(InvalidPublishingApprovalCursorError);
  });
});
