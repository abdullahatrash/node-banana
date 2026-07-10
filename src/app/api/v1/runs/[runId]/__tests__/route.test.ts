import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { getPermissionsForRole } from "@/lib/studio/authz";

const { mockAuthorize, mockIsDatabaseConfigured, mockGetWorkflowRun } =
  vi.hoisted(() => ({
    mockAuthorize: vi.fn(),
    mockIsDatabaseConfigured: vi.fn(() => true),
    mockGetWorkflowRun: vi.fn(),
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

vi.mock("@/lib/workflow-runner/runsRepository", () => ({
  getWorkflowRun: (...args: unknown[]) => mockGetWorkflowRun(...args),
}));

import { GET } from "../route";

const BASE = "http://localhost:3000/api/v1/runs/run_1";

function createRequest(headers?: HeadersInit): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: new URL(BASE),
  } as unknown as NextRequest;
}

function params(runId: string) {
  return { params: Promise.resolve({ runId }) };
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

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDatabaseConfigured.mockReturnValue(true);
});

describe("/api/v1/runs/[runId] GET", () => {
  it("returns a run's status, progress, and outputs", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetWorkflowRun.mockResolvedValue({
      id: "run_1",
      status: "succeeded",
      progress: { nodes: [{ nodeId: "gen1", type: "nanoBanana", status: "succeeded" }] },
      outputs: [{ nodeId: "gen1", assetId: "asset_9", url: "https://cdn/x.png" }],
      errorCode: null,
      errorMessage: null,
    });

    const response = await GET(createRequest({ authorization: "Bearer nb_x" }), params("run_1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.status).toBe("succeeded");
    expect(data.outputs[0].assetId).toBe("asset_9");
    expect(mockGetWorkflowRun).toHaveBeenCalledWith("ws_1", "run_1");
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "projects:read" }),
    );
  });

  it("returns 404 for an unknown run", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetWorkflowRun.mockResolvedValue(null);

    const response = await GET(createRequest({ authorization: "Bearer nb_x" }), params("nope"));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error.code).toBe("not_found");
  });

  it("passes through the auth layer's 401 for an invalid token", async () => {
    mockAuthorize.mockResolvedValue({
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Invalid or revoked API token." },
        { status: 401 },
      ),
    });

    const response = await GET(createRequest({ authorization: "Bearer nb_bad" }), params("run_1"));

    expect(response.status).toBe(401);
    expect(mockGetWorkflowRun).not.toHaveBeenCalled();
  });
});
