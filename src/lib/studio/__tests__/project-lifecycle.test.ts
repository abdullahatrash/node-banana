import { describe, expect, it } from "vitest";
import { statusForProjectResave } from "@/lib/studio/project-lifecycle";

describe("project workflow lifecycle", () => {
  it("restores an archived/deleted project to active when its workflow is resaved", () => {
    const deletedProject = {
      status: "archived" as const,
      deletedAt: new Date("2026-07-24T00:00:00.000Z"),
      workflowJson: null,
    };

    const resaved = {
      ...deletedProject,
      workflowJson: { nodes: [], edges: [] },
      status:
        statusForProjectResave({ nodes: [], edges: [] }) ??
        deletedProject.status,
      deletedAt: null,
    };

    expect(resaved).toMatchObject({
      status: "active",
      deletedAt: null,
      workflowJson: { nodes: [], edges: [] },
    });
  });

  it("does not invent an active workflow lifecycle without workflow data", () => {
    expect(statusForProjectResave(null)).toBeUndefined();
  });
});
