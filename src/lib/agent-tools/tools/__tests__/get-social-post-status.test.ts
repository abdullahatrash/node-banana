import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentOSSession } from "@/lib/studio/authz";
import { getPermissionsForRole } from "@/lib/studio/authz";

const { mockGetSocialPost, MockSocialPostNotFoundError } = vi.hoisted(() => {
  class MockSocialPostNotFoundError extends Error {
    constructor(postId: string) {
      super(`Social post not found: ${postId}`);
      this.name = "SocialPostNotFoundError";
    }
  }
  return { mockGetSocialPost: vi.fn(), MockSocialPostNotFoundError };
});

vi.mock("@/lib/social/repository", () => ({
  getSocialPost: (...args: unknown[]) => mockGetSocialPost(...args),
  SocialPostNotFoundError: MockSocialPostNotFoundError,
}));

import { runTool } from "../../runtime";
import { getSocialPostStatusTool } from "../get-social-post-status";

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

function postRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "spost_1",
    workspaceId: "ws_1",
    socialAccountId: "sacct_1",
    status: "published",
    dispatchStatus: "dispatched",
    dispatchAttempts: 2,
    retryCount: 1,
    scheduledAt: new Date("2026-07-10T15:00:00.000Z"),
    publishedAt: new Date("2026-07-10T15:00:05.000Z"),
    nextDispatchAt: null,
    lastDispatchError: null,
    errorMessage: null,
    platformPostId: "tweet_123",
    platformPostUrl: "https://x.com/acme/status/123",
    createdAt: new Date("2026-07-10T14:00:00.000Z"),
    updatedAt: new Date("2026-07-10T15:00:05.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("get_social_post_status tool", () => {
  it("returns the full dispatch state for a published post", async () => {
    mockGetSocialPost.mockResolvedValue(postRow());

    const result = await runTool(
      getSocialPostStatusTool,
      { postId: "spost_1" },
      { session: session("owner", "ws_1") },
    );

    expect(mockGetSocialPost).toHaveBeenCalledWith("ws_1", "spost_1");
    expect(result).toEqual({
      postId: "spost_1",
      socialAccountId: "sacct_1",
      status: "published",
      dispatchStatus: "dispatched",
      dispatchAttempts: 2,
      retryCount: 1,
      scheduledAt: "2026-07-10T15:00:00.000Z",
      publishedAt: "2026-07-10T15:00:05.000Z",
      nextDispatchAt: null,
      lastError: null,
      platformPostId: "tweet_123",
      releaseUrl: "https://x.com/acme/status/123",
      createdAt: "2026-07-10T14:00:00.000Z",
      updatedAt: "2026-07-10T15:00:05.000Z",
    });
  });

  it("surfaces the dispatch failure reason for a failed post", async () => {
    mockGetSocialPost.mockResolvedValue(
      postRow({
        status: "failed",
        dispatchStatus: "failed",
        publishedAt: null,
        platformPostId: null,
        platformPostUrl: null,
        lastDispatchError: "X API rejected the media upload.",
        errorMessage: "Dispatch failed after maximum retry attempts.",
      }),
    );

    const result = await runTool(
      getSocialPostStatusTool,
      { postId: "spost_1" },
      { session: session("owner", "ws_1") },
    );

    expect(result.status).toBe("failed");
    expect(result.lastError).toBe("X API rejected the media upload.");
    expect(result.releaseUrl).toBeNull();
  });

  it("falls back to errorMessage when there is no dispatch error", async () => {
    mockGetSocialPost.mockResolvedValue(
      postRow({
        status: "failed",
        lastDispatchError: null,
        errorMessage: "Account requires reconnection.",
      }),
    );

    const result = await runTool(
      getSocialPostStatusTool,
      { postId: "spost_1" },
      { session: session("owner", "ws_1") },
    );

    expect(result.lastError).toBe("Account requires reconnection.");
  });

  it("returns not_found when the post is not in this workspace", async () => {
    mockGetSocialPost.mockRejectedValue(
      new MockSocialPostNotFoundError("spost_missing"),
    );

    const error = await runTool(
      getSocialPostStatusTool,
      { postId: "spost_missing" },
      { session: session("owner", "ws_1") },
    ).catch((e) => e);

    expect(error.code).toBe("not_found");
  });

  it("denies callers whose role lacks social:view", async () => {
    const memberSession = session("member");
    memberSession.permissions = memberSession.permissions.filter(
      (p) => p !== "social:view",
    );

    const error = await runTool(
      getSocialPostStatusTool,
      { postId: "spost_1" },
      { session: memberSession },
    ).catch((e) => e);

    expect(error.code).toBe("forbidden");
    expect(mockGetSocialPost).not.toHaveBeenCalled();
  });
});
