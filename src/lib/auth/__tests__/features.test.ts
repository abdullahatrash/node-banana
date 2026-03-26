import { beforeEach, describe, expect, it } from "vitest";
import {
  getAuthFeatureFlags,
  getSocialProviderConfig,
  isProductionLikeRuntime,
} from "@/lib/auth/features";

describe("auth feature flags", () => {
  beforeEach(() => {
    delete process.env.BETTER_AUTH_ENABLE_GOOGLE_OAUTH;
    delete process.env.BETTER_AUTH_ENABLE_GITHUB_OAUTH;
    delete process.env.BETTER_AUTH_ENABLE_MAGIC_LINK;
    delete process.env.BETTER_AUTH_ENABLE_TWO_FACTOR;
    delete process.env.BETTER_AUTH_ENABLE_PASSKEY;
    delete process.env.BETTER_AUTH_ENABLE_SAML_SSO;
    delete process.env.BETTER_AUTH_GOOGLE_CLIENT_ID;
    delete process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET;
    delete process.env.BETTER_AUTH_GITHUB_CLIENT_ID;
    delete process.env.BETTER_AUTH_GITHUB_CLIENT_SECRET;
    delete process.env.APP_ENV;
    delete process.env.DEPLOY_ENV;
    delete process.env.VERCEL_ENV;
  });

  it("parses feature flags from env", () => {
    process.env.BETTER_AUTH_ENABLE_GOOGLE_OAUTH = "true";
    process.env.BETTER_AUTH_ENABLE_MAGIC_LINK = "1";

    const flags = getAuthFeatureFlags();
    expect(flags.googleOAuth).toBe(true);
    expect(flags.magicLink).toBe(true);
    expect(flags.githubOAuth).toBe(false);
  });

  it("requires OAuth credentials when provider is enabled", () => {
    process.env.BETTER_AUTH_ENABLE_GOOGLE_OAUTH = "true";

    expect(() => getSocialProviderConfig(getAuthFeatureFlags())).toThrow(
      "Google OAuth is enabled but credentials are missing",
    );
  });

  it("returns configured social providers", () => {
    process.env.BETTER_AUTH_ENABLE_GOOGLE_OAUTH = "true";
    process.env.BETTER_AUTH_GOOGLE_CLIENT_ID = "google-id";
    process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET = "google-secret";

    const socialProviders = getSocialProviderConfig(getAuthFeatureFlags());

    expect(socialProviders.google).toEqual({
      clientId: "google-id",
      clientSecret: "google-secret",
    });
    expect(socialProviders.github).toBeUndefined();
  });

  it("treats staging and preview as production-like runtime", () => {
    process.env.APP_ENV = "staging";
    expect(isProductionLikeRuntime()).toBe(true);

    delete process.env.APP_ENV;
    process.env.VERCEL_ENV = "preview";
    expect(isProductionLikeRuntime()).toBe(true);
  });
});
