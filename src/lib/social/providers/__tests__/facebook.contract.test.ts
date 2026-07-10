// @vitest-environment node

/**
 * Facebook provider CONTRACT tests (MSW).
 *
 * Unlike `facebook.test.ts` — which replaces `fetch` wholesale with
 * `vi.stubGlobal` — these tests exercise the provider's real `fetch()` calls
 * against a mocked Meta Graph API boundary via MSW.
 *
 * Scenario classes (the contract every provider must satisfy):
 *   1. successful post publish (text-only Page feed post)
 *   2. token-refresh trigger path        (OAuthException token error → "refresh-token")
 *   3. rate-limit retry classification   (generic transient error → "retry")
 *   4. permanent-failure classification  (page posting cap → "bad-body")
 *
 * See `instagram.contract.test.ts` for the full write-up of a CONFIRMED
 * DEFECT shared by every provider built on `classifyMetaError()`
 * (facebook.ts, instagram.ts, threads.ts): `classifyError()` only inspects
 * the thrown error's `.message`, but the real `MetaApiError` never folds its
 * numeric Graph API `.code` into `.message` — so the numeric-code "bad-body"
 * branches in `classifyMetaError()` are unreachable in production and
 * silently downgrade to the generic "retry" fallback. The canary test below
 * reproduces it for Facebook's own numeric error codes (photo-too-large).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupMswServer } from "@/test/msw/server";
import { clearRegistry } from "@/lib/social/provider-registry";
import { facebookProvider } from "@/lib/social/providers/facebook";
import type { PublishRequest } from "@/lib/social/provider-interface";

// ---------------------------------------------------------------------------
// Meta Graph API endpoints exercised by facebookProvider.post()
// ---------------------------------------------------------------------------

const GRAPH_BASE = "https://graph.facebook.com/v20.0";
const PAGE_ID = "page-1";
const FEED_URL = `${GRAPH_BASE}/${PAGE_ID}/feed`;

const textPost: PublishRequest = {
  postId: "our-post-1",
  content: "Hello from a contract test",
};

// ---------------------------------------------------------------------------
// MSW server — default handler describes the HAPPY PATH.
// ---------------------------------------------------------------------------

const server = setupMswServer(
  http.post(FEED_URL, () =>
    HttpResponse.json({
      id: "post-1",
      permalink_url: "https://www.facebook.com/page-1/posts/post-1",
    }),
  ),
);

beforeEach(() => {
  clearRegistry();
  process.env.META_APP_ID = "test-app-id";
  process.env.META_APP_SECRET = "test-app-secret";
});

afterEach(() => {
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
});

// ---------------------------------------------------------------------------
// Scenario 1 — successful post publish
// ---------------------------------------------------------------------------

describe("facebookProvider contract — successful post publish", () => {
  it("publishes a text-only page post against the live Graph API contract", async () => {
    const results = await facebookProvider.post(PAGE_ID, "access-token", [
      textPost,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      postId: "our-post-1",
      platformPostId: "post-1",
      platformPostUrl: "https://www.facebook.com/page-1/posts/post-1",
      status: "published",
    });
  });
});

/**
 * Helper: run a publish that the platform rejects, and return the *real*
 * `MetaApiError` the provider threw.
 */
async function captureThrownError(): Promise<unknown> {
  return facebookProvider.post(PAGE_ID, "access-token", [textPost]).then(
    () => {
      throw new Error("expected post() to reject, but it resolved");
    },
    (err: unknown) => err,
  );
}

// ---------------------------------------------------------------------------
// Scenario 2 — token-refresh trigger path
// ---------------------------------------------------------------------------

describe("facebookProvider contract — token-refresh trigger", () => {
  it("classifies a real OAuthException token error as refresh-token", async () => {
    server.use(
      http.post(FEED_URL, () =>
        HttpResponse.json(
          {
            error: {
              message: "Error validating access token: Session has expired.",
              type: "OAuthException",
              code: 190,
              fbtrace_id: "AbCdEfGhIjK",
            },
          },
          { status: 400 },
        ),
      ),
    );

    const error = await captureThrownError();
    const classified = facebookProvider.classifyError(error);

    expect(classified.type).toBe("refresh-token");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — rate-limit retry classification
// ---------------------------------------------------------------------------

describe("facebookProvider contract — rate-limit retry", () => {
  it("classifies a real transient Graph API error as retry", async () => {
    server.use(
      http.post(FEED_URL, () =>
        HttpResponse.json(
          {
            error: {
              message: "An unknown error occurred",
              type: "OAuthException",
              code: 1,
              fbtrace_id: "AbCdEfGhIjL",
            },
          },
          { status: 400 },
        ),
      ),
    );

    const error = await captureThrownError();
    const classified = facebookProvider.classifyError(error);

    expect(classified.type).toBe("retry");
    expect(classified.message).toBe(
      "An unknown error occurred. Please try again later.",
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — permanent-failure classification
// ---------------------------------------------------------------------------

describe("facebookProvider contract — permanent-failure", () => {
  it("classifies a real page-posting-cap rejection as bad-body", async () => {
    server.use(
      http.post(FEED_URL, () =>
        HttpResponse.json(
          {
            error: {
              message: "Page request limit reached",
              type: "OAuthException",
              code: 4,
              fbtrace_id: "AbCdEfGhIjM",
            },
          },
          { status: 400 },
        ),
      ),
    );

    const error = await captureThrownError();
    const classified = facebookProvider.classifyError(error);

    expect(classified.type).toBe("bad-body");
  });

  /**
   * REGRESSION (formerly a CONFIRMED DEFECT canary) — Facebook's numeric
   * photo-size error code (1366046) must classify as "bad-body" and fail
   * fast, NOT silently downgrade to a forever-retry. The numeric code lives
   * on the real `MetaApiError`'s structured `.code`/`.rawBody` fields (never
   * folded into `.message`), so `classifyError()` must inspect the structured
   * error, not just `.message` text.
   */
  it("classifies a real numeric-code Graph error (1366046) as bad-body", async () => {
    server.use(
      http.post(FEED_URL, () =>
        HttpResponse.json(
          {
            error: {
              message: "Photos must be smaller than 4 MB and saved as JPG or PNG.",
              type: "OAuthException",
              code: 1366046,
              fbtrace_id: "AbCdEfGhIjN",
            },
          },
          { status: 400 },
        ),
      ),
    );

    const error = await captureThrownError();
    expect((error as Error).message).toBe(
      "Photos must be smaller than 4 MB and saved as JPG or PNG.",
    );

    const classified = facebookProvider.classifyError(error);
    expect(classified.type).toBe("bad-body");
    expect(classified.message).toBe(
      "Photos must be smaller than 4 MB and saved as JPG or PNG.",
    );
  });
});
