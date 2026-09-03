import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { getPermissionsForRole } from "@/lib/studio/authz";

const {
  mockAuthorize,
  mockIsDatabaseConfigured,
  mockListSocialPosts,
  mockListSocialAccounts,
  mockGetSocialAccount,
  mockCreateSocialPost,
  mockUpdatePostStatus,
  mockCountSocialPostsCreatedInRange,
  mockEmitSocialEvent,
  mockValidatePublishingSettings,
  mockInspectPublishingApproval,
  mockConsumePublishingApproval,
} = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockIsDatabaseConfigured: vi.fn(() => true),
  mockListSocialPosts: vi.fn(),
  mockListSocialAccounts: vi.fn(),
  mockGetSocialAccount: vi.fn(),
  mockCreateSocialPost: vi.fn(),
  mockUpdatePostStatus: vi.fn(),
  mockCountSocialPostsCreatedInRange: vi.fn(),
  mockEmitSocialEvent: vi.fn(),
  mockValidatePublishingSettings: vi.fn(),
  mockInspectPublishingApproval: vi.fn(),
  mockConsumePublishingApproval: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => mockIsDatabaseConfigured(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/api-tokens/auth", () => ({
  authorizePublicApiRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

vi.mock("@/lib/social/repository", () => ({
  listSocialPosts: (...args: unknown[]) => mockListSocialPosts(...args),
  listSocialAccounts: (...args: unknown[]) => mockListSocialAccounts(...args),
  getSocialAccount: (...args: unknown[]) => mockGetSocialAccount(...args),
  createSocialPost: (...args: unknown[]) => mockCreateSocialPost(...args),
  updatePostStatus: (...args: unknown[]) => mockUpdatePostStatus(...args),
  countSocialPostsCreatedInRange: (...args: unknown[]) =>
    mockCountSocialPostsCreatedInRange(...args),
  SocialAccountNotFoundError: class extends Error {},
}));

vi.mock("@/lib/studio/repository", () => ({
  getAsset: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  buildCdnDownloadUrl: vi.fn(() => null),
  createPresignedDownload: vi.fn(),
}));

vi.mock("@/lib/social/events", () => ({
  emitSocialEvent: (...args: unknown[]) => mockEmitSocialEvent(...args),
}));

vi.mock("@/lib/social/publishing-settings", () => ({
  validateSelectedPublishingSettings: (...args: unknown[]) =>
    mockValidatePublishingSettings(...args),
}));

vi.mock("@/lib/agent-tools/social-publishing-approval", () => ({
  exactApprovedSocialPostInput: () => true,
  PRODUCTION_SOCIAL_PUBLISHING_APPROVAL_ADMISSION: {
    inspect: (...args: unknown[]) => mockInspectPublishingApproval(...args),
    consume: (...args: unknown[]) => mockConsumePublishingApproval(...args),
  },
}));

import { GET, POST } from "../route";

function authorized(workspaceId = "ws_1") {
  return {
    authorized: true,
    session: {
      user: { id: `apitoken:${workspaceId}`, name: null, email: null },
      workspace: { id: workspaceId, organizationId: null },
      role: "owner" as const,
      planTier: "free" as const,
      permissions: getPermissionsForRole("owner"),
    },
  };
}

function getRequest(query = ""): NextRequest {
  return {
    headers: new Headers({ authorization: "Bearer nb_valid" }),
    nextUrl: new URL(`http://localhost:3000/api/v1/social-posts${query}`),
  } as unknown as NextRequest;
}

function postRequest(body: unknown): NextRequest {
  return {
    headers: new Headers({ authorization: "Bearer nb_valid" }),
    nextUrl: new URL("http://localhost:3000/api/v1/social-posts"),
    json: async () => body,
  } as unknown as NextRequest;
}

function publishingApproval() {
  return {
    approvalRequestId: "par_approved",
    targetId: "target_x",
    targetEvidenceDigest: `sha256:${"a".repeat(64)}`,
    consumingPrincipalId: "principal_agent",
    consumingKeyId: "key_agent",
    authorizationEvidenceRef: "authz-agent-release",
    authorizationIssuedAt: "2026-07-10T14:00:00.000Z",
    authorizationExpiresAt: "2026-07-10T16:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDatabaseConfigured.mockReturnValue(true);
  mockListSocialAccounts.mockResolvedValue([{ id: "sacct_x", platform: "x" }]);
  mockCountSocialPostsCreatedInRange.mockResolvedValue(0);
  mockValidatePublishingSettings.mockReturnValue({ valid: true, errors: [] });
  mockInspectPublishingApproval.mockImplementation(async ({ evidence }) => ({
    requestId: evidence.approvalRequestId,
    decisionId: "pad_approved",
    channelIds: ["sacct_x"],
    artifactIds: ["artifact_text"],
    evidence,
    target: {
      targetId: evidence.targetId,
      channel: { id: "sacct_x", platform: "x", authorKind: "organization", displayName: "Acme", historical: false },
      content: { artifactId: "artifact_text", digest: `sha256:${"b".repeat(64)}`, mediaType: "text/plain; charset=utf-8", text: "Scheduled" },
      media: [],
      settings: {},
      timing: { kind: "scheduled", publishAt: "2026-07-10T15:00:00.000Z" },
      targetEvidenceDigest: evidence.targetEvidenceDigest,
      validation: {},
      costContext: null,
    },
  }));
  mockConsumePublishingApproval.mockResolvedValue("consumed");
});

describe("/api/v1/social-posts GET", () => {
  it("returns 503 when the database is not configured", async () => {
    mockIsDatabaseConfigured.mockReturnValue(false);
    const response = await GET(getRequest());
    expect(response.status).toBe(503);
  });

  it("lists posts through the registry handler and forwards the status filter", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockListSocialPosts.mockResolvedValue([
      {
        id: "spost_1",
        socialAccountId: "sacct_x",
        status: "queued",
        dispatchStatus: "pending",
        content: "hi",
        scheduledAt: new Date("2026-07-10T15:00:00.000Z"),
        publishedAt: null,
        lastDispatchError: null,
        errorMessage: null,
        platformPostUrl: null,
        createdAt: new Date("2026-07-10T14:00:00.000Z"),
      },
    ]);

    const response = await GET(getRequest("?status=queued&limit=10"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.posts).toHaveLength(1);
    expect(data.posts[0].postId).toBe("spost_1");
    expect(data.posts[0].platform).toBe("x");
    expect(mockListSocialPosts).toHaveBeenCalledWith(
      "ws_1",
      expect.objectContaining({ status: "queued", limit: 10 }),
    );
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "social:view" }),
    );
  });

  it("passes through the auth layer's 401", async () => {
    mockAuthorize.mockResolvedValue({
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Invalid or revoked API token." },
        { status: 401 },
      ),
    });
    const response = await GET(getRequest());
    expect(response.status).toBe(401);
    expect(mockListSocialPosts).not.toHaveBeenCalled();
  });
});

describe("/api/v1/social-posts POST", () => {
  it("creates a draft and returns 201", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetSocialAccount.mockResolvedValue({
      id: "sacct_x",
      platform: "x",
      displayName: "Acme",
      disabled: false,
      requiresReauth: false,
    });
    mockCreateSocialPost.mockResolvedValue({
      id: "spost_new",
      status: "draft",
      scheduledAt: null,
    });

    const response = await POST(
      postRequest({ socialAccountId: "sacct_x", content: "Hello", draft: true }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.postId).toBe("spost_new");
    expect(data.status).toBe("draft");
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ permission: "social:publish" }),
    );
  });

  it("schedules a post and returns its queued status", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetSocialAccount.mockResolvedValue({
      id: "sacct_x",
      platform: "x",
      displayName: "Acme",
      disabled: false,
      requiresReauth: false,
    });
    mockCreateSocialPost.mockResolvedValue({ id: "spost_new", status: "draft" });
    mockUpdatePostStatus.mockResolvedValue({
      id: "spost_new",
      status: "queued",
      scheduledAt: new Date("2026-07-10T15:00:00.000Z"),
    });

    const response = await POST(
      postRequest({
        socialAccountId: "sacct_x",
        content: "Scheduled",
        scheduledAt: "2026-07-10T15:00:00.000Z",
        publishingApproval: publishingApproval(),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.status).toBe("queued");
    expect(data.scheduledAt).toBe("2026-07-10T15:00:00.000Z");
    expect(mockEmitSocialEvent).toHaveBeenCalled();
  });

  it("returns a structured 400 for an empty post", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    mockGetSocialAccount.mockResolvedValue({
      id: "sacct_x",
      platform: "x",
      displayName: "Acme",
      disabled: false,
      requiresReauth: false,
    });

    const response = await POST(
      postRequest({ socialAccountId: "sacct_x", draft: true }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("invalid_input");
    expect(data.error.fix).toBeTruthy();
    expect(mockCreateSocialPost).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    mockAuthorize.mockResolvedValue(authorized("ws_1"));
    const badRequest = {
      headers: new Headers({ authorization: "Bearer nb_valid" }),
      nextUrl: new URL("http://localhost:3000/api/v1/social-posts"),
      json: async () => {
        throw new Error("Unexpected token");
      },
    } as unknown as NextRequest;

    const response = await POST(badRequest);
    expect(response.status).toBe(400);
  });
});
