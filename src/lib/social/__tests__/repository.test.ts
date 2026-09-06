import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OAuthStateExpiredError,
  OAuthStateNotFoundError,
  OAuthSelectionSessionExpiredError,
  OAuthSelectionSessionNotFoundError,
  SocialAccountNotFoundError,
  SocialAccountQuotaExceededError,
  SocialPostNotFoundError,
  SocialPostMediaBindingError,
  SocialPostStateTransitionError,
  bindStableSocialMedia,
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
const mockExecute = vi.fn();
const mockTransaction = vi.fn();

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
  getDb: () => {
    const database = {
      insert: mockInsert,
      select: mockSelect,
      update: mockUpdate,
      delete: mockDelete,
      execute: mockExecute,
    };
    return {
      ...database,
      transaction: (callback: (tx: typeof database) => unknown) => mockTransaction(callback, database),
    };
  },
}));

vi.mock("@/lib/db/schema", () => ({
  socialAccounts: { workspaceId: "workspace_id", id: "id", platform: "platform", platformUserId: "platform_user_id", disabled: "disabled" },
  socialPosts: { workspaceId: "workspace_id", id: "id", status: "status", socialAccountId: "social_account_id", retryCount: "retry_count", createdAt: "created_at" },
  socialOAuthStates: { id: "id", state: "state", expiresAt: "expires_at" },
  socialOAuthSelectionSessions: { id: "id", expiresAt: "expires_at", workspaceId: "workspace_id", platform: "platform" },
}));

describe("social/repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction.mockImplementation((callback, database) => callback(database));
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

    it("OAuthSelectionSessionNotFoundError has correct name", () => {
      const error = new OAuthSelectionSessionNotFoundError();
      expect(error.name).toBe("OAuthSelectionSessionNotFoundError");
    });

    it("OAuthSelectionSessionExpiredError has correct name", () => {
      const error = new OAuthSelectionSessionExpiredError();
      expect(error.name).toBe("OAuthSelectionSessionExpiredError");
    });
  });

  describe("stable social media binding", () => {
    const resources = new Map([
      ["studio_asset:asset-a", { resourceKind: "studio_asset" as const, id: "asset-a", digest: `sha256:${"a".repeat(64)}`, type: "image" }],
      ["artifact:artifact-b", { resourceKind: "artifact" as const, id: "artifact-b", digest: `sha256:${"b".repeat(64)}`, type: "image" }],
    ]);

    it("pins every canonical resource and preserves exact order and alt text", () => {
      expect(bindStableSocialMedia({
        mediaUrls: [{ type: "image", url: "one", alt: "First" }, { type: "image", url: "two", alt: "Second" }],
        references: [{ resourceKind: "studio_asset", id: "asset-a" }, { resourceKind: "artifact", id: "artifact-b", digest: `sha256:${"b".repeat(64)}` }],
        resources,
      })).toEqual([
        { resourceKind: "studio_asset", assetId: "asset-a", assetDigest: `sha256:${"a".repeat(64)}`, order: 0, alt: "First" },
        { resourceKind: "artifact", assetId: "artifact-b", assetDigest: `sha256:${"b".repeat(64)}`, order: 1, alt: "Second" },
      ]);
    });

    it("rejects an incomplete, duplicated, or caller-digest-mismatched relation", () => {
      expect(() => bindStableSocialMedia({ mediaUrls: [{ type: "image", url: "one" }], references: [], resources })).toThrow(SocialPostMediaBindingError);
      expect(() => bindStableSocialMedia({ mediaUrls: [{ type: "image", url: "one" }, { type: "image", url: "two" }], references: [{ resourceKind: "studio_asset", id: "asset-a" }, { resourceKind: "studio_asset", id: "asset-a" }], resources })).toThrow(SocialPostMediaBindingError);
      expect(() => bindStableSocialMedia({ mediaUrls: [{ type: "image", url: "one" }], references: [{ resourceKind: "studio_asset", id: "asset-a", digest: `sha256:${"c".repeat(64)}` }], resources })).toThrow(SocialPostMediaBindingError);
      expect(() => bindStableSocialMedia({ mediaUrls: [{ type: "image", url: "one" }], references: [{ resourceKind: "studio_asset", id: "asset-a" }], resources: new Map([["studio_asset:asset-a", { resourceKind: "studio_asset", id: "asset-a", digest: "metadata-only", type: "image" }]]) })).toThrow("verified SHA-256 digest");
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

  describe("selection sessions", () => {
    it("creates a selection session", async () => {
      const mockRow = { id: "sosel_1", workspaceId: "ws_1", platform: "facebook" };
      setupChainableMock([mockRow]);
      const { createOAuthSelectionSession } = await import("@/lib/social/repository");
      const result = await createOAuthSelectionSession({
        workspaceId: "ws_1",
        platform: "facebook",
        accessTokenEncrypted: "enc_access",
        createdByUserId: "user_1",
        expiresAt: new Date(Date.now() + 3600_000),
      });
      expect(result).toEqual(mockRow);
    });

    it("consumes a valid selection session", async () => {
      const futureDate = new Date(Date.now() + 3600_000);
      setupChainableMock([
        { id: "sosel_1", expiresAt: futureDate, workspaceId: "ws_1", platform: "facebook" },
      ]);
      const { consumeOAuthSelectionSession } = await import("@/lib/social/repository");
      const result = await consumeOAuthSelectionSession({
        selectionSessionId: "sosel_1",
        workspaceId: "ws_1",
        platform: "facebook",
      });
      expect(result.id).toBe("sosel_1");
    });

    it("throws when selection session is missing", async () => {
      setupChainableMock([]);
      const { consumeOAuthSelectionSession } = await import("@/lib/social/repository");
      await expect(
        consumeOAuthSelectionSession({
          selectionSessionId: "missing",
          workspaceId: "ws_1",
          platform: "facebook",
        }),
      ).rejects.toThrow(OAuthSelectionSessionNotFoundError);
    });

    it("throws when selection session is expired", async () => {
      const pastDate = new Date(Date.now() - 3600_000);
      setupChainableMock([
        { id: "sosel_1", expiresAt: pastDate, workspaceId: "ws_1", platform: "facebook" },
      ]);
      const { consumeOAuthSelectionSession } = await import("@/lib/social/repository");
      await expect(
        consumeOAuthSelectionSession({
          selectionSessionId: "sosel_1",
          workspaceId: "ws_1",
          platform: "facebook",
        }),
      ).rejects.toThrow(OAuthSelectionSessionExpiredError);
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

    it("serializes final admission and rejects a new account at the immutable Plan limit", async () => {
      const { upsertSocialAccount } = await import("@/lib/social/repository");
      mockWhere
        .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([]) })
        .mockResolvedValueOnce([{ count: 2 }]);

      await expect(upsertSocialAccount({
        workspaceId: "ws_1",
        platform: "linkedin",
        platformUserId: "new-user",
        displayName: "New user",
        accessTokenEncrypted: "enc_token",
        createdByUserId: "user_1",
        maxActiveChannels: 2,
      })).rejects.toEqual(new SocialAccountQuotaExceededError(2, 2));

      expect(mockExecute).toHaveBeenCalledOnce();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("allows an existing active Channel to reauthorize while the allowance is full", async () => {
      const account = { id: "sacct_existing", platform: "linkedin", displayName: "Existing" };
      setupChainableMock([account]);
      mockWhere.mockReturnValueOnce({
        limit: vi.fn().mockResolvedValue([{ id: "sacct_existing", disabled: false }]),
      });
      const { upsertSocialAccount } = await import("@/lib/social/repository");

      await expect(upsertSocialAccount({
        workspaceId: "ws_1",
        platform: "linkedin",
        platformUserId: "existing-user",
        displayName: "Existing",
        accessTokenEncrypted: "new_token",
        createdByUserId: "user_1",
        maxActiveChannels: 2,
      })).resolves.toEqual(account);

      expect(mockExecute).toHaveBeenCalledOnce();
      expect(mockSelect).toHaveBeenCalledOnce();
      expect(mockInsert).toHaveBeenCalledOnce();
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
    it("does not insert a post when its channel is outside the workspace", async () => {
      setupChainableMock([]);
      const { createSocialPost } = await import("@/lib/social/repository");
      await expect(createSocialPost({ workspaceId: "ws_1", socialAccountId: "foreign", content: "Hello", createdByUserId: "user_1" })).rejects.toThrow(SocialAccountNotFoundError);
      expect(mockInsert).not.toHaveBeenCalled();
    });

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

    it("allows scheduled-only update on queued post", async () => {
      const scheduledAt = new Date("2026-05-01T12:15:00.000Z");
      setupChainableMock([
        { id: "spost_1", status: "queued", workspaceId: "ws_1" },
      ]);

      const { updateSocialPost } = await import("@/lib/social/repository");
      await updateSocialPost("ws_1", "spost_1", { scheduledAt });

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledAt,
          dispatchStatus: "pending",
          nextDispatchAt: scheduledAt,
          lockedAt: null,
        }),
      );
    });

    it("rejects a concurrent reschedule once provider publishing has started", async () => {
      const scheduledAt = new Date("2026-05-01T12:15:00.000Z");
      setupChainableMock([
        { id: "spost_1", status: "publishing", workspaceId: "ws_1" },
      ]);

      const { updateSocialPost } = await import("@/lib/social/repository");
      await expect(updateSocialPost("ws_1", "spost_1", { scheduledAt }))
        .rejects.toThrow(SocialPostStateTransitionError);
      expect(mockSet).not.toHaveBeenCalled();
    });
  });

  describe("deleteSocialPost", () => {
    it("allows delete on queued post", async () => {
      setupChainableMock([
        { id: "spost_1", status: "queued", workspaceId: "ws_1" },
      ]);

      const { deleteSocialPost } = await import("@/lib/social/repository");
      await expect(deleteSocialPost("ws_1", "spost_1")).resolves.toBeUndefined();
    });

    it("allows delete on publishing post", async () => {
      setupChainableMock([
        { id: "spost_1", status: "publishing", workspaceId: "ws_1" },
      ]);

      const { deleteSocialPost } = await import("@/lib/social/repository");
      await expect(deleteSocialPost("ws_1", "spost_1")).resolves.toBeUndefined();
    });

    it("rejects delete on published post", async () => {
      setupChainableMock([
        { id: "spost_1", status: "published", workspaceId: "ws_1" },
      ]);

      const { deleteSocialPost } = await import("@/lib/social/repository");
      await expect(deleteSocialPost("ws_1", "spost_1")).rejects.toThrow(
        SocialPostStateTransitionError,
      );
    });
  });
});
