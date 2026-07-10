import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentOSSession } from "@/lib/studio/authz";
import { getPermissionsForRole } from "@/lib/studio/authz";

const { mockListSocialPosts, mockListSocialAccounts } = vi.hoisted(() => ({
  mockListSocialPosts: vi.fn(),
  mockListSocialAccounts: vi.fn(),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialPosts: (...args: unknown[]) => mockListSocialPosts(...args),
  listSocialAccounts: (...args: unknown[]) => mockListSocialAccounts(...args),
}));

import { runTool } from "../../runtime";
import { listSocialPostsTool } from "../list-social-posts";

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

function accounts() {
  return [
    { id: "sacct_x", platform: "x" },
    { id: "sacct_bsky", platform: "bluesky" },
  ];
}

function postRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "spost_1",
    workspaceId: "ws_1",
    socialAccountId: "sacct_x",
    status: "queued",
    dispatchStatus: "pending",
    content: "Hello world",
    scheduledAt: new Date("2026-07-10T15:00:00.000Z"),
    publishedAt: null,
    lastDispatchError: null,
    errorMessage: null,
    platformPostUrl: null,
    createdAt: new Date("2026-07-10T14:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListSocialAccounts.mockResolvedValue(accounts());
});

describe("list_social_posts tool", () => {
  it("returns post summaries with platform, dispatch status and failure reason", async () => {
    mockListSocialPosts.mockResolvedValue([
      postRow(),
      postRow({
        id: "spost_2",
        socialAccountId: "sacct_bsky",
        status: "failed",
        dispatchStatus: "failed",
        content: null,
        publishedAt: null,
        lastDispatchError: "Rate limited by the platform.",
      }),
    ]);

    const result = await runTool(
      listSocialPostsTool,
      {},
      { session: session("owner", "ws_1") },
    );

    expect(mockListSocialPosts).toHaveBeenCalledWith("ws_1", {
      status: undefined,
      socialAccountId: undefined,
      startDate: undefined,
      endDate: undefined,
      limit: undefined,
    });
    expect(result.posts).toEqual([
      {
        postId: "spost_1",
        socialAccountId: "sacct_x",
        platform: "x",
        status: "queued",
        dispatchStatus: "pending",
        content: "Hello world",
        scheduledAt: "2026-07-10T15:00:00.000Z",
        publishedAt: null,
        failureReason: null,
        releaseUrl: null,
        createdAt: "2026-07-10T14:00:00.000Z",
      },
      {
        postId: "spost_2",
        socialAccountId: "sacct_bsky",
        platform: "bluesky",
        status: "failed",
        dispatchStatus: "failed",
        content: null,
        scheduledAt: "2026-07-10T15:00:00.000Z",
        publishedAt: null,
        failureReason: "Rate limited by the platform.",
        releaseUrl: null,
        createdAt: "2026-07-10T14:00:00.000Z",
      },
    ]);
  });

  it("forwards status, account, date-range and limit filters to the repository", async () => {
    mockListSocialPosts.mockResolvedValue([]);

    await runTool(
      listSocialPostsTool,
      {
        status: "published",
        socialAccountId: "sacct_x",
        startDate: "2026-07-01T00:00:00.000Z",
        endDate: "2026-07-31T00:00:00.000Z",
        limit: 25,
      },
      { session: session("owner", "ws_1") },
    );

    expect(mockListSocialPosts).toHaveBeenCalledWith("ws_1", {
      status: "published",
      socialAccountId: "sacct_x",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-31T00:00:00.000Z"),
      limit: 25,
    });
  });

  it("filters to a single platform in-memory using the account map", async () => {
    mockListSocialPosts.mockResolvedValue([
      postRow({ id: "spost_1", socialAccountId: "sacct_x" }),
      postRow({ id: "spost_2", socialAccountId: "sacct_bsky" }),
    ]);

    const result = await runTool(
      listSocialPostsTool,
      { platform: "x" },
      { session: session("owner", "ws_1") },
    );

    expect(result.posts.map((p) => p.postId)).toEqual(["spost_1"]);
  });

  it("rejects an invalid status enum with invalid_input", async () => {
    const error = await runTool(
      listSocialPostsTool,
      { status: "sent" },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("invalid_input");
    expect(mockListSocialPosts).not.toHaveBeenCalled();
  });

  it("denies callers whose role lacks social:view", async () => {
    const memberSession = session("member");
    memberSession.permissions = memberSession.permissions.filter(
      (p) => p !== "social:view",
    );

    const error = await runTool(listSocialPostsTool, {}, {
      session: memberSession,
    }).catch((e) => e);

    expect(error.code).toBe("forbidden");
    expect(mockListSocialPosts).not.toHaveBeenCalled();
  });
});
