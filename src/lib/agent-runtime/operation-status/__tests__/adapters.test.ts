import { describe, expect, it } from "vitest";
import { getOperationProjectionAdapter, OPERATION_PROJECTION_ADAPTERS, UNAVAILABLE_OPERATION_KINDS } from "../adapters";

describe("operation projection adapters", () => {
  it("covers all required owning resources", () => {
    expect(OPERATION_PROJECTION_ADAPTERS.map((item) => item.kind)).toEqual([
      "workflow_run", "brand_ingestion", "governance_export", "governance_bulk", "workspace_import", "automation", "publishing_delivery", "persona_training",
    ]);
    expect(UNAVAILABLE_OPERATION_KINDS).toEqual(["metric_refresh", "ingestion"]);
    expect(OPERATION_PROJECTION_ADAPTERS.some((adapter) => adapter.kind === "persona_training")).toBe(true);
    expect(getOperationProjectionAdapter("creator-persona-training/v1")?.kind).toBe("persona_training");
  });
  it("normalizes aborted and unknown source states safely", () => {
    const adapter = OPERATION_PROJECTION_ADAPTERS[6];
    expect(adapter.project({ workspaceId: "w", resourceId: "r", state: "aborted", updatedAt: new Date() }).state).toBe("cancelled");
    expect(adapter.project({ workspaceId: "w", resourceId: "r", state: "mystery", updatedAt: new Date() }).state).toBe("blocked");
  });
});
