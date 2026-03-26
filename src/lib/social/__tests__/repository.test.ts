import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OAuthStateExpiredError,
  OAuthStateNotFoundError,
  SocialAccountNotFoundError,
  SocialPostNotFoundError,
  SocialPostStateTransitionError,
} from "@/lib/social/repository";

// Mock the database module
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockReturning = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockSet = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockOffset = vi.fn();

function setupChainableMock(returnValue: unknown[] = []) {
  mockReturning.mockResolvedValue(returnValue);
  mockValues.mockReturnValue({
    returning: mockReturning,
    onConflictDoUpdate: mockOnConflictDoUpdate,
  });
  mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning });
  mockSet.mockReturnValue({ where: mockWhere });

  // select().from().where() returns a thenable (array) directly
  const selectResult = Object.assign(Promise.resolve(returnValue), {
    returning: mockReturning,
    orderBy: mockOrderBy,
    limit: mockLimit,
  });
  mockWhere.mockReturnValue(selectResult);
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockLimit.mockReturnValue({ offset: mockOffset });
  mockOffset.mockReturnValue(Promise.resolve(returnValue));
  mockFrom.mockReturnValue({ where: mockWhere });

  mockInsert.mockReturnValue({ values: mockValues });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockUpdate.mockReturnValue({ set: mockSet });
  mockDelete.mockReturnValue({ where: mockWhere });
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
    delete: mockDelete,
  }),
}));

vi.mock("@/lib/db/schema", () => ({
  socialAccounts: { workspaceId: "workspace_id", id: "id", platform: "platform", platformUserId: "platform_user_id" },
  socialPosts: { workspaceId: "workspace_id", id: "id", status: "status", socialAccountId: "social_account_id", retryCount: "retry_count", createdAt: "created_at" },
  socialOAuthStates: { state: "state", expiresAt: "expires_at" },
}));

describe("social/repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("error classes", () => {
    it("SocialAccountNotFoundError includes id", () => {
      const error = new SocialAccountNotFoundError("sacct_123");
      expect(error.name).toBe("SocialAccountNotFoundError");
      expect(error.message).toContain("sacct_123");
    });

    it("SocialPostNotFoundError includes id", () => {
      const error = new SocialPostNotFoundError("spost_123");
      expect(error.name).toBe("SocialPostNotFoundError");
      expect(error.message).toContain("spost_123");
    });

    it("SocialPostStateTransitionError includes states", () => {
      const error = new SocialPostStateTransitionError("published", "draft");
      expect(error.name).toBe("SocialPostStateTransitionError");
      expect(error.currentStatus).toBe("published");
      expect(error.targetStatus).toBe("draft");
      expect(error.message).toContain("published");
      expect(error.message).toContain("draft");
    });

    it("OAuthStateNotFoundError has correct name", () => {
      const error = new OAuthStateNotFoundError();
      expect(error.name).toBe("OAuthStateNotFoundError");
    });

    it("OAuthStateExpiredError has correct name", () => {
      const error = new OAuthStateExpiredError();
      expect(error.name).toBe("OAuthStateExpiredError");
    });
  });

  describe("createOAuthState", () => {
    it("inserts a new OAuth state", async () => {
      const mockRow = {
        id: "soauth_test",
        state: "test-state",
        workspaceId: "ws_1",
        platform: "linkedin",
      };
      setupChainableMock([mockRow]);

      const { createOAuthState } = await import("@/lib/social/repository");
      const result = await createOAuthState({
        workspaceId: "ws_1",
        platform: "linkedin",
        state: "test-state",
        expiresAt: new Date(Date.now() + 3600_000),
      });

      expect(mockInsert).toHaveBeenCalled();
      expect(result).toEqual(mockRow);
    });
  });

  describe("consumeOAuthState", () => {
    it("deletes and returns valid state", async () => {
      const futureDate = new Date(Date.now() + 3600_000);
      setupChainableMock([
        { id: "soauth_1", state: "test", expiresAt: futureDate },
      ]);

      const { consumeOAuthState } = await import("@/lib/social/repository");
      const result = await consumeOAuthState("test");

      expect(mockDelete).toHaveBeenCalled();
      expect(result.state).toBe("test");
    });

    it("throws OAuthStateNotFoundError for missing state", async () => {
      setupChainableMock([]);

      const { consumeOAuthState } = await import("@/lib/social/repository");
      await expect(consumeOAuthState("missing")).rejects.toThrow(
        OAuthStateNotFoundError,
      );
    });

    it("throws OAuthStateExpiredError for expired state", async () => {
      const pastDate = new Date(Date.now() - 3600_000);
      setupChainableMock([
        { id: "soauth_1", state: "test", expiresAt: pastDate },
      ]);

      const { consumeOAuthState } = await import("@/lib/social/repository");
      await expect(consumeOAuthState("test")).rejects.toThrow(
        OAuthStateExpiredError,
      );
    });
  });

  describe("upsertSocialAccount", () => {
    it("creates a new account with generated ID", async () => {
      const mockAccount = {
        id: "sacct_test",
        platform: "linkedin",
        displayName: "Test User",
      };
      setupChainableMock([mockAccount]);

      const { upsertSocialAccount } = await import("@/lib/social/repository");
      const result = await upsertSocialAccount({
        workspaceId: "ws_1",
        platform: "linkedin",
        platformUserId: "user123",
        displayName: "Test User",
        accessTokenEncrypted: "enc_token",
        createdByUserId: "user_1",
      });

      expect(mockInsert).toHaveBeenCalled();
      expect(result).toEqual(mockAccount);
    });
  });

  describe("getSocialAccount", () => {
    it("throws SocialAccountNotFoundError when not found", async () => {
      setupChainableMock([]);

      const { getSocialAccount } = await import("@/lib/social/repository");
      await expect(
        getSocialAccount("ws_1", "sacct_missing"),
      ).rejects.toThrow(SocialAccountNotFoundError);
    });
  });

  describe("createSocialPost", () => {
    it("creates a draft post", async () => {
      const mockPost = {
        id: "spost_test",
        status: "draft",
        content: "Hello world",
      };
      setupChainableMock([mockPost]);

      const { createSocialPost } = await import("@/lib/social/repository");
      const result = await createSocialPost({
        workspaceId: "ws_1",
        socialAccountId: "sacct_1",
        content: "Hello world",
        createdByUserId: "user_1",
      });

      expect(result.status).toBe("draft");
    });
  });

  describe("updateSocialPost", () => {
    it("rejects update on non-draft post", async () => {
      // getSocialPost returns a published post
      setupChainableMock([
        { id: "spost_1", status: "published", workspaceId: "ws_1" },
      ]);

      const { updateSocialPost } = await import("@/lib/social/repository");
      await expect(
        updateSocialPost("ws_1", "spost_1", { content: "updated" }),
      ).rejects.toThrow(SocialPostStateTransitionError);
    });
  });

  describe("deleteSocialPost", () => {
    it("rejects delete on queued post", async () => {
      setupChainableMock([
        { id: "spost_1", status: "queued", workspaceId: "ws_1" },
      ]);

      const { deleteSocialPost } = await import("@/lib/social/repository");
      await expect(deleteSocialPost("ws_1", "spost_1")).rejects.toThrow(
        SocialPostStateTransitionError,
      );
    });

    it("rejects delete on publishing post", async () => {
      setupChainableMock([
        { id: "spost_1", status: "publishing", workspaceId: "ws_1" },
      ]);

      const { deleteSocialPost } = await import("@/lib/social/repository");
      await expect(deleteSocialPost("ws_1", "spost_1")).rejects.toThrow(
        SocialPostStateTransitionError,
      );
    });
  });
});
