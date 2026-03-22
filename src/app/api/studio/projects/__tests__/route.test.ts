import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockListProjects = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/studio/authz", () => {
  return {
    authorizeStudioRequest: (...args: unknown[]) => mockAuthorizeStudioRequest(...args),
    authzErrorResponse: (result: { status: number; error: string }) =>
      NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: result.status },
      ),
  };
});

vi.mock("@/lib/studio/repository", () => ({
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  upsertProject: vi.fn(),
}));

import { GET } from "../route";

function createRequest(): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL("http://localhost:3000/api/studio/projects"),
  } as unknown as NextRequest;
}

describe("/api/studio/projects GET auth hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Please sign in to access AI Studio.",
      reason: "unauthenticated",
    });

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      success: false,
      error: "Please sign in to access AI Studio.",
    });
  });

  it("returns 403 for authenticated non-members", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 403,
      error: "No access to this workspace.",
      reason: "forbidden",
    });

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({
      success: false,
      error: "No access to this workspace.",
    });
  });

  it("returns 200 for workspace members", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockListProjects.mockResolvedValue([{ id: "proj_1", name: "Project One" }]);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.projects).toHaveLength(1);
    expect(mockAuthorizeStudioRequest).toHaveBeenCalledWith(
      expect.anything(),
      {
        route: "/api/studio/projects",
        action: "read",
      },
    );
    expect(mockListProjects).toHaveBeenCalledWith("ws_1");
  });
});
