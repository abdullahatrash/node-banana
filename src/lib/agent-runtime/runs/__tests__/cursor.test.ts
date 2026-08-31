import { describe, expect, it } from "vitest";
import {
  AesGcmWorkflowRunEventCursorCodec,
  InvalidWorkflowRunCursorError,
  workflowRunCursorKeysFromEnvironment,
} from "../cursor";

describe("AesGcmWorkflowRunEventCursorCodec", () => {
  const codec = new AesGcmWorkflowRunEventCursorCodec(() => ({
    active: { id: "current", key: Buffer.alloc(32, 9) },
    all: [{ id: "current", key: Buffer.alloc(32, 9) }],
  }));

  it("round-trips a bound sequence without exposing bound identifiers", () => {
    const cursor = codec.seal({
      workspaceId: "workspace-secret",
      principalId: "principal-secret",
      workflowId: "workflow-secret",
      runId: "run-secret",
      afterSequence: 3,
    });
    expect(cursor).not.toContain("workspace-secret");
    expect(cursor).not.toContain("principal-secret");
    expect(
      codec.open({
        cursor,
        workspaceId: "workspace-secret",
        principalId: "principal-secret",
        workflowId: "workflow-secret",
        runId: "run-secret",
      }),
    ).toBe(3);
  });

  it("rejects tampering, cross-resource replay, and noncanonical encoding", () => {
    const cursor = codec.seal({
      workspaceId: "workspace_1",
      principalId: "principal_1",
      workflowId: "workflow_1",
      runId: "run_1",
      afterSequence: 0,
    });
    for (const candidate of [
      `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`,
      cursor.replace(".", ".="),
    ]) {
      expect(() =>
        codec.open({
          cursor: candidate,
          workspaceId: "workspace_1",
          principalId: "principal_1",
          workflowId: "workflow_1",
          runId: "run_1",
        }),
      ).toThrow(InvalidWorkflowRunCursorError);
    }
    expect(() =>
      codec.open({
        cursor,
        workspaceId: "workspace_1",
        principalId: "principal_1",
        workflowId: "workflow_1",
        runId: "run_2",
      }),
    ).toThrow(InvalidWorkflowRunCursorError);
  });

  it("loads a rotatable fail-closed keyring from the environment", () => {
    const original = process.env.WORKFLOW_RUN_CURSOR_KEYS;
    try {
      const first = Buffer.alloc(32, 1).toString("base64url");
      const second = Buffer.alloc(32, 2).toString("base64url");
      process.env.WORKFLOW_RUN_CURSOR_KEYS =
        `current:${first},previous:${second}`;
      expect(workflowRunCursorKeysFromEnvironment()).toMatchObject({
        active: { id: "current" },
        all: [{ id: "current" }, { id: "previous" }],
      });
      for (const invalid of [
        "",
        "missing-separator",
        "duplicate:AQ,duplicate:AQ",
        `bad id:${first}`,
        "short:AQ",
      ]) {
        process.env.WORKFLOW_RUN_CURSOR_KEYS = invalid;
        expect(() => workflowRunCursorKeysFromEnvironment()).toThrow();
      }
    } finally {
      if (original === undefined) {
        delete process.env.WORKFLOW_RUN_CURSOR_KEYS;
      } else {
        process.env.WORKFLOW_RUN_CURSOR_KEYS = original;
      }
    }
  });
});
