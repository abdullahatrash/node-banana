import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPost: vi.fn(), getAccount: vi.fn(), globalAccount: vi.fn(),
  updateStatus: vi.fn(), decrypt: vi.fn(), provider: vi.fn(), claimEffect: vi.fn(), publish: vi.fn(),
}));
vi.mock("workflow", () => ({ sleep: vi.fn(), FatalError: class extends Error {} }));
vi.mock("@/lib/social/repository", () => ({
  getSocialPost: mocks.getPost,
  getSocialAccount: mocks.getAccount,
  getSocialAccountById: mocks.globalAccount,
  updatePostStatus: mocks.updateStatus,
  updateSocialAccountTokens: vi.fn(),
  markRequiresReauth: vi.fn(),
  SocialAccountNotFoundError: class extends Error {},
  SocialPostNotFoundError: class extends Error {},
  claimSocialPostProviderEffect: mocks.claimEffect,
  resolveSocialPostMediaForDelivery: vi.fn(),
}));
vi.mock("@/lib/governance/region-enforcement", () => ({ GOVERNANCE_REGION_ROUTES: { publishing: "publishing" }, requireGovernanceRegionRoute: vi.fn() }));
vi.mock("@/lib/governance/publishing-route-guard", () => ({ requiresGovernedPublishingPlan: vi.fn(() => false) }));
vi.mock("@/lib/social/events", () => ({ emitSocialEvent: vi.fn() }));
vi.mock("@/lib/social/crypto", () => ({ decryptToken: mocks.decrypt, encryptToken: vi.fn() }));
vi.mock("@/lib/social/runtime-bootstrap", () => ({ ensureSocialProvidersBootstrapped: vi.fn() }));
vi.mock("@/lib/social/provider-registry", () => ({ getProvider: mocks.provider }));

describe("publishing workflow workspace isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.provider.mockReturnValue({ post: mocks.publish });
  });

  it("rejects a pre-existing cross-workspace association before credential access", async () => {
    const { SocialAccountNotFoundError } = await import("@/lib/social/repository");
    mocks.getPost.mockResolvedValue({ id: "post", workspaceId: "ws_1", socialAccountId: "foreign", status: "queued", content: "Hello", mediaUrls: [] });
    mocks.getAccount.mockRejectedValue(new SocialAccountNotFoundError("foreign"));
    const { publishPostWorkflow } = await import("@/../workflows/social-publish");
    await expect(publishPostWorkflow("post", "ws_1")).rejects.toThrow("channel_not_found");
    expect(mocks.getAccount).toHaveBeenCalledWith("ws_1", "foreign");
    expect(mocks.globalAccount).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rechecks the post before the provider effect even after a successful credential step", async () => {
    const { SocialPostNotFoundError } = await import("@/lib/social/repository");
    mocks.getPost.mockResolvedValue({ id: "post", socialAccountId: "channel", status: "queued", content: "Hello", mediaUrls: [] });
    mocks.claimEffect.mockRejectedValueOnce(new SocialPostNotFoundError("post"));
    mocks.getAccount.mockResolvedValue({ id: "channel", workspaceId: "ws_1", platform: "x", accessTokenEncrypted: "encrypted", tokenExpiresAt: null });
    const { publishPostWorkflow } = await import("@/../workflows/social-publish");
    await expect(publishPostWorkflow("post", "ws_1")).rejects.toThrow("channel_not_found");
    expect(mocks.claimEffect).toHaveBeenCalledWith("ws_1", "post");
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
