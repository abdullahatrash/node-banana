import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mockAuthorizeStudioRequest = vi.fn();
const mockSoftDeleteAsset = vi.fn();

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
  getAsset: vi.fn(),
  softDeleteAsset: (...args: unknown[]) => mockSoftDeleteAsset(...args),
}));

import { DELETE } from "../route";

function createRequest(): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL("http://localhost:3000/api/studio/assets/asset_1"),
  } as unknown as NextRequest;
}

describe("/api/studio/assets/[assetId] DELETE role enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when a member tries to delete an asset", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: false,
      status: 403,
      error: "Only workspace owners and admins can perform this action.",
      reason: "forbidden",
    });

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ assetId: "asset_1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({
      success: false,
      error: "Only workspace owners and admins can perform this action.",
    });
    expect(mockSoftDeleteAsset).not.toHaveBeenCalled();
  });

  it("returns 200 for owner/admin delete", async () => {
    mockAuthorizeStudioRequest.mockResolvedValue({
      authorized: true,
      userId: "user_1",
      workspaceId: "ws_1",
      role: "admin",
    });
    mockSoftDeleteAsset.mockResolvedValue({
      id: "asset_1",
      workspaceId: "ws_1",
      deletedAt: "2026-03-21T10:00:00.000Z",
    });

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ assetId: "asset_1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSoftDeleteAsset).toHaveBeenCalledWith("ws_1", "asset_1");
  });
});
