// @vitest-environment node

/**
 * Threads provider CONTRACT tests (MSW).
 *
 * Unlike `threads.test.ts` — which replaces `fetch` wholesale with
 * `vi.stubGlobal` — these tests exercise the provider's real `fetch()` calls
 * against a mocked Meta Graph API boundary via MSW.
 *
 * Scenario classes (the contract every provider must satisfy):
 *   1. successful post publish (text-only: create → publish → permalink)
 *   2. token-refresh trigger path        (OAuthException token error → "refresh-token")
 *   3. rate-limit retry classification   (generic transient error → "retry")
 *   4. permanent-failure classification  (page posting cap → "bad-body")
 *
 * Threads shares `classifyMetaError()` with instagram.ts/facebook.ts — see
 * `instagram.contract.test.ts` for the full write-up of the CONFIRMED DEFECT
 * where a real MetaApiError's numeric `.code` never reaches classification
 * (only `.message` is inspected), so numeric-code "bad-body" branches are
 * unreachable in production. Not re-litigated here in full; the scenarios
 * below use message-text-based branches, which ARE genuinely reachable.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupMswServer } from "@/test/msw/server";
import { clearRegistry } from "@/lib/social/provider-registry";
import { threadsProvider } from "@/lib/social/providers/threads";
import type { PublishRequest } from "@/lib/social/provider-interface";

// ---------------------------------------------------------------------------
// Meta Graph API endpoints exercised by threadsProvider.post()
// ---------------------------------------------------------------------------

const GRAPH_BASE = "https://graph.facebook.com/v20.0";
const THREADS_USER_ID = "threads-user-1";
const CREATE_URL = `${GRAPH_BASE}/${THREADS_USER_ID}/threads`;
const PUBLISH_URL = `${GRAPH_BASE}/${THREADS_USER_ID}/threads_publish`;

const textPost: PublishRequest = {
  postId: "our-post-1",
  content: "Hello from a contract test",
};

// ---------------------------------------------------------------------------
// MSW server — default handlers describe the HAPPY PATH.
// ---------------------------------------------------------------------------

const server = setupMswServer(
  http.post(CREATE_URL, () => HttpResponse.json({ id: "container-1" })),
  http.post(PUBLISH_URL, () => HttpResponse.json({ id: "thread-1" })),
  http.get(`${GRAPH_BASE}/thread-1`, () =>
    HttpResponse.json({
      id: "thread-1",
      permalink: "https://www.threads.net/t/thread-1",
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

describe("threadsProvider contract — successful post publish", () => {
  it("creates a container, publishes, and resolves the permalink against the live Graph API contract", async () => {
    const results = await threadsProvider.post(
      THREADS_USER_ID,
      "access-token",
      [textPost],
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      postId: "our-post-1",
      platformPostId: "thread-1",
      platformPostUrl: "https://www.threads.net/t/thread-1",
      status: "published",
    });
  });
});

/**
 * Helper: run a publish that the platform rejects, and return the *real*
 * `MetaApiError` the provider threw.
 */
async function captureThrownError(): Promise<unknown> {
  return threadsProvider
    .post(THREADS_USER_ID, "access-token", [textPost])
    .then(
      () => {
        throw new Error("expected post() to reject, but it resolved");
      },
      (err: unknown) => err,
    );
}

// ---------------------------------------------------------------------------
// Scenario 2 — token-refresh trigger path
// ---------------------------------------------------------------------------

describe("threadsProvider contract — token-refresh trigger", () => {
  it("classifies a real OAuthException token error as refresh-token", async () => {
    server.use(
      http.post(CREATE_URL, () =>
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
    const classified = threadsProvider.classifyError(error);

    expect(classified.type).toBe("refresh-token");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — rate-limit retry classification
// ---------------------------------------------------------------------------

describe("threadsProvider contract — rate-limit retry", () => {
  it("classifies a real transient Graph API error as retry", async () => {
    server.use(
      http.post(CREATE_URL, () =>
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
    const classified = threadsProvider.classifyError(error);

    expect(classified.type).toBe("retry");
    expect(classified.message).toBe(
      "An unknown error occurred. Please try again later.",
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — permanent-failure classification
// ---------------------------------------------------------------------------

describe("threadsProvider contract — permanent-failure", () => {
  it("classifies a real page-posting-cap rejection as bad-body", async () => {
    server.use(
      http.post(CREATE_URL, () =>
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
    const classified = threadsProvider.classifyError(error);

    expect(classified.type).toBe("bad-body");
  });
});

// ---------------------------------------------------------------------------
// Media-rejection guard — Threads is text-only in this codebase
// ---------------------------------------------------------------------------

describe("threadsProvider contract — media rejection", () => {
  it("rejects posts with media before making any network call", async () => {
    await expect(
      threadsProvider.post(THREADS_USER_ID, "access-token", [
        {
          postId: "post-with-media",
          content: "This has an image",
          media: [{ type: "image", url: "https://cdn.example.com/photo.jpg" }],
        },
      ]),
    ).rejects.toThrow(/text-only posts/);
  });
});
