import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockResolveWorkspaceIdByRawToken,
  mockIsDatabaseConfigured,
  mockSelectRows,
  mockWithApiPermission,
  mockResolvePermissions,
} = vi.hoisted(() => ({
  mockResolveWorkspaceIdByRawToken: vi.fn(),
  mockIsDatabaseConfigured: vi.fn(() => true),
  mockSelectRows: vi.fn(),
  mockWithApiPermission: vi.fn(),
  mockResolvePermissions: vi.fn(() => ["workspaces:read"]),
}));

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => mockSelectRows()),
    })),
  })),
};

// Prevent Better Auth's server module (and its DB probe) from loading eagerly
// when the real authz layer is imported.
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mockIsDatabaseConfigured(),
  getDb: vi.fn(() => mockDb),
}));

vi.mock("@/lib/api-tokens/repository", () => ({
  resolveApiTokenAuthorityByRawToken: async (...args: unknown[]) => {
    const workspaceId = await mockResolveWorkspaceIdByRawToken(...args);
    return workspaceId ? { workspaceId, createdByUserId: "owner-scoped" } : null;
  },
  resolveWorkspaceIdByRawToken: (...args: unknown[]) =>
    mockResolveWorkspaceIdByRawToken(...args),
}));

// Session-auth fallback lives in the studio authz layer; the public route
// delegates to it when no Bearer token is present.
vi.mock("@/lib/studio/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/studio/authz")>(
    "@/lib/studio/authz",
  );
  return {
    ...actual,
    withApiPermission: (...args: unknown[]) => mockWithApiPermission(...args),
    resolveWorkspaceMemberPermissions: (input: unknown) => mockResolvePermissions(input),
  };
});

import { GET } from "../route";

function createRequest(headers?: HeadersInit): NextRequest {
  return {
    headers: new Headers(headers),
    nextUrl: new URL("http://localhost:3000/api/v1/workspaces"),
  } as unknown as NextRequest;
}

describe("/api/v1/workspaces GET (Bearer token path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
  });

  it("returns 503 when the database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);

    const response = await GET(
      createRequest({ authorization: "Bearer nb_validtoken" }),
    );
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.success).toBe(false);
  });

  it("returns exactly the workspace the token is scoped to", async () => {
    mockResolveWorkspaceIdByRawToken.mockResolvedValue("ws_scoped");
    mockSelectRows.mockResolvedValueOnce([
      { id: "ws_scoped", name: "Scoped Workspace", slug: "scoped-workspace" },
    ]);

    const response = await GET(
      createRequest({ authorization: "Bearer nb_validtoken" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      workspaces: [
        { id: "ws_scoped", name: "Scoped Workspace", slug: "scoped-workspace" },
      ],
    });
    expect(mockResolveWorkspaceIdByRawToken).toHaveBeenCalledWith(
      "nb_validtoken",
    );
    // Token path must never fall through to session auth.
    expect(mockWithApiPermission).not.toHaveBeenCalled();
  });

  it("returns 401 for a missing/invalid token (unknown hash)", async () => {
    mockResolveWorkspaceIdByRawToken.mockResolvedValue(null);

    const response = await GET(
      createRequest({ authorization: "Bearer nb_bogus" }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(mockSelectRows).not.toHaveBeenCalled();
  });

  it("returns 401 for a revoked token (resolves to null)", async () => {
    mockResolveWorkspaceIdByRawToken.mockResolvedValue(null);

    const response = await GET(
      createRequest({ authorization: "Bearer nb_revoked" }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects a malformed Bearer value that is not an nb_ token with 401", async () => {
    const response = await GET(
      createRequest({ authorization: "Bearer not-an-nb-token" }),
    );

    expect(response.status).toBe(401);
    // A non-nb_ bearer must not be treated as a session request.
    expect(mockWithApiPermission).not.toHaveBeenCalled();
    expect(mockResolveWorkspaceIdByRawToken).not.toHaveBeenCalled();
  });

  it("falls back to session auth when no Authorization header is present", async () => {
    mockWithApiPermission.mockResolvedValue({
      authorized: true,
      session: {
        user: { id: "user_1", name: null, email: null },
        workspace: { id: "ws_session", organizationId: null },
        role: "owner",
        planTier: "free",
        permissions: ["workspaces:read"],
      },
    });
    mockSelectRows.mockResolvedValueOnce([
      { id: "ws_session", name: "Session Workspace", slug: "session-workspace" },
    ]);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.workspaces).toEqual([
      {
        id: "ws_session",
        name: "Session Workspace",
        slug: "session-workspace",
      },
    ]);
    expect(mockWithApiPermission).toHaveBeenCalled();
  });
});
