import { describe, expect, it } from "vitest";
import { getPermissionsForRole } from "@/lib/studio/authz";
import { ToolError } from "../../errors";
import { runTool } from "../../runtime";
import { runWorkflowTool } from "../run-workflow";

const session = (permissions = getPermissionsForRole("owner")) => ({
  user: { id: "apitoken:ws_1", name: null, email: null },
  workspace: { id: "ws_1", organizationId: null },
  role: "owner" as const,
  planTier: "free" as const,
  permissions,
});

describe("run_workflow tool", () => {
  it("fails closed before creating provider or run effects", async () => {
    await expect(runTool(runWorkflowTool, { projectId: "proj_1" }, { session: session() }))
      .rejects.toMatchObject({ code: "unavailable" } satisfies Partial<ToolError>);
  });

  it("still enforces tool authorization before reporting availability", async () => {
    await expect(runTool(runWorkflowTool, { projectId: "proj_1" }, { session: session([]) }))
      .rejects.toMatchObject({ code: "forbidden" } satisfies Partial<ToolError>);
  });
});
