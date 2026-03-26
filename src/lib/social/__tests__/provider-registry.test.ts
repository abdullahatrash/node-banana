import { afterEach, describe, expect, it } from "vitest";
import {
  clearRegistry,
  getProvider,
  isProviderRegistered,
  listProviderCapabilities,
  listProviders,
  registerProvider,
  SocialProviderNotFoundError,
  validatePlatform,
} from "@/lib/social/provider-registry";
import type { SocialProviderAdapter } from "@/lib/social/provider-interface";

function createMockProvider(
  overrides: Partial<SocialProviderAdapter> = {},
): SocialProviderAdapter {
  return {
    identifier: "linkedin",
    displayName: "LinkedIn",
    maxContentLength: 3000,
    supportsImages: true,
    supportsVideo: true,
    supportsCarousel: true,
    maxImages: 9,
    maxConcurrentJobs: 2,
    requiresPageSelection: true,
    generateAuthUrl: async () => ({
      url: "https://example.com/auth",
      state: "test-state",
    }),
    authenticate: async () => ({
      platformUserId: "user-123",
      accessToken: "token",
      displayName: "Test User",
    }),
    refreshToken: async () => ({ accessToken: "new-token" }),
    post: async () => [
      {
        postId: "post-1",
        platformPostId: "plat-1",
        platformPostUrl: "https://example.com/post/1",
        status: "published" as const,
      },
    ],
    classifyError: () => ({ type: "retry" as const, message: "Unknown error" }),
    getCapabilities: () => ({
      identifier: "linkedin" as const,
      displayName: "LinkedIn",
      maxContentLength: 3000,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: true,
      requiresPageSelection: true,
    }),
    ...overrides,
  };
}

describe("provider-registry", () => {
  afterEach(() => {
    clearRegistry();
  });

  describe("registerProvider", () => {
    it("registers a provider successfully", () => {
      const provider = createMockProvider();
      registerProvider(provider);
      expect(isProviderRegistered("linkedin")).toBe(true);
    });

    it("throws on duplicate registration", () => {
      registerProvider(createMockProvider());
      expect(() => registerProvider(createMockProvider())).toThrow(
        'already registered',
      );
    });
  });

  describe("getProvider", () => {
    it("returns a registered provider", () => {
      const provider = createMockProvider();
      registerProvider(provider);
      expect(getProvider("linkedin")).toBe(provider);
    });

    it("throws SocialProviderNotFoundError for unknown platform", () => {
      expect(() => getProvider("unknown")).toThrow(SocialProviderNotFoundError);
      expect(() => getProvider("unknown")).toThrow(
        'not available',
      );
    });

    it("includes registered providers in error message", () => {
      registerProvider(createMockProvider({ identifier: "x", displayName: "X" }));
      try {
        getProvider("unknown");
      } catch (error) {
        expect(error).toBeInstanceOf(SocialProviderNotFoundError);
        expect((error as SocialProviderNotFoundError).message).toContain("x");
        expect((error as SocialProviderNotFoundError).platform).toBe("unknown");
      }
    });
  });

  describe("listProviders", () => {
    it("returns empty array when no providers registered", () => {
      expect(listProviders()).toEqual([]);
    });

    it("returns all registered providers", () => {
      registerProvider(createMockProvider({ identifier: "linkedin", displayName: "LinkedIn" }));
      registerProvider(createMockProvider({ identifier: "x", displayName: "X" }));
      const providers = listProviders();
      expect(providers).toHaveLength(2);
      expect(providers.map((p) => p.identifier)).toEqual(["linkedin", "x"]);
    });
  });

  describe("listProviderCapabilities", () => {
    it("returns capabilities for all providers", () => {
      registerProvider(createMockProvider());
      const capabilities = listProviderCapabilities();
      expect(capabilities).toHaveLength(1);
      expect(capabilities[0]).toEqual({
        identifier: "linkedin",
        displayName: "LinkedIn",
        maxContentLength: 3000,
        supportsImages: true,
        supportsVideo: true,
        supportsCarousel: true,
        requiresPageSelection: true,
      });
    });
  });

  describe("validatePlatform", () => {
    it("returns typed platform for registered provider", () => {
      registerProvider(createMockProvider());
      expect(validatePlatform("linkedin")).toBe("linkedin");
    });

    it("throws for unregistered platform", () => {
      expect(() => validatePlatform("unknown")).toThrow(
        SocialProviderNotFoundError,
      );
    });
  });

  describe("clearRegistry", () => {
    it("removes all registered providers", () => {
      registerProvider(createMockProvider());
      expect(listProviders()).toHaveLength(1);
      clearRegistry();
      expect(listProviders()).toHaveLength(0);
    });
  });
});
