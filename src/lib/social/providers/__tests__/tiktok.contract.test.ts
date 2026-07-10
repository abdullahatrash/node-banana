// @vitest-environment node

/**
 * TikTok provider CONTRACT tests (MSW).
 *
 * Unlike `tiktok.test.ts` — which replaces `fetch` wholesale with
 * `vi.stubGlobal` — these tests exercise the provider's real `fetch()` calls
 * against a mocked TikTok Content Posting API boundary via MSW.
 *
 * Scenario classes (the contract every provider must satisfy):
 *   1. successful post publish (video, PULL_FROM_URL, async "processing")
 *   2. token-refresh trigger path        (access_token_invalid → "refresh-token")
 *   3. rate-limit retry classification   (rate_limit_exceeded → "retry")
 *   4. permanent-failure classification  (spam_risk_* → "bad-body")
 *
 * PLUS the async-finalization (reconcile) path that `getPostStatus()` drives:
 * the real TikTok `post/publish/status/fetch` endpoint transitioning through
 * PROCESSING_UPLOAD → PUBLISH_COMPLETE / FAILED.
 *
 * TikTok's Content Posting API returns real, non-2xx HTTP status codes for
 * every error class exercised below (unlike Meta's Graph API, which returns
 * HTTP 200 with an `error` object — see facebook/instagram/threads contract
 * files for that divergent, defect-triggering shape). The provider's thrown
 * Error interpolates both `response.status` and the raw response body text,
 * so classifyError()'s string-matching on real TikTok error codes
 * (`access_token_invalid`, `rate_limit_exceeded`, `spam_risk_*`, ...) is
 * genuinely reachable — no defect found for this provider.
 *
 * The provider code is intentionally UNMODIFIED.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupMswServer } from "@/test/msw/server";
import { clearRegistry } from "@/lib/social/provider-registry";
import { tikTokProvider } from "@/lib/social/providers/tiktok";
import type { PublishRequest } from "@/lib/social/provider-interface";

// ---------------------------------------------------------------------------
// TikTok Content Posting API endpoints exercised by tikTokProvider.post()
// ---------------------------------------------------------------------------

const VIDEO_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
const STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

const videoPost: PublishRequest = {
  postId: "our-post-1",
  content: "Hello from a contract test",
  media: [{ type: "video", url: "https://cdn.example.com/video.mp4" }],
};

// ---------------------------------------------------------------------------
// MSW server — default handlers describe the HAPPY PATH.
// ---------------------------------------------------------------------------

const server = setupMswServer(
  http.post(VIDEO_INIT_URL, () =>
    HttpResponse.json({ data: { publish_id: "publish-id-123" }, error: { code: "ok" } }),
  ),
  http.get(USER_INFO_URL, () =>
    HttpResponse.json({
      data: {
        user: {
          open_id: "open-id-1",
          display_name: "Contract Bot",
          avatar_url: "https://p16.tiktokcdn.com/avatar.jpg",
          username: "contractbot",
        },
      },
    }),
  ),
);

beforeEach(() => {
  clearRegistry();
  process.env.TIKTOK_CLIENT_KEY = "test-client-key";
  process.env.TIKTOK_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  delete process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_SECRET;
});

// ---------------------------------------------------------------------------
// Scenario 1 — successful post publish
// ---------------------------------------------------------------------------

describe("tikTokProvider contract — successful post publish", () => {
  it("initiates a video post against the live TikTok HTTP contract", async () => {
    const results = await tikTokProvider.post("open-id-1", "access-token", [
      videoPost,
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      postId: "our-post-1",
      platformPostId: "publish-id-123",
      platformPostUrl: "https://www.tiktok.com/@contractbot",
      status: "processing",
    });
  });
});

/**
 * Helper: run a publish that the platform rejects, and return the *real*
 * error the provider threw.
 */
async function captureThrownError(): Promise<unknown> {
  return tikTokProvider.post("open-id-1", "access-token", [videoPost]).then(
    () => {
      throw new Error("expected post() to reject, but it resolved");
    },
    (err: unknown) => err,
  );
}

// ---------------------------------------------------------------------------
// Scenario 2 — token-refresh trigger path
// ---------------------------------------------------------------------------

describe("tikTokProvider contract — token-refresh trigger", () => {
  it("classifies a real access_token_invalid rejection as refresh-token", async () => {
    server.use(
      http.post(VIDEO_INIT_URL, () =>
        HttpResponse.json(
          {
            data: {},
            error: {
              code: "access_token_invalid",
              message: "The access token is invalid or has expired.",
              log_id: "202401010000000000000000000000000",
            },
          },
          { status: 401 },
        ),
      ),
    );

    const error = await captureThrownError();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("access_token_invalid");

    const classified = tikTokProvider.classifyError(error);
    expect(classified.type).toBe("refresh-token");
    expect(classified.original).toBe(error);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — rate-limit retry classification
// ---------------------------------------------------------------------------

describe("tikTokProvider contract — rate-limit retry", () => {
  it("classifies a real rate_limit_exceeded rejection as retry", async () => {
    server.use(
      http.post(VIDEO_INIT_URL, () =>
        HttpResponse.json(
          {
            data: {},
            error: {
              code: "rate_limit_exceeded",
              message: "Rate limit exceeded for this application.",
              log_id: "202401010000000000000000000000001",
            },
          },
          { status: 429 },
        ),
      ),
    );

    const error = await captureThrownError();
    expect((error as Error).message).toContain("rate_limit_exceeded");

    const classified = tikTokProvider.classifyError(error);
    expect(classified.type).toBe("retry");
    expect(classified.message).toBe("TikTok API rate limit exceeded — will retry");
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — permanent-failure classification
// ---------------------------------------------------------------------------

describe("tikTokProvider contract — permanent-failure", () => {
  it("classifies a real spam_risk_too_many_posts rejection as bad-body", async () => {
    server.use(
      http.post(VIDEO_INIT_URL, () =>
        HttpResponse.json(
          {
            data: {},
            error: {
              code: "spam_risk_too_many_posts",
              message: "User has posted too many times today.",
              log_id: "202401010000000000000000000000002",
            },
          },
          { status: 400 },
        ),
      ),
    );

    const error = await captureThrownError();
    const classified = tikTokProvider.classifyError(error);
    expect(classified.type).toBe("bad-body");
  });
});

// ---------------------------------------------------------------------------
// Async-finalization (reconcile) path — getPostStatus()
// ---------------------------------------------------------------------------

describe("tikTokProvider contract — async publish finalization (getPostStatus)", () => {
  it("reports processing while TikTok is still uploading", async () => {
    server.use(
      http.post(STATUS_URL, () =>
        HttpResponse.json({ data: { status: "PROCESSING_UPLOAD" }, error: { code: "ok" } }),
      ),
    );

    const status = await tikTokProvider.getPostStatus?.(
      "contractbot",
      "access-token",
      "publish-id-123",
    );

    expect(status).toEqual({
      platformPostId: "publish-id-123",
      platformPostUrl: "https://www.tiktok.com/@contractbot",
      status: "processing",
    });
  });

  it("reports published once TikTok finishes processing", async () => {
    server.use(
      http.post(STATUS_URL, () =>
        HttpResponse.json({
          data: {
            status: "PUBLISH_COMPLETE",
            publicaly_available_post_id: ["7312345678901234567"],
          },
          error: { code: "ok" },
        }),
      ),
    );

    const status = await tikTokProvider.getPostStatus?.(
      "contractbot",
      "access-token",
      "publish-id-123",
    );

    expect(status).toEqual({
      platformPostId: "7312345678901234567",
      platformPostUrl: "https://www.tiktok.com/@contractbot/video/7312345678901234567",
      status: "published",
    });
  });

  it("reports failed with the real fail_reason when TikTok rejects the upload", async () => {
    server.use(
      http.post(STATUS_URL, () =>
        HttpResponse.json({
          data: { status: "FAILED", fail_reason: "video_pull_failed" },
          error: { code: "ok" },
        }),
      ),
    );

    const status = await tikTokProvider.getPostStatus?.(
      "contractbot",
      "access-token",
      "publish-id-123",
    );

    expect(status?.status).toBe("failed");
    expect(status?.errorMessage).toContain("video_pull_failed");
  });
});
