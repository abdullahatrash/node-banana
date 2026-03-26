import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetSession = vi.fn();
const mockEnsureWorkspaceUser = vi.fn();
const mockEnsurePersonalWorkspaceForUser = vi.fn();
const mockSelectRows = vi.fn();
const mockIsDatabaseConfigured = vi.fn(() => true);

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => mockSelectRows()),
      })),
    })),
  })),
};

vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mockIsDatabaseConfigured(),
  getDb: vi.fn(() => mockDb),
}));

vi.mock("@/lib/studio/repository", () => ({
  ensureWorkspaceUser: (...args: unknown[]) => mockEnsureWorkspaceUser(...args),
  ensurePersonalWorkspaceForUser: (...args: unknown[]) =>
    mockEnsurePersonalWorkspaceForUser(...args),
}));

import { GET } from "../route";

function createRequest(headers?: HeadersInit): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: new URL("http://localhost:3000/api/studio/workspaces"),
  } as unknown as NextRequest;
}

describe("/api/studio/workspaces GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    delete process.env.DEV_AUTH_BYPASS;
    delete process.env.DEV_USER_ID;
    delete process.env.DEV_WORKSPACE_ID;
  });

  it("returns 503 when database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);
    mockGetSession.mockResolvedValue({
      user: {
        id: "user_1",
      },
    });

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toEqual({
      success: false,
      error:
        "DATABASE_URL is not configured. Configure Postgres to use workspace APIs.",
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      success: false,
      error: "Please sign in to access AI Studio.",
    });
  });

  it("returns memberships when user has workspaces", async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: "user_1",
        name: "Test User",
        email: "test@example.com",
      },
    });
    mockSelectRows.mockResolvedValueOnce([
      {
        id: "ws_1",
        name: "Workspace One",
        slug: "workspace-one",
        role: "owner",
      },
    ]);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      workspaces: [
        {
          id: "ws_1",
          name: "Workspace One",
          slug: "workspace-one",
          role: "owner",
        },
      ],
    });
    expect(mockEnsurePersonalWorkspaceForUser).not.toHaveBeenCalled();
  });

  it("auto-provisions a workspace when user has none", async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: "user_2",
        name: "No Workspace User",
        email: "noworkspace@example.com",
      },
    });
    mockSelectRows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "ws_new",
          name: "No Workspace User's Workspace",
          slug: "no-workspace-user-workspace",
          role: "owner",
        },
      ]);
    mockEnsurePersonalWorkspaceForUser.mockResolvedValue({
      workspaceId: "ws_new",
      slug: "no-workspace-user-workspace",
    });

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.workspaces).toHaveLength(1);
    expect(mockEnsurePersonalWorkspaceForUser).toHaveBeenCalledWith({
      userId: "user_2",
      userName: "No Workspace User",
      userEmail: "noworkspace@example.com",
    });
  });

  it("supports DEV_AUTH_BYPASS local fallback", async () => {
    process.env.DEV_AUTH_BYPASS = "true";
    process.env.DEV_USER_ID = "dev_user";
    process.env.DEV_WORKSPACE_ID = "dev_workspace";
    mockGetSession.mockResolvedValue(null);
    mockSelectRows.mockResolvedValueOnce([
      {
        id: "dev_workspace",
        name: "Local Workspace",
        slug: "dev-workspace",
        role: "owner",
      },
    ]);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockEnsureWorkspaceUser).toHaveBeenCalledWith(
      "dev_workspace",
      "dev_user",
    );
  });
});
