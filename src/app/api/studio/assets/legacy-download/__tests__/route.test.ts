import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockGetProject = vi.fn();
const mockObjectExistsInS3 = vi.fn();
const mockCreatePresignedDownload = vi.fn();

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/storage", () => ({
  canUseS3Storage: vi.fn(() => true),
  objectExistsInS3: (...args: unknown[]) => mockObjectExistsInS3(...args),
  createPresignedDownload: (...args: unknown[]) => mockCreatePresignedDownload(...args),
}));

vi.mock("@/lib/studio/authz", () => ({
  authorizeStudioRequest: (...args: unknown[]) => mockAuthorizeStudioRequest(...args),
  authzErrorResponse: (result: { status: number; error: string }) =>
    NextResponse.json({ success: false, error: result.error }, { status: result.status }),
}));

vi.mock("@/lib/studio/repository", () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
}));

import { POST } from "../route";

function createRequest(body: unknown): NextRequest {
  return {
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest;
}

describe("/api/studio/assets/legacy-download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePresignedDownload.mockResolvedValue({
      key: "workflows/project_a/generations/file.png",
      downloadUrl: "https://example-download",
      expiresInSeconds: 900,
    });
  });

  it("returns 401 for unauthenticated request", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Please sign in to access AI Studio.",
    });

    const response = await POST(
      createRequest({
        projectId: "proj_1",
        legacyKey: "workflows/project_a/generations/file.png",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 403 when key is outside allowed project legacy prefix", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetProject.mockResolvedValue({
      id: "proj_1",
      sourceDirectoryPath: "project_a",
    });

    const response = await POST(
      createRequest({
        projectId: "proj_1",
        legacyKey: "workflows/project_b/generations/file.png",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({
      success: false,
      error: "Legacy key does not belong to this project.",
    });
  });

  it("returns signed URL for authorized project-owned legacy key", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      workspaceId: "ws_1",
      role: "member",
    });
    mockGetProject.mockResolvedValue({
      id: "proj_1",
      sourceDirectoryPath: "project_a",
    });
    mockObjectExistsInS3.mockResolvedValue(true);

    const response = await POST(
      createRequest({
        projectId: "proj_1",
        legacyKey: "workflows/project_a/generations/file.png",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      key: "workflows/project_a/generations/file.png",
      downloadUrl: "https://example-download",
      expiresInSeconds: 900,
    });
  });
});
