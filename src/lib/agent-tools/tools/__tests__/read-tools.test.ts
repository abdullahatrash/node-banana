import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentOSSession } from "@/lib/studio/authz";
import { getPermissionsForRole } from "@/lib/studio/authz";

const {
  mockGetWorkspaceById,
  mockListWorkspaceAssets,
  mockListSocialAccounts,
} = vi.hoisted(() => ({
  mockGetWorkspaceById: vi.fn(),
  mockListWorkspaceAssets: vi.fn(),
  mockListSocialAccounts: vi.fn(),
}));

vi.mock("@/lib/studio/repository", () => ({
  getWorkspaceById: (...args: unknown[]) => mockGetWorkspaceById(...args),
  listWorkspaceAssets: (...args: unknown[]) => mockListWorkspaceAssets(...args),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialAccounts: (...args: unknown[]) => mockListSocialAccounts(...args),
}));

import { runTool } from "../../runtime";
import { listAssetsTool } from "../list-assets";
import { listSocialAccountsTool } from "../list-social-accounts";
import { listWorkspacesTool } from "../list-workspaces";

function session(
  role: "owner" | "member" = "owner",
  workspaceId = "ws_1",
): ContentOSSession {
  return {
    user: { id: `apitoken:${workspaceId}`, name: null, email: null },
    workspace: { id: workspaceId, organizationId: null },
    role,
    planTier: "free",
    permissions: getPermissionsForRole(role),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_workspaces tool", () => {
  it("returns the single workspace the token is scoped to", async () => {
    mockGetWorkspaceById.mockResolvedValue({
      id: "ws_1",
      name: "Acme Brand",
      slug: "acme-brand",
    });

    const result = await runTool(
      listWorkspacesTool,
      {},
      { session: session("owner", "ws_1") },
    );

    expect(result).toEqual({
      workspaces: [{ id: "ws_1", name: "Acme Brand", slug: "acme-brand" }],
    });
    expect(mockGetWorkspaceById).toHaveBeenCalledWith("ws_1");
  });

  it("returns an empty list when the scoped workspace is gone", async () => {
    mockGetWorkspaceById.mockResolvedValue(null);

    const result = await runTool(listWorkspacesTool, {}, { session: session() });

    expect(result).toEqual({ workspaces: [] });
  });
});

describe("list_social_accounts tool", () => {
  it("maps accounts to safe fields and never leaks encrypted tokens", async () => {
    mockListSocialAccounts.mockResolvedValue([
      {
        id: "sacct_1",
        workspaceId: "ws_1",
        platform: "x",
        platformUserId: "12345",
        displayName: "Acme on X",
        username: "acme",
        avatarUrl: "https://cdn/avatar.png",
        accessTokenEncrypted: "SECRET-ENCRYPTED",
        refreshTokenEncrypted: "SECRET-REFRESH",
        accessTokenSecret: "SECRET-SECRET",
        tokenExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
        requiresReauth: false,
        disabled: false,
        createdAt: new Date("2025-12-01T00:00:00.000Z"),
      },
    ]);

    const result = await runTool(
      listSocialAccountsTool,
      {},
      { session: session("owner", "ws_1") },
    );

    expect(mockListSocialAccounts).toHaveBeenCalledWith("ws_1");
    expect(result.accounts).toEqual([
      {
        id: "sacct_1",
        platform: "x",
        platformUserId: "12345",
        displayName: "Acme on X",
        username: "acme",
        avatarUrl: "https://cdn/avatar.png",
        tokenExpiresAt: "2026-01-01T00:00:00.000Z",
        requiresReauth: false,
        disabled: false,
        createdAt: "2025-12-01T00:00:00.000Z",
      },
    ]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SECRET-ENCRYPTED");
    expect(serialized).not.toContain("SECRET-REFRESH");
    expect(serialized).not.toContain("SECRET-SECRET");
  });

  it("denies callers whose role lacks social:view", async () => {
    const memberSession = session("member");
    memberSession.permissions = memberSession.permissions.filter(
      (p) => p !== "social:view",
    );

    const error = await runTool(listSocialAccountsTool, {}, {
      session: memberSession,
    }).catch((e) => e);

    expect(error.code).toBe("forbidden");
  });
});

describe("list_assets tool", () => {
  it("returns workspace assets with safe metadata", async () => {
    mockListWorkspaceAssets.mockResolvedValue([
      {
        id: "asset_1",
        workspaceId: "ws_1",
        projectId: "proj_1",
        type: "image",
        mimeType: "image/png",
        sizeBytes: 2048,
        width: 512,
        height: 512,
        durationSeconds: null,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);

    const result = await runTool(
      listAssetsTool,
      { type: "image", limit: 10 },
      { session: session("owner", "ws_1") },
    );

    expect(mockListWorkspaceAssets).toHaveBeenCalledWith("ws_1", {
      type: "image",
      limit: 10,
    });
    expect(result.assets).toEqual([
      {
        id: "asset_1",
        projectId: "proj_1",
        type: "image",
        mimeType: "image/png",
        sizeBytes: 2048,
        width: 512,
        height: 512,
        durationSeconds: null,
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
  });

  it("passes no filters through when none are supplied", async () => {
    mockListWorkspaceAssets.mockResolvedValue([]);

    const result = await runTool(
      listAssetsTool,
      {},
      { session: session("owner", "ws_1") },
    );

    expect(mockListWorkspaceAssets).toHaveBeenCalledWith("ws_1", {
      type: undefined,
      limit: undefined,
    });
    expect(result).toEqual({ assets: [] });
  });

  it("rejects an out-of-range limit with invalid_input", async () => {
    const error = await runTool(
      listAssetsTool,
      { limit: 9999 },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("invalid_input");
    expect(mockListWorkspaceAssets).not.toHaveBeenCalled();
  });
});
