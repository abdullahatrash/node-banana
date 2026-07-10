// @vitest-environment node

/**
 * X (Twitter) provider CONTRACT tests (MSW).
 *
 * Unlike `x.test.ts` — which replaces `twitter-api-v2` wholesale with `vi.mock`
 * — these tests exercise the *real* SDK and the provider's real request/response
 * handling, intercepting HTTP at the network boundary with MSW. That means the
 * OAuth 1.0a signing, URL construction, JSON (de)serialisation, and — crucially
 * — the `twitter-api-v2` error objects fed into `classifyError()` are all real.
 *
 * Scenario classes (the contract every provider must satisfy):
 *   1. successful post publish
 *   2. token-refresh trigger path        (401 → "refresh-token")
 *   3. rate-limit retry classification   (429 → "retry")
 *   4. permanent-failure classification  (403 duplicate → "bad-body")
 *
 * The provider code is intentionally UNMODIFIED.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupMswServer } from "@/test/msw/server";
import { clearRegistry } from "@/lib/social/provider-registry";
import { xProvider } from "@/lib/social/providers/x";
import type { PublishRequest } from "@/lib/social/provider-interface";

// ---------------------------------------------------------------------------
// X platform endpoints exercised by xProvider.post()
// (see node_modules/twitter-api-v2 globals: API_V2_PREFIX = https://api.x.com/2/)
// ---------------------------------------------------------------------------

const X_API = "https://api.x.com/2";
const TWEETS_URL = `${X_API}/tweets`;
const ME_URL = `${X_API}/users/me`;

// Access token is stored by the provider as "token:secret".
const ACCESS_TOKEN = "acc-token:acc-secret";

const textPost: PublishRequest = {
  postId: "our-post-1",
  content: "Hello from a contract test",
};

// ---------------------------------------------------------------------------
// MSW server — default handlers describe the HAPPY PATH; individual tests
// override with server.use(...) to inject platform failures.
// ---------------------------------------------------------------------------

const server = setupMswServer(
  http.post(TWEETS_URL, () =>
    HttpResponse.json({ data: { id: "tweet-123", text: textPost.content } }),
  ),
  http.get(ME_URL, () =>
    HttpResponse.json({ data: { id: "user-1", username: "contractbot" } }),
  ),
);

beforeEach(() => {
  clearRegistry();
  process.env.X_API_KEY = "test-api-key";
  process.env.X_API_SECRET = "test-api-secret";
});

afterEach(() => {
  delete process.env.X_API_KEY;
  delete process.env.X_API_SECRET;
});

// ---------------------------------------------------------------------------
// Scenario 1 — successful post publish
// ---------------------------------------------------------------------------

describe("xProvider contract — successful post publish", () => {
  it("publishes a text tweet against the live X HTTP contract", async () => {
    const results = await xProvider.post("user-1", ACCESS_TOKEN, [textPost]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      postId: "our-post-1",
      platformPostId: "tweet-123",
      platformPostUrl: "https://x.com/contractbot/status/tweet-123",
      status: "published",
    });
  });
});

/**
 * Helper: run a publish that the platform rejects, and return the *real*
 * `twitter-api-v2` error object the provider threw. This is what the publish
 * pipeline actually catches and hands to `classifyError()` — no synthetic
 * `new Error("429 ...")` strings.
 */
async function captureThrownError(): Promise<unknown> {
  return xProvider.post("user-1", ACCESS_TOKEN, [textPost]).then(
    () => {
      throw new Error("expected post() to reject, but it resolved");
    },
    (err: unknown) => err,
  );
}

// ---------------------------------------------------------------------------
// Scenario 2 — token-refresh trigger path (HTTP 401)
// ---------------------------------------------------------------------------

describe("xProvider contract — token-refresh trigger", () => {
  it("classifies a real 401 from the tweet endpoint as refresh-token", async () => {
    server.use(
      http.post(TWEETS_URL, () =>
        HttpResponse.json(
          {
            title: "Unauthorized",
            detail: "Unauthorized",
            type: "about:blank",
            status: 401,
          },
          { status: 401 },
        ),
      ),
    );

    const error = await captureThrownError();
    const classified = xProvider.classifyError(error);

    expect(classified.type).toBe("refresh-token");
    // The real SDK error is preserved for the pipeline / logs.
    expect(classified.original).toBe(error);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — rate-limit retry classification (HTTP 429)
// ---------------------------------------------------------------------------

describe("xProvider contract — rate-limit retry", () => {
  it("classifies a real 429 from the tweet endpoint as retry", async () => {
    server.use(
      http.post(TWEETS_URL, () =>
        HttpResponse.json(
          { title: "Too Many Requests", detail: "Too Many Requests" },
          {
            status: 429,
            headers: {
              "x-rate-limit-limit": "50",
              "x-rate-limit-remaining": "0",
              "x-rate-limit-reset": "9999999999",
            },
          },
        ),
      ),
    );

    // Sanity-check the real SDK error carried the 429 before classifying, so a
    // generic "unknown → retry" fallback can't masquerade as rate-limit handling.
    const error = await captureThrownError();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("429");

    const classified = xProvider.classifyError(error);

    expect(classified.type).toBe("retry");
    // Distinct rate-limit message — NOT the default retry fallback (which echoes
    // the raw error text) — proving the 429 branch fired.
    expect(classified.message).toBe("X rate limit reached. Will retry shortly.");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — permanent-failure classification (HTTP 403 duplicate content)
// ---------------------------------------------------------------------------

describe("xProvider contract — permanent-failure", () => {
  it("classifies a real 403 duplicate-content rejection as bad-body", async () => {
    server.use(
      http.post(TWEETS_URL, () =>
        HttpResponse.json(
          {
            title: "Forbidden",
            detail:
              "You are not allowed to create a Tweet with duplicate content.",
            type: "about:blank",
            errors: [
              { message: "You are not allowed to create a Tweet with duplicate content." },
            ],
          },
          { status: 403 },
        ),
      ),
    );

    const error = await captureThrownError();
    const classified = xProvider.classifyError(error);

    expect(classified.type).toBe("bad-body");
  });
});
