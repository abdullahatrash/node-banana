// @vitest-environment node

/**
 * YouTube provider CONTRACT tests (MSW).
 *
 * Unlike `youtube.test.ts` — which replaces `googleapis` wholesale with
 * `vi.mock` — these tests exercise the *real* `googleapis`/`gaxios` SDK
 * against a mocked Google API boundary via MSW.
 *
 * Doing so surfaced two CONFIRMED, REAL defects in `youtube.ts`, both now
 * FIXED. This file documents the fixes and guards against regression.
 *
 * ---------------------------------------------------------------------------
 * DEFECT 1 (FIXED) — video/thumbnail upload was structurally broken
 * ---------------------------------------------------------------------------
 * `urlToReadableStream()` previously did:
 *   const response = await fetch(url);
 *   return response.body as unknown as NodeJS.ReadableStream;
 * Node's native `fetch()` (undici) returns `response.body` as a WHATWG
 * `ReadableStream` — it has NO `.pipe()` method. `googleapis-common`'s
 * multipart uploader (`apirequest.js`, `multipartUpload()`) unconditionally
 * calls `part.body.pipe(...)` on the media body, so every real `post()` with
 * video media threw `TypeError: part.body.pipe is not a function` before any
 * HTTP request to the YouTube Data API was even made — YouTube publishing did
 * not work at all. `youtube.test.ts`'s `vi.mock("googleapis")` replaces the
 * whole SDK, so it never exercised the real multipart pipeline and could not
 * have caught this. Fixed by bridging with `Readable.fromWeb(response.body)`
 * (node:stream, Node 17+); scenario 1 below now drives the real pipeline.
 *
 * ---------------------------------------------------------------------------
 * DEFECT 2 — classifyError() pattern-matches on fields that never reach `.message`
 * ---------------------------------------------------------------------------
 * `youTubeProvider.classifyError()` checks for literal reason-code strings
 * ("invalidTitle", "quotaExceeded", "forbidden", "UNAUTHENTICATED", ...).
 * Real `googleapis`/`gaxios` errors (`GaxiosError`) build `.message` purely
 * from the Google API JSON error's `.message` field (see
 * `GaxiosError.extractAPIErrorFromResponse` in `gaxios/build/.../common.js`)
 * — the per-error `reason` enum (where these strings actually live, e.g.
 * `errors[0].reason === "quotaExceeded"`) is never folded into `.message`.
 * Confirmed empirically below with real 401 and 403/quotaExceeded Google API
 * error bodies: BOTH classify as the generic "retry" fallback, including the
 * 401 — meaning an expired/invalid access token used against the real API
 * (as opposed to a refresh-token-endpoint failure, see scenario 2) is
 * silently retried instead of triggering re-authentication.
 *
 * Given DEFECT 1 blocks `post()`'s error paths entirely (the TypeError fires
 * before any network call), scenarios 2-4 below exercise `refreshToken()`
 * and `fetchPageInformation()` instead — both make real, unblocked
 * `googleapis` HTTP calls and are legitimate real-SDK error sources for
 * `classifyError()`, which is a general-purpose function not tied to a
 * single call site.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupMswServer } from "@/test/msw/server";
import { clearRegistry } from "@/lib/social/provider-registry";
import { youTubeProvider } from "@/lib/social/providers/youtube";
import type { PublishRequest } from "@/lib/social/provider-interface";

const CHANNELS_URL = "https://youtube.googleapis.com/youtube/v3/channels";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const VIDEO_UPLOAD_URL =
  "https://youtube.googleapis.com/upload/youtube/v3/videos";

const videoPost: PublishRequest = {
  postId: "our-post-1",
  content: "Hello from a contract test",
  media: [{ type: "video", url: "https://cdn.example.com/video.mp4" }],
};

const server = setupMswServer(
  http.get(CHANNELS_URL, () =>
    HttpResponse.json({ items: [{ id: "channel-1", snippet: { title: "Contract Bot" } }] }),
  ),
  http.get("https://cdn.example.com/video.mp4", () =>
    HttpResponse.text("fake-video-bytes"),
  ),
);

beforeEach(() => {
  clearRegistry();
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

// ---------------------------------------------------------------------------
// Scenario 1 — successful post publish
// ---------------------------------------------------------------------------

describe("youTubeProvider contract — successful post publish", () => {
  it("uploads the real video body via the multipart pipeline and returns the published result", async () => {
    server.use(
      http.post(VIDEO_UPLOAD_URL, () =>
        HttpResponse.json({ id: "video-1", snippet: {}, status: {} }),
      ),
    );

    const results = await youTubeProvider.post("channel-1", "access-token", [
      videoPost,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      postId: "our-post-1",
      platformPostId: "video-1",
      platformPostUrl: "https://www.youtube.com/watch?v=video-1",
      status: "published",
    });
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — token-refresh trigger path
// ---------------------------------------------------------------------------

describe("youTubeProvider contract — token-refresh trigger", () => {
  it("classifies a real invalid_grant OAuth token-exchange error as refresh-token", async () => {
    server.use(
      http.post(OAUTH_TOKEN_URL, () =>
        HttpResponse.json(
          {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          },
          { status: 400 },
        ),
      ),
    );

    let caught: unknown;
    try {
      await youTubeProvider.refreshToken("expired-refresh-token");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("invalid_grant");

    const classified = youTubeProvider.classifyError(caught);
    expect(classified.type).toBe("refresh-token");
  });

  /**
   * CANARY — documents DEFECT 2 for the auth case specifically. A stale
   * access token used against the real Data API (NOT the OAuth token
   * endpoint) throws a differently-shaped GaxiosError whose `.message` is
   * "Request had invalid authentication credentials." — no match for any
   * refresh-token branch — so it is misclassified as "retry".
   */
  it("[CONFIRMED DEFECT] a real 401 from the Data API itself does not classify as refresh-token", async () => {
    server.use(
      http.get(CHANNELS_URL, () =>
        HttpResponse.json(
          {
            error: {
              code: 401,
              message: "Request had invalid authentication credentials.",
              errors: [
                {
                  message: "Invalid Credentials",
                  domain: "global",
                  reason: "authError",
                  location: "Authorization",
                  locationType: "header",
                },
              ],
              status: "UNAUTHENTICATED",
            },
          },
          { status: 401 },
        ),
      ),
    );

    let caught: unknown;
    try {
      await youTubeProvider.fetchPageInformation!("access-token");
    } catch (err) {
      caught = err;
    }

    expect((caught as Error).message).toBe(
      "Request had invalid authentication credentials.",
    );

    const classified = youTubeProvider.classifyError(caught);
    // INTENDED: "refresh-token". ACTUAL (confirmed real behavior — the defect):
    expect(classified.type).toBe("retry");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — rate-limit retry classification
// ---------------------------------------------------------------------------

describe("youTubeProvider contract — rate-limit retry", () => {
  it("classifies a real quotaExceeded rejection as retry (via the safe generic fallback)", async () => {
    server.use(
      http.get(CHANNELS_URL, () =>
        HttpResponse.json(
          {
            error: {
              code: 403,
              message:
                "The request cannot be completed because you have exceeded your quota.",
              errors: [
                {
                  message:
                    "The request cannot be completed because you have exceeded your quota.",
                  domain: "youtube.quota",
                  reason: "quotaExceeded",
                },
              ],
            },
          },
          { status: 403 },
        ),
      ),
    );

    let caught: unknown;
    try {
      await youTubeProvider.fetchPageInformation!("access-token");
    } catch (err) {
      caught = err;
    }

    expect((caught as Error).message).toBe(
      "The request cannot be completed because you have exceeded your quota.",
    );

    // classifyError()'s explicit "quotaExceeded" text check never matches
    // (see DEFECT 2) — but the generic bottom-of-function fallback also
    // returns "retry", so the *outcome* here happens to be correct even
    // though the intended branch is dead code.
    const classified = youTubeProvider.classifyError(caught);
    expect(classified.type).toBe("retry");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — permanent-failure classification
// ---------------------------------------------------------------------------

describe("youTubeProvider contract — permanent-failure", () => {
  /**
   * CANARY — documents DEFECT 2 for the content-policy case. Unlike the
   * rate-limit scenario above (where the generic fallback happens to
   * produce the correct "retry" outcome), a permanent/forbidden failure
   * being misclassified as "retry" IS a functional bug: the publish
   * pipeline will retry (up to 3x) something that can never succeed,
   * instead of failing fast via FatalError.
   */
  it("[CONFIRMED DEFECT] a real forbidden/policy-violation rejection does not classify as bad-body", async () => {
    server.use(
      http.get(CHANNELS_URL, () =>
        HttpResponse.json(
          {
            error: {
              code: 403,
              message: "The request is not authorized to access this resource properly.",
              errors: [
                {
                  message: "The request is not authorized to access this resource properly.",
                  domain: "youtube.header",
                  reason: "forbidden",
                },
              ],
            },
          },
          { status: 403 },
        ),
      ),
    );

    let caught: unknown;
    try {
      await youTubeProvider.fetchPageInformation!("access-token");
    } catch (err) {
      caught = err;
    }

    expect((caught as Error).message).toBe(
      "The request is not authorized to access this resource properly.",
    );

    const classified = youTubeProvider.classifyError(caught);
    // INTENDED (per the "forbidden" branch in classifyError): "bad-body".
    // ACTUAL (confirmed real behavior — the defect):
    expect(classified.type).toBe("retry");
  });
});
