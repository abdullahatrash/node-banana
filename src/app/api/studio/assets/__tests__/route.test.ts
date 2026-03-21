import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockListProjectAssets = vi.fn();
const mockGetProject = vi.fn();
const mockRecordAsset = vi.fn();

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
  getProject: (...args: unknown[]) => mockGetProject(...args),
  listProjectAssets: (...args: unknown[]) => mockListProjectAssets(...args),
  recordAsset: (...args: unknown[]) => mockRecordAsset(...args),
}));

import { GET, POST } from "../route";

function createGetRequest(projectId = "proj_1"): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL(`http://localhost:3000/api/studio/assets?projectId=${projectId}`),
  } as unknown as NextRequest;
}

function createPostRequest(body: unknown): NextRequest {
  return {
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest;
}

describe("/api/studio/assets auth hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated GET requests", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Please sign in to access AI Studio.",
      reason: "unauthenticated",
    });

    const response = await GET(createGetRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      success: false,
      error: "Please sign in to access AI Studio.",
    });
  });

  it("returns project assets for authorized workspace members", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockListProjectAssets.mockResolvedValue([{ id: "asset_1", projectId: "proj_1" }]);

    const response = await GET(createGetRequest("proj_1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.assets).toHaveLength(1);
    expect(mockListProjectAssets).toHaveBeenCalledWith("ws_1", "proj_1");
    expect(mockAuthorizeStudioRequest).toHaveBeenCalledWith(
      expect.anything(),
      {
        route: "/api/studio/assets",
        action: "read",
      },
    );
  });

  it("returns 403 when POST references a project outside the workspace", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetProject.mockResolvedValue(null);

    const response = await POST(
      createPostRequest({
        projectId: "proj_other",
        type: "image",
        storageProvider: "local",
        storageKey: "/tmp/image.png",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({
      success: false,
      error: "No access to this project.",
    });
    expect(mockRecordAsset).not.toHaveBeenCalled();
  });

  it("records asset metadata for authorized POST requests", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetProject.mockResolvedValue({ id: "proj_1", workspaceId: "ws_1" });
    mockRecordAsset.mockResolvedValue({
      id: "asset_1",
      projectId: "proj_1",
      workspaceId: "ws_1",
    });

    const response = await POST(
      createPostRequest({
        projectId: "proj_1",
        type: "image",
        storageProvider: "local",
        storageKey: "/tmp/image.png",
        mimeType: "image/png",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockRecordAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws_1",
        userId: "user_1",
        projectId: "proj_1",
        type: "image",
        storageProvider: "local",
        storageKey: "/tmp/image.png",
      }),
    );
    expect(mockAuthorizeStudioRequest).toHaveBeenCalledWith(
      expect.anything(),
      {
        route: "/api/studio/assets",
        action: "write",
      },
    );
  });
});
