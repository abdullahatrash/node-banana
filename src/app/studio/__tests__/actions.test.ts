import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock setup ────────────────────────────────────────────────────────────────

const mockIsDatabaseConfigured = vi.fn(() => true);
const mockGetDb = vi.fn();

vi.mock("next/headers", () => ({
  headers: vi.fn(() => new Headers()),
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: (...args: unknown[]) => mockIsDatabaseConfigured(...(args as [])),
  getDb: (...args: unknown[]) => mockGetDb(...(args as [])),
}));

const mockGetAuthenticatedUserFromHeaders = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getAuthenticatedUserFromHeaders: (...args: unknown[]) =>
    mockGetAuthenticatedUserFromHeaders(...args),
}));

const mockListProjects = vi.fn();
const mockGetProject = vi.fn();
const mockSoftDeleteProject = vi.fn();
const mockListProjectAssets = vi.fn();
const mockEnsurePersonalWorkspaceForUser = vi.fn();

vi.mock("@/lib/studio/repository", () => ({
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  getProject: (...args: unknown[]) => mockGetProject(...args),
  softDeleteProject: (...args: unknown[]) => mockSoftDeleteProject(...args),
  listProjectAssets: (...args: unknown[]) => mockListProjectAssets(...args),
  ensurePersonalWorkspaceForUser: (...args: unknown[]) =>
    mockEnsurePersonalWorkspaceForUser(...args),
}));

// Chainable Drizzle stub — built fresh per test via buildDbStub(result)
function buildDbStub(membershipRows: { workspaceId: string }[]) {
  const stub = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(membershipRows),
  };
  return stub;
}

import {
  fetchProjects,
  fetchProjectDetail,
  deleteProject,
} from "../actions";

// ── Tests ─────────────────────────────────────────────────────────────────────

const AUTHED_USER = {
  id: "user_1",
  name: "Alice",
  email: "alice@example.com",
};

describe("studio server actions — workspace membership authz", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseConfigured.mockReturnValue(true);
    mockGetAuthenticatedUserFromHeaders.mockResolvedValue(AUTHED_USER);
  });

  // ── Case 5: DB not configured ─────────────────────────────────────────────

  describe("when database is not configured", () => {
    it("fetchProjects returns [] without calling auth", async () => {
      mockIsDatabaseConfigured.mockReturnValue(false);
      const result = await fetchProjects("ws_1");
      expect(result).toEqual([]);
      expect(mockGetAuthenticatedUserFromHeaders).not.toHaveBeenCalled();
      expect(mockListProjects).not.toHaveBeenCalled();
    });
  });

  // ── Case 1: Unauthenticated ───────────────────────────────────────────────

  describe("when user is not authenticated", () => {
    beforeEach(() => {
      mockGetAuthenticatedUserFromHeaders.mockResolvedValue(null);
    });

    it("fetchProjects rejects with 'Not authenticated.' and does not call listProjects", async () => {
      await expect(fetchProjects("ws_1")).rejects.toThrow("Not authenticated.");
      expect(mockListProjects).not.toHaveBeenCalled();
    });
  });

  // ── Case 2: Non-member (IDOR regression) ─────────────────────────────────

  describe("when user is not a member of the workspace (IDOR regression)", () => {
    beforeEach(() => {
      // membership query returns empty — user is NOT a member
      mockGetDb.mockReturnValue(buildDbStub([]));
    });

    it("fetchProjects rejects with 'no access' and does not call listProjects", async () => {
      await expect(fetchProjects("ws_other")).rejects.toThrow(
        "You do not have access to this workspace.",
      );
      expect(mockListProjects).not.toHaveBeenCalled();
    });

    it("fetchProjectDetail rejects with 'no access' and does not call getProject", async () => {
      await expect(fetchProjectDetail("ws_other", "proj_1")).rejects.toThrow(
        "You do not have access to this workspace.",
      );
      expect(mockGetProject).not.toHaveBeenCalled();
    });

    it("deleteProject rejects with 'no access' and does not call softDeleteProject", async () => {
      await expect(deleteProject("ws_other", "proj_1")).rejects.toThrow(
        "You do not have access to this workspace.",
      );
      expect(mockSoftDeleteProject).not.toHaveBeenCalled();
    });
  });

  // ── Case 3: Member happy path ─────────────────────────────────────────────

  describe("when user is a member of the workspace", () => {
    beforeEach(() => {
      mockGetDb.mockReturnValue(buildDbStub([{ workspaceId: "ws_1" }]));
    });

    it("fetchProjects returns mapped project summaries", async () => {
      mockListProjects.mockResolvedValue([
        {
          id: "proj_1",
          workspaceId: "ws_1",
          name: "My Project",
          slug: "my-project",
          description: "desc",
          status: "active",
          sourceDirectoryPath: "/path",
          updatedAt: new Date("2024-01-01"),
        },
      ]);

      const result = await fetchProjects("ws_1");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("proj_1");
      expect(result[0].name).toBe("My Project");
      expect(mockListProjects).toHaveBeenCalledWith("ws_1");
    });

    it("deleteProject resolves when softDeleteProject returns truthy", async () => {
      mockSoftDeleteProject.mockResolvedValue(true);
      await expect(deleteProject("ws_1", "proj_1")).resolves.toBeUndefined();
      expect(mockSoftDeleteProject).toHaveBeenCalledWith("ws_1", "proj_1");
    });
  });

  // ── Case 4: deleteProject not-found ───────────────────────────────────────

  describe("when deleteProject target project does not exist", () => {
    beforeEach(() => {
      mockGetDb.mockReturnValue(buildDbStub([{ workspaceId: "ws_1" }]));
      mockSoftDeleteProject.mockResolvedValue(false);
    });

    it("rejects with 'Project not found.'", async () => {
      await expect(deleteProject("ws_1", "proj_missing")).rejects.toThrow(
        "Project not found.",
      );
    });
  });
});
