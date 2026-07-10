// @vitest-environment node

/**
 * Instagram provider CONTRACT tests (MSW).
 *
 * Unlike `instagram.test.ts` — which replaces `fetch` wholesale with
 * `vi.stubGlobal` — these tests exercise the provider's real `fetch()` calls
 * against a mocked Meta Graph API boundary via MSW.
 *
 * Scenario classes (the contract every provider must satisfy):
 *   1. successful post publish (single image, container → publish → permalink)
 *   2. token-refresh trigger path        (OAuthException token error → "refresh-token")
 *   3. rate-limit retry classification   (generic transient error → "retry")
 *   4. permanent-failure classification  (page posting cap → "bad-body")
 *
 * PLUS the async-finalization path that the reconcile flow depends on: the
 * container-status poll loop (`pollContainerStatus`) transitioning through
 * IN_PROGRESS → FINISHED before `post()` resolves.
 *
 * ⚠️ CONFIRMED DEFECT (reported, NOT fixed — see repo root PR/issue notes):
 * `instagramProvider.classifyError()` (shared via `classifyMetaError()` in
 * `meta-common.ts`) builds its match string from
 * `JSON.stringify({ message: error.message })` — i.e. it only ever looks at
 * the thrown error's `.message` text. But a real `MetaApiError` (see
 * `createMediaContainer`/`publishContainer` in `instagram.ts`) is constructed
 * as `new MetaApiError(data.error.message, data.error.code, rawBody)` — the
 * numeric Graph API error `code` (e.g. 2207081 "Trial Reels not supported")
 * is stored on `.code`/`.rawBody`, NEVER folded into `.message`. Since nearly
 * all of `classifyMetaError()`'s "bad-body" branches match on the *numeric
 * code appearing as a literal substring*, they are unreachable from a real
 * thrown error and every one of them silently falls through to the generic
 * `{ type: "retry", ... }` fallback instead of failing fast. The existing
 * `instagram.test.ts` unit tests don't catch this because they construct
 * synthetic errors like `new Error('{"error":{"code":2207081,...}}')` whose
 * `.message` *is* the full JSON blob — that shape never occurs in production.
 * The canary test below proves this with the real construction path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupMswServer } from "@/test/msw/server";
import { clearRegistry } from "@/lib/social/provider-registry";
import { instagramProvider } from "@/lib/social/providers/instagram";
import type { PublishRequest } from "@/lib/social/provider-interface";

// ---------------------------------------------------------------------------
// Meta Graph API endpoints exercised by instagramProvider.post()
// (see GRAPH_BASE = https://graph.facebook.com/v20.0 in meta-common.ts)
// ---------------------------------------------------------------------------

const GRAPH_BASE = "https://graph.facebook.com/v20.0";
const IG_USER_ID = "ig-user-1";
const MEDIA_URL = `${GRAPH_BASE}/${IG_USER_ID}/media`;
const PUBLISH_URL = `${GRAPH_BASE}/${IG_USER_ID}/media_publish`;

const imagePost: PublishRequest = {
  postId: "our-post-1",
  content: "Hello from a contract test",
  media: [{ type: "image", url: "https://cdn.example.com/photo.jpg" }],
};

// ---------------------------------------------------------------------------
// MSW server — default handlers describe the HAPPY PATH; individual tests
// override with server.use(...) to inject platform failures.
// ---------------------------------------------------------------------------

const server = setupMswServer(
  http.post(MEDIA_URL, () => HttpResponse.json({ id: "container-1" })),
  http.get(`${GRAPH_BASE}/container-1`, () =>
    HttpResponse.json({ status_code: "FINISHED" }),
  ),
  http.post(PUBLISH_URL, () => HttpResponse.json({ id: "media-1" })),
  http.get(`${GRAPH_BASE}/media-1`, () =>
    HttpResponse.json({ permalink: "https://www.instagram.com/p/ABC123/" }),
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

describe("instagramProvider contract — successful post publish", () => {
  it("creates a container, publishes, and resolves the permalink against the live Graph API contract", async () => {
    const results = await instagramProvider.post(IG_USER_ID, "access-token", [
      imagePost,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      postId: "our-post-1",
      platformPostId: "media-1",
      platformPostUrl: "https://www.instagram.com/p/ABC123/",
      status: "published",
    });
  });
});

// ---------------------------------------------------------------------------
// Async-finalization (reconcile) path — container polling
// ---------------------------------------------------------------------------

describe("instagramProvider contract — async container finalization", () => {
  it("polls through a real IN_PROGRESS state before FINISHED, then publishes", async () => {
    let pollCount = 0;
    server.use(
      http.get(`${GRAPH_BASE}/container-1`, () => {
        pollCount++;
        return HttpResponse.json({
          status_code: pollCount === 1 ? "IN_PROGRESS" : "FINISHED",
        });
      }),
    );

    vi.useFakeTimers();
    const postPromise = instagramProvider.post(IG_USER_ID, "access-token", [
      imagePost,
    ]);

    // Advance past the 30s poll interval the provider waits between attempts.
    await vi.runAllTimersAsync();
    const results = await postPromise;
    vi.useRealTimers();

    expect(pollCount).toBeGreaterThanOrEqual(2);
    expect(results[0].status).toBe("published");
    expect(results[0].platformPostId).toBe("media-1");
  });

  it("throws a real MetaApiError when the container transitions to ERROR", async () => {
    server.use(
      http.get(`${GRAPH_BASE}/container-1`, () =>
        HttpResponse.json({ status_code: "ERROR" }),
      ),
    );

    await expect(
      instagramProvider.post(IG_USER_ID, "access-token", [imagePost]),
    ).rejects.toThrow(/ERROR/);
  });
});

/**
 * Helper: run a publish that the platform rejects, and return the *real*
 * `MetaApiError` the provider threw.
 */
async function captureThrownError(): Promise<unknown> {
  return instagramProvider.post(IG_USER_ID, "access-token", [imagePost]).then(
    () => {
      throw new Error("expected post() to reject, but it resolved");
    },
    (err: unknown) => err,
  );
}

// ---------------------------------------------------------------------------
// Scenario 2 — token-refresh trigger path
// ---------------------------------------------------------------------------

describe("instagramProvider contract — token-refresh trigger", () => {
  it("classifies a real OAuthException token error as refresh-token", async () => {
    server.use(
      http.post(MEDIA_URL, () =>
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
    const classified = instagramProvider.classifyError(error);

    expect(classified.type).toBe("refresh-token");
    expect(classified.original).toBeUndefined(); // classifyMetaError() branches don't attach `original`
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — rate-limit retry classification
// ---------------------------------------------------------------------------

describe("instagramProvider contract — rate-limit retry", () => {
  it("classifies a real transient Graph API error as retry", async () => {
    server.use(
      http.post(MEDIA_URL, () =>
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
    const classified = instagramProvider.classifyError(error);

    expect(classified.type).toBe("retry");
    expect(classified.message).toBe(
      "An unknown error occurred. Please try again later.",
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — permanent-failure classification
// ---------------------------------------------------------------------------

describe("instagramProvider contract — permanent-failure", () => {
  it("classifies a real page-posting-cap rejection as bad-body", async () => {
    server.use(
      http.post(MEDIA_URL, () =>
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
    const classified = instagramProvider.classifyError(error);

    expect(classified.type).toBe("bad-body");
  });

  /**
   * CANARY — documents the confirmed defect described in the file header.
   * A real container-creation failure carrying Instagram's numeric media
   * error code (2207081, "Trial Reels not supported") should, per the
   * existing `instagram.test.ts` unit tests (which assert this via a
   * synthetic error), classify as "bad-body". Fed the *real* MetaApiError
   * shape instead, it does not — classifyError() only inspects `.message`
   * text, and the human message ("This account doesn't support Trial
   * Reels.") never contains the digits "2207081", so the code-based branch
   * in classifyMetaError() never matches. This asserts the CURRENT (buggy)
   * behavior; if this test ever starts failing because the type flips to
   * "bad-body", the defect has been fixed and this test should be deleted.
   */
  it("[CONFIRMED DEFECT] silently downgrades a real numeric-code Graph error to retry instead of bad-body", async () => {
    server.use(
      http.post(MEDIA_URL, () =>
        HttpResponse.json(
          {
            error: {
              message: "This account doesn't support Trial Reels.",
              type: "OAuthException",
              code: 2207081,
              fbtrace_id: "AbCdEfGhIjN",
            },
          },
          { status: 400 },
        ),
      ),
    );

    const error = await captureThrownError();
    expect((error as Error).message).toBe(
      "This account doesn't support Trial Reels.",
    );

    const classified = instagramProvider.classifyError(error);
    // INTENDED (per meta-common.ts code 2207081 branch): "bad-body".
    // ACTUAL (confirmed real behavior — the defect):
    expect(classified.type).toBe("retry");
  });
});
