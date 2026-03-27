import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkflowRunRef } from "@/lib/social/workflow-utils";

describe("social/workflow-utils", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers runId, workflowId, and id in that order", () => {
    expect(resolveWorkflowRunRef({ runId: "run_1" }, "dispatch:post_1")).toBe("run_1");
    expect(resolveWorkflowRunRef({ workflowId: "wf_1" }, "dispatch:post_1")).toBe("wf_1");
    expect(resolveWorkflowRunRef({ id: "id_1" }, "dispatch:post_1")).toBe("id_1");
  });

  it("falls back to the dispatch key when no workflow ref exists", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    expect(resolveWorkflowRunRef({}, "dispatch:spost_1")).toBe(
      "dispatch:spost_1:1700000000000",
    );
  });
});
