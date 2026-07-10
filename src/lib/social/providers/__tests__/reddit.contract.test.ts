// @vitest-environment node

/**
 * Reddit provider CONTRACT tests (MSW).
 *
 * Unlike `reddit.test.ts` — which replaces `fetch` wholesale with
 * `vi.stubGlobal` — these tests exercise the provider's real `fetch()` calls
 * against a mocked Reddit API boundary via MSW.
 *
 * Scenario classes (the contract every provider must satisfy):
 *   1. successful post publish
 *   2. token-refresh trigger path        (401 → "refresh-token")
 *   3. rate-limit retry classification   (429 → "retry")
 *   4. permanent-failure classification  (real `json.errors` 200-OK quirk → "bad-body")
 *
 * Reddit's classic `/api/submit` endpoint has a well-known quirk: content
 * validation failures (bad subreddit, missing title, etc.) come back as an
 * HTTP 200 with a `json.errors` array, NOT a non-2xx status. The provider
 * correctly special-cases this (see `reddit.ts`'s `data.json?.errors` check)
 * and throws a distinct "Reddit submit validation failed: ..." error whose
 * text matches classifyError()'s "validation" check — this is exercised
 * explicitly below since it is easy to get backwards in a vi.mock unit test.
 *
 * The provider code is intentionally UNMODIFIED.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupMswServer } from "@/test/msw/server";
import { clearRegistry } from "@/lib/social/provider-registry";
import { redditProvider } from "@/lib/social/providers/reddit";
import type { PublishRequest } from "@/lib/social/provider-interface";

// ---------------------------------------------------------------------------
// Reddit API endpoints exercised by redditProvider.post()
// ---------------------------------------------------------------------------

const SUBMIT_URL = "https://oauth.reddit.com/api/submit";

const textPost: PublishRequest = {
  postId: "our-post-1",
  content: "Hello from a contract test",
  platformSettings: { subreddit: "test", title: "Contract test post" },
};

// ---------------------------------------------------------------------------
// MSW server — default handler describes the HAPPY PATH.
// ---------------------------------------------------------------------------

const server = setupMswServer(
  http.post(SUBMIT_URL, () =>
    HttpResponse.json({
      json: {
        errors: [],
        data: {
          name: "t3_abc123",
          url: "https://www.reddit.com/r/test/comments/abc123/contract_test_post/",
        },
      },
    }),
  ),
);

beforeEach(() => {
  clearRegistry();
  process.env.REDDIT_CLIENT_ID = "test-client-id";
  process.env.REDDIT_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;
});

// ---------------------------------------------------------------------------
// Scenario 1 — successful post publish
// ---------------------------------------------------------------------------

describe("redditProvider contract — successful post publish", () => {
  it("submits a self post against the live Reddit HTTP contract", async () => {
    const results = await redditProvider.post("user-1", "access-token", [
      textPost,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      postId: "our-post-1",
      platformPostId: "t3_abc123",
      platformPostUrl:
        "https://www.reddit.com/r/test/comments/abc123/contract_test_post/",
      status: "published",
    });
  });
});

/**
 * Helper: run a publish that the platform rejects, and return the *real*
 * error the provider threw.
 */
async function captureThrownError(): Promise<unknown> {
  return redditProvider.post("user-1", "access-token", [textPost]).then(
    () => {
      throw new Error("expected post() to reject, but it resolved");
    },
    (err: unknown) => err,
  );
}

// ---------------------------------------------------------------------------
// Scenario 2 — token-refresh trigger path (HTTP 401)
// ---------------------------------------------------------------------------

describe("redditProvider contract — token-refresh trigger", () => {
  it("classifies a real 401 from /api/submit as refresh-token", async () => {
    server.use(
      http.post(SUBMIT_URL, () =>
        HttpResponse.text("invalid_token", { status: 401 }),
      ),
    );

    const error = await captureThrownError();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("401");

    const classified = redditProvider.classifyError(error);
    expect(classified.type).toBe("refresh-token");
    expect(classified.original).toBe(error);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — rate-limit retry classification (HTTP 429)
// ---------------------------------------------------------------------------

describe("redditProvider contract — rate-limit retry", () => {
  it("classifies a real 429 from /api/submit as retry", async () => {
    server.use(
      http.post(SUBMIT_URL, () =>
        HttpResponse.text("Take a break, you are doing that too much", {
          status: 429,
        }),
      ),
    );

    const error = await captureThrownError();
    expect((error as Error).message).toContain("429");

    const classified = redditProvider.classifyError(error);
    expect(classified.type).toBe("retry");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — permanent-failure classification (HTTP 200 + json.errors)
// ---------------------------------------------------------------------------

describe("redditProvider contract — permanent-failure", () => {
  it("classifies a real 200-OK submit-validation rejection as bad-body", async () => {
    server.use(
      http.post(SUBMIT_URL, () =>
        HttpResponse.json({
          json: {
            errors: [["SUBREDDIT_NOEXIST", "that subreddit doesn't exist", "sr"]],
          },
        }),
      ),
    );

    const error = await captureThrownError();
    expect((error as Error).message.toLowerCase()).toContain("validation");

    const classified = redditProvider.classifyError(error);
    expect(classified.type).toBe("bad-body");
  });
});
