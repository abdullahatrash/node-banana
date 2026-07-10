import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPermissionsForRole } from "@/lib/studio/authz";

import { ToolError } from "../../errors";
import { runTool } from "../../runtime";

const { mockGetProject, mockCreateWorkflowRun, mockSchedule, mockExecute } =
  vi.hoisted(() => ({
    mockGetProject: vi.fn(),
    mockCreateWorkflowRun: vi.fn(),
    mockSchedule: vi.fn(),
    mockExecute: vi.fn(),
  }));

vi.mock("@/lib/studio/repository", () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
}));

vi.mock("@/lib/workflow-runner/runsRepository", () => ({
  createWorkflowRun: (...args: unknown[]) => mockCreateWorkflowRun(...args),
}));

// BYOK swap: the runner now resolves keys via the workspace vault when they
// are not supplied inline. Stub the vault to "no stored key" so header-less
// runs still surface the typed byok_key_missing error without a DB call.
vi.mock("@/lib/byok/repository", () => ({
  resolveProviderKey: vi.fn(async () => null),
}));

vi.mock("@/lib/workflow-runner/service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/workflow-runner/service")
  >("@/lib/workflow-runner/service");
  return {
    ...actual,
    scheduleBackground: (task: () => Promise<void>) => mockSchedule(task),
    executeRunInBackground: (...args: unknown[]) => mockExecute(...args),
  };
});

import { runWorkflowTool } from "../run-workflow";

function session(role: "owner" | "member" = "owner") {
  return {
    user: { id: "apitoken:ws_1", name: null, email: null },
    workspace: { id: "ws_1", organizationId: null },
    role,
    planTier: "free" as const,
    permissions: getPermissionsForRole(role),
  };
}

const IMAGE_WORKFLOW = {
  version: 1,
  name: "demo",
  nodes: [
    { id: "p1", type: "prompt", data: { prompt: "a cat" } },
    { id: "gen1", type: "nanoBanana", data: { model: "nano-banana-pro" } },
    { id: "out1", type: "output", data: {} },
  ],
  edges: [
    { source: "p1", target: "gen1" },
    { source: "gen1", target: "out1" },
  ],
};

async function run(input: unknown, role: "owner" | "member" = "owner") {
  return runTool(runWorkflowTool, input, { session: session(role) });
}

async function expectToolError(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ToolError) return error;
    throw error;
  }
  throw new Error("Expected the tool to throw a ToolError.");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateWorkflowRun.mockResolvedValue({ id: "run_1", status: "queued" });
});

describe("run_workflow tool", () => {
  it("creates a queued run and schedules background execution", async () => {
    mockGetProject.mockResolvedValue({ workflowJson: IMAGE_WORKFLOW });

    const result = await run({
      projectId: "proj_1",
      providerKeys: { gemini: "gkey" },
    });

    expect(result).toEqual({ runId: "run_1", status: "queued" });
    expect(mockGetProject).toHaveBeenCalledWith("ws_1", "proj_1");
    expect(mockCreateWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", projectId: "proj_1" }),
    );
    expect(mockSchedule).toHaveBeenCalledOnce();
  });

  it("returns not_found when the project does not exist", async () => {
    mockGetProject.mockResolvedValue(null);

    const error = await expectToolError(run({ projectId: "missing" }));
    expect(error.code).toBe("not_found");
    expect(mockCreateWorkflowRun).not.toHaveBeenCalled();
  });

  it("returns unsupported_node for a node type the runner cannot execute", async () => {
    mockGetProject.mockResolvedValue({
      workflowJson: {
        version: 1,
        name: "demo",
        nodes: [{ id: "v1", type: "generateVideo", data: {} }],
        edges: [],
      },
    });

    const error = await expectToolError(
      run({ projectId: "proj_1", providerKeys: { gemini: "k" } }),
    );
    expect(error.code).toBe("unsupported_node");
    expect(error.message).toContain("generateVideo");
    expect(mockCreateWorkflowRun).not.toHaveBeenCalled();
  });

  it("returns the typed BYOK error when no provider key is supplied", async () => {
    mockGetProject.mockResolvedValue({ workflowJson: IMAGE_WORKFLOW });

    const error = await expectToolError(run({ projectId: "proj_1" }));
    expect(error.code).toBe("byok_key_missing");
    expect(error.message).toContain("gemini");
    expect(mockCreateWorkflowRun).not.toHaveBeenCalled();
  });

  it("rejects a member token lacking projects:write with forbidden", async () => {
    // member role has projects:write in this app, so drop to a bare session.
    const bare = {
      ...session("member"),
      permissions: getPermissionsForRole("member").filter(
        (p) => p !== "projects:write",
      ),
    };
    const error = await expectToolError(
      runTool(runWorkflowTool, { projectId: "proj_1" }, { session: bare }),
    );
    expect(error.code).toBe("forbidden");
    expect(mockGetProject).not.toHaveBeenCalled();
  });
});
