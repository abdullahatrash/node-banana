import { describe, expect, it } from "vitest";
import {
  blueskyProvider,
  facebookProvider,
  instagramProvider,
  linkedInProvider,
  mastodonProvider,
  pinterestProvider,
  redditProvider,
  threadsProvider,
  tikTokProvider,
  xProvider,
  youTubeProvider,
} from "@/lib/social/providers";
import type { SocialErrorType } from "@/lib/social/provider-interface";

const providers = [
  linkedInProvider,
  xProvider,
  instagramProvider,
  facebookProvider,
  tikTokProvider,
  youTubeProvider,
  redditProvider,
  threadsProvider,
  pinterestProvider,
  blueskyProvider,
  mastodonProvider,
] as const;

const classificationFixtures: Record<
  (typeof providers)[number]["identifier"],
  { token: string; badBody: string; retry: string }
> = {
  linkedin: {
    token: "401 token expired",
    badBody: "INVALID_REQUEST invalid content",
    retry: "429 Too Many Requests",
  },
  x: {
    token: "401 Unauthorized Invalid or expired token",
    badBody: "duplicate post content",
    retry: "429 Rate limit reached",
  },
  instagram: {
    token: "Error validating access token",
    badBody: "2207026 unsupported video format",
    retry: "An unknown error occurred",
  },
  facebook: {
    token: "Error validating access token",
    badBody: "2207026 unsupported video format",
    retry: "An unknown error occurred",
  },
  tiktok: {
    token: "access_token_invalid",
    badBody: "invalid_params",
    retry: "rate_limit_exceeded",
  },
  youtube: {
    token: "token expired",
    badBody: "invalidTitle",
    retry: "quotaExceeded",
  },
  reddit: {
    token: "401 Unauthorized token expired",
    badBody: "validation subreddit required",
    retry: "429 rate limit exceeded",
  },
  threads: {
    token: "Error validating access token",
    badBody: "2207026 unsupported video format",
    retry: "An unknown error occurred",
  },
  pinterest: {
    token: "401 Unauthorized token expired",
    badBody: "400 board validation error",
    retry: "429 rate limit exceeded",
  },
  bluesky: {
    token: "ExpiredToken session expired",
    badBody: "InvalidRequest: record is invalid",
    retry: "RateLimitExceeded",
  },
  mastodon: {
    token: "401 Unauthorized token invalid",
    badBody: "422 Unprocessable validation too long",
    retry: "429 Rate limit exceeded",
  },
};

describe("social provider conformance", () => {
  it.each(providers)("%s exposes required adapter capabilities", (provider) => {
    expect(typeof provider.identifier).toBe("string");
    expect(typeof provider.displayName).toBe("string");
    expect(typeof provider.maxContentLength).toBe("number");
    expect(typeof provider.supportsImages).toBe("boolean");
    expect(typeof provider.supportsVideo).toBe("boolean");
    expect(typeof provider.supportsCarousel).toBe("boolean");
    expect(typeof provider.maxImages).toBe("number");
    expect(typeof provider.maxConcurrentJobs).toBe("number");
    expect(typeof provider.requiresPageSelection).toBe("boolean");

    expect(typeof provider.generateAuthUrl).toBe("function");
    expect(typeof provider.authenticate).toBe("function");
    expect(typeof provider.refreshToken).toBe("function");
    expect(typeof provider.post).toBe("function");
    expect(typeof provider.classifyError).toBe("function");
    expect(typeof provider.getCapabilities).toBe("function");
  });

  it.each(providers)(
    "%s classifies token/content/retry errors predictably",
    (provider) => {
      const fixtures = classificationFixtures[provider.identifier];

      const tokenClassification = provider.classifyError(new Error(fixtures.token));
      const badBodyClassification = provider.classifyError(new Error(fixtures.badBody));
      const retryClassification = provider.classifyError(new Error(fixtures.retry));

      expect(tokenClassification.type).toBe("refresh-token");
      expect(badBodyClassification.type).toBe("bad-body");
      expect(retryClassification.type).toBe("retry");

      const allowed: SocialErrorType[] = ["refresh-token", "bad-body", "retry"];
      expect(allowed).toContain(tokenClassification.type);
      expect(allowed).toContain(badBodyClassification.type);
      expect(allowed).toContain(retryClassification.type);
    },
  );
});
