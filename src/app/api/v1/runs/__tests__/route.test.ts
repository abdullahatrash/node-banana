import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { getPermissionsForRole } from "@/lib/studio/authz";

const {
  mockAuthorize,
  mockIsDatabaseConfigured,
  mockGetProject,
  mockCreateWorkflowRun,
  mockSchedule,
  mockExecute,
} = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockIsDatabaseConfigured: vi.fn(() => true),
  mockGetProject: vi.fn(),
  mockCreateWorkflowRun: vi.fn(),
  mockSchedule: vi.fn(),
  mockExecute: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mockIsDatabaseConfigured(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/api-tokens/auth", () => ({
  authorizePublicApiRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

vi.mock("@/lib/studio/repository", () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
}));

vi.mock("@/lib/workflow-runner/runsRepository", () => ({
  createWorkflowRun: (...args: unknown[]) => mockCreateWorkflowRun(...args),
}));

// BYOK swap: the runner resolves keys via the workspace vault when they are
// not supplied inline. Stub the vault to "no stored key" so header-supplied
// and header-less runs behave deterministically without a DB call.
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

import { POST } from "../route";

const BASE = "http://localhost:3000/api/v1/runs";

function createRequest(body: unknown, headers?: HeadersInit): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: new URL(BASE),
    json: async () => body,
  } as unknown as NextRequest;
}

function authorized(workspaceId = "ws_1") {
  return {
    authorized: true,
    session: {
      user: { id: `apitoken:${workspaceId}`, name: null, email: null },
      workspace: { id: workspaceId, organizationId: null },
      role: "owner" as const,
      planTier: "free" as const,
      permissions: getPermissionsForRole("owner"),
    },
  };
}

const IMAGE_WORKFLOW = {
  version: 1,
  name: "demo",
  nodes: [
    { id: "p1", type: "prompt", data: { prompt: "a cat" } },
    { id: "gen1", type: "nanoBanana", data: { model: "nano-banana-pro" } },
  ],
  edges: [{ source: "p1", target: "gen1" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDatabaseConfigured.mockReturnValue(true);
  mockCreateWorkflowRun.mockResolvedValue({ id: "run_1", status: "queued" });
});

describe("/api/v1/runs POST", () => {
  it("returns 503 when the database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);

    const response = await POST(
      createRequest({ projectId: "proj_1" }, { authorization: "Bearer nb_x" }),
    );

    expect(response.status).toBe(503);
  });

  it("starts a run and returns 202 with the runId (BYOK key from header)", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetProject.mockResolvedValue({ workflowJson: IMAGE_WORKFLOW });

    const response = await POST(
      createRequest(
        { projectId: "proj_1" },
        { authorization: "Bearer nb_x", "X-Gemini-API-Key": "gkey" },
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(202);
    expect(data).toEqual({ success: true, runId: "run_1", status: "queued" });
    expect(mockCreateWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws_1", projectId: "proj_1" }),
    );
    expect(mockSchedule).toHaveBeenCalledOnce();
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "projects:write" }),
    );
  });

  it("returns the typed BYOK error (400) when no provider key is supplied", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetProject.mockResolvedValue({ workflowJson: IMAGE_WORKFLOW });

    const response = await POST(
      createRequest({ projectId: "proj_1" }, { authorization: "Bearer nb_x" }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("byok_key_missing");
    expect(mockCreateWorkflowRun).not.toHaveBeenCalled();
  });

  it("returns 422 unsupported_node for an unsupported node type", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetProject.mockResolvedValue({
      workflowJson: {
        version: 1,
        name: "demo",
        nodes: [{ id: "v1", type: "generateVideo", data: {} }],
        edges: [],
      },
    });

    const response = await POST(
      createRequest(
        { projectId: "proj_1" },
        { authorization: "Bearer nb_x", "X-Gemini-API-Key": "gkey" },
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error.code).toBe("unsupported_node");
  });

  it("returns 400 invalid_input when projectId is missing", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));

    const response = await POST(
      createRequest({}, { authorization: "Bearer nb_x" }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("invalid_input");
  });

  it("passes through the auth layer's 401 for an invalid token", async () => {
    mockAuthorize.mockResolvedValue({
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Invalid or revoked API token." },
        { status: 401 },
      ),
    });

    const response = await POST(
      createRequest({ projectId: "proj_1" }, { authorization: "Bearer nb_bad" }),
    );

    expect(response.status).toBe(401);
    expect(mockGetProject).not.toHaveBeenCalled();
  });
});
